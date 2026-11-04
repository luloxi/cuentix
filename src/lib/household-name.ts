/** Shared hogar-name rules for the Worker and the create-household UI. */

/** Allowed on the first household when `allowPersonal` is set. Reserved otherwise. */
const PERSONAL_HOUSEHOLD_NAMES = new Set(["personal", "mi espacio"]);

/** "invoice iog" and "casita" are reserved even for the first household. */
const RESERVED_HOUSEHOLD_NAMES = new Set([
  "personal",
  "mi espacio",
  "invoice iog",
  "casita",
]);

/** Whitespace controls become a space. Other C0 controls and DEL are removed. */
const WHITESPACE_RUN = /[\t\n\r\f\v\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export const HOUSEHOLD_NAME_MAX = 60;

export const HOUSEHOLD_NAME_EMPTY = "Poné un nombre para el hogar";
export const HOUSEHOLD_NAME_TOO_LONG = "El nombre es demasiado largo (máx. 60)";
export const HOUSEHOLD_NAME_RESERVED = "Ese nombre está reservado";

/** Trim, collapse inner whitespace, and strip control characters. */
export function normalizeHouseholdName(raw: string): string {
  return raw.replace(WHITESPACE_RUN, " ").replace(CONTROL_CHARS, "").trim().replace(/ {2,}/g, " ");
}

export type HouseholdNameResult =
  | { ok: true; name: string }
  | { ok: false; error: string };

/**
 * Names longer than this are rejected before the normalize scan so a huge
 * payload cannot burn the Worker's CPU budget. Real names are at most 60.
 */
const RAW_NAME_CAP = 200;

export function validateHouseholdName(
  input: unknown,
  opts?: { allowPersonal?: boolean },
): HouseholdNameResult {
  if (typeof input !== "string") {
    return { ok: false, error: HOUSEHOLD_NAME_EMPTY };
  }
  if (input.length > RAW_NAME_CAP) {
    return { ok: false, error: HOUSEHOLD_NAME_TOO_LONG };
  }
  const name = normalizeHouseholdName(input);
  if (name.length < 1) return { ok: false, error: HOUSEHOLD_NAME_EMPTY };
  if (name.length > HOUSEHOLD_NAME_MAX) return { ok: false, error: HOUSEHOLD_NAME_TOO_LONG };
  const key = name.toLowerCase();
  const personalOk = opts?.allowPersonal === true && PERSONAL_HOUSEHOLD_NAMES.has(key);
  if (RESERVED_HOUSEHOLD_NAMES.has(key) && !personalOk) {
    return { ok: false, error: HOUSEHOLD_NAME_RESERVED };
  }
  return { ok: true, name };
}
