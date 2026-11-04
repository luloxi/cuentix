import { DEUDA_ENABLED } from "@/lib/features";

export const HOME_ORDER_KEY = "lc:home-order";
export const HOME_HIDDEN_KEY = "lc:home-hidden";
export const SKIPPED_SERVICES_KEY = "lc:hogar-skipped-services";
export const LEGACY_SHOW_DEBT_KEY = "lc:home-show-debt";
export const LEGACY_SHOW_HOGAR_KEY = "lc:home-show-hogar";

export type HomeSectionId =
  | "gastos"
  | "categorias"
  | "ahorros"
  | "hogar"
  | "deuda"
  | "cotizaciones";

export const DEFAULT_HOME_ORDER: HomeSectionId[] = DEUDA_ENABLED
  ? ["gastos", "categorias", "ahorros", "hogar", "deuda", "cotizaciones"]
  : ["gastos", "categorias", "ahorros", "hogar", "cotizaciones"];

const EMPTY_HIDDEN: Set<HomeSectionId> = new Set();
const EMPTY_SKIPPED: Set<string> = new Set();

export function parseHomeOrder(
  raw: string | null,
  defaults: readonly HomeSectionId[] = DEFAULT_HOME_ORDER,
): HomeSectionId[] {
  if (!raw) return [...defaults];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [...defaults];
    const valid = arr.filter((id): id is HomeSectionId =>
      defaults.includes(id as HomeSectionId),
    );
    for (const id of defaults) {
      if (!valid.includes(id)) valid.push(id);
    }
    return defaults.includes("deuda")
      ? valid
      : valid.filter((id) => id !== "deuda");
  } catch {
    return [...defaults];
  }
}

export function parseHomeHidden(
  raw: string | null,
  legacyDebt: string | null,
  legacyHogar: string | null,
  known: readonly HomeSectionId[] = DEFAULT_HOME_ORDER,
): HomeSectionId[] {
  try {
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) return [];
      return arr.filter((id): id is HomeSectionId =>
        known.includes(id as HomeSectionId),
      );
    }
    const hidden: HomeSectionId[] = [];
    if (legacyDebt === "0" || legacyDebt === "false") hidden.push("deuda");
    if (legacyHogar === "0" || legacyHogar === "false") hidden.push("hogar");
    return hidden;
  } catch {
    return [];
  }
}

export function parseSkippedSlugs(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

type Cache<T> = { key: string; value: T };

let orderCache: Cache<HomeSectionId[]> = {
  key: "\u0000unset",
  value: DEFAULT_HOME_ORDER,
};
let hiddenCache: Cache<Set<HomeSectionId>> = {
  key: "\u0000unset",
  value: EMPTY_HIDDEN,
};
let skippedCache: Cache<Set<string>> = {
  key: "\u0000unset",
  value: EMPTY_SKIPPED,
};

const listeners = new Set<() => void>();

function emitHomeLayout() {
  for (const listener of listeners) listener();
}

export function subscribeHomeLayout(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    const key = event.key;
    if (
      key == null ||
      key === HOME_ORDER_KEY ||
      key === HOME_HIDDEN_KEY ||
      key === SKIPPED_SERVICES_KEY ||
      key === LEGACY_SHOW_DEBT_KEY ||
      key === LEGACY_SHOW_HOGAR_KEY
    ) {
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function readKey(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function getHomeOrderSnapshot(): HomeSectionId[] {
  const raw = readKey(HOME_ORDER_KEY);
  const key = raw ?? "";
  if (orderCache.key === key) return orderCache.value;
  const value = raw ? parseHomeOrder(raw) : DEFAULT_HOME_ORDER;
  orderCache = { key, value };
  return value;
}

export function getServerHomeOrder(): HomeSectionId[] {
  return DEFAULT_HOME_ORDER;
}

export function writeHomeOrder(order: HomeSectionId[]) {
  const raw = JSON.stringify(order);
  window.localStorage.setItem(HOME_ORDER_KEY, raw);
  orderCache = { key: raw, value: order };
  emitHomeLayout();
}

export function getHomeHiddenSnapshot(): Set<HomeSectionId> {
  const raw = readKey(HOME_HIDDEN_KEY);
  const legacyDebt = readKey(LEGACY_SHOW_DEBT_KEY);
  const legacyHogar = readKey(LEGACY_SHOW_HOGAR_KEY);
  const key = `${raw ?? ""}\0${legacyDebt ?? ""}\0${legacyHogar ?? ""}`;
  if (hiddenCache.key === key) return hiddenCache.value;
  const ids = parseHomeHidden(raw, legacyDebt, legacyHogar);
  const value = ids.length === 0 ? EMPTY_HIDDEN : new Set(ids);
  hiddenCache = { key, value };
  return value;
}

export function getServerHomeHidden(): Set<HomeSectionId> {
  return EMPTY_HIDDEN;
}

export function writeHomeHidden(hidden: Set<HomeSectionId>) {
  const raw = JSON.stringify([...hidden]);
  window.localStorage.setItem(HOME_HIDDEN_KEY, raw);
  const legacyDebt = readKey(LEGACY_SHOW_DEBT_KEY);
  const legacyHogar = readKey(LEGACY_SHOW_HOGAR_KEY);
  const key = `${raw}\0${legacyDebt ?? ""}\0${legacyHogar ?? ""}`;
  hiddenCache = { key, value: hidden };
  emitHomeLayout();
}

export function getSkippedSnapshot(): Set<string> {
  const raw = readKey(SKIPPED_SERVICES_KEY);
  const key = raw ?? "";
  if (skippedCache.key === key) return skippedCache.value;
  const ids = parseSkippedSlugs(raw);
  const value = ids.length === 0 ? EMPTY_SKIPPED : new Set(ids);
  skippedCache = { key, value };
  return value;
}

export function getServerSkipped(): Set<string> {
  return EMPTY_SKIPPED;
}

export function writeSkipped(skipped: Set<string>) {
  const raw = JSON.stringify([...skipped]);
  window.localStorage.setItem(SKIPPED_SERVICES_KEY, raw);
  skippedCache = { key: raw, value: skipped };
  emitHomeLayout();
}

/** Test-only. Drops cached snapshots so the next read hits storage again. */
export function resetHomeLayoutCacheForTests() {
  orderCache = { key: "\u0000unset", value: DEFAULT_HOME_ORDER };
  hiddenCache = { key: "\u0000unset", value: EMPTY_HIDDEN };
  skippedCache = { key: "\u0000unset", value: EMPTY_SKIPPED };
  listeners.clear();
}
