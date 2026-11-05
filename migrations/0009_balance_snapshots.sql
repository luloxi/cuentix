-- Manual and routine bank balances. Additive. Does not touch transactions.
-- ARS, USDT, and USD stay in separate rows and are never summed in SQL.

CREATE TABLE IF NOT EXISTS balance_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  account_name TEXT NOT NULL,
  date TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('ARS', 'USDT', 'USD')),
  amount TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual', 'routine')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE UNIQUE INDEX IF NOT EXISTS balance_snapshots_slot_uidx
  ON balance_snapshots (user_id, household_id, account_name, currency, date);

CREATE INDEX IF NOT EXISTS balance_snapshots_lookup_idx
  ON balance_snapshots (user_id, household_id, currency, date);
