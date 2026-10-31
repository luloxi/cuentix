-- Better Auth tables. Do not clash with app `users`.
-- Cookie sessions live in auth_session. Timestamps are integer unix ms.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS auth_user (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  email_verified integer NOT NULL DEFAULT 0,
  image text,
  created_at integer NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at integer NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS auth_session (
  id text PRIMARY KEY,
  expires_at integer NOT NULL,
  token text NOT NULL UNIQUE,
  created_at integer NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at integer NOT NULL DEFAULT (unixepoch() * 1000),
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS auth_session_user_idx ON auth_session(user_id);

CREATE TABLE IF NOT EXISTS auth_account (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at integer,
  refresh_token_expires_at integer,
  scope text,
  password text,
  created_at integer NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at integer NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_account_provider_uidx
  ON auth_account(provider_id, account_id);
CREATE INDEX IF NOT EXISTS auth_account_user_idx ON auth_account(user_id);

CREATE TABLE IF NOT EXISTS auth_verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at integer NOT NULL,
  created_at integer NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at integer NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS auth_verification_identifier_idx
  ON auth_verification(identifier);
