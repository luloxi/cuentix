import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import {
  buildExpenseDraft,
  lineItemsTotal,
  nextCategoryId,
  nextPayerId,
} from "./expense-form";
import {
  DEFAULT_HOME_ORDER,
  getHomeHiddenSnapshot,
  getHomeOrderSnapshot,
  getSkippedSnapshot,
  parseHomeHidden,
  parseHomeOrder,
  parseSkippedSlugs,
  resetHomeLayoutCacheForTests,
  writeHomeHidden,
  writeHomeOrder,
  writeSkipped,
  type HomeSectionId,
} from "./home-layout";
import { nextPage, pickFilterPeriod } from "./list-page";
import { parseStoredTheme, resolveTheme, toggledTheme } from "./theme-mode";

const ORDER: HomeSectionId[] = [
  "gastos",
  "categorias",
  "ahorros",
  "hogar",
  "deuda",
  "cotizaciones",
];

describe("theme mode", () => {
  it("parses only the three stored modes", () => {
    assert.equal(parseStoredTheme("dark"), "dark");
    assert.equal(parseStoredTheme("light"), "light");
    assert.equal(parseStoredTheme("system"), "system");
    assert.equal(parseStoredTheme(null), "system");
    assert.equal(parseStoredTheme("blue"), "system");
  });

  it("resolves system to the current scheme and toggles away from it", () => {
    assert.equal(resolveTheme("system", "dark"), "dark");
    assert.equal(resolveTheme("light", "dark"), "light");
    assert.equal(toggledTheme("system", "dark"), "light");
    assert.equal(toggledTheme("light", "dark"), "dark");
    assert.equal(toggledTheme("dark", "light"), "light");
  });
});

describe("list page", () => {
  it("resets to page 1 when the filter changes, then clamps", () => {
    assert.equal(nextPage({ filterChanged: true, page: 4, totalPages: 9 }), 1);
    assert.equal(nextPage({ filterChanged: false, page: 4, totalPages: 9 }), 4);
    assert.equal(nextPage({ filterChanged: false, page: 8, totalPages: 3 }), 3);
    assert.equal(nextPage({ filterChanged: false, page: 0, totalPages: 3 }), 1);
    assert.equal(nextPage({ filterChanged: false, page: 2, totalPages: 0 }), 1);
  });

  it("keeps the selected month, otherwise prefers now", () => {
    const periods = ["2026-09", "2026-10"];
    assert.equal(pickFilterPeriod("2026-09", periods, "2026-11"), "2026-09");
    assert.equal(pickFilterPeriod("all", periods, "2026-10"), "2026-10");
    assert.equal(pickFilterPeriod("2024-01", periods, "2026-11"), "2026-09");
    assert.equal(pickFilterPeriod("2024-01", [], "2026-11"), "2026-11");
    assert.equal(pickFilterPeriod("all", periods, "2026-11"), "2026-09");
  });
});

describe("expense form", () => {
  const categories = [
    { id: "u", slug: "uncategorized" },
    { id: "a", slug: "alquiler" },
  ];
  const members = [{ userId: "ana" }, { userId: "luis" }];

  it("lets a preset category overwrite the current pick", () => {
    assert.equal(nextCategoryId("u", categories, "alquiler"), "a");
    assert.equal(nextCategoryId("a", categories, "alquiler"), null);
    assert.equal(nextCategoryId("", categories), "u");
    assert.equal(nextCategoryId("", [{ id: "x", slug: "luz" }]), "x");
    assert.equal(nextCategoryId("u", categories), null);
    assert.equal(nextCategoryId("", [], "alquiler"), null);
  });

  it("fills the payer only while it is empty", () => {
    assert.equal(nextPayerId("ana", members, "luis", "luis"), null);
    assert.equal(nextPayerId("", [], "ana", "ana"), null);
    assert.equal(nextPayerId("", members, "luis", "ana"), "luis");
    assert.equal(nextPayerId("", members, "missing", "ana"), "ana");
    assert.equal(nextPayerId("", members, undefined, null), "ana");
  });

  it("builds the draft the modal used to initialize", () => {
    assert.deepEqual(
      buildExpenseDraft({
        preset: {
          mode: "manual",
          description: "Luz",
          categorySlug: "alquiler",
          ownership: "shared",
          paidByUserId: "luis",
        },
        categories,
        members,
        viewerUserId: "ana",
        today: "2026-11-04",
      }),
      {
        mode: "manual",
        date: "2026-11-04",
        description: "Luz",
        amountArs: "",
        amountUsd: "",
        categoryId: "a",
        paidByUserId: "luis",
        ownership: "shared",
      },
    );
  });

  it("sums line totals and falls back to quantity times unit price", () => {
    assert.equal(
      lineItemsTotal([
        { lineTotal: "10,5", quantity: "1", unitPrice: "1" },
        { lineTotal: "", quantity: "2", unitPrice: "3,5" },
        { lineTotal: "nope", quantity: "x", unitPrice: "y" },
      ]),
      17.5,
    );
    assert.equal(lineItemsTotal([]), 0);
  });
});

describe("home layout", () => {
  const hadWindow = "window" in globalThis;
  const hadStorage = "localStorage" in globalThis;
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.localStorage;

  function installStorage() {
    const mem = new Map<string, string>();
    const storage = {
      getItem(key: string) {
        return mem.has(key) ? mem.get(key)! : null;
      },
      setItem(key: string, value: string) {
        mem.set(key, value);
      },
      removeItem(key: string) {
        mem.delete(key);
      },
      clear() {
        mem.clear();
      },
    };
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: storage },
    });
  }

  beforeEach(() => {
    installStorage();
    resetHomeLayoutCacheForTests();
  });

  after(() => {
    resetHomeLayoutCacheForTests();
    if (hadWindow) {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
    if (hadStorage) {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previousStorage,
      });
    } else {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it("parses order, hidden sections, and skipped services", () => {
    assert.deepEqual(parseHomeOrder(null, ORDER), [...ORDER]);
    assert.deepEqual(parseHomeOrder("nope", ORDER), [...ORDER]);
    assert.deepEqual(
      parseHomeOrder(JSON.stringify(["cotizaciones", "nope", "gastos"]), ORDER),
      ["cotizaciones", "gastos", "categorias", "ahorros", "hogar", "deuda"],
    );
    assert.deepEqual(
      parseHomeOrder(JSON.stringify(["deuda", "gastos"]), ["gastos", "hogar"]),
      ["gastos", "hogar"],
    );

    assert.deepEqual(parseHomeHidden(null, "0", "false", ORDER), ["deuda", "hogar"]);
    assert.deepEqual(parseHomeHidden("[]", "0", "false", ORDER), []);
    assert.deepEqual(parseHomeHidden("{", null, null, ORDER), []);
    assert.deepEqual(
      parseHomeHidden(JSON.stringify(["deuda", "nope"]), null, null, ORDER),
      ["deuda"],
    );

    assert.deepEqual(parseSkippedSlugs(null), []);
    assert.deepEqual(parseSkippedSlugs("nope"), []);
    assert.deepEqual(parseSkippedSlugs(JSON.stringify(["luz", 1, "gas"])), ["luz", "gas"]);
  });

  it("returns a stable snapshot until storage changes", () => {
    const order = getHomeOrderSnapshot();
    assert.equal(getHomeOrderSnapshot(), order);
    assert.deepEqual(order, DEFAULT_HOME_ORDER);

    const next: HomeSectionId[] = ["hogar", ...DEFAULT_HOME_ORDER.filter((id) => id !== "hogar")];
    writeHomeOrder(next);
    assert.equal(getHomeOrderSnapshot(), next);

    const hidden = getHomeHiddenSnapshot();
    assert.equal(getHomeHiddenSnapshot(), hidden);
    assert.equal(hidden.size, 0);
    const marked = new Set<HomeSectionId>(["deuda"]);
    writeHomeHidden(marked);
    assert.equal(getHomeHiddenSnapshot(), marked);

    const skipped = getSkippedSnapshot();
    assert.equal(getSkippedSnapshot(), skipped);
    assert.equal(skipped.size, 0);
    const services = new Set(["luz"]);
    writeSkipped(services);
    assert.equal(getSkippedSnapshot(), services);
  });
});
