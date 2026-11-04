import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Db, Statement } from "../../worker/index";

export function openMemoryDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync("migrations/0001_init.sql", "utf8"));
  return db;
}

export function insertAccount(db: DatabaseSync, name: string): number {
  db.prepare("INSERT INTO accounts (name, household) VALUES (?, 'Personal')").run(name);
  const row = db.prepare("SELECT id FROM accounts WHERE name = ?").get(name) as { id: number };
  return Number(row.id);
}

export function insertCategory(db: DatabaseSync, name: string): number {
  db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)").run(name);
  const row = db.prepare("SELECT id FROM categories WHERE name = ?").get(name) as { id: number };
  return Number(row.id);
}

export function insertTransaction(
  db: DatabaseSync,
  input: {
    date: string;
    amount: number;
    currency: string;
    accountId: number;
    categoryId: number | null;
    description: string;
    kind: string;
    source?: string;
    externalKey?: string;
  },
): void {
  db.prepare(
    `INSERT INTO transactions (date, amount, currency, account_id, category_id, description, kind, source, external_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.date,
    input.amount,
    input.currency,
    input.accountId,
    input.categoryId,
    input.description,
    input.kind,
    input.source ?? "test",
    input.externalKey ?? `${input.kind}-${input.date}-${input.amount}-${input.currency}-${input.description}`,
  );
}

class SqliteStatement implements Statement {
  private params: SQLInputValue[] = [];

  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
  ) {}

  bind(...values: Array<string | number | null>): Statement {
    const next = new SqliteStatement(this.db, this.sql);
    next.params = values;
    return next;
  }

  async all<T>(): Promise<{ results: T[] }> {
    const results = this.db.prepare(this.sql).all(...this.params) as T[];
    return { results };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const info = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(info.changes) } };
  }
}

export function wrapDb(db: DatabaseSync): Db {
  return {
    prepare(sql: string) {
      return new SqliteStatement(db, sql);
    },
    async batch(statements: Statement[]) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
