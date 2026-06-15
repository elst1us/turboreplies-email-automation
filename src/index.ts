import "dotenv/config";
import { loadConfig, runOutreach } from "./outreach";
import { OutreachMode } from "./types";

function resolveMode(argv: string[]): OutreachMode {
  if (argv.includes("--dry-run")) {
    return "dry-run";
  }

  if (argv.includes("--send")) {
    return "send";
  }

  throw new Error("Specify either --dry-run or --send.");
}

async function main(): Promise<void> {
  const mode = resolveMode(process.argv.slice(2));
  const config = loadConfig(mode);
  await runOutreach(config);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
