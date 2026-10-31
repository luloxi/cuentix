import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import { parseBbvaWorkbook } from "@/lib/bbva/parse";
import { summarizeParsedMovements } from "./import-summary";

function workbookBuffer(rows: Array<Array<string | number | null>>): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Movimientos");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

describe("load statement summary from BBVA-like workbook", () => {
  it("parses real amounts from a generated movimientos sheet", () => {
    const buf = workbookBuffer([
      [
        "Nro. Tarjeta",
        "Fecha",
        "Establecimiento",
        "Cuota",
        "Importe en $",
        "Importe en U$S",
      ],
      ["1234", "01/08/2026", "DIA TIENDA 99", "/", 15420.5, null],
      ["1234", "02/08/2026", "CAFE MARTINEZ", "/", 3200, null],
      ["1234", "03/08/2026", "OPENAI", "/", null, 20],
      ["1234", "04/08/2026", "SU PAGO EN PESOS", "/", -18000, null],
      ["1234", "15/07/2026", "YPF", "/", 8900, null],
    ]);

    const movements = parseBbvaWorkbook(buf);
    assert.ok(
      movements.length >= 4,
      `expected movements, got ${movements.length}`,
    );

    const summary = summarizeParsedMovements(movements, "bbva_xlsx");
    assert.equal(summary.source, "bbva_xlsx");
    assert.ok(summary.expenseCount >= 3);
    assert.ok(summary.paymentCount >= 1);

    const august = summary.byPeriod.find((p) => p.period === "2026-08");
    assert.ok(august, "August period missing from parsed file");
    assert.equal(august.amountArs, 15420.5 + 3200);
    assert.equal(august.amountUsd, 20);
    assert.equal(august.expenseCount, 3);

    const july = summary.byPeriod.find((p) => p.period === "2026-07");
    assert.ok(july);
    assert.equal(july.amountArs, 8900);
  });

  it("returns zeros rather than invented totals for an empty file", () => {
    const buf = workbookBuffer([
      ["Fecha", "Establecimiento", "Importe en $", "Importe en U$S"],
    ]);
    const movements = parseBbvaWorkbook(buf);
    const summary = summarizeParsedMovements(movements);
    assert.equal(summary.total, 0);
    assert.equal(summary.expenseCount, 0);
    assert.deepEqual(summary.byPeriod, []);
  });
});
