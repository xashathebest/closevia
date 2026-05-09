-- Inactivity-based archive support for ongoing trades and multiway chains.
-- Safe to run once during deployment; runtime code also checks column presence.

ALTER TABLE trades
  ADD COLUMN last_activity_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN archived_at TIMESTAMP NULL,
  ADD COLUMN archived_reason VARCHAR(64) NULL;

UPDATE trades
SET last_activity_at = COALESCE(last_activity_at, updated_at, created_at)
WHERE last_activity_at IS NULL;

ALTER TABLE trades
  MODIFY COLUMN status ENUM(
    'pending','accepted','accepted_by_one','accepted_by_both','declined','countered',
    'active','ongoing','awaiting_confirmation','awaiting_other_party','completed',
    'did_not_push_through','under_review','cancelled','cancelled_due_to_conflict',
    'auto_completed','expired','broken','history','archived','pending_multiway','multiway_active'
  ) DEFAULT 'pending';

CREATE INDEX idx_trades_status_last_activity ON trades(status, last_activity_at);

ALTER TABLE trade_like_loops
  ADD COLUMN last_activity_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN archived_at TIMESTAMP NULL,
  ADD COLUMN archived_reason VARCHAR(64) NULL;

UPDATE trade_like_loops
SET last_activity_at = COALESCE(last_activity_at, updated_at, created_at)
WHERE last_activity_at IS NULL;

ALTER TABLE trade_like_loops
  MODIFY COLUMN status ENUM(
    'pending','partially_accepted','accepted','confirmed','ongoing','completed',
    'did_not_push_through','history','rejected','cancelled','cancelled_due_to_conflict',
    'broken','expired','archived'
  ) DEFAULT 'pending';

CREATE INDEX idx_trade_like_loops_status_activity ON trade_like_loops(status, last_activity_at);

ALTER TABLE multiway_trades
  ADD COLUMN last_activity_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN archived_at TIMESTAMP NULL,
  ADD COLUMN archived_reason VARCHAR(64) NULL;

UPDATE multiway_trades
SET last_activity_at = COALESCE(last_activity_at, updated_at, created_at)
WHERE last_activity_at IS NULL;

ALTER TABLE multiway_trades
  MODIFY COLUMN status ENUM(
    'searching','pending_user3','pending_initiator_upgrade','waiting_acceptance',
    'user3_accepted','user3_declined','active','completed','cancelled','expired',
    'broken','history','archived','fully_declined'
  ) DEFAULT 'searching';

CREATE INDEX idx_multiway_trades_status_activity ON multiway_trades(status, last_activity_at);
