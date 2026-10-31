/**
 * One-off: import BBVA PDFs/XLS into the owner's household.
 * Usage: DIR=/path npx tsx --env-file=.env.local scripts/import-statements.ts
 */
import fs from "fs";
import path from "path";
import { importBbvaFile } from "../src/lib/import/bbva";

const DIR =
  process.env.DIR ||
  "/mnt/c/Users/usuario/Downloads/drive-download-20260804T130106Z-1-001";
const householdId = "566f730a-4e56-4a9a-8bb8-9e505e954b0e";
const userId = "e7a4756a-97b8-4038-b57e-5aac635c85bf";

const files = [
  "2025-05.pdf",
  "2025-06.pdf",
  "2025-07.pdf",
  "2025-08.pdf",
  "2025-09.pdf",
  "2025-10.pdf",
  "2025-11.pdf",
  "2025-12.pdf",
  "2026-01.pdf",
  "2026-02.pdf",
  "2026-03 - Últimos movimientos.xls",
  "2026-04 - Últimos movimientos.xls",
  "2026-05 - Últimos movimientos.xls",
  "2026-06 - Últimos movimientos.xlsx",
];

async function main() {

  let totalInserted = 0;
  let totalAlready = 0;
  let totalRead = 0;

  for (const name of files) {
    const full = path.join(DIR, name);
    if (!fs.existsSync(full)) {
      console.log("MISSING", name);
      continue;
    }
    const buffer = fs.readFileSync(full);
    try {
      const r = await importBbvaFile({
        householdId,
        userId,
        fileName: name,
        buffer,
      });
      totalInserted += r.inserted;
      totalAlready += r.alreadyExists;
      totalRead += r.total;
      console.log(
        `${name.padEnd(42)} read=${String(r.total).padStart(4)} new=${String(r.inserted).padStart(4)} exists=${String(r.alreadyExists).padStart(4)}  ${r.message ?? ""}`,
      );
      if (r.total === 0) console.log("  WARN: 0 movements parsed");
    } catch (e) {
      console.error("FAIL", name, e instanceof Error ? e.message : e);
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log({ totalRead, totalInserted, totalAlready });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
