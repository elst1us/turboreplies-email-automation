import "dotenv/config";
import { loadConfig } from "./outreach";
import { CsvStore } from "./csvStore";
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
  const store = new CsvStore(config.csvPath);
  const rows = await store.readRows();

  let shown = 0;
  for (const row of rows) {
    const email = String(row.cells.Email ?? "").trim();
    if (!email) continue;
    if (isTrue(row.cells["Replied?"])) continue;
    if (isTrue(row.cells["Do Not Contact?"])) continue;

    // Only render genuine first-email candidates (Status blank/"To do" and
    // Follow-up Step blank/"0") so leads already in the follow-up sequence
    // aren't re-drafted as if they were new.
    const status = String(row.cells.Status ?? "").trim();
    const step = String(row.cells["Follow-up Step"] ?? "").trim();
    if (status !== "" && status !== "To do") continue;
    if (step !== "" && step !== "0") continue;

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
