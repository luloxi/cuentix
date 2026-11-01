import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { FIWIND_ECHO_CANDIDATE_SQL } from "./fiwind-dups";
import { annotateIncomeRows, sumIncomeArs } from "./income";
import { ARS_EXPR, consumosVisibleSql, expenseSql } from "./sql";
import {
  INCOME_TWIN_SQL,
  TRANSFER_CANDIDATE_SQL,
  clearExcludedMovementCache,
  loadExcludedMovementIds,
} from "./transfer-class";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CUIT = "1".repeat(11);
const DERIVED = "5".repeat(11);
const OTHER_CUIT = "3".repeat(11);
const OTHER_CVU = "4".repeat(22);
const SIXTY_K =
  "outgoing transfer (payee unknown) | transferencia inmediata | 100 - banca online | payee not in export";

type TxInsert = {
  id: string;
  householdId: string;
  date: string;
  description: string;
  bank?: string | null;
  amountArs?: string | null;
  amountUsd?: string | null;
  isPayment?: number;
  isCredit?: number;
};

function openDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of ["0001_app.sql", "0002_auth.sql", "0003_serpix_sync.sql", "0004_card_closed.sql"]) {
    db.exec(readFileSync(join(root, "migrations", file), "utf8"));
  }
  return db;
}

function wrap(db: DatabaseSync) {
  return {
    prepare(sql: string) {
      let params: unknown[] = [];
      const stmt = {
        bind(...values: unknown[]) {
          params = values;
          return stmt;
        },
        async all<T>() {
          return { results: db.prepare(sql).all(...(params as never[])) as T[] };
        },
      };
      return stmt;
    },
  };
}

function seedPeople(db: DatabaseSync) {
  db.prepare("INSERT INTO users (id, email, name) VALUES ('user-u', 'u@example.com', 'User U')").run();
  db.prepare("INSERT INTO users (id, email, name) VALUES ('user-v', 'v@example.com', 'User V')").run();
  db.prepare("INSERT INTO households (id, name, invite_code) VALUES ('hh-home', 'Personal', 'codehome1')").run();
  db.prepare("INSERT INTO households (id, name, invite_code) VALUES ('hh-shared', 'Shared', 'codeshared')").run();
  db.prepare("INSERT INTO households (id, name, invite_code) VALUES ('hh-foreign', 'Foreign', 'codeforeign')").run();
  db.prepare(
    "INSERT INTO household_members (household_id, user_id, role) VALUES ('hh-home', 'user-u', 'owner')",
  ).run();
  db.prepare(
    "INSERT INTO household_members (household_id, user_id, role) VALUES ('hh-shared', 'user-u', 'member')",
  ).run();
  db.prepare(
    "INSERT INTO household_members (household_id, user_id, role) VALUES ('hh-foreign', 'user-v', 'owner')",
  ).run();
}

function insertTx(db: DatabaseSync, row: TxInsert) {
  db.prepare(
    `INSERT INTO transactions (
       id, household_id, date, description_raw, description_normalized,
       amount_ars, amount_usd, is_payment, is_credit, external_fingerprint, source, bank
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bbva_import', ?)`,
  ).run(
    row.id,
    row.householdId,
    row.date,
    row.description,
    row.description,
    row.amountArs ?? null,
    row.amountUsd ?? null,
    row.isPayment ?? 0,
    row.isCredit ?? 0,
    `fp-${row.id}`,
    row.bank ?? null,
  );
}

function insertIncome(
  db: DatabaseSync,
  row: { id: string; householdId: string; date: string; label: string; amountArs: string },
) {
  db.prepare(
    `INSERT INTO incomes (id, user_id, household_id, kind, date, label, amount_ars)
     VALUES (?, 'user-u', ?, 'variable', ?, ?, ?)`,
  ).run(row.id, row.householdId, row.date, row.label, row.amountArs);
}

function idsWhere(db: DatabaseSync, sql: string): Set<string> {
  const rows = db.prepare(sql).all() as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}

/** Top-level `UNION ALL` count plus one. Unions inside CTE bodies do not count. */
function compoundTermCount(sql: string): number {
  let depth = 0;
  let unions = 0;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i += 1;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2;
            continue;
          }
          break;
        }
        i += 1;
      }
      i += 1;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      i += 2;
      while (i < sql.length && sql[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "(") {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      i += 1;
      continue;
    }
    if (depth === 0 && /^union\s+all\b/i.test(sql.slice(i))) {
      unions += 1;
      i += 5;
      continue;
    }
    i += 1;
  }
  return unions + 1;
}

function assertIndexedPlan(plan: Array<{ detail: string }>) {
  const detail = plan.map((line) => line.detail).join("\n");
  // Date windows are household_id + date on tx_household_date_idx.
  // A SCAN of alias t or m is a transactions scan. CTE scans (tr, n) are fine.
  assert.match(detail, /tx_household_date_idx \(household_id=\? AND date>\? AND date<\?\)/);
  assert.match(detail, /hm_user_idx \(user_id=\?\)/);
  const tableScans = plan.filter((line) => /\bSCAN\s+(t|m)\b/.test(line.detail));
  assert.deepEqual(
    tableScans.map((line) => line.detail),
    [],
    detail,
  );
}

describe("TRANSFER_CANDIDATE_SQL", () => {
  it("keeps each candidate statement within D1's five-term compound SELECT limit", () => {
    const statements = [FIWIND_ECHO_CANDIDATE_SQL, TRANSFER_CANDIDATE_SQL, INCOME_TWIN_SQL];
    for (const sql of statements) {
      assert.equal(compoundTermCount(sql) <= 5, true);
    }
    assert.equal(compoundTermCount(FIWIND_ECHO_CANDIDATE_SQL), 4);
    assert.equal(compoundTermCount(TRANSFER_CANDIDATE_SQL), 5);
    assert.equal(compoundTermCount(INCOME_TWIN_SQL), 2);
    assert.match(INCOME_TWIN_SQL, /LIKE '%TRANSFERENCIA%'/);
    assert.match(INCOME_TWIN_SQL, /m\.is_credit = 0/);
    assert.match(INCOME_TWIN_SQL, /i\.kind != 'recurring'/);
  });

  it("binds the user on each statement and reads transactions through the household date index", () => {
    assert.equal(TRANSFER_CANDIDATE_SQL.split("?").length - 1, 1);
    assert.equal(INCOME_TWIN_SQL.split("?").length - 1, 3);
    const db = openDb();
    seedPeople(db);
    insertTx(db, {
      id: "bare",
      householdId: "hh-home",
      date: "2026-08-10",
      description: "TRANSFERENCIA",
      bank: "BBVA",
      amountArs: "100",
    });
    insertIncome(db, {
      id: "inc",
      householdId: "hh-home",
      date: "2026-08-10",
      label: "TRANSFERENCIA",
      amountArs: "100",
    });
    const transferPlan = db.prepare(`EXPLAIN QUERY PLAN ${TRANSFER_CANDIDATE_SQL}`).all("user-u") as Array<{
      detail: string;
    }>;
    const incomePlan = db.prepare(`EXPLAIN QUERY PLAN ${INCOME_TWIN_SQL}`).all("user-u", "user-u", "user-u") as Array<{
      detail: string;
    }>;
    assertIndexedPlan(transferPlan);
    assertIndexedPlan(incomePlan);
  });
});

describe("transfer exclusion in the expense fragment", () => {
  beforeEach(() => {
    clearExcludedMovementCache();
  });

  it("keeps internal transfers out of totals and on Consumos, and counts third parties and revisar", async () => {
    const db = openDb();
    seedPeople(db);
    const home = "hh-home";
    const rows: TxInsert[] = [
      {
        id: "own-cfg",
        householdId: home,
        date: "2026-08-10",
        description: `TRANSFERENCIA 11-${"1".repeat(8)}-1`,
        bank: "BBVA",
        amountArs: "5001",
      },
      {
        id: "marker",
        householdId: home,
        date: "2026-08-01",
        description: `CUENTA PROPIA ${DERIVED}`,
        bank: "BBVA",
        amountArs: "1",
      },
      {
        id: "derived",
        householdId: home,
        date: "2026-08-15",
        description: `TRANSFERENCIA INMEDIATA ${DERIVED}`,
        bank: "BBVA",
        amountArs: "5002",
      },
      {
        id: "twin-bank",
        householdId: home,
        date: "2026-08-10",
        description: "TRANSFERENCIA",
        bank: "BBVA",
        amountArs: "250",
      },
      {
        id: "twin-bank-in",
        householdId: home,
        date: "2026-08-11",
        description: "TRANSFERENCIA",
        bank: "GALICIA",
        amountArs: "-250",
        isCredit: 1,
      },
      {
        id: "twin-home",
        householdId: home,
        date: "2026-08-10",
        description: "TRANSFERENCIA",
        bank: "BBVA",
        amountArs: "251",
      },
      {
        id: "twin-home-in",
        householdId: "hh-shared",
        date: "2026-08-10",
        description: "TRANSFERENCIA",
        bank: "BBVA",
        amountArs: "251",
        isCredit: 1,
      },
      {
        id: "foreign",
        householdId: home,
        date: "2026-08-10",
        description: "TRANSFERENCIA",
        bank: "BBVA",
        amountArs: "252",
      },
      {
        id: "foreign-in",
        householdId: "hh-foreign",
        date: "2026-08-10",
        description: "TRANSFERENCIA",
        bank: "GALICIA",
        amountArs: "252",
        isCredit: 1,
      },
      {
        id: "two-day",
        householdId: home,
        date: "2026-08-10",
        description: "TRANSFERENCIA",
        bank: "BBVA",
        amountArs: "253",
      },
      {
        id: "two-day-in",
        householdId: home,
        date: "2026-08-12",
        description: "TRANSFERENCIA",
        bank: "GALICIA",
        amountArs: "253",
        isCredit: 1,
      },
      {
        id: "same-a",
        householdId: home,
        date: "2026-08-20",
        description: "TRANSFERENCIA",
        bank: "BBVA",
        amountArs: "254",
      },
      {
        id: "same-b",
        householdId: home,
        date: "2026-08-20",
        description: "TRANSFERENCIA",
        bank: "GALICIA",
        amountArs: "254",
      },
      {
        id: "wrong",
        householdId: home,
        date: "2026-08-18",
        description: "TRANSFERENCIA",
        bank: "BBVA",
        amountArs: "255",
      },
      {
        id: "wrong-flip",
        householdId: home,
        date: "2026-08-18",
        description: "AJUSTE",
        bank: "GALICIA",
        amountArs: "-255",
      },
      {
        id: "far",
        householdId: home,
        date: "2026-08-01",
        description: "TRANSFERENCIA",
        bank: "BBVA",
        amountArs: "256",
      },
      {
        id: "near",
        householdId: home,
        date: "2026-08-02",
        description: "TRANSFERENCIA",
        bank: "GALICIA",
        amountArs: "256",
      },
      {
        id: "near-in",
        householdId: home,
        date: "2026-08-02",
        description: "TRANSFERENCIA",
        bank: "MACRO",
        amountArs: "256",
        isCredit: 1,
      },
      {
        id: "third-cuit",
        householdId: home,
        date: "2026-08-16",
        description: `TRANSFERENCIA ${OTHER_CUIT}`,
        bank: "BBVA",
        amountArs: "257",
      },
      {
        id: "third-cvu",
        householdId: home,
        date: "2026-08-16",
        description: `TRANSFERENCIA ${OTHER_CVU}`,
        bank: "BBVA",
        amountArs: "258",
      },
      {
        id: "third-name",
        householdId: home,
        date: "2026-08-16",
        description: "PERSONA DEMO | TRANSFERENCIA INMEDIATA",
        bank: "BBVA",
        amountArs: "259",
      },
      {
        id: "k60",
        householdId: home,
        date: "2026-08-18",
        description: SIXTY_K,
        bank: "BBVA",
        amountArs: "60000",
      },
      {
        id: "echo",
        householdId: home,
        date: "2026-08-18",
        description: "260",
        bank: "Fiwind",
        amountArs: "260",
      },
      {
        id: "echo-named",
        householdId: home,
        date: "2026-08-18",
        description: "Cafe demo",
        bank: "BBVA",
        amountArs: "260",
      },
      {
        id: "cafe",
        householdId: home,
        date: "2026-08-03",
        description: "Cafe",
        bank: "BBVA",
        amountArs: "40",
      },
      {
        id: "income-out",
        householdId: home,
        date: "2026-08-10",
        description: "TRANSFERENCIA INMEDIATA",
        bank: "GALICIA",
        amountArs: "80",
      },
    ];
    for (const row of rows) insertTx(db, row);
    insertIncome(db, {
      id: "inc-twin",
      householdId: home,
      date: "2026-08-10",
      label: "TRANSFERENCIA",
      amountArs: "80",
    });
    insertIncome(db, {
      id: "inc-bare",
      householdId: home,
      date: "2026-08-05",
      label: "TRANSFERENCIA INMEDIATA",
      amountArs: "81",
    });
    insertIncome(db, {
      id: "inc-debin",
      householdId: home,
      date: "2026-08-05",
      label: "DEBIN servicio",
      amountArs: "82",
    });

    const movements = await loadExcludedMovementIds(wrap(db), "user-u", CUIT);
    const internal = [
      "own-cfg",
      "derived",
      "twin-bank",
      "twin-home",
      "near",
    ];
    for (const id of internal) {
      assert.equal(movements.internalIds.includes(id), true, id);
      assert.equal(movements.excludedIds.includes(id), true, id);
      assert.equal(movements.revisarIds.has(id), false, id);
    }
    assert.equal(movements.internalIds.includes("echo"), false);
    assert.equal(movements.excludedIds.includes("echo"), true);
    for (const id of ["foreign", "two-day", "same-a", "same-b", "wrong", "far", "k60"]) {
      assert.equal(movements.internalIds.includes(id), false, id);
      assert.equal(movements.revisarIds.has(id), true, id);
    }
    for (const id of ["third-cuit", "third-cvu", "third-name"]) {
      assert.equal(movements.internalIds.includes(id), false, id);
      assert.equal(movements.revisarIds.has(id), false, id);
    }
    assert.equal(movements.ownIds.has(CUIT), true);
    assert.equal(movements.ownIds.has(DERIVED), true);

    const expenses = idsWhere(db, `SELECT t.id AS id FROM transactions t WHERE ${expenseSql(movements.excludedIds)}`);
    for (const id of [...internal, "echo", "marker", "twin-bank-in"]) {
      assert.equal(expenses.has(id), false, `expense ${id}`);
    }
    for (const id of [
      "foreign",
      "two-day",
      "same-a",
      "same-b",
      "wrong",
      "far",
      "third-cuit",
      "third-cvu",
      "third-name",
      "k60",
      "cafe",
      "echo-named",
    ]) {
      assert.equal(expenses.has(id), true, `expense ${id}`);
    }
    const sixty = db
      .prepare(
        `SELECT SUM(${ARS_EXPR}) AS ars FROM transactions t WHERE t.id = 'k60' AND ${expenseSql(movements.excludedIds)}`,
      )
      .get() as { ars: number | null };
    assert.equal(sixty.ars, 60000);

    const hidden = idsWhere(
      db,
      `SELECT t.id AS id FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE ${consumosVisibleSql(undefined, movements.excludedIds)}`,
    );
    const shown = idsWhere(
      db,
      `SELECT t.id AS id FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE ${consumosVisibleSql(undefined, movements.excludedIds, movements.internalIds)}`,
    );
    for (const id of internal) {
      assert.equal(hidden.has(id), false, `hidden without visible ids ${id}`);
      assert.equal(shown.has(id), true, `visible ${id}`);
    }
    assert.equal(shown.has("echo"), false);
    assert.equal(hidden.has("echo"), false);
    for (const id of ["k60", "third-cuit", "third-name", "cafe", "far", "marker"]) {
      assert.equal(shown.has(id), true, `visible ${id}`);
    }

    const incomeRows = db
      .prepare(
        `SELECT id, household_id, date, label, kind, frequency, amount_ars, amount_usd
         FROM incomes WHERE user_id = 'user-u'`,
      )
      .all() as Array<{
      id: string;
      household_id: string;
      date: string;
      label: string;
      kind: string | null;
      frequency: string | null;
      amount_ars: string | null;
      amount_usd: string | null;
    }>;
    const ctx = {
      ownIds: movements.ownIds,
      userHouseholdIds: movements.userHouseholdIds,
      outgoing: movements.incomeOutgoing,
    };
    assert.equal(sumIncomeArs(incomeRows, "2026-08", 0, ctx), 81);
    const noted = annotateIncomeRows(incomeRows, ctx);
    const twin = noted.find((row) => row.id === "inc-twin");
    const bare = noted.find((row) => row.id === "inc-bare");
    assert.equal(twin?.internal, true);
    assert.equal(twin?.revisar, false);
    assert.equal(bare?.internal, false);
    assert.equal(bare?.revisar, true);
    assert.equal(movements.incomeOutgoing.some((row) => row.id === "cafe"), false);
  });

  it("keeps Sueldo when Alquiler has the same amount, through the loader", async () => {
    const db = openDb();
    seedPeople(db);
    const home = "hh-home";
    insertTx(db, {
      id: "rent",
      householdId: home,
      date: "2026-09-10",
      description: "Alquiler",
      bank: "BBVA",
      amountArs: "500000",
    });
    insertTx(db, {
      id: "pago",
      householdId: home,
      date: "2026-09-01",
      description: "SU PAGO EN PESOS",
      bank: "BBVA",
      amountArs: "500000",
      isPayment: 1,
    });
    insertIncome(db, {
      id: "sueldo",
      householdId: home,
      date: "2026-09-10",
      label: "Sueldo",
      amountArs: "500000",
    });
    insertIncome(db, {
      id: "sueldo-prev",
      householdId: home,
      date: "2026-08-31",
      label: "Sueldo",
      amountArs: "500000",
    });
    const movements = await loadExcludedMovementIds(wrap(db), "user-u", null);
    assert.equal(movements.incomeOutgoing.some((row) => row.id === "rent"), false);
    assert.equal(movements.incomeOutgoing.some((row) => row.id === "pago"), false);
    const incomeRows = db
      .prepare(
        `SELECT id, household_id, date, label, kind, frequency, amount_ars, amount_usd
         FROM incomes WHERE user_id = 'user-u'`,
      )
      .all() as Array<{
      id: string;
      household_id: string;
      date: string;
      label: string;
      kind: string | null;
      frequency: string | null;
      amount_ars: string | null;
      amount_usd: string | null;
    }>;
    const ctx = {
      ownIds: movements.ownIds,
      userHouseholdIds: movements.userHouseholdIds,
      outgoing: movements.incomeOutgoing,
    };
    assert.equal(sumIncomeArs(incomeRows, "2026-09", 0, ctx), 500000);
    assert.equal(sumIncomeArs(incomeRows, "2026-08", 0, ctx), 500000);
    const noted = annotateIncomeRows(incomeRows, ctx);
    assert.equal(noted.every((row) => row.internal === false), true);
  });

  it("returns no internal ids when the transfer statement fails and does not log the user id", async () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(" "));
    };
    try {
      const db = {
        prepare(sql: string) {
          return {
            bind() {
              return {
                async all() {
                  if (sql === TRANSFER_CANDIDATE_SQL) throw new Error("d1 down");
                  return { results: [] };
                },
              };
            },
          };
        },
      };
      const movements = await loadExcludedMovementIds(db, "user-secret-id", CUIT);
      assert.deepEqual(movements.internalIds, []);
      assert.deepEqual(movements.excludedIds, []);
      assert.equal(movements.ownIds.has(CUIT), true);
      const transferLog = lines.find((line) => line.includes("transfer class load failed"));
      assert.equal(typeof transferLog, "string");
      assert.equal(transferLog?.includes("user-secret-id"), false);
      assert.equal(transferLog?.includes(CUIT), false);
      assert.equal(transferLog?.includes("d1 down"), true);
    } finally {
      console.error = original;
    }
  });

  it("keeps transfer internal ids when only the income statement fails", async () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(" "));
    };
    try {
      const db = openDb();
      seedPeople(db);
      insertTx(db, {
        id: "own-cfg",
        householdId: "hh-home",
        date: "2026-08-10",
        description: `TRANSFERENCIA 11-${"1".repeat(8)}-1`,
        bank: "BBVA",
        amountArs: "5001",
      });
      insertTx(db, {
        id: "income-out",
        householdId: "hh-home",
        date: "2026-08-10",
        description: "PAGO SERVICIO",
        bank: "GALICIA",
        amountArs: "80",
      });
      insertIncome(db, {
        id: "inc-twin",
        householdId: "hh-home",
        date: "2026-08-10",
        label: "TRANSFERENCIA",
        amountArs: "80",
      });
      const real = wrap(db);
      const failing = {
        prepare(sql: string) {
          if (sql === INCOME_TWIN_SQL) {
            return {
              bind() {
                return {
                  async all() {
                    throw new Error("income down");
                  },
                };
              },
            };
          }
          return real.prepare(sql);
        },
      };
      const movements = await loadExcludedMovementIds(failing, "user-u", CUIT);
      assert.equal(movements.internalIds.includes("own-cfg"), true);
      assert.equal(movements.excludedIds.includes("own-cfg"), true);
      assert.equal(movements.userHouseholdIds.has("hh-home"), true);
      assert.deepEqual(movements.incomeOutgoing, []);
      const incomeLog = lines.find((line) => line.includes("income twin load failed"));
      assert.equal(typeof incomeLog, "string");
      assert.equal(incomeLog?.includes("user-u"), false);
      assert.equal(incomeLog?.includes(CUIT), false);
      assert.equal(incomeLog?.includes("5001"), false);
      assert.equal(incomeLog?.includes("80"), false);
      assert.equal(incomeLog?.includes("income down"), true);
      assert.equal(lines.some((line) => line.includes("transfer class load failed")), false);
    } finally {
      console.error = original;
    }
  });

  it("does not read D1 again for the same user within 60 seconds", async () => {
    const db = openDb();
    seedPeople(db);
    let reads = 0;
    const real = wrap(db);
    const counting = {
      prepare(sql: string) {
        const stmt = real.prepare(sql);
        return {
          bind(...values: unknown[]) {
            const bound = stmt.bind(...values);
            return {
              async all<T>() {
                reads += 1;
                return bound.all<T>();
              },
            };
          },
        };
      },
    };
    const first = await loadExcludedMovementIds(counting, "user-cache", null);
    const afterFirst = reads;
    assert.equal(afterFirst > 0, true);
    const second = await loadExcludedMovementIds(counting, "user-cache", null);
    assert.equal(reads, afterFirst);
    assert.deepEqual(second.excludedIds, first.excludedIds);
    assert.deepEqual(second.internalIds, first.internalIds);

    const lines: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(" "));
    };
    try {
      let failReads = 0;
      const failing = {
        prepare(sql: string) {
          return {
            bind() {
              return {
                async all() {
                  failReads += 1;
                  if (sql === TRANSFER_CANDIDATE_SQL) throw new Error("d1 down");
                  return { results: [] };
                },
              };
            },
          };
        },
      };
      await loadExcludedMovementIds(failing, "user-cache-fail", CUIT);
      const afterFail = failReads;
      await loadExcludedMovementIds(failing, "user-cache-fail", CUIT);
      assert.equal(failReads > afterFail, true);
      assert.equal(lines.some((line) => line.includes("transfer class load failed")), true);
    } finally {
      console.error = original;
    }
  });
});
