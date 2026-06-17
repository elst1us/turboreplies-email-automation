import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { CsvStore } from "./csvStore";
import { firstEmailSentUpdates, loadConfig } from "./outreach";
import { OutreachRow } from "./types";

// `npm run mark-sent <email|row> [...]` (or --all) records that you sent the
// first email by hand, applying the SAME state transition the automated sender
// uses — Status=Active, Date sent=today, Follow-up Step=1, Next Follow-up=+3
// days — so `npm run send` then drives follow-ups exactly as it would have.

function isTrue(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "si" || normalized === "sì";
}

function isFirstEmailCandidate(row: OutreachRow): boolean {
  const email = String(row.cells.Email ?? "").trim();
  if (!email) return false;
  if (isTrue(row.cells["Replied?"])) return false;
  if (isTrue(row.cells["Do Not Contact?"])) return false;
  const status = String(row.cells.Status ?? "").trim();
  const step = String(row.cells["Follow-up Step"] ?? "").trim();
  if (status !== "" && status !== "To do") return false;
  if (step !== "" && step !== "0") return false;
  return true;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // Accept bare keywords (`all`, `yes`) as well as flags (`--all`, `--yes`) so
  // `npm run mark-sent all` works without npm's `--` separator.
  const markAll = args.includes("--all") || args.includes("all");
  const autoYes = args.includes("--yes") || args.includes("-y") || args.includes("yes");
  const identifiers = args.filter((arg) => !arg.startsWith("-") && arg !== "all" && arg !== "yes");

  if (!markAll && identifiers.length === 0) {
    console.error("Usage: npm run mark-sent <email|rowNumber> [more...]   (or 'all' for every To do lead)");
    process.exit(1);
  }

  const config = loadConfig("dry-run");
  const store = new CsvStore(config.csvPath);
  const candidates = (await store.readRows()).filter(isFirstEmailCandidate);

  let targets: OutreachRow[];
  if (markAll) {
    targets = candidates;
  } else {
    const wanted = new Set(identifiers.map((value) => value.toLowerCase()));
    targets = candidates.filter(
      (row) =>
        wanted.has(String(row.rowNumber)) || wanted.has(String(row.cells.Email ?? "").trim().toLowerCase())
    );
    const matched = new Set<string>();
    for (const row of targets) {
      matched.add(String(row.rowNumber));
      matched.add(String(row.cells.Email ?? "").trim().toLowerCase());
    }
    const missing = identifiers.filter((value) => !matched.has(value.toLowerCase()));
    if (missing.length > 0) {
      console.warn(`No first-email candidate matched: ${missing.join(", ")}`);
    }
  }

  if (targets.length === 0) {
    console.log("Nothing to mark.");
    return;
  }

  console.log("Will mark as first-email-sent (Status=Active, Date sent=today, Follow-up Step=1, Next Follow-up=+3 days):");
  for (const row of targets) {
    console.log(`  row ${row.rowNumber}  ${row.cells.Property}  <${row.cells.Email}>`);
  }

  if (!autoYes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question(`Proceed with ${targets.length} row(s)? [y/N] `)).trim().toLowerCase();
    rl.close();
    if (answer !== "y" && answer !== "yes") {
      console.log("Cancelled.");
      return;
    }
  }

  const now = new Date();
  for (const row of targets) {
    await store.updateRow(row.rowNumber, firstEmailSentUpdates(row, now, "First email sent manually"));
    console.log(`Marked row ${row.rowNumber} (${row.cells.Email}).`);
  }
  console.log(`Done. ${targets.length} row(s) updated — npm run send will handle follow-ups.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
