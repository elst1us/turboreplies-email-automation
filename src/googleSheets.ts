import { google, sheets_v4 } from "googleapis";
import {
  GoogleSheetsConfig,
  OutreachRow,
  RowUpdate,
  SHEET_COLUMNS,
  SheetCellValue,
  SheetColumn
} from "./types";

const LAST_COLUMN_LETTER = "Q";
const HEADER_ALIASES: Partial<Record<SheetColumn, string[]>> = {
  Property: ["Property/Business"]
};
const GOOGLE_REQUEST_RETRY_DELAYS_MS = [500, 1500, 3000];

function quoteSheetName(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

function columnLetterFromIndex(index: number): string {
  let dividend = index + 1;
  let columnName = "";

  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    columnName = String.fromCharCode(65 + modulo) + columnName;
    dividend = Math.floor((dividend - modulo) / 26);
  }

  return columnName;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isRetryableGoogleAuthError(error: unknown): boolean {
  const message = extractErrorMessage(error);

  return [
    "oauth2.googleapis.com/token failed",
    "getaddrinfo",
    "EAI_AGAIN",
    "ENOTFOUND",
    "ECONNRESET",
    "ETIMEDOUT",
    "socket hang up"
  ].some((fragment) => message.includes(fragment));
}

function isGoogleTokenError(error: unknown): boolean {
  return extractErrorMessage(error).includes("oauth2.googleapis.com/token");
}

export class GoogleSheetsClient {
  private readonly sheets: sheets_v4.Sheets;

  constructor(private readonly config: GoogleSheetsConfig) {
    const auth = new google.auth.JWT({
      email: config.serviceAccountEmail,
      key: config.privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });

    this.sheets = google.sheets({ version: "v4", auth });
  }

  private async withGoogleRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= GOOGLE_REQUEST_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (!isRetryableGoogleAuthError(error) || attempt === GOOGLE_REQUEST_RETRY_DELAYS_MS.length) {
          break;
        }

        await sleep(GOOGLE_REQUEST_RETRY_DELAYS_MS[attempt]);
      }
    }

    if (isGoogleTokenError(lastError)) {
      throw new Error(
        "Google OAuth token request failed. Check your network/VPN/firewall and retry; the service account JSON path is already being read correctly."
      );
    }

    throw lastError;
  }

  async readRows(): Promise<OutreachRow[]> {
    const range = `${quoteSheetName(this.config.sheetName)}!A1:${LAST_COLUMN_LETTER}`;
    const response = await this.withGoogleRetry(() =>
      this.sheets.spreadsheets.values.get({
        spreadsheetId: this.config.sheetId,
        range,
        valueRenderOption: "UNFORMATTED_VALUE"
      })
    );

    const values = response.data.values ?? [];
    if (values.length === 0) {
      throw new Error("The Google Sheet is empty.");
    }

    const headers = values[0].map((value) => String(value).trim());
    const headerIndexes = new Map<SheetColumn, number>();

    for (const header of SHEET_COLUMNS) {
      const candidates = [header, ...(HEADER_ALIASES[header] ?? [])];
      const matchedIndex = candidates
        .map((candidate) => headers.indexOf(candidate))
        .find((index) => index >= 0);

      if (matchedIndex !== undefined) {
        headerIndexes.set(header, matchedIndex);
      }
    }

    const missingHeaders = SHEET_COLUMNS.filter((header) => !headerIndexes.has(header));

    if (missingHeaders.length > 0) {
      throw new Error(`Missing expected sheet columns: ${missingHeaders.join(", ")}`);
    }

    return values
      .slice(1)
      .map((rawRow, rowIndex) => {
        const cells = {} as Record<SheetColumn, SheetCellValue>;
        for (const header of SHEET_COLUMNS) {
          const headerIndex = headerIndexes.get(header);
          if (headerIndex === undefined) {
            throw new Error(`Header mapping missing for column: ${header}`);
          }
          const value = rawRow[headerIndex];
          cells[header] = value === undefined || value === null ? "" : (value as SheetCellValue);
        }

        return {
          rowNumber: rowIndex + 2,
          cells
        };
      })
      .filter((row) =>
        SHEET_COLUMNS.some((column) => {
          const value = row.cells[column];
          return value !== "" && value !== false;
        })
      );
  }

  async updateRow(rowNumber: number, updates: RowUpdate): Promise<void> {
    const entries = Object.entries(updates) as Array<[SheetColumn, SheetCellValue]>;
    if (entries.length === 0) {
      return;
    }

    await this.withGoogleRetry(() =>
      this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.config.sheetId,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: entries.map(([column, value]) => {
            const columnIndex = SHEET_COLUMNS.indexOf(column);
            const a1Range = `${quoteSheetName(this.config.sheetName)}!${columnLetterFromIndex(columnIndex)}${rowNumber}`;
            return {
              range: a1Range,
              values: [[value]]
            };
          })
        }
      })
    );
  }
}
