/**
 * Load the Neon JSONL backup into D1 `cuentix`. Use `--local` only.
 *
 *   node scripts/load-neon-backup.mjs /path/to/backup --local
 *   node scripts/load-neon-backup.mjs /path/to/backup --remote
 *
 * `--local` is the only mode this repo should run. It targets the D1 state of
 * wrangler.staging.jsonc. `--remote` exists so the old command stays explicit;
 * do not use it from the lite migration.
 *
 * Writes chunked SQL under `.d1-import/` (gitignored) and applies each file
 * with `wrangler d1 execute`. INSERT OR IGNORE makes
 * a re-run safe. A row that violates a foreign key is skipped the same way,
 * so run scripts/verify-d1.mjs afterwards.
 *
 * Types match migrations/0001_app.sql: timestamps are integer unix ms
 * (naive ISO strings are UTC; extra fractional digits are trimmed to ms),
 * money and other decimals stay exact text, booleans are 0/1, jsonb is text.
 * Auth seed is the two users in neon_auth.user.jsonl (no sessions, tokens, or jwks).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const local = args.includes("--local");
const remote = args.includes("--remote");
const backupDir = args.find((arg) => !arg.startsWith("--"));
if (!backupDir || local === remote) {
  console.error("usage: node scripts/load-neon-backup.mjs <backup-dir> --local|--remote");
  process.exit(1);
}

const repoRoot = join(import.meta.dirname, "..");
const outDir = join(repoRoot, ".d1-import");
const MAX_BYTES = 48 * 1024;

const BOOL = new Set([
  "is_system",
  "hidden",
  "is_credit",
  "is_payment",
  "force_settled",
]);
const TS = new Set([
  "created_at",
  "updated_at",
  "joined_at",
  "imported_at",
  "last_used_at",
  "revoked_at",
  "last_synced_at",
  "cleared_at",
  "current_period_end",
]);
const INT = new Set(["row_count", "priority", "split_pct", "due_day", "email_verified"]);
const JSON_COL = new Set(["ocr_raw"]);

const TABLES = [
  {
    file: "public.users.jsonl",
    table: "users",
    columns: ["id", "name", "email", "image", "created_at"],
  },
  {
    file: "public.allowed_emails.jsonl",
    table: "allowed_emails",
    columns: ["email", "created_at", "created_by"],
  },
  {
    file: "public.households.jsonl",
    table: "households",
    columns: ["id", "name", "invite_code", "created_at"],
  },
  {
    file: "public.household_members.jsonl",
    table: "household_members",
    columns: ["household_id", "user_id", "role", "display_name", "joined_at"],
  },
  {
    file: "public.household_api_tokens.jsonl",
    table: "household_api_tokens",
    columns: [
      "id",
      "household_id",
      "token_hash",
      "token_prefix",
      "created_by",
      "created_at",
      "last_used_at",
      "revoked_at",
    ],
  },
  {
    file: "public.categories.jsonl",
    table: "categories",
    columns: [
      "id",
      "slug",
      "name",
      "kind",
      "default_ownership",
      "is_system",
      "household_id",
    ],
  },
  {
    file: "public.household_category_prefs.jsonl",
    table: "household_category_prefs",
    columns: ["household_id", "category_id", "hidden"],
  },
  {
    file: "public.merchant_rules.jsonl",
    table: "merchant_rules",
    columns: ["id", "household_id", "pattern", "category_id", "priority"],
  },
  {
    file: "public.card_statements.jsonl",
    table: "card_statements",
    columns: [
      "id",
      "household_id",
      "source",
      "file_name",
      "imported_by",
      "imported_at",
      "row_count",
    ],
  },
  {
    file: "public.transactions.jsonl",
    table: "transactions",
    columns: [
      "id",
      "household_id",
      "statement_id",
      "date",
      "description_raw",
      "description_normalized",
      "amount_ars",
      "amount_usd",
      "installment",
      "is_payment",
      "is_credit",
      "category_id",
      "ownership",
      "paid_by_user_id",
      "split_pct",
      "external_fingerprint",
      "source",
      "bank",
      "card_last4",
      "linked_transaction_id",
      "created_at",
      "updated_at",
    ],
  },
  {
    file: "public.receipts.jsonl",
    table: "receipts",
    columns: [
      "id",
      "household_id",
      "image_url",
      "merchant_name",
      "receipt_date",
      "total_ars",
      "currency",
      "ocr_raw",
      "status",
      "transaction_id",
      "created_by",
      "created_at",
    ],
  },
  {
    file: "public.receipt_items.jsonl",
    table: "receipt_items",
    columns: [
      "id",
      "receipt_id",
      "name",
      "quantity",
      "unit_price",
      "line_total",
      "product_category",
    ],
  },
  {
    file: "public.savings_assets.jsonl",
    table: "savings_assets",
    columns: [
      "id",
      "user_id",
      "household_id",
      "kind",
      "label",
      "address",
      "amount_ars",
      "amount_usd",
      "last_balance_usd",
      "last_synced_at",
      "sync_error",
      "created_at",
      "updated_at",
    ],
  },
  {
    file: "public.debt_settings.jsonl",
    table: "debt_settings",
    columns: [
      "user_id",
      "rate_pct",
      "min_payment_ars",
      "due_day",
      "notes",
      "force_settled",
      "cleared_at",
      "card_last4",
      "saldo_deuda_ars",
      "saldo_deuda_usd",
      "updated_at",
    ],
  },
  {
    file: "public.incomes.jsonl",
    table: "incomes",
    columns: [
      "id",
      "user_id",
      "household_id",
      "kind",
      "frequency",
      "date",
      "label",
      "amount_ars",
      "amount_usd",
      "external_fingerprint",
      "created_at",
      "updated_at",
    ],
  },
  {
    file: "public.subscriptions.jsonl",
    table: "subscriptions",
    columns: [
      "user_id",
      "polar_subscription_id",
      "status",
      "current_period_end",
      "updated_at",
    ],
  },
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

function toMs(value) {
  if (value == null || value === "") return null;
  let s = String(value).trim();
  if (/^-?\d+$/.test(s)) {
    const n = Number(s);
    return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  }
  s = s.replace(/\.(\d{3})\d+/, ".$1");
  if (!/[zZ]$/.test(s) && !/[+-]\d{2}:?\d{2}$/.test(s)) s += "Z";
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw new Error(`bad timestamp ${value}`);
  return ms;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlValue(column, value) {
  if (value == null) return "NULL";
  if (BOOL.has(column)) return value === true || value === 1 || value === "1" || value === "true" ? "1" : "0";
  if (TS.has(column)) {
    const ms = toMs(value);
    return ms == null ? "NULL" : String(ms);
  }
  if (INT.has(column)) {
    if (!/^-?\d+$/.test(String(value))) throw new Error(`bad int ${column}`);
    return String(value);
  }
  if (JSON_COL.has(column)) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return sqlString(text);
  }
  return sqlString(value);
}

function readRows(file) {
  const path = join(backupDir, file);
  const text = readFileSync(path, "utf8");
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    rows.push(parsePreserving(line));
  }
  return rows;
}

function insertSql(table, columns, rows) {
  const values = rows
    .map((row) => `(${columns.map((col) => sqlValue(col, row[col])).join(", ")})`)
    .join(",\n");
  return `INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES\n${values};\n`;
}

let tableSeq = 0;

function writeChunks(table, columns, rows) {
  const files = [];
  let batch = [];
  let batchBytes = 0;
  let part = 0;
  tableSeq += 1;
  const prefix = String(tableSeq).padStart(2, "0");
  const flush = () => {
    if (batch.length === 0) return;
    part += 1;
    const name = `${prefix}-${table}-${String(part).padStart(3, "0")}.sql`;
    const body = insertSql(table, columns, batch);
    writeFileSync(join(outDir, name), body);
    files.push(name);
    batch = [];
    batchBytes = 0;
  };
  for (const row of rows) {
    const one = insertSql(table, columns, [row]);
    if (batch.length > 0 && batchBytes + one.length > MAX_BYTES) flush();
    batch.push(row);
    batchBytes += one.length;
  }
  flush();
  return files;
}

function applyFile(name) {
  const flag = local ? "--local" : "--remote";
  const configArgs = local ? ["-c", "wrangler.staging.jsonc"] : [];
  const result = spawnSync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", "cuentix", ...configArgs, flag, "--file", join(outDir, name)],
    { cwd: repoRoot, encoding: "utf8", env: { ...process.env, CI: "1" } },
  );
  if (result.status !== 0) {
    const tail = `${result.stderr || ""}\n${result.stdout || ""}`.slice(-800);
    console.error(`failed ${name} exit ${result.status}`);
    console.error(tail.replace(/'[^']{24,}'/g, "'…'"));
    process.exit(result.status || 1);
  }
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const planned = [];
for (const spec of TABLES) {
  const rows = readRows(spec.file);
  const files = writeChunks(spec.table, spec.columns, rows);
  planned.push({ table: spec.table, rows: rows.length, files: files.length });
}

const authRows = readRows("neon_auth.user.jsonl").map((row) => ({
  id: row.id,
  name: row.name,
  email: String(row.email).trim().toLowerCase(),
  email_verified: 1,
  image: row.image ?? null,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
}));
const authFiles = writeChunks("auth_user", [
  "id",
  "name",
  "email",
  "email_verified",
  "image",
  "created_at",
  "updated_at",
], authRows);
planned.push({ table: "auth_user", rows: authRows.length, files: authFiles.length });

const sqlFiles = readdirSync(outDir).filter((name) => name.endsWith(".sql")).sort();
console.log(`applying ${sqlFiles.length} files`);
for (const spec of planned) {
  console.log(`${spec.table}: ${spec.rows} rows in ${spec.files} file(s)`);
}
for (const name of sqlFiles) {
  console.log(`apply ${name}`);
  applyFile(name);
}
console.log("load done");
