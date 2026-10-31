import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { markdownToStatementText, parseBbvaPdfText } from "./parse-pdf";

const FIXTURE = `
## Metadata
pages: 2
producer: synthetic

## DETALLE DE CONSUMOS

| Fecha | Descripcion | Importe |
| --- | --- | --- |
| 04-Ago-26 | SU PAGO EN PESOS 123456 | 180.000,00 |
| 05-Ago-26 | MERPAGO*FOO 654321 | 15.420,50 |

06-Ago-26 OPENAI
USD 20,00
`;

describe("markdown statement adapter", () => {
  it("rebuilds dated lines and keeps asterisks", () => {
    const text = markdownToStatementText(FIXTURE);
    assert.match(text, /DETALLE DE CONSUMOS/);
    assert.match(text, /04-Ago-26 SU PAGO EN PESOS 123456 180\.000,00/);
    assert.match(text, /05-Ago-26 MERPAGO\*FOO 654321 15\.420,50/);
    assert.match(text, /06-Ago-26 OPENAI USD 20,00/);
    assert.doesNotMatch(text, /Metadata/);
    assert.doesNotMatch(text, /\| --- \|/);
  });

  it("splits dates that toMarkdown glues onto the previous amount", () => {
    const text = markdownToStatementText(
      "Sus pagos y ajustes01-Ago-26 SU PAGO EN PESOS -180.000,0005-Ago-26 MERPAGO*FOO 654321 15.420,50TOTAL CONSUMOS 195.420,50",
    );
    const rows = parseBbvaPdfText(text);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.descriptionNormalized.includes("SU PAGO"), true);
    assert.equal(rows[0]?.amountArs, -180000);
    assert.match(rows[1]?.descriptionNormalized ?? "", /MERPAGO\*FOO/);
    assert.equal(rows[1]?.amountArs, 15420.5);
  });

  it("keeps a tax line whose amount is glued to SALDO ACTUAL", () => {
    const text = markdownToStatementText(
      "IMPUESTOS, CARGOS E INTERESES21-Ago-25 IVA RG 4240 21%( 4215,24) 885,2021-Ago-25 DB.RG 5617 30% ( 26137,09 ) 7.841,12SALDO ACTUAL 2.895.037,06 20,09",
    );
    const rows = parseBbvaPdfText(text);
    const tax = rows.find((row) => row.descriptionNormalized.includes("DB.RG"));
    assert.ok(tax);
    assert.equal(tax?.date, "2025-08-21");
    assert.equal(tax?.amountArs, 7841.12);
    assert.equal(tax?.descriptionNormalized.includes("SALDO"), false);
  });

  it("keeps a payment glued to the next Consumos header", () => {
    const text = markdownToStatementText(
      "04-Sep-25 SU PAGO EN PESOS -11.000,0005-Sep-25 SU PAGO EN PESOS -145.000,00Consumos TITULAR DEMOFECHA DESCRIPCIÓN NRO. CUPÓN PESOS",
    );
    const rows = parseBbvaPdfText(text);
    assert.equal(rows.length, 2);
    assert.equal(rows[1]?.date, "2025-09-05");
    assert.equal(rows[1]?.amountArs, -145000);
    assert.equal(rows[1]?.descriptionNormalized, "SU PAGO EN PESOS");
  });

  it("splits two same-day payments that share one date", () => {
    const text = markdownToStatementText(
      "05-Sep-25 SU PAGO EN PESOS -11.000,00SU PAGO EN PESOS -145.000,00",
    );
    const rows = parseBbvaPdfText(text);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.amountArs, -11000);
    assert.equal(rows[1]?.amountArs, -145000);
    assert.equal(rows[1]?.date, "2025-09-05");
  });

  it("feeds rebuilt lines to the BBVA parser", () => {
    const rows = parseBbvaPdfText(markdownToStatementText(FIXTURE));
    assert.equal(rows.length, 3);
    const pago = rows.find((row) => row.isPayment);
    assert.ok(pago);
    assert.equal(pago?.date, "2026-08-04");
    const dia = rows.find((row) => /MERPAGO\*FOO/.test(row.descriptionNormalized));
    assert.equal(dia?.date, "2026-08-05");
    assert.equal(dia?.amountArs, 15420.5);
    const usd = rows.find((row) => row.amountUsd != null);
    assert.equal(usd?.date, "2026-08-06");
    assert.equal(usd?.amountUsd, 20);
  });
});
