/**
 * Local wall-time harness for the lite Worker (upper bound on CPU).
 *
 * Prerequisite: local D1 loaded with
 *   node scripts/load-neon-backup.mjs /workspace/cuentix/migration/backup --local
 *
 * Mints a session ONLY in that local D1 (never --remote). The cookie value is
 * a fixed local test token; D1 stores its SHA-256.
 *
 * Live CPU (after promotion, on the real worker, by the account owner):
 *   pnpm exec wrangler tail cuentix --format json
 * Each line is one request. Read outcome.cpuTime (ms) and outcome.status.
 * The Workers FREE limit is 10 ms. This OAuth token may lack
 * workers_tail:read, so tail can fail until the owner runs it.
 *
 *   node scripts/bench-lite.mjs
 */
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const PORT = 8787;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TOKEN = "cuentix-lite-local-test";
const USER_ID = "e7a4756a-97b8-4038-b57e-5aac635c85bf";
const HASH = createHash("sha256").update(TOKEN).digest("hex");
const EXPIRES = Date.now() + 30 * 24 * 60 * 60 * 1000;
const RUNS = 20;
const WARMUP = 2;

const ROUTES = [
  { name: "GET /login/ (static)", path: "/login/", auth: false, expect: [200] },
  { name: "GET /api/me (no cookie)", path: "/api/me", auth: false, expect: [401] },
  { name: "GET /api/transactions (no cookie)", path: "/api/transactions", auth: false, expect: [401] },
  { name: "GET /api/auth/google", path: "/api/auth/google", auth: false, expect: [302], redirect: "manual" },
  { name: "GET /api/me", path: "/api/me", auth: true, expect: [200] },
  { name: "GET /api/dashboard?period=2026-10", path: "/api/dashboard?period=2026-10", auth: true, expect: [200] },
  { name: "GET /api/transactions?period=2026-10&limit=10", path: "/api/transactions?period=2026-10&limit=10&offset=0", auth: true, expect: [200] },
  { name: "GET /api/transactions?limit=10 (no period)", path: "/api/transactions?limit=10&offset=0", auth: true, expect: [200] },
  { name: "GET /api/categories", path: "/api/categories", auth: true, expect: [200] },
  { name: "GET /api/household/active", path: "/api/household/active", auth: true, expect: [200] },
  { name: "GET /api/stats/mes-a-mes (stage 2)", path: "/api/stats/mes-a-mes", auth: true, expect: [501] },
];

function d1(command) {
  const result = spawnSync(
    "pnpm",
    [
      "exec", "wrangler", "d1", "execute", "cuentix",
      "-c", "wrangler.staging.jsonc",
      "--local",
      "--json",
      "--command", command,
    ],
    { encoding: "utf8", env: { ...process.env, CI: "1" } },
  );
  if (result.status !== 0) {
    console.error((result.stderr || result.stdout || "").slice(-1200));
    process.exit(result.status || 1);
  }
  return result.stdout;
}

function mintSession() {
  const sql = `INSERT OR REPLACE INTO auth_session (id, expires_at, token, created_at, updated_at, user_id) VALUES ('local-lite-bench', ${EXPIRES}, '${HASH}', ${Date.now()}, ${Date.now()}, '${USER_ID}')`;
  d1(sql);
  const check = d1(
    `SELECT u.id AS id, u.email AS email FROM auth_user u WHERE u.id = '${USER_ID}'`,
  );
  if (!check.includes(USER_ID)) {
    console.error("local auth_user seed missing; load the backup with --local first");
    process.exit(1);
  }
}

function percentile(sorted, p) {
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

async function sample(route) {
  const headers = route.auth ? { cookie: `cuentix_session=${TOKEN}` } : {};
  const times = [];
  let status = 0;
  let location = "";
  let bodySnippet = "";
  for (let i = 0; i < WARMUP + RUNS; i++) {
    const start = performance.now();
    const res = await fetch(`${ORIGIN}${route.path}`, {
      headers,
      redirect: route.redirect || "follow",
    });
    const buf = await res.arrayBuffer();
    const ms = performance.now() - start;
    status = res.status;
    location = res.headers.get("location") || "";
    if (!route.expect.includes(status)) {
      bodySnippet = new TextDecoder().decode(buf).slice(0, 300);
    }
    if (i >= WARMUP) times.push(ms);
  }
  times.sort((a, b) => a - b);
  const ok = route.expect.includes(status);
  return {
    name: route.name,
    status,
    ok,
    location: location.slice(0, 120),
    bodySnippet,
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    min: times[0],
    max: times[times.length - 1],
  };
}

async function waitReady(child) {
  let buf = "";
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("wrangler dev did not become ready")), 90_000);
    const onData = (chunk) => {
      const text = String(chunk);
      buf += text;
      process.stderr.write(text);
      if (/Ready on|ready on|localhost:8787|127\.0\.0\.1:8787/i.test(buf)) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`wrangler dev exited ${code} before ready`));
    });
  });
  await ready;
  await delay(300);
}

function startDev() {
  const child = spawn(
    "node_modules/.bin/wrangler",
    [
      "dev",
      "-c", "wrangler.staging.jsonc",
      "--port", String(PORT),
      "--ip", "127.0.0.1",
      "--local",
    ],
    {
      env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  return child;
}

function stop(child) {
  if (!child || child.pid == null) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
}

async function main() {
  mintSession();
  const child = startDev();
  const kill = () => stop(child);
  process.on("exit", kill);
  process.on("SIGINT", () => { kill(); process.exit(1); });
  try {
    await waitReady(child);
    const rows = [];
    for (const route of ROUTES) {
      const row = await sample(route);
      rows.push(row);
      console.log(
        `${row.ok ? "ok" : "FAIL"} ${row.status} p50=${row.p50.toFixed(1)} p95=${row.p95.toFixed(1)} ${row.name}${row.location ? " -> " + row.location : ""}${row.bodySnippet ? " " + row.bodySnippet : ""}`,
      );
    }
    console.log("\n| Route | status | p50 ms | p95 ms |");
    console.log("| --- | ---: | ---: | ---: |");
    for (const row of rows) {
      console.log(`| ${row.name} | ${row.status} | ${row.p50.toFixed(1)} | ${row.p95.toFixed(1)} |`);
    }
    const failed = rows.filter((row) => !row.ok);
    if (failed.length) process.exitCode = 1;
  } finally {
    stop(child);
    await delay(400);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
