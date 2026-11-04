# Cuentix v2

Personal finance viewer for one person. The old app is still on the git tag `legacy-v1`. This branch replaces it with static pages and one small API.

ARS, USDT, and USD are never converted and never added together. There is no exchange rate anywhere in the app.

## Architecture

Next.js builds a static export (`output: 'export'`) into `out/`. Cloudflare Workers static assets serve those files. Page views do not run Worker code.

`wrangler.jsonc` sends only `/api/*` to the Worker (`run_worker_first`). HTML uses `auto-trailing-slash`. Missing paths use `not_found_handling: "404-page"`, not a single-page-app fallback.

The Worker is a plain fetch handler in `worker/index.ts`. It runs the SQL strings in `src/lib/sql.ts`. Totals are `GROUP BY` in D1, with indexes, and the JSON stays small. Charts are inline SVG in the browser.

This is sized for the Workers Free plan (10 ms of CPU per request). There are no cron triggers, no R2 bucket, no AI binding, and no custom domain. `workers_dev` is on.

## Screens

The UI is in Spanish. Code and this file are in English.

| Screen | Path | What it shows |
| --- | --- | --- |
| Gastos | `/` and `/gastos/` | Last 90 days of `kind = expense`, per currency. Pie chart, table, total. Day 90 is included and day 91 is not. Refunds are negative expenses, so they reduce the total. |
| Ingresos | `/ingresos/` | `kind = income` only, per month. Internal transfers are not income. |
| Evolución | `/evolucion/` | Expense line chart. Día is the last 90 days. Semana is the last 26 weeks, Monday start (`date(date, 'weekday 0', '-6 days')`). Mes is the last 24 months. Todo el historial is one point per month for all time. It is not a cumulative line. |
| Movimientos | `/movimientos/` | 50 rows per page, newest first, keyset cursor. Filter by kind and currency. Internal transfers are marked and are not part of any money total. |
| Saldos | `/saldos/` | Latest balance per account and currency, totals per currency, a line per account, and the manual balance form. |
| Entrar | `/login/` | One access key field. |

The balance form is the only data input in the UI. There is no upload, no billing, and no add-expense button.

On a narrow screen the sections sit in a bottom tab bar. Tap targets are at least 40px, and clickable controls use `cursor: pointer`.

## Auth

The static pages are public shells. They call the API and go to `/login/` on a 401.

Secrets, by name only:

- `ACCESS_KEY`: the login key
- `SESSION_SECRET`: HMAC key for the session cookie
- `BALANCES_TOKEN`: bearer token for the operator balance route

`POST /api/login` with `{"accessKey":"..."}` compares the key to `ACCESS_KEY` in constant time. On success it sets cookie `cuentix_session` to `<unix exp>.<base64url HMAC-SHA256(SESSION_SECRET, exp)>`. The cookie is HttpOnly, Secure, SameSite=Lax, Path=/, and lasts 30 days. Login is not rate limited, so the request stays cheap.

Every other `/api/*` route checks that cookie, except `POST /api/balances`, which uses the bearer token and does not accept the session. `POST /api/logout` checks the cookie and clears it.

Copy `.dev.vars.example` to `.dev.vars` for local `wrangler dev`. Set the real values with `wrangler secret put`. Do not commit `.dev.vars`.

The cookie is `Secure`, so a browser stores it on HTTPS (`*.workers.dev`). `http://localhost` will not keep it.

## API

All JSON. Successful GETs send `Cache-Control: private, max-age=30`.

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/api/login` | access key in the body |
| POST | `/api/logout` | session cookie |
| GET | `/api/spending-by-category?days=90&currency=ARS` | session |
| GET | `/api/income-by-month?currency=ARS` | session |
| GET | `/api/spending-series?granularity=day\|week\|month\|all&currency=ARS` | session |
| GET | `/api/transactions?kind=&currency=&cursor=` | session |
| GET | `/api/balances?currency=ARS` | session |
| POST | `/api/balances/manual` | session. One snapshot, source forced to `manual`. |
| POST | `/api/balances` | `Authorization: Bearer <BALANCES_TOKEN>` |

`currency` is `ARS` (default), `USDT`, or `USD`. `kind` is `expense`, `income`, or `internal_transfer`. `cursor` is `YYYY-MM-DD|<id>` from `nextCursor`.

`today` in the SQL is the calendar date in `America/Argentina/Buenos_Aires`. Tests inject their own date.

Operator body, at most 50 snapshots. `date` defaults to today in Buenos Aires. A new account name is created. The same account, currency, and date updates in place:

```json
{
  "source": "routine",
  "snapshots": [
    {"account": "Fiwind", "currency": "USDT", "amount": 1.23, "date": "2026-11-03"}
  ]
}
```

```bash
curl -sS -X POST "$APP_URL/api/balances" \
  -H "Authorization: Bearer $BALANCES_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"routine","snapshots":[{"account":"Fiwind","currency":"USDT","amount":1.23,"date":"2026-11-03"}]}'
```

Response: `{"ok":true,"upserted":1}`.

Manual form body: `{"account","currency","amount","date"}` to `POST /api/balances/manual`.

## Data

`migrations/0001_init.sql` creates `accounts`, `categories`, `transactions`, and `balance_snapshots`.

- Expense amounts are signed: a charge is positive, a refund is negative.
- Income and internal transfer amounts are positive magnitudes.
- `balance_snapshots` is unique on `(account_id, currency, date)` and `source` is `manual` or `routine`.
- `accounts.household` exists for later use. The seed only loads household `Personal`.

## Seed pipeline

Real rows stay out of git. `seed.sql` is gitignored.

```bash
python3 scripts/build-seed.py \
  --old-db /workspace/cuentix-v2/old.db \
  --out /workspace/cuentix-v2/seed.sql
```

The script is Python 3 standard library only. It reads the local sqlite file (old D1 backup plus later Fiwind rows). It does not query remote D1. Stdout is counts. Stderr lists ambiguous description shapes with the digits removed, and no amounts.

Rules, in order:

1. Dedupe. A Fiwind description that is only digits, dots, commas, spaces, or slashes is dropped when a named Fiwind row has the same date and the same absolute ARS and USD amounts, in any household. Numeric rows with no named twin stay (they are conversions, so they become internal transfers). Rows that share date, currency, absolute amount, normalized description, and account but come from different sources keep the more specific source: `csv_import`, `xlsx_import`, `sheet_import`, `casita_csv`, `statement_pdf`, `bbva_pdf`, `bbva_import`. Repeats from the same source stay. `external_key` is the old fingerprint, or a hash, and inserts are `INSERT OR IGNORE`.
2. Account: Fiwind, BBVA caja, BBVA tarjeta (null bank with `bbva_import` or `bbva_pdf`), otherwise Sin cuenta. Brubank is created with no transactions.
3. Non-zero `amount_usd` becomes USDT on Fiwind and USD elsewhere. If ARS is also non-zero, the description gains ` (ARS <amount>)` and the USD side is the stored amount. Otherwise the row is ARS. Rows with both sides null or zero are dropped as `empty`.
4. Kind: internal transfer for Conversiones, Transferencia interna, Pagos, Crypto / inversiones, and the own-account phrases in the script. Income for Rendimientos, for real rows in the old `incomes` table (labels without devolucion or devolvio; a matching transaction is relabeled instead of duplicated), and for Uncategorized credits that are not `Pago a` and not a generic Depósito or DEBIN. Everything else is an expense. Credits in expense categories are negative.
5. Categories: expenses keep the old name. Income is Ingreso, or Rendimientos. Internal transfers are Transferencia interna, or Conversiones.

The seed also upserts two manual Fiwind snapshots dated 2026-11-03: USDT 1961.41 and ARS 10145.02.

Apply it after the migration:

```bash
pnpm db:migrate:local
pnpm exec wrangler d1 execute cuentix-v2 --local --file /workspace/cuentix-v2/seed.sql
```

Use `--remote` only when you mean to write the Cloudflare database.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Next.js dev server for the static UI. The API is not part of this process. |
| `pnpm build` | `next build`, writes `out/`. |
| `pnpm test` | Vitest. In-memory sqlite, synthetic rows, injected `today`. |
| `pnpm typecheck` | `tsc --noEmit`. |
| `pnpm db:migrate:local` | `wrangler d1 migrations apply cuentix-v2 --local`. |

`pnpm exec wrangler dev` serves `out/` plus the API locally after a build.

## Deploy

You deploy. This repo does not run `wrangler deploy`.

1. Create a D1 database named `cuentix-v2`.
2. Replace `REPLACE_WITH_D1_ID` in `wrangler.jsonc` with that database id.
3. `pnpm build`
4. `pnpm exec wrangler d1 migrations apply cuentix-v2 --remote`
5. Build `seed.sql` with the script above and run `pnpm exec wrangler d1 execute cuentix-v2 --remote --file /workspace/cuentix-v2/seed.sql`
6. `pnpm exec wrangler secret put ACCESS_KEY`
7. `pnpm exec wrangler secret put SESSION_SECRET`
8. `pnpm exec wrangler secret put BALANCES_TOKEN`
9. `pnpm exec wrangler deploy`

No route and no custom domain are configured. The Worker is available on `workers.dev`. Do not merge this branch to `main`.
