import path from "node:path";
import { CsvStore } from "./csvStore";
import { ImapReplyDetector } from "./imapReplies";
import { ResendClient } from "./resendClient";
import { buildEmail } from "./templates";
import { AppConfig, OutreachRow, RowUpdate, SendCandidate, SheetCellValue, SHEET_COLUMNS } from "./types";

const DEFAULT_CSV_PATH = "leads.csv";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function booleanEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) {
    return defaultValue;
  }
  return value.trim().toLowerCase() === "true";
}

function numberEnv(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid numeric environment variable: ${name}`);
  }

  return parsed;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTimestamp(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${formatDate(date)} ${hours}:${minutes}:${seconds}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function cumulativeFollowUpOffsetDays(followUpStep: string): number | null {
  if (followUpStep === "1") {
    return 3;
  }

  if (followUpStep === "2") {
    return 7;
  }

  if (followUpStep === "3") {
    return 14;
  }

  return null;
}

function parseSheetDate(value: SheetCellValue): Date | null {
  if (value === "" || value === false) {
    return null;
  }

  if (typeof value === "number") {
    const excelEpoch = new Date(1899, 11, 30);
    excelEpoch.setDate(excelEpoch.getDate() + Math.floor(value));
    return startOfDay(excelEpoch);
  }

  const stringValue = String(value).trim();
  if (!stringValue) {
    return null;
  }

  const isoMatch = stringValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return new Date(
      Number.parseInt(isoMatch[1], 10),
      Number.parseInt(isoMatch[2], 10) - 1,
      Number.parseInt(isoMatch[3], 10)
    );
  }

  const slashMatch = stringValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const first = Number.parseInt(slashMatch[1], 10);
    const second = Number.parseInt(slashMatch[2], 10);
    const year = Number.parseInt(slashMatch[3], 10);
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    return new Date(year, month - 1, day);
  }

  const parsed = new Date(stringValue);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return startOfDay(parsed);
}

function isTruthyCell(value: SheetCellValue): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  return String(value).trim().toLowerCase() === "true";
}

function isBlank(value: SheetCellValue): boolean {
  return String(value).trim().length === 0;
}

function textValue(value: SheetCellValue): string {
  return String(value ?? "").trim();
}

function appendNote(existing: SheetCellValue, note: string, now: Date): string {
  const prefix = `[${formatTimestamp(now)}] ${note}`;
  const current = String(existing || "").trim();
  return current ? `${current}\n${prefix}` : prefix;
}

function createThreadToken(row: OutreachRow): string {
  const seed = [
    textValue(row.cells.Email).toLowerCase(),
    textValue(row.cells.Property).toLowerCase(),
    textValue(row.cells.Location).toLowerCase(),
    textValue(row.cells.Village).toLowerCase(),
    String(row.rowNumber)
  ].join("|");
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }

  return `TR-${hash.toString(36).toUpperCase().padStart(6, "0")}`;
}

function extractThreadToken(notes: SheetCellValue): string | null {
  const match = String(notes || "").match(/\bTR-[A-Z0-9]{6,}\b/);
  return match ? match[0] : null;
}

function getThreadToken(row: OutreachRow): string {
  return extractThreadToken(row.cells.Notes) ?? createThreadToken(row);
}

function resolveNextFollowUpDate(row: OutreachRow): Date | null {
  const explicitNextFollowUp = parseSheetDate(row.cells["Next Follow-up"]);
  if (explicitNextFollowUp) {
    return explicitNextFollowUp;
  }

  const followUpStep = textValue(row.cells["Follow-up Step"]);
  const sentAt = parseSheetDate(row.cells["Date sent"]);
  const offsetDays = cumulativeFollowUpOffsetDays(followUpStep);

  if (!sentAt || offsetDays === null) {
    return null;
  }

  return startOfDay(addDays(sentAt, offsetDays));
}

function rowLabel(row: OutreachRow): string {
  const property = textValue(row.cells.Property);
  const email = textValue(row.cells.Email);
  return `row ${row.rowNumber}${property ? ` (${property})` : ""}${email ? ` <${email}>` : ""}`;
}

function applyLocalUpdates(row: OutreachRow, updates: RowUpdate): void {
  for (const column of SHEET_COLUMNS) {
    if (column in updates) {
      row.cells[column] = updates[column] as SheetCellValue;
    }
  }
}

function shouldNeverSend(row: OutreachRow): boolean {
  const status = textValue(row.cells.Status);
  return (
    isBlank(row.cells.Email) ||
    isTruthyCell(row.cells["Replied?"]) ||
    isTruthyCell(row.cells["Do Not Contact?"]) ||
    ["Needs reply", "Interested", "Not interested", "Bad fit"].includes(status)
  );
}

// The canonical "first email was sent" state transition, shared by the automated
// sender and the manual `mark-sent` command so both leave a row in an identical
// state and the follow-up phases behave the same way.
export function firstEmailSentUpdates(row: OutreachRow, now: Date, note: string): RowUpdate {
  const todayStart = startOfDay(now);
  const threadToken = getThreadToken(row);
  return {
    Status: "Active",
    "Date sent": formatDate(todayStart),
    "Next Follow-up": formatDate(addDays(todayStart, 3)),
    "Follow-up Step": "1",
    Notes: appendNote(row.cells.Notes, `${note} (${threadToken})`, now)
  };
}

function buildCandidate(row: OutreachRow, today: Date, now: Date): SendCandidate | null {
  if (shouldNeverSend(row)) {
    return null;
  }

  const status = textValue(row.cells.Status);
  const followUpStep = textValue(row.cells["Follow-up Step"]);
  const nextFollowUp = resolveNextFollowUpDate(row);
  const todayStart = startOfDay(today);
  const threadToken = getThreadToken(row);

  if (status === "To do" && followUpStep === "0") {
    return {
      label: "First email",
      row,
      updates: firstEmailSentUpdates(row, now, "First email sent via Resend"),
      email: buildEmail(row, 0)
    };
  }

  if (status !== "Active" || !nextFollowUp || nextFollowUp.getTime() > todayStart.getTime()) {
    return null;
  }

  if (followUpStep === "1") {
    return {
      label: "Follow-up 1",
      row,
      updates: {
        "Next Follow-up": formatDate(addDays(todayStart, 4)),
        "Follow-up Step": "2",
        Notes: appendNote(row.cells.Notes, `Follow-up 1 sent via Resend (${threadToken})`, now)
      },
      email: buildEmail(row, 1)
    };
  }

  if (followUpStep === "2") {
    return {
      label: "Follow-up 2",
      row,
      updates: {
        "Next Follow-up": formatDate(addDays(todayStart, 7)),
        "Follow-up Step": "3",
        Notes: appendNote(row.cells.Notes, `Follow-up 2 sent via Resend (${threadToken})`, now)
      },
      email: buildEmail(row, 2)
    };
  }

  if (followUpStep === "3") {
    return {
      label: "Follow-up 3",
      row,
      updates: {
        Status: "Not interested",
        "Next Follow-up": "",
        "Follow-up Step": "Done",
        Notes: appendNote(row.cells.Notes, `Follow-up 3 sent via Resend, sequence ended (${threadToken})`, now)
      },
      email: buildEmail(row, 3)
    };
  }

  return null;
}

function formatUpdates(updates: RowUpdate): string {
  return Object.entries(updates)
    .map(([key, value]) => `${key}=${value === "" ? "(empty)" : JSON.stringify(value)}`)
    .join(", ");
}

export function loadConfig(mode: "dry-run" | "send"): AppConfig {
  const checkReplies = booleanEnv("CHECK_REPLIES", false);
  const fromEmail = process.env.OUTREACH_FROM_EMAIL?.trim() || "hello@turboreplies.com";
  const fromName = process.env.OUTREACH_FROM_NAME?.trim() || "Federico | TurboReplies";
  const replyTo = process.env.OUTREACH_REPLY_TO?.trim() || fromEmail;
  const resendApiKey = mode === "send" ? requiredEnv("RESEND_API_KEY") : process.env.RESEND_API_KEY?.trim() || "dry-run";
  const csvPath = path.resolve(process.cwd(), process.env.OUTREACH_CSV_PATH?.trim() || DEFAULT_CSV_PATH);

  return {
    mode,
    checkReplies,
    allowSendIfImapFails: booleanEnv("ALLOW_SEND_IF_IMAP_FAILS", false),
    csvPath,
    resend: {
      apiKey: resendApiKey,
      fromEmail,
      fromName,
      replyTo
    },
    imap: checkReplies
      ? {
          host: requiredEnv("IMAP_HOST"),
          port: numberEnv("IMAP_PORT", 993),
          secure: booleanEnv("IMAP_SECURE", true),
          user: requiredEnv("IMAP_USER"),
          pass: requiredEnv("IMAP_PASS")
        }
      : undefined
  };
}

export async function runOutreach(config: AppConfig): Promise<void> {
  const store = new CsvStore(config.csvPath);
  const resendClient = config.mode === "send" ? new ResendClient(config.resend) : null;
  const rows = await store.readRows();
  const now = new Date();
  const today = startOfDay(now);

  console.log(`Loaded ${rows.length} rows from ${config.csvPath}.`);

  if (config.checkReplies && config.imap) {
    const detector = new ImapReplyDetector(config.imap);

    try {
      await detector.connect();
      console.log("IMAP reply detection enabled.");

      for (const row of rows) {
        const status = textValue(row.cells.Status);
        if (status !== "Active" || isTruthyCell(row.cells["Replied?"])) {
          continue;
        }

        const email = textValue(row.cells.Email);
        const sentAt = parseSheetDate(row.cells["Date sent"]);
        if (!email || !sentAt) {
          continue;
        }

        const hasReply = await detector.hasReplySince(email, sentAt);
        if (!hasReply) {
          continue;
        }

        const updates: RowUpdate = {
          Status: "Needs reply",
          "Replied?": true,
          "Next Follow-up": "",
          "Follow-up Step": "Done",
          Notes: appendNote(row.cells.Notes, "Reply detected via IMAP", now)
        };

        if (config.mode === "send") {
          await store.updateRow(row.rowNumber, updates);
          console.log(`Updated ${rowLabel(row)} after reply detection.`);
        } else {
          console.log(`[dry-run] Would update ${rowLabel(row)} after reply detection.`);
          console.log(`[dry-run] Changes: ${formatUpdates(updates)}`);
        }

        applyLocalUpdates(row, updates);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (config.mode === "dry-run") {
        console.warn(`IMAP warning: ${message}`);
      } else if (!config.allowSendIfImapFails) {
        throw new Error(`IMAP failed before sending: ${message}`);
      } else {
        console.warn(`IMAP warning: ${message}`);
        console.warn("Continuing because ALLOW_SEND_IF_IMAP_FAILS=true.");
      }
    } finally {
      await detector.close().catch(() => undefined);
    }
  }

  const candidates = rows
    .map((row) => buildCandidate(row, today, now))
    .filter((candidate): candidate is SendCandidate => candidate !== null);

  if (candidates.length === 0) {
    console.log("No eligible emails found.");
    return;
  }

  console.log(`Found ${candidates.length} eligible email(s).`);

  for (const candidate of candidates) {
    const email = textValue(candidate.row.cells.Email);
    console.log(`${config.mode === "dry-run" ? "[dry-run] " : ""}${candidate.label}: ${rowLabel(candidate.row)}`);
    console.log(`Subject: ${candidate.email.subject}`);
    console.log("Body preview:");
    console.log(candidate.email.text);
    console.log(`Changes: ${formatUpdates(candidate.updates)}`);

    if (config.mode === "dry-run") {
      continue;
    }

    try {
      if (!resendClient) {
        throw new Error("Resend client is unavailable in send mode.");
      }

      const messageId = await resendClient.sendEmail(email, candidate.email);
      await store.updateRow(candidate.row.rowNumber, candidate.updates);
      applyLocalUpdates(candidate.row, candidate.updates);
      console.log(`Sent ${candidate.label.toLowerCase()} to ${email} (${messageId}).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed sending ${candidate.label.toLowerCase()} to ${email}: ${message}`);
    }
  }
}
