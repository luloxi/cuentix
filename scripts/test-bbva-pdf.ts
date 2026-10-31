/**
 * Needs a Worker request with the AI binding. On plain Node, extractPdfText
 * throws because Workers AI toMarkdown is not available.
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { parseBbvaStatementPdf } from "../src/lib/bbva/parse-pdf";

const dir =
  process.argv[2] ??
  "./statements" /* pass a folder with your own PDFs */;

async function main() {
  const files = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort();

  for (const f of files) {
    const buf = readFileSync(join(dir, f));
    const rows = await parseBbvaStatementPdf(buf);
    const ars = rows.reduce((s, r) => s + (r.amountArs ?? 0), 0);
    const usd = rows.reduce((s, r) => s + (r.amountUsd ?? 0), 0);
    const payments = rows.filter((r) => r.isPayment).length;
    const installments = rows.filter((r) => r.installment).length;
    console.log(
      `${f}: ${rows.length} mov · pagos ${payments} · cuotas ${installments} · ARS ${ars.toFixed(2)} · USD ${usd.toFixed(2)}`,
    );
    console.log("  sample:", rows.slice(0, 4).map((r) => ({
      d: r.date,
      desc: r.descriptionNormalized.slice(0, 40),
      ars: r.amountArs,
      usd: r.amountUsd,
      c: r.installment,
    })));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
