import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NAV_HREFS,
  NAV_LINKS,
  homeNextAction,
  isUnlistedNavHref,
  navIncludesDeuda,
  navLinksFor,
  splitMobileNav,
} from "./nav";
import { DEUDA_ENABLED, isDeudaEnabled } from "./features";
import {
  swipeIncludesDeuda,
  swipePathFor,
  resolveSwipeIndex,
  stepToHref,
} from "./swipe-path";

describe("section nav", () => {
  const labels = [
    "Inicio",
    "Consumos",
    "Ingresos",
    "Hogar",
    "Análisis",
    "Mes a mes",
    "Grupo",
    "Supermercado",
    "MCP",
  ];
  const hrefs = [
    "/dashboard",
    "/consumos",
    "/ingresos",
    "/compartido",
    "/analisis",
    "/mes-a-mes",
    "/grupo",
    "/supermercado",
    "/mcp",
  ];

  it("lists every working read-only section", () => {
    assert.deepEqual(
      NAV_LINKS.map((l) => l.label),
      labels,
    );
    assert.deepEqual([...NAV_HREFS], hrefs);
    assert.equal(NAV_LINKS.length, 9);
  });

  it("adds Administración only for admins", () => {
    const guest = navLinksFor(false);
    assert.equal(
      guest.some((l) => l.href === "/admin" || l.label === "Administración"),
      false,
    );
    const admin = navLinksFor(true);
    assert.equal(admin.at(-1)?.href, "/admin");
    assert.equal(admin.at(-1)?.label, "Administración");
    assert.deepEqual(
      admin.slice(0, -1).map((l) => l.label),
      labels,
    );
  });

  it("keeps Compartir, Suscripción, Importar, Cargas and add-expense unlisted", () => {
    for (const links of [navLinksFor(false), navLinksFor(true)]) {
      const listedHrefs = links.map((l) => l.href);
      const listedLabels = links.map((l) => l.label);
      for (const href of [
        "/share-target",
        "/suscripcion",
        "/importar",
        "/cargas",
        "/deuda",
      ]) {
        assert.equal(
          listedHrefs.some((h) => h === href),
          false,
        );
        assert.equal(isUnlistedNavHref(href), true);
      }
      for (const label of [
        "Compartir",
        "Suscripción",
        "Importar",
        "Cargas",
        "Sumar",
        "Deuda",
      ]) {
        assert.equal(listedLabels.includes(label), false);
      }
    }
  });

  it("puts the overflow in Más on mobile", () => {
    const everyone = splitMobileNav(navLinksFor(false));
    assert.deepEqual(
      everyone.bar.map((l) => l.label),
      ["Inicio", "Consumos", "Ingresos", "Hogar"],
    );
    assert.deepEqual(
      everyone.more.map((l) => l.label),
      ["Análisis", "Mes a mes", "Grupo", "Supermercado", "MCP"],
    );
    const admin = splitMobileNav(navLinksFor(true));
    assert.equal(admin.bar.length, 4);
    assert.equal(admin.more.at(-1)?.label, "Administración");
    assert.ok(admin.more.length > 1);
    assert.deepEqual(
      [...admin.bar, ...admin.more].map((l) => l.href),
      navLinksFor(true).map((l) => l.href),
    );
  });

  it("never puts Deuda in the bar, even if the flag is on", () => {
    assert.equal(navIncludesDeuda(), false);
    assert.equal(navIncludesDeuda([...NAV_HREFS, "/admin"]), false);
    assert.equal(navIncludesDeuda(["/dashboard", "/deuda"]), true);
  });
});

describe("DEUDA_ENABLED (no flag)", () => {
  it("is always on: no env value hides it", () => {
    for (const v of ["1", "true", "0", "false", "", undefined]) {
      assert.equal(isDeudaEnabled(v), true);
    }
    assert.equal(DEUDA_ENABLED, true);
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
  it("stays on Consumos and never opens Cargas", () => {
    for (const n of [0, -1, 1, 12]) {
      assert.deepEqual(homeNextAction(n), {
        href: "/consumos",
        label: "Ver consumos",
      });
    }
  });

  it("does not send the next action to Deuda or Cargas", () => {
    assert.notEqual(homeNextAction(0).href, "/deuda");
    assert.notEqual(homeNextAction(0).href, "/cargas");
    assert.notEqual(homeNextAction(3).href, "/deuda");
    assert.notEqual(homeNextAction(3).href, "/cargas");
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
