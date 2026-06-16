import "dotenv/config";
import { createInterface } from "node:readline/promises";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "./outreach";
import { CsvStore } from "./csvStore";
import { buildEmail } from "./templates";
import { OPTIONAL_SHEET_COLUMNS, OptionalSheetColumn, OutreachRow, SHEET_COLUMNS, SheetCellValue, SheetColumn } from "./types";

type LeadRow = Partial<Record<SheetColumn | OptionalSheetColumn, SheetCellValue>>;

// `npm run add <url>` — fetch a business website, let Claude classify it and
// draft a personal Hook, then append a ready-to-send lead row to leads.csv after
// you confirm. Turns "add a new business" into "paste a URL, approve a hook".

const MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-4-8";

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractEmails(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    const email = match[0].toLowerCase();
    if (!/\.(png|jpe?g|gif|webp|svg)$/.test(email)) {
      found.add(email);
    }
  }
  return [...found];
}

function extractInstagram(html: string): string {
  const match = html.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
  return match ? `@${match[1].replace(/\/$/, "")}` : "";
}

function extractPhone(html: string): string {
  const match = html.match(/(?:tel:|>)\s*(\+?\d[\d\s().-]{6,}\d)/);
  return match ? match[1].trim() : "";
}

function extractTitle(html: string): string {
  const ogSiteName = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
  if (ogSiteName) {
    return ogSiteName[1].trim();
  }
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return title ? title[1].trim() : "";
}

function extractHtmlLang(html: string): string {
  const match = html.match(/<html[^>]+lang=["']([a-z]{2})/i);
  return match ? match[1].toLowerCase() : "";
}

interface LeadDraft {
  businessName: string;
  email: string;
  location: string;
  language: "it" | "en" | "fr" | "de" | "es";
  vertical: "clinic" | "real-estate" | "hotel";
  hook: string;
}

function previewEmail(row: LeadRow): string {
  const cells = {} as Record<string, SheetCellValue>;
  for (const column of [...SHEET_COLUMNS, ...OPTIONAL_SHEET_COLUMNS]) {
    cells[column] = "";
  }
  Object.assign(cells, row);
  const outreachRow = { rowNumber: 0, cells } as unknown as OutreachRow;
  const email = buildEmail(outreachRow, 0);
  return `Subject: ${email.subject}\n\n${email.text}`;
}

async function main(): Promise<void> {
  const url = process.argv[2]?.trim();
  if (!url) {
    console.error("Usage: npm run add <website-url>");
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.error("Missing ANTHROPIC_API_KEY in .env");
    process.exit(1);
  }

  const config = loadConfig("dry-run");
  const store = new CsvStore(config.csvPath);

  console.log(`Fetching ${url} ...`);
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (TurboReplies lead research)" } });
  if (!response.ok) {
    console.error(`Fetch failed: ${response.status} ${response.statusText}`);
    process.exit(1);
  }
  const html = await response.text();

  const signals = {
    title: extractTitle(html),
    emails: extractEmails(html),
    instagram: extractInstagram(html),
    phone: extractPhone(html),
    htmlLang: extractHtmlLang(html)
  };
  const pageText = htmlToText(html).slice(0, 6000);

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system:
      "You research small and local businesses for TurboReplies, an AI assistant that answers inbound customer messages (WhatsApp, Instagram, Facebook, website chat) 24/7 in 5 languages, qualifies the lead, and hands it to staff. Given a business website, classify it and write ONE short, specific cold-outreach hook line. Respond with ONLY a single JSON object — no markdown fences, no prose.",
    messages: [
      {
        role: "user",
        content: `URL: ${url}
Detected title: ${signals.title || "(none)"}
Candidate emails: ${signals.emails.join(", ") || "(none found)"}
Instagram: ${signals.instagram || "(none)"}
Phone: ${signals.phone || "(none)"}
HTML lang: ${signals.htmlLang || "(none)"}

Vertical guide: clinic = medical/dental/aesthetic studios; real-estate = property agencies; hotel = hotels, B&B, hostels, short-term-rental managers.
For clinics, frame the hook as complementing (not replacing) any existing booking system, emphasizing multilingual WhatsApp/Instagram pre-booking messages.

Return a JSON object with exactly these keys:
- "businessName": string
- "email": best public contact email found on the site, or "" if none
- "location": city or town if found, else ""
- "language": one of "it", "en", "fr", "de", "es"
- "vertical": one of "clinic", "real-estate", "hotel"
- "hook": one specific sentence in the business's language referencing a concrete detail from the site; no greeting; max ~160 chars

Website text (truncated):
${pageText}`
      }
    ]
  });

  const rawText = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  let draft: LeadDraft;
  try {
    draft = JSON.parse(jsonMatch ? jsonMatch[0] : rawText) as LeadDraft;
  } catch {
    console.error(`Could not parse model output:\n${rawText}`);
    process.exit(1);
  }

  const email = (draft.email || signals.emails[0] || "").trim();

  const row: LeadRow = {
    Property: draft.businessName || signals.title,
    Location: draft.location || "",
    Language: draft.language || signals.htmlLang || "it",
    Email: email,
    "Phone/WhatsApp": signals.phone,
    Instagram: signals.instagram,
    Hook: draft.hook || "",
    "Primary Channel": "Email",
    Status: "To do",
    "Follow-up Step": "0",
    "Replied?": "FALSE",
    "Do Not Contact?": "FALSE",
    Vertical: draft.vertical || "hotel"
  };

  console.log("\n--- Proposed lead ---");
  console.log(`Business:  ${row.Property}`);
  console.log(`Location:  ${row.Location || "(none)"}`);
  console.log(`Vertical:  ${row.Vertical}`);
  console.log(`Language:  ${row.Language}`);
  console.log(`Email:     ${email || "(none found — fill manually before sending)"}`);
  console.log(`Phone:     ${signals.phone || "(none)"}`);
  console.log(`Instagram: ${signals.instagram || "(none)"}`);
  console.log(`Hook:      ${row.Hook}`);
  console.log("\n--- First email preview ---");
  console.log(previewEmail(row));

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("\nAppend this lead to leads.csv? [y/N] ")).trim().toLowerCase();
  rl.close();

  if (answer !== "y" && answer !== "yes") {
    console.log("Not added.");
    return;
  }

  await store.appendRow(row);
  console.log(`Added to ${config.csvPath}.`);
  if (!email) {
    console.log("Note: no email was found — add one in leads.csv before sending.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
