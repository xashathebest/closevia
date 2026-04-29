-- CloviaPH staging query checks.
-- Run only against a disposable staging DB after scripts/staging_seed.sql.

SET @current_db := DATABASE();
SET @is_staging_db := @current_db IS NOT NULL AND LOWER(@current_db) LIKE '%staging%';
SET @guard_sql := IF(@is_staging_db, 'SELECT 1', 'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''Refusing query checks: selected DB name must contain staging''');
PREPARE guard_stmt FROM @guard_sql;
EXECUTE guard_stmt;
DEALLOCATE PREPARE guard_stmt;

-- Notifications: unread list and badge count.
EXPLAIN ANALYZE
SELECT id, type, message, is_read, target_type, target_id, target_url, metadata, created_at
FROM notifications
WHERE user_id = (SELECT id FROM users WHERE email = 'clovia_loadtest_user_1@example.test')
ORDER BY created_at DESC
LIMIT 30;

EXPLAIN ANALYZE
SELECT COUNT(*)
FROM notifications
WHERE user_id = (SELECT id FROM users WHERE email = 'clovia_loadtest_user_1@example.test')
  AND is_read = FALSE;

-- Trades count / dashboard count.
EXPLAIN ANALYZE
SELECT COUNT(*)
FROM trades
WHERE buyer_id = (SELECT id FROM users WHERE email = 'clovia_loadtest_user_1@example.test')
   OR seller_id = (SELECT id FROM users WHERE email = 'clovia_loadtest_user_1@example.test');

-- Product listing / homepage pagination.
EXPLAIN ANALYZE
SELECT id, slug, title, price, image_urls, seller_id, premium, status, category, created_at
FROM products
WHERE status = 'available'
ORDER BY premium DESC, created_at DESC
LIMIT 24 OFFSET 0;

EXPLAIN ANALYZE
SELECT id, slug, title, price, image_urls, seller_id, premium, status, category, created_at
FROM products
WHERE status = 'available'
ORDER BY premium DESC, created_at DESC
LIMIT 24 OFFSET 48;

-- Multiway matching style: pending offers plus available candidate products.
EXPLAIN ANALYZE
SELECT t.id, t.buyer_id, t.seller_id, t.target_product_id, p.category, p.wanted_categories
FROM trades t
JOIN products p ON p.id = t.target_product_id
WHERE t.status IN ('pending', 'pending_multiway')
  AND p.status = 'available'
ORDER BY t.created_at DESC
LIMIT 50;

EXPLAIN ANALYZE
SELECT p.id, p.seller_id, p.category, p.wanted_categories, p.created_at
FROM products p
WHERE p.status = 'available'
  AND p.seller_id <> (SELECT id FROM users WHERE email = 'clovia_loadtest_user_1@example.test')
ORDER BY p.created_at DESC
LIMIT 100;
