import "dotenv/config";
import { loadConfig } from "./outreach";
import { GoogleSheetsClient } from "./googleSheets";
import { buildEmail } from "./templates";

// Renders the first outreach email for every contactable lead in the sheet so
// they can be sent by hand (copy-paste). It reads only, sends nothing, and
// writes nothing. Because it uses the same buildEmail() as the automated send,
// the manual first touch and the automated follow-ups stay in sync.

function isTrue(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "si" || normalized === "sì";
}

async function main(): Promise<void> {
  const config = loadConfig("dry-run");
  const client = new GoogleSheetsClient(config.googleSheets);
  const rows = await client.readRows();

  let shown = 0;
  for (const row of rows) {
    const email = String(row.cells.Email ?? "").trim();
    if (!email) continue;
    if (isTrue(row.cells["Replied?"])) continue;
    if (isTrue(row.cells["Do Not Contact?"])) continue;

    const content = buildEmail(row, 0);
    shown += 1;

    const vertical = String(row.cells.Vertical || "").trim() || "(blank -> hotel)";
    const language = String(row.cells.Language || "").trim() || "-";

    console.log("\n" + "=".repeat(76));
    console.log(`Row ${row.rowNumber}  |  ${email}  |  Vertical=${vertical}  |  Lang=${language}`);
    console.log("=".repeat(76));
    console.log(`Subject: ${content.subject}\n`);
    console.log(content.text);
  }

  console.log(`\n${shown} first-outreach draft(s) ready for manual sending.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
