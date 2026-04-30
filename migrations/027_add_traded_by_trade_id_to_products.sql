-- Migration 027: Add traded_by_trade_id to products for strict product finalization.
-- Allows markProductUnavailable to detect cross-trade conflicts (same product claimed
-- by two different trades) vs. idempotent re-marking by the same trade.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS traded_by_trade_id INT NULL
  COMMENT 'Trade ID that last marked this product as traded';

ALTER TABLE products
  ADD INDEX IF NOT EXISTS idx_products_traded_by (traded_by_trade_id);
