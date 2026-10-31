import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { monthlyIncomeEvolution } from "./incomes";

describe("monthlyIncomeEvolution", () => {
  it("sums variable ingresos by month", () => {
    const series = monthlyIncomeEvolution(
      [
        {
          id: "1",
          date: "2026-09-01",
          label: "Mauro",
          kind: "variable",
          amountArs: 1963000,
          amountUsd: null,
        },
        {
          id: "2",
          date: "2026-08-15",
          label: "Extra",
          kind: "variable",
          amountArs: 50000,
          amountUsd: null,
        },
      ],
      { periods: ["2026-08", "2026-09"], months: 12 },
    );
    assert.equal(series.length, 2);
    assert.equal(series[0]!.period, "2026-08");
    assert.equal(series[0]!.amountArs, 50000);
    assert.equal(series[1]!.period, "2026-09");
    assert.equal(series[1]!.amountArs, 1963000);
  });

  it("expands recurring mensual into periods", () => {
    const series = monthlyIncomeEvolution(
      [
        {
          id: "r1",
          date: "2026-07-01",
          label: "Sueldo",
          kind: "recurring",
          frequency: "mensual",
          amountArs: 100000,
          amountUsd: null,
        },
      ],
      { periods: ["2026-07", "2026-08", "2026-09"], months: 12 },
    );
    assert.deepEqual(
      series.map((s) => s.amountArs),
      [100000, 100000, 100000],
    );
  });
});
