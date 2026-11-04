-- Exact description lookups (Fiwind "aplicar a similares").
-- Additive only: creates an index and does not change rows.
-- Serves household_id = ? AND description_normalized IN (...).
CREATE INDEX IF NOT EXISTS tx_household_desc_idx
  ON transactions(household_id, description_normalized);
