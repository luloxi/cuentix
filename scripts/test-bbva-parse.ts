import { readFileSync } from "fs";
import { parseBbvaWorkbook, parseTransparenciaConsumos } from "../src/lib/bbva/parse";
import { matchCategory } from "../src/lib/categorize/rules";

const bbvaPath =
  process.argv[2] ||
  "/mnt/c/Users/usuario/Downloads/Últimos movimientos.xlsx";
const transpPath =
  process.argv[3] ||
  "/mnt/c/Users/usuario/Downloads/Transparencia_Actualizada_Junio2026.xlsx";

const bbva = parseBbvaWorkbook(readFileSync(bbvaPath));
console.log("BBVA movements:", bbva.length);
console.log("sample:", bbva.slice(0, 3));

const cats: Record<string, number> = {};
for (const m of bbva) {
  const c = matchCategory(m.descriptionNormalized);
  cats[c.name] = (cats[c.name] ?? 0) + 1;
}
console.log("BBVA categories:", cats);

const tc = parseTransparenciaConsumos(readFileSync(transpPath));
console.log("Transparencia consumos:", tc.length);
console.log("sample:", tc.slice(0, 2));
