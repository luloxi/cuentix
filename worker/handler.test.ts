import { describe, expect, it } from "vitest";
import { signSession, SESSION_COOKIE, SESSION_MAX_AGE_SEC } from "../src/lib/auth";
import { insertAccount, insertCategory, insertTransaction, openMemoryDb, wrapDb } from "../src/test/db";
import { handleRequest, type Env } from "./index";

const NOW = Date.parse("2026-06-15T15:00:00Z");

function envFor(db = openMemoryDb(), overrides: Partial<Env> = {}): Env {
  return {
    DB: wrapDb(db),
    ACCESS_KEY: "test-access-key",
    SESSION_SECRET: "test-session-secret",
    BALANCES_TOKEN: "test-balances-token",
    ...overrides,
  };
}

async function cookieHeader(secret = "test-session-secret"): Promise<string> {
  const token = await signSession(secret, Math.floor(NOW / 1000) + SESSION_MAX_AGE_SEC);
  return `${SESSION_COOKIE}=${token}`;
}

describe("session gate", () => {
  it("sets an HttpOnly Secure cookie on login and rejects a bad key", async () => {
    const env = envFor();
    const ok = await handleRequest(
      new Request("https://cuentix.test/api/login", {
        method: "POST",
        body: JSON.stringify({ accessKey: "test-access-key" }),
      }),
      env,
      { now: NOW, today: "2026-06-15" },
    );
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain(`${SESSION_COOKIE}=`);

    const bad = await handleRequest(
      new Request("https://cuentix.test/api/login", {
        method: "POST",
        body: JSON.stringify({ accessKey: "nope" }),
      }),
      env,
      { now: NOW, today: "2026-06-15" },
    );
    expect(bad.status).toBe(401);
    expect(bad.headers.get("set-cookie")).toBeNull();
  });

  it("returns 401 for API reads without a valid cookie", async () => {
    const env = envFor();
    const missing = await handleRequest(new Request("https://cuentix.test/api/spending-by-category"), env, {
      now: NOW,
      today: "2026-06-15",
    });
    expect(missing.status).toBe(401);

    const token = await signSession("test-session-secret", Math.floor(NOW / 1000) - 10);
    const expired = await handleRequest(
      new Request("https://cuentix.test/api/income-by-month", {
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      }),
      env,
      { now: NOW, today: "2026-06-15" },
    );
    expect(expired.status).toBe(401);
  });
});

describe("balances token", () => {
  it("rejects a missing or wrong token and does not accept the session cookie", async () => {
    const env = envFor();
    const missing = await handleRequest(
      new Request("https://cuentix.test/api/balances", {
        method: "POST",
        body: JSON.stringify({
          source: "routine",
          snapshots: [{ account: "Fiwind", currency: "USDT", amount: 1, date: "2026-01-01" }],
        }),
      }),
      env,
      { now: NOW, today: "2026-06-15" },
    );
    expect(missing.status).toBe(401);

    const wrong = await handleRequest(
      new Request("https://cuentix.test/api/balances", {
        method: "POST",
        headers: { authorization: "Bearer wrong-token" },
        body: JSON.stringify({
          source: "routine",
          snapshots: [{ account: "Fiwind", currency: "USDT", amount: 1, date: "2026-01-01" }],
        }),
      }),
      env,
      { now: NOW, today: "2026-06-15" },
    );
    expect(wrong.status).toBe(401);

    const cookie = await cookieHeader();
    const sessionOnly = await handleRequest(
      new Request("https://cuentix.test/api/balances", {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({
          source: "routine",
          snapshots: [{ account: "Fiwind", currency: "USDT", amount: 1, date: "2026-01-01" }],
        }),
      }),
      env,
      { now: NOW, today: "2026-06-15" },
    );
    expect(sessionOnly.status).toBe(401);
  });

  it("upserts the same account, currency, and date in place", async () => {
    const db = openMemoryDb();
    const env = envFor(db);
    const send = (amount: number) =>
      handleRequest(
        new Request("https://cuentix.test/api/balances", {
          method: "POST",
          headers: { authorization: "Bearer test-balances-token" },
          body: JSON.stringify({
            source: "routine",
            snapshots: [{ account: "Fiwind", currency: "USDT", amount, date: "2026-01-02" }],
          }),
        }),
        env,
        { now: NOW, today: "2026-06-15" },
      );

    const first = await send(10);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, upserted: 1 });
    const second = await send(11.5);
    expect(second.status).toBe(200);

    const rows = db.prepare("SELECT amount, source, date FROM balance_snapshots").all() as Array<{
      amount: number;
      source: string;
      date: string;
    }>;
    expect(rows).toEqual([{ amount: 11.5, source: "routine", date: "2026-01-02" }]);
    const accounts = db.prepare("SELECT name FROM accounts").all();
    expect(accounts).toEqual([{ name: "Fiwind" }]);
  });
});

describe("authenticated reads", () => {
  it("serves spending totals and a private cache header", async () => {
    const db = openMemoryDb();
    const fiwind = insertAccount(db, "Fiwind");
    const delivery = insertCategory(db, "Delivery");
    insertTransaction(db, {
      date: "2026-06-10",
      amount: 20,
      currency: "ARS",
      accountId: fiwind,
      categoryId: delivery,
      description: "Test purchase C",
      kind: "expense",
    });
    insertTransaction(db, {
      date: "2026-06-10",
      amount: 8,
      currency: "ARS",
      accountId: fiwind,
      categoryId: delivery,
      description: "Test internal move",
      kind: "internal_transfer",
    });
    const response = await handleRequest(
      new Request("https://cuentix.test/api/spending-by-category?currency=ARS&days=90", {
        headers: { cookie: await cookieHeader() },
      }),
      envFor(db),
      { now: NOW, today: "2026-06-15" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, max-age=30");
    const body = (await response.json()) as { total: number; rows: Array<{ total: number }> };
    expect(body.total).toBe(20);
    expect(body.rows).toHaveLength(1);
  });
});
