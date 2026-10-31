-- One snapshot per user per calendar day. 0005 is unique on
-- (user_id, date, source), which does not match ON CONFLICT(user_id, date).

DELETE FROM patrimonio_snapshots
WHERE id NOT IN (
  SELECT MIN(id) FROM patrimonio_snapshots GROUP BY user_id, date
);

CREATE UNIQUE INDEX IF NOT EXISTS patrimonio_snapshots_user_date_uidx
  ON patrimonio_snapshots(user_id, date);
