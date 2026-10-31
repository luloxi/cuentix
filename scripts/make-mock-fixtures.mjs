// Generates MOCK statement fixtures (no real people, amounts or accounts).
// Usage: node scripts/make-mock-fixtures.mjs   → writes ./fixtures/**
import * as XLSX from "xlsx";
import { mkdirSync } from "node:fs";

let seed = 20260901;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const pad = (n) => String(n).padStart(2, "0");
const ars = (n) =>
  n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MERCHANTS = [
  "DIA TIENDA 536", "RAPPI", "PAYU*AR*UBER", "MERPAGO*OPEN25", "CAFE DEMO",
  "KIOSCO DEMO", "SUPER DEMO", "FARMACIA DEMO", "PANADERIA DEMO", "LIBRERIA DEMO",
];

function write(path, wb, bookType) {
  mkdirSync(path.split("/").slice(0, -1).join("/"), { recursive: true });
  XLSX.writeFile(wb, path, { bookType });
}

function dmy(d, y4 = true) {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${y4 ? d.getFullYear() : String(d.getFullYear()).slice(2)}`;
}

// ── BBVA "Últimos movimientos" (xlsx) ───────────────────────────────────────
function ultimos(path, rows) {
  const aoa = [[], ["Últimos Movimientos"], ["Fecha y hora", "Movimientos", "Cuota", "Monto"], ...rows];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "movements");
  write(path, wb, "xlsx");
}
ultimos("fixtures/bbva-card/ultimos-movimientos.xlsx", [
  ["01/09/26", "SU PAGO EN PESOS", "-", "$ -50.000,00"],
  ["01/09/26", "SU PAGO EN USD", "-", "USD -10,00"],
  ["23/08/26", "MERPAGO*TEMBICI", "-", "$ 140,00"],
  ["22/08/26", "MERPAGO*TEMBICI", "-", "$ 140,00"],
]);
{
  const rows = [];
  const base = new Date(2026, 5, 15);
  for (let i = 0; i < 90; i++) {
    const d = new Date(base.getTime() - i * 86400000 * 0.7);
    rows.push([dmy(d, false), pick(MERCHANTS), "-", `$ ${ars(1000 + Math.round(rnd() * 40000))}`]);
  }
  rows.push(["14/06/26", "VERCEL INC.", "-", "USD 20,00"]);
  rows.push(["05/06/26", "SU PAGO EN PESOS", "-", "$ -28.000,00"]);
  rows.push(["06/05/26", "LIBRERIA DEMO", "02/06", "$ 39.000,00"]);
  ultimos("fixtures/bbva-card/ultimos-movimientos-2.xlsx", rows);
}

// ── BBVA "Movimientos del período" (xls, two cards) ─────────────────────────
function period(path, sheetName, cardA, cardB, installA, installB) {
  const aoa = [[], ["Movimientos del Período"], ["Nro. Tarjeta", "Fecha", "Establecimiento", "Cuota", "Importe en $ ", "Importe en U$S"]];
  const block = (rowsN, last4, specials) => {
    let total = 0;
    const lines = [];
    const base = new Date(2026, 7, 4);
    for (let i = 0; i < rowsN; i++) {
      const d = new Date(base.getTime() - i * 86400000 * 1.3);
      const amount = 2000 + Math.round(rnd() * 50000);
      total += amount;
      lines.push(["", dmy(d), pick(MERCHANTS), "/", ars(amount), ""]);
    }
    for (const s of specials) {
      lines.push(["", s.date, s.desc, s.cuota ?? "/", s.ars ? ars(s.ars) : "", s.usd ? ars(s.usd) : ""]);
      total += s.ars ?? 0;
    }
    lines.push([`Total Tarjeta Nro ****${last4}`, "", "", "", ars(total), ""]);
    return lines;
  };
  aoa.push(...block(cardA.n, cardA.last4, cardA.specials));
  aoa.push(...block(cardB.n, cardB.last4, cardB.specials));
  aoa.push(["", "", "Monto total de los Movimientos del período", "", ars(1_000_000), ""]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  write(path, wb, "biff8");
}
const bike = { date: "23/07/2026", desc: "MERPAGO*TEMBICI", ars: 140 };
const grok = { date: "12/07/2026", desc: "GROK XAI         demo0001", usd: 9.9, ars: 0 };
period("fixtures/bbva-card/mov-periodo-a.xls", "Mov_Periodo_07-09-2026",
  { n: 5, last4: "7022", specials: [{ date: "06/05/2026", desc: "PENGUIN GALERIAS PACIF", cuota: "4/6", ars: 39000 }] },
  { n: 42, last4: "8958", specials: [bike, grok, { date: "26/05/2026", desc: "MACOWENS", cuota: "3/3", ars: 12660 }] });
period("fixtures/bbva-card/mov-periodo-b.xls", "Mov_Periodo_07-08-2026",
  { n: 9, last4: "7022", specials: [{ date: "06/05/2026", desc: "PENGUIN GALERIAS PACIF", cuota: "3/6", ars: 39000 }] },
  { n: 70, last4: "8958", specials: [bike, grok] });
period("fixtures/bbva-card/mov-periodo-c.xls", "Mov_Periodo_15-06-2026",
  { n: 4, last4: "7022", specials: [{ date: "06/05/2026", desc: "PENGUIN GALERIAS PACIF", cuota: "2/6", ars: 39000 }] },
  { n: 30, last4: "8958", specials: [bike, grok, { date: "03/06/2026", desc: "LIBRERIA DEMO", cuota: "1/6", ars: 36000 }] });

// ── Fiwind "Actividad" (xlsx) ───────────────────────────────────────────────
function fiwind(path, startDate, n, opts = {}) {
  const head = ["Fecha", "Tipo", "Monto", "Moneda", "Monto Origen", "Moneda Origen", "Precio"];
  const rows = [head];
  const stamp = (d, h) => `${dmy(d)} ${pad(h)}:${pad(Math.floor(rnd() * 60))}:${pad(Math.floor(rnd() * 60))}`;
  for (let i = 0; i < n; i++) {
    const d = new Date(startDate.getTime() - Math.floor(i / 2) * 86400000);
    const k = i % 8;
    if (k === 0) rows.push([stamp(d, 3), "Ganancia diaria", 1.68 + rnd(), "ARS", null, null, null]);
    else if (k === 1) rows.push([stamp(d, 3), "Rendimiento bonificado", 1.27 + rnd(), "ARS", null, null, null]);
    else if (k === 2) { const a = 3000 + Math.round(rnd() * 40000); rows.push([stamp(d, 12), `Pago a ${pick(["DIA TIENDA 536", "YPF", "Carrefour", "DLO*DiDi", "PAYU*AR*UBER"])}`, a, "ARS", a, "ARS", 1]); }
    else if (k === 3) { const a = 3000 + Math.round(rnd() * 30000); rows.push([stamp(d, 14), "Pago a DIA", a, "ARS", a, "ARS", 1]); }
    else if (k === 4) rows.push([stamp(d, 15), `Retiro a ${pick(["Persona Demo Uno", "Persona Demo Dos", "Persona Demo Tres"])}`, (5000 + Math.round(rnd() * 60000)), "ARS", null, null, null]);
    else if (k === 5) rows.push([stamp(d, 3), "Ganancia diaria", 0.0001, "USDC", null, null, null]);
    else if (k === 6) {
      const a = 12000 + Math.round(rnd() * 20000);
      const t = stamp(d, 20);
      rows.push([t, "Retiro a Persona Demo Dos", a, "ARS", null, null, null]);
      rows.push([t, "Conversión", a, "ARS", +(a / 1570).toFixed(2), "USDC", 1570]);
    }
    else rows.push([stamp(d, 17), "Pago a GOOGLE *Google One", 1.99, "USD", 3000, "ARS", 0.00066]);
  }
  rows.splice(1, 0, [`${dmy(startDate)} 19:23:58`, "Depósito de cuenta propia", 12800, "ARS", null, null, null]);
  if (opts.extra) for (const r of opts.extra) rows.push(r);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Actividad");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Tenencia al cierre"], ["Moneda", "Cantidad"], ["ARS", 100000]]), "Balance");
  write(path, wb, "xlsx");
}
fiwind("fixtures/fiwind/actividad-1.xlsx", new Date(2026, 5, 29), 48);
fiwind("fixtures/fiwind/actividad-2.xlsx", new Date(2026, 7, 31), 170);
fiwind("fixtures/fiwind/actividad-3.xlsx", new Date(2026, 6, 31), 90, {
  extra: [["15/07/2026 10:00:00", "Retiro a Ana Lopez Gomez Diaz", 225000, "ARS", null, null, null]],
});
console.log("mock fixtures written");
