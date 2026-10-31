-- App schema (Postgres table/column names). See src/lib/db/schema.ts for types.
-- timestamps: integer unix ms. money: TEXT decimal strings. booleans: 0/1.
-- jsonb: TEXT. D1 applies this file once; there is no runtime DDL bootstrap.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  name text,
  email text UNIQUE,
  image text,
  created_at integer NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS allowed_emails (
  email text PRIMARY KEY,
  created_at integer NOT NULL DEFAULT (unixepoch() * 1000),
  created_by text
);

CREATE TABLE IF NOT EXISTS households (
  id text PRIMARY KEY,
  name text NOT NULL DEFAULT 'Mi espacio',
  invite_code text NOT NULL UNIQUE,
  created_at integer NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS household_members (
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  display_name text,
  joined_at integer NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (household_id, user_id)
);
CREATE INDEX IF NOT EXISTS hm_user_idx ON household_members(user_id);

CREATE TABLE IF NOT EXISTS household_api_tokens (
  id text PRIMARY KEY,
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  token_prefix text NOT NULL,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at integer NOT NULL DEFAULT (unixepoch() * 1000),
  last_used_at integer,
  revoked_at integer
);
CREATE UNIQUE INDEX IF NOT EXISTS hat_hash_uidx ON household_api_tokens(token_hash);
CREATE INDEX IF NOT EXISTS hat_household_idx ON household_api_tokens(household_id);

CREATE TABLE IF NOT EXISTS categories (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL,
  default_ownership text NOT NULL DEFAULT 'personal',
  is_system integer NOT NULL DEFAULT 1,
  household_id text REFERENCES households(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS household_category_prefs (
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  category_id text NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  hidden integer NOT NULL DEFAULT 1,
  PRIMARY KEY (household_id, category_id)
);
CREATE INDEX IF NOT EXISTS hcp_household_idx ON household_category_prefs(household_id);

CREATE TABLE IF NOT EXISTS merchant_rules (
  id text PRIMARY KEY,
  household_id text REFERENCES households(id) ON DELETE CASCADE,
  pattern text NOT NULL,
  category_id text NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  priority integer NOT NULL DEFAULT 50
);

CREATE TABLE IF NOT EXISTS card_statements (
  id text PRIMARY KEY,
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'bbva_xlsx',
  file_name text,
  imported_by text REFERENCES users(id),
  imported_at integer NOT NULL DEFAULT (unixepoch() * 1000),
  row_count integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id text PRIMARY KEY,
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  statement_id text REFERENCES card_statements(id) ON DELETE SET NULL,
  date text NOT NULL,
  description_raw text NOT NULL,
  description_normalized text NOT NULL,
  amount_ars text,
  amount_usd text,
  installment text,
  is_payment integer NOT NULL DEFAULT 0,
  is_credit integer NOT NULL DEFAULT 0,
  category_id text REFERENCES categories(id),
  ownership text NOT NULL DEFAULT 'personal',
  paid_by_user_id text REFERENCES users(id),
  split_pct integer NOT NULL DEFAULT 50,
  external_fingerprint text NOT NULL,
  source text NOT NULL DEFAULT 'bbva_import',
  bank text,
  card_last4 text,
  linked_transaction_id text,
  created_at integer NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at integer NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS tx_household_fp_uidx
  ON transactions(household_id, external_fingerprint);
CREATE INDEX IF NOT EXISTS tx_household_date_idx ON transactions(household_id, date);
CREATE INDEX IF NOT EXISTS tx_household_cat_idx ON transactions(household_id, category_id);
CREATE INDEX IF NOT EXISTS tx_household_bank_idx ON transactions(household_id, bank);
CREATE INDEX IF NOT EXISTS tx_linked_idx ON transactions(linked_transaction_id);

CREATE TABLE IF NOT EXISTS receipts (
  id text PRIMARY KEY,
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  merchant_name text,
  receipt_date text,
  total_ars text,
  currency text DEFAULT 'ARS',
  ocr_raw text,
  status text NOT NULL DEFAULT 'pending',
  transaction_id text REFERENCES transactions(id) ON DELETE SET NULL,
  created_by text REFERENCES users(id),
  created_at integer NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS receipts_household_idx ON receipts(household_id);
CREATE INDEX IF NOT EXISTS receipts_tx_idx ON receipts(transaction_id);

CREATE TABLE IF NOT EXISTS receipt_items (
  id text PRIMARY KEY,
  receipt_id text NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  name text NOT NULL,
  quantity text DEFAULT '1',
  unit_price text,
  line_total text,
  product_category text
);

CREATE TABLE IF NOT EXISTS savings_assets (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  kind text NOT NULL,
  label text NOT NULL,
  address text,
  amount_ars text,
  amount_usd text,
  last_balance_usd text,
  last_synced_at integer,
  sync_error text,
  created_at integer NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at integer NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS savings_user_idx ON savings_assets(user_id);
CREATE INDEX IF NOT EXISTS savings_household_idx ON savings_assets(household_id);

CREATE TABLE IF NOT EXISTS debt_settings (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rate_pct text,
  min_payment_ars text,
  due_day integer,
  notes text,
  force_settled integer NOT NULL DEFAULT 0,
  cleared_at integer,
  card_last4 text,
  saldo_deuda_ars text,
  saldo_deuda_usd text,
  updated_at integer NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS incomes (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'variable',
  frequency text,
  date text NOT NULL,
  label text NOT NULL,
  amount_ars text,
  amount_usd text,
  external_fingerprint text,
  created_at integer NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at integer NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS incomes_user_idx ON incomes(user_id);
CREATE INDEX IF NOT EXISTS incomes_household_date_idx ON incomes(household_id, date);
CREATE INDEX IF NOT EXISTS incomes_user_kind_idx ON incomes(user_id, kind);
CREATE UNIQUE INDEX IF NOT EXISTS incomes_household_fp_uidx
  ON incomes(household_id, external_fingerprint)
  WHERE external_fingerprint IS NOT NULL;

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  polar_subscription_id text PRIMARY KEY,
  status text NOT NULL,
  current_period_end integer,
  updated_at integer NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS subscriptions_user_idx ON subscriptions(user_id);
