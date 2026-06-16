import { readFileSync, writeFileSync } from "node:fs";
import {
  OPTIONAL_SHEET_COLUMNS,
  OptionalSheetColumn,
  OutreachRow,
  RowUpdate,
  SHEET_COLUMNS,
  SheetCellValue,
  SheetColumn
} from "./types";

// Accept the original Google Sheet header for a clean drop-in migration.
const HEADER_ALIASES: Partial<Record<SheetColumn, string[]>> = {
  Property: ["Property/Business"]
};

// Minimal RFC-4180-style parser: handles quoted fields, "" escapes, and commas
// or newlines inside quotes (Notes can contain embedded newlines).
function parseCsv(text: string): string[][] {
  let input = text;
  if (input.charCodeAt(0) === 0xfeff) {
    input = input.slice(1);
  }

  const rows: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      record.push(field);
      field = "";
      index += 1;
      continue;
    }
    if (char === "\r") {
      index += 1;
      continue;
    }
    if (char === "\n") {
      record.push(field);
      rows.push(record);
      record = [];
      field = "";
      index += 1;
      continue;
    }

    field += char;
    index += 1;
  }

  if (field.length > 0 || record.length > 0) {
    record.push(field);
    rows.push(record);
  }

  return rows;
}

function serializeField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function serializeCsv(rows: string[][]): string {
  return rows.map((record) => record.map(serializeField).join(",")).join("\n") + "\n";
}

function cellToString(value: SheetCellValue): string {
  if (value === "") {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  return String(value);
}

function buildHeaderIndexes(headers: string[]): Map<SheetColumn, number> {
  const headerIndexes = new Map<SheetColumn, number>();

  for (const header of SHEET_COLUMNS) {
    const candidates = [header, ...(HEADER_ALIASES[header] ?? [])];
    const matchedIndex = candidates
      .map((candidate) => headers.indexOf(candidate))
      .find((position) => position >= 0);

    if (matchedIndex !== undefined) {
      headerIndexes.set(header, matchedIndex);
    }
  }

  return headerIndexes;
}

// Same read/update interface as the former GoogleSheetsClient, backed by a local
// CSV file. rowNumber stays 1-based with the header as line 1 (first data row 2).
export class CsvStore {
  constructor(private readonly filePath: string) {}

  private read(): { headers: string[]; records: string[][] } {
    let text: string;
    try {
      text = readFileSync(this.filePath, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to read CSV at ${this.filePath}: ${message}`);
    }

    const rows = parseCsv(text);
    if (rows.length === 0) {
      throw new Error(`The CSV file is empty: ${this.filePath}`);
    }

    const [headerRow, ...records] = rows;
    return { headers: headerRow.map((header) => header.trim()), records };
  }

  async readRows(): Promise<OutreachRow[]> {
    const { headers, records } = this.read();
    const headerIndexes = buildHeaderIndexes(headers);

    const missingHeaders = SHEET_COLUMNS.filter((header) => !headerIndexes.has(header));
    if (missingHeaders.length > 0) {
      throw new Error(`Missing expected CSV columns: ${missingHeaders.join(", ")}`);
    }

    const optionalHeaderIndexes = new Map<OptionalSheetColumn, number>();
    for (const header of OPTIONAL_SHEET_COLUMNS) {
      const position = headers.indexOf(header);
      if (position >= 0) {
        optionalHeaderIndexes.set(header, position);
      }
    }

    return records
      .map((raw, index) => {
        const cells = {} as Record<SheetColumn | OptionalSheetColumn, SheetCellValue>;
        for (const header of SHEET_COLUMNS) {
          const position = headerIndexes.get(header);
          cells[header] = position === undefined ? "" : raw[position] ?? "";
        }
        for (const header of OPTIONAL_SHEET_COLUMNS) {
          const position = optionalHeaderIndexes.get(header);
          cells[header] = position === undefined ? "" : raw[position] ?? "";
        }
        return { rowNumber: index + 2, cells };
      })
      .filter((row) => SHEET_COLUMNS.some((column) => row.cells[column] !== "" && row.cells[column] !== false));
  }

  async updateRow(rowNumber: number, updates: RowUpdate): Promise<void> {
    const entries = Object.entries(updates) as Array<[SheetColumn, SheetCellValue]>;
    if (entries.length === 0) {
      return;
    }

    const { headers, records } = this.read();
    const headerIndexes = buildHeaderIndexes(headers);

    const record = records[rowNumber - 2];
    if (!record) {
      throw new Error(`CSV row ${rowNumber} not found for update.`);
    }

    const normalized = records.map((row) => {
      const copy = row.slice();
      while (copy.length < headers.length) {
        copy.push("");
      }
      return copy;
    });

    const targetRecord = normalized[rowNumber - 2];
    for (const [column, value] of entries) {
      const columnIndex = headerIndexes.get(column);
      if (columnIndex === undefined) {
        throw new Error(`Cannot update unknown CSV column: ${column}`);
      }
      targetRecord[columnIndex] = cellToString(value);
    }

    writeFileSync(this.filePath, serializeCsv([headers, ...normalized]), "utf8");
  }
}
