import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NAV_HREFS,
  NAV_LINKS,
  homeNextAction,
  navIncludesDeuda,
} from "./nav";
import { isDeudaEnabled } from "./features";
import {
  swipeIncludesDeuda,
  swipePathFor,
  resolveSwipeIndex,
  stepToHref,
} from "./swipe-path";

describe("slim 5-item nav", () => {
  it("is Inicio · Consumos · Cargas · Ingresos · Hogar", () => {
    assert.deepEqual(
      NAV_LINKS.map((l) => l.label),
      ["Inicio", "Consumos", "Cargas", "Ingresos", "Hogar"],
    );
    assert.deepEqual([...NAV_HREFS], [
      "/dashboard",
      "/consumos",
      "/cargas",
      "/ingresos",
      "/compartido",
    ]);
    assert.equal(NAV_LINKS.length, 5);
  });

  it("never puts Deuda in the bar, even if the flag is on", () => {
    assert.equal(navIncludesDeuda(), false);
    assert.equal(navIncludesDeuda([...NAV_HREFS, "/admin"]), false);
    assert.equal(navIncludesDeuda(["/dashboard", "/deuda"]), true);
  });
});

describe("DEUDA_ENABLED flag", () => {
  it("is on by default; only 0/false hides it", () => {
    assert.equal(isDeudaEnabled("1"), true);
    assert.equal(isDeudaEnabled("true"), true);
    assert.equal(isDeudaEnabled("0"), false);
    assert.equal(isDeudaEnabled("false"), false);
    assert.equal(isDeudaEnabled(""), true);
    assert.equal(isDeudaEnabled(undefined), true);
  });

  it("keeps swipe on the slim path when the flag is off", () => {
    const off = swipePathFor(false);
    assert.equal(swipeIncludesDeuda(off), false);
    assert.ok(off.every((s) => s.href !== "/deuda"));
    assert.deepEqual(
      off.map((s) => ("tab" in s ? `${s.href}?tab=${s.tab}` : s.href)),
      [
        "/dashboard",
        "/consumos?tab=lista",
        "/consumos?tab=resumen",
        "/consumos?tab=charts",
        "/compartido?tab=vista",
        "/compartido?tab=charts",
        "/ahorros",
      ],
    );
  });

  it("only adds /deuda steps when the flag is on", () => {
    const on = swipePathFor(true);
    assert.equal(swipeIncludesDeuda(on), true);
    assert.ok(on.some((s) => s.href === "/deuda" && "tab" in s && s.tab === "evolucion"));
    assert.ok(on.some((s) => s.href === "/deuda" && "tab" in s && s.tab === "pagos"));
    assert.equal(on.length, swipePathFor(false).length + 2);
  });
});

describe("home next action", () => {
  it("points empty months at Cargas and the rest at Consumos", () => {
    assert.deepEqual(homeNextAction(0), {
      href: "/cargas",
      label: "Cargá el resumen",
    });
    assert.deepEqual(homeNextAction(-1), {
      href: "/cargas",
      label: "Cargá el resumen",
    });
    assert.deepEqual(homeNextAction(1), {
      href: "/consumos",
      label: "Ver consumos",
    });
    assert.deepEqual(homeNextAction(12), {
      href: "/consumos",
      label: "Ver consumos",
    });
  });

  it("does not send the next action to Deuda", () => {
    assert.notEqual(homeNextAction(0).href, "/deuda");
    assert.notEqual(homeNextAction(3).href, "/deuda");
  });
});

describe("swipe index (flag off path)", () => {
  it("resolves Inicio and Consumos tabs", () => {
    assert.equal(resolveSwipeIndex("/dashboard", null), 0);
    assert.equal(resolveSwipeIndex("/consumos", "lista"), 1);
    assert.equal(resolveSwipeIndex("/consumos", "resumen"), 2);
    assert.equal(resolveSwipeIndex("/consumos", "charts"), 3);
  });

  it("does not land on Deuda from a deep link when the swipe path is off", () => {
    const hrefs = swipePathFor(false).map(stepToHref);
    assert.ok(!hrefs.some((h) => h.includes("/deuda")));
  });

  it("builds hrefs without Deuda on the slim path", () => {
    const hrefs = swipePathFor(false).map(stepToHref);
    assert.ok(!hrefs.some((h) => h.includes("/deuda")));
  });
});
