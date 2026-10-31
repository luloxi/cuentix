import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function openMigrated(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of [
    "0001_app.sql",
    "0002_auth.sql",
    "0003_serpix_sync.sql",
    "0004_card_closed.sql",
  ]) {
    db.exec(readFileSync(join(root, "migrations", file), "utf8"));
  }
  return db;
}

describe("D1 migrations on node:sqlite", () => {
  it("creates the app tables and keeps decimal strings exact", () => {
    const db = openMigrated();
    db.prepare(
      "INSERT INTO users (id, email, name) VALUES ('u1', 'a@b.co', 'A')",
    ).run();
    db.prepare(
      "INSERT INTO households (id, name, invite_code) VALUES ('h1', 'Casa', 'CODE1234')",
    ).run();
    db.prepare(
      `INSERT INTO transactions (
        id, household_id, date, description_raw, description_normalized,
        amount_ars, amount_usd, external_fingerprint
      ) VALUES ('t1', 'h1', '2026-01-02', 'DIA', 'DIA', '16961.25', '10.50', 'fp1')`,
    ).run();

    const row = db
      .prepare(
        "SELECT amount_ars, amount_usd, typeof(amount_ars) AS t, is_payment, created_at FROM transactions WHERE id = 't1'",
      )
      .get() as {
      amount_ars: string;
      amount_usd: string;
      t: string;
      is_payment: number;
      created_at: number;
    };
    assert.equal(row.t, "text");
    assert.equal(row.amount_ars, "16961.25");
    assert.equal(row.amount_usd, "10.50");
    assert.equal(row.is_payment, 0);
    assert.equal(typeof row.created_at, "number");
    assert.ok(row.created_at > 1_000_000_000_000);
  });

  it("keeps the partial unique index on incomes fingerprints", () => {
    const db = openMigrated();
    db.prepare("INSERT INTO users (id, email) VALUES ('u1', 'a@b.co')").run();
    db.prepare(
      "INSERT INTO households (id, invite_code) VALUES ('h1', 'CODE1234')",
    ).run();
    const insert = db.prepare(
      `INSERT INTO incomes (id, user_id, household_id, date, label, external_fingerprint)
       VALUES (?, 'u1', 'h1', '2026-01-01', 'x', ?)`,
    );
    insert.run("i1", null);
    insert.run("i2", null);
    insert.run("i3", "fp");
    assert.throws(() => insert.run("i4", "fp"));
  });

  it("declares saldo_deuda columns on debt_settings", () => {
    const src = readFileSync(join(root, "migrations", "0001_app.sql"), "utf8");
    assert.match(src, /saldo_deuda_ars text/);
    assert.match(src, /saldo_deuda_usd text/);
    const db = openMigrated();
    const cols = db.prepare("PRAGMA table_info(debt_settings)").all() as Array<{
      name: string;
    }>;
    const names = new Set(cols.map((c) => c.name));
    assert.ok(names.has("saldo_deuda_ars"));
    assert.ok(names.has("saldo_deuda_usd"));
    const cardCols = db.prepare("PRAGMA table_info(card_statements)").all() as Array<{
      name: string;
    }>;
    const cardNames = new Set(cardCols.map((c) => c.name));
    assert.ok(cardNames.has("closed_at"));
    assert.ok(cardNames.has("status"));
    assert.ok(names.has("force_settled"));
  });

  it("creates Better Auth tables apart from app users", () => {
    const db = openMigrated();
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'auth_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    assert.deepEqual(
      tables.map((t) => t.name),
      ["auth_account", "auth_session", "auth_user", "auth_verification"],
    );
    db.prepare(
      "INSERT INTO auth_user (id, name, email, email_verified) VALUES ('e1', 'A', 'a@b.co', 1)",
    ).run();
    const row = db
      .prepare("SELECT email_verified FROM auth_user WHERE id = 'e1'")
      .get() as { email_verified: number };
    assert.equal(row.email_verified, 1);
  });

  it("adds business sync columns and the outbox without rewriting transactions", () => {
    const db = openMigrated();
    const cols = db.prepare("PRAGMA table_info(transactions)").all() as Array<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    const business = cols.find((c) => c.name === "is_business");
    const version = cols.find((c) => c.name === "business_version");
    assert.ok(business);
    assert.equal(business.notnull, 1);
    assert.equal(business.dflt_value, "0");
    assert.ok(version);
    db.prepare("INSERT INTO users (id, email) VALUES ('u1', 'a@b.co')").run();
    db.prepare(
      "INSERT INTO households (id, invite_code) VALUES ('h1', 'CODE1234')",
    ).run();
    db.prepare(
      `INSERT INTO transactions (
        id, household_id, date, description_raw, description_normalized, external_fingerprint
      ) VALUES ('t1', 'h1', '2026-01-02', 'DIA', 'DIA', 'fp1')`,
    ).run();
    const row = db
      .prepare("SELECT is_business, business_version FROM transactions WHERE id = 't1'")
      .get() as { is_business: number; business_version: number | null };
    assert.equal(row.is_business, 0);
    assert.equal(row.business_version, null);
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'serpix_outbox' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    const names = new Set(indexes.map((i) => i.name));
    assert.ok(names.has("serpix_outbox_pending_idx"));
    assert.ok(names.has("serpix_outbox_tx_created_idx"));
  });
});
