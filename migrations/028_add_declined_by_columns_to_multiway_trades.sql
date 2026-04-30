-- Migration 028: Add declined_by_user_id and declined_by_role to multiway_trades.
-- Allows DeclineMultiwayChain to record which participant declined (user1, user2, or user3)
-- instead of always assuming user3.  The status column is kept as 'user3_declined' to
-- avoid breaking existing frontend checks.

ALTER TABLE multiway_trades
  ADD COLUMN IF NOT EXISTS declined_by_user_id INT NULL
  COMMENT 'User ID of the participant who declined this chain';

ALTER TABLE multiway_trades
  ADD COLUMN IF NOT EXISTS declined_by_role VARCHAR(10) NULL
  COMMENT 'user1, user2, or user3 — role of the participant who declined';
