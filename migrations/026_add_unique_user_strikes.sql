-- Migration 026: Add unique index to user_strikes for idempotent penalty recording.
--
-- PREREQUISITE: Run the dedup query below BEFORE applying this migration.
-- If duplicate rows exist for (user_id, strike_type, trade_id), the ALTER will fail.
--
-- Dedup query:
--   DELETE s1 FROM user_strikes s1
--   JOIN user_strikes s2
--     ON s1.user_id = s2.user_id
--    AND s1.strike_type = s2.strike_type
--    AND s1.trade_id = s2.trade_id
--    AND s1.id > s2.id
--   WHERE s1.trade_id IS NOT NULL;

ALTER TABLE user_strikes
  ADD UNIQUE INDEX uniq_strike_per_trade (user_id, strike_type, trade_id);
