-- Serpix business-movement sync. Additive only.
-- is_business: 0/1. business_version: monotonic integer (updated_at ms).
-- serpix_outbox: one row per change; retries reuse event_id with a fresh nonce.

ALTER TABLE transactions ADD COLUMN is_business integer NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN business_version integer;

CREATE TABLE IF NOT EXISTS serpix_outbox (
  id text PRIMARY KEY,
  tx_id text NOT NULL,
  event_id text NOT NULL,
  type text NOT NULL,
  payload text NOT NULL,
  created_at integer NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at integer,
  last_error text,
  sent_at integer,
  failed_at integer
);

CREATE INDEX IF NOT EXISTS serpix_outbox_pending_idx
  ON serpix_outbox(sent_at, failed_at, next_attempt_at);

-- Latest event per movement (one join on the list query).
CREATE INDEX IF NOT EXISTS serpix_outbox_tx_created_idx
  ON serpix_outbox(tx_id, created_at);
