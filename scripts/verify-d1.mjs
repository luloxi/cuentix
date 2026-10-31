/**
 * Compare remote D1 `cuentix` to the Neon JSONL backup.
 *
 *   node scripts/verify-d1.mjs /path/to/backup [/path/to/d1_verify.json]
 *
 * Sums are decimal strings (not SQLite SUM floats, and not JSON.parse floats).
 * Exits 1 when a count or sum differs.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const backupDir = process.argv[2];
const outPath = process.argv[3] ?? "/workspace/cuentix/migration/d1_verify.json";
if (!backupDir) {
  console.error("usage: node scripts/verify-d1.mjs <backup-dir> [out.json]");
  process.exit(1);
}

const repoRoot = join(import.meta.dirname, "..");
const SCALE = 100_000_000n;

const TABLES = [
  "allowed_emails",
  "card_statements",
  "categories",
  "debt_settings",
  "household_api_tokens",
  "household_category_prefs",
  "household_members",
  "households",
  "incomes",
  "merchant_rules",
  "receipt_items",
  "receipts",
  "savings_assets",
  "subscriptions",
  "transactions",
  "users",
  "auth_user",
];

function parsePreserving(line) {
  let out = "";
  let i = 0;
  let inStr = false;
  while (i < line.length) {
    const c = line[i];
    if (inStr) {
      out += c;
      if (c === "\\") {
        out += line[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      i++;
      continue;
    }
    if (c === "-" || (c >= "0" && c <= "9")) {
      const m = line.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (m) {
        out += JSON.stringify(m[0]);
        i += m[0].length;
        continue;
      }
    }
    out += c;
    i++;
  }
  return JSON.parse(out);
}

function readRows(file) {
  const text = readFileSync(join(backupDir, file), "utf8");
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    rows.push(parsePreserving(line));
  }
  return rows;
}

function decToInt(raw) {
  if (raw == null || raw === "") return null;
  const text = String(raw).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new Error(`bad decimal ${text}`);
  const neg = text.startsWith("-");
  const body = neg ? text.slice(1) : text;
  const [whole, frac = ""] = body.split(".");
  const padded = (frac + "00000000").slice(0, 8);
  const n = BigInt(whole || "0") * SCALE + BigInt(padded);
  return neg ? -n : n;
}

function intToDec(n) {
  if (n == null) return null;
  const neg = n < 0n;
  const v = neg ? -n : n;
  const whole = v / SCALE;
  const frac = (v % SCALE).toString().padStart(8, "0").replace(/0+$/, "");
  const text = frac ? `${whole}.${frac}` : `${whole}`;
  return neg ? `-${text}` : text;
}

function addDec(a, raw) {
  if (raw == null || raw === "") return a;
  const n = decToInt(raw);
  if (n == null) return a;
  return (a ?? 0n) + n;
}

function d1(command) {
  const result = spawnSync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", "cuentix", "--remote", "--json", "--command", command],
    { cwd: repoRoot, encoding: "utf8", env: { ...process.env, CI: "1" } },
  );
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
  const text = result.stdout;
  const start = text.search(/[\[{]/);
  if (start < 0) {
    console.error(text);
    process.exit(1);
  }
  const parsed = JSON.parse(text.slice(start));
  const block = Array.isArray(parsed) ? parsed[0] : parsed;
  return block.results ?? [];
}

function page(sql) {
  const rows = [];
  const size = 400;
  for (let offset = 0; ; offset += size) {
    const chunk = d1(`${sql} LIMIT ${size} OFFSET ${offset}`);
    rows.push(...chunk);
    if (chunk.length < size) break;
  }
  return rows;
}

function countsFromJsonl() {
  const counts = {};
  for (const table of TABLES) {
    if (table === "auth_user") {
      counts[table] = readRows("neon_auth.user.jsonl").length;
      continue;
    }
    counts[table] = readRows(`public.${table}.jsonl`).length;
  }
  return counts;
}

function txReport(rows, fields) {
  const byHousehold = {};
  const bySource = {};
  let isCredit = 0;
  let isPayment = 0;
  const categories = new Set();
  for (const row of rows) {
    const hid = row[fields.household] ?? "";
    const bucket = byHousehold[hid] ?? { amount_ars: null, amount_usd: null };
    bucket.amount_ars = addDec(bucket.amount_ars, row[fields.ars]);
    bucket.amount_usd = addDec(bucket.amount_usd, row[fields.usd]);
    byHousehold[hid] = bucket;
    const source = row[fields.source] ?? "";
    bySource[source] = (bySource[source] ?? 0) + 1;
    const credit = row[fields.credit];
    const payment = row[fields.payment];
    if (credit === true || credit === 1 || credit === "1") isCredit += 1;
    if (payment === true || payment === 1 || payment === "1") isPayment += 1;
    const category = row[fields.category];
    if (category != null && category !== "") categories.add(String(category));
  }
  const sums = {};
  for (const [id, bucket] of Object.entries(byHousehold)) {
    sums[id] = {
      amount_ars: intToDec(bucket.amount_ars),
      amount_usd: intToDec(bucket.amount_usd),
    };
  }
  return {
    byHousehold: sums,
    bySource,
    is_credit: isCredit,
    is_payment: isPayment,
    distinct_category_id: categories.size,
  };
}

function moneyReport(rows, keys) {
  const out = {};
  for (const key of keys) {
    let sum = null;
    for (const row of rows) sum = addDec(sum, row[key]);
    out[key] = intToDec(sum);
  }
  return out;
}

const expected = {
  counts: countsFromJsonl(),
  transactions: txReport(readRows("public.transactions.jsonl"), {
    household: "household_id",
    ars: "amount_ars",
    usd: "amount_usd",
    source: "source",
    credit: "is_credit",
    payment: "is_payment",
    category: "category_id",
  }),
  incomes: moneyReport(readRows("public.incomes.jsonl"), ["amount_ars", "amount_usd"]),
  savings_assets: moneyReport(readRows("public.savings_assets.jsonl"), [
    "amount_ars",
    "amount_usd",
    "last_balance_usd",
  ]),
};

const actualCounts = {};
for (const table of TABLES) {
  const rows = d1(`SELECT COUNT(*) AS c FROM ${table}`);
  actualCounts[table] = Number(rows[0]?.c ?? 0);
}

const txRows = page(
  "SELECT household_id, amount_ars, amount_usd, source, is_credit, is_payment, category_id FROM transactions",
);
const actual = {
  counts: actualCounts,
  transactions: txReport(txRows, {
    household: "household_id",
    ars: "amount_ars",
    usd: "amount_usd",
    source: "source",
    credit: "is_credit",
    payment: "is_payment",
    category: "category_id",
  }),
  incomes: moneyReport(
    page("SELECT amount_ars, amount_usd FROM incomes"),
    ["amount_ars", "amount_usd"],
  ),
  savings_assets: moneyReport(
    page("SELECT amount_ars, amount_usd, last_balance_usd FROM savings_assets"),
    ["amount_ars", "amount_usd", "last_balance_usd"],
  ),
};

const report = { ok: true, expected, actual, mismatches: [] };

function differ(path, a, b) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    report.ok = false;
    report.mismatches.push({ path, expected: a, actual: b });
  }
}

differ("counts", expected.counts, actual.counts);
differ("transactions", expected.transactions, actual.transactions);
differ("incomes", expected.incomes, actual.incomes);
differ("savings_assets", expected.savings_assets, actual.savings_assets);

writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: report.ok, counts: actual.counts, mismatches: report.mismatches.length }, null, 2));
if (!report.ok) process.exit(1);
