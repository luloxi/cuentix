-- Mark old card imports closed without dropping history.
-- status defaults to open so existing rows stay readable until a data fix.

ALTER TABLE card_statements ADD COLUMN closed_at integer;
ALTER TABLE card_statements ADD COLUMN status text NOT NULL DEFAULT 'open';

CREATE INDEX IF NOT EXISTS card_statements_status_idx
  ON card_statements(household_id, status);
