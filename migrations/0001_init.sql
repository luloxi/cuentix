-- Cuentix v2. One household viewer. Currencies are never converted.

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  household TEXT NOT NULL DEFAULT 'Personal'
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('ARS', 'USDT', 'USD')),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  category_id INTEGER REFERENCES categories(id),
  description TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'internal_transfer')),
  source TEXT,
  external_key TEXT UNIQUE
);

CREATE INDEX idx_transactions_date ON transactions (date);
CREATE INDEX idx_transactions_kind ON transactions (kind);
CREATE INDEX idx_transactions_category_id ON transactions (category_id);
CREATE INDEX idx_transactions_account_id ON transactions (account_id);
CREATE INDEX idx_transactions_kind_date ON transactions (kind, date);
CREATE INDEX idx_transactions_kind_currency_date ON transactions (kind, currency, date);

CREATE TABLE balance_snapshots (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  currency TEXT NOT NULL CHECK (currency IN ('ARS', 'USDT', 'USD')),
  amount REAL NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual', 'routine')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (account_id, currency, date)
);

CREATE INDEX idx_balance_snapshots_account_date ON balance_snapshots (account_id, date);
