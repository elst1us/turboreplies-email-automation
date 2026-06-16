export const SHEET_COLUMNS = [
  "Property",
  "Location",
  "Village",
  "Language",
  "Owner",
  "Email",
  "Phone/WhatsApp",
  "Instagram",
  "Hook",
  "Primary Channel",
  "Status",
  "Date sent",
  "Next Follow-up",
  "Follow-up Step",
  "Replied?",
  "Do Not Contact?",
  "Notes"
] as const;

// Optional columns are read by header name when present but are never required
// and never written back, so existing sheets keep working untouched.
export const OPTIONAL_SHEET_COLUMNS = ["Vertical"] as const;

export type SheetColumn = (typeof SHEET_COLUMNS)[number];
export type OptionalSheetColumn = (typeof OPTIONAL_SHEET_COLUMNS)[number];
export type SheetCellValue = string | number | boolean | "";
export type OutreachMode = "dry-run" | "send";

export interface OutreachRow {
  rowNumber: number;
  cells: Record<SheetColumn | OptionalSheetColumn, SheetCellValue>;
}

export interface ResendConfig {
  apiKey: string;
  fromEmail: string;
  fromName: string;
  replyTo: string;
}

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

export interface AppConfig {
  mode: OutreachMode;
  checkReplies: boolean;
  allowSendIfImapFails: boolean;
  csvPath: string;
  resend: ResendConfig;
  imap?: ImapConfig;
}

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export type RowUpdate = Partial<Record<SheetColumn, SheetCellValue>>;

export interface SendCandidate {
  label: string;
  row: OutreachRow;
  updates: RowUpdate;
  email: EmailContent;
}
