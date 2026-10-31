-- Daily net-worth points. Money stays TEXT. Writes are idempotent per user, day, and source.

CREATE TABLE IF NOT EXISTS patrimonio_snapshots (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date text NOT NULL,
  assets_ars text NOT NULL DEFAULT '0',
  assets_usd text NOT NULL DEFAULT '0',
  debt_ars text NOT NULL DEFAULT '0',
  debt_usd text NOT NULL DEFAULT '0',
  net_worth_ars text NOT NULL DEFAULT '0',
  fx_rate text,
  source text NOT NULL DEFAULT 'snapshot',
  note text,
  created_at integer NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE UNIQUE INDEX IF NOT EXISTS patrimonio_snapshots_user_date_source_uidx
  ON patrimonio_snapshots(user_id, date, source);

CREATE INDEX IF NOT EXISTS patrimonio_snapshots_user_date_idx
  ON patrimonio_snapshots(user_id, date);
