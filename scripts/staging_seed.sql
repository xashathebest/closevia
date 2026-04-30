-- CloviaPH disposable staging seed.
--
-- Safety:
-- - Run only after migrations/CreateTables have prepared the schema.
-- - This script refuses to run unless the selected database name contains "staging".
-- - It only deletes rows whose emails/titles/messages use the clovia_loadtest_ prefix.
--
-- Login password for all seeded users: password

SET @current_db := DATABASE();
SET @is_staging_db := @current_db IS NOT NULL AND LOWER(@current_db) LIKE '%staging%';
SET @guard_sql := IF(@is_staging_db, 'SELECT 1', 'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''Refusing to seed: selected DB name must contain staging''');
PREPARE guard_stmt FROM @guard_sql;
EXECUTE guard_stmt;
DEALLOCATE PREPARE guard_stmt;

SET FOREIGN_KEY_CHECKS = 0;

DELETE tm FROM trade_messages tm
JOIN trades t ON t.id = tm.trade_id
JOIN users u ON u.id IN (t.buyer_id, t.seller_id)
WHERE u.email LIKE 'clovia_loadtest_%@example.test';

DELETE m FROM messages m
JOIN conversations c ON c.id = m.conversation_id
JOIN users u ON u.id IN (c.buyer_id, c.seller_id)
WHERE u.email LIKE 'clovia_loadtest_%@example.test';

DELETE c FROM conversations c
JOIN users u ON u.id IN (c.buyer_id, c.seller_id)
WHERE u.email LIKE 'clovia_loadtest_%@example.test';

DELETE ti FROM trade_items ti
JOIN trades t ON t.id = ti.trade_id
JOIN users u ON u.id IN (t.buyer_id, t.seller_id)
WHERE u.email LIKE 'clovia_loadtest_%@example.test';

DELETE te FROM trade_events te
JOIN trades t ON t.id = te.trade_id
JOIN users u ON u.id IN (t.buyer_id, t.seller_id)
WHERE u.email LIKE 'clovia_loadtest_%@example.test';

DELETE t FROM trades t
JOIN users u ON u.id IN (t.buyer_id, t.seller_id)
WHERE u.email LIKE 'clovia_loadtest_%@example.test';

DELETE n FROM notifications n
JOIN users u ON u.id = n.user_id
WHERE u.email LIKE 'clovia_loadtest_%@example.test';

DELETE p FROM products p
JOIN users u ON u.id = p.seller_id
WHERE u.email LIKE 'clovia_loadtest_%@example.test'
   OR p.title LIKE 'clovia_loadtest_%';

DELETE FROM users WHERE email LIKE 'clovia_loadtest_%@example.test';

SET FOREIGN_KEY_CHECKS = 1;

DROP TEMPORARY TABLE IF EXISTS clovia_seed_numbers;
CREATE TEMPORARY TABLE clovia_seed_numbers (n INT PRIMARY KEY);

DROP PROCEDURE IF EXISTS clovia_seed_fill_numbers;

DELIMITER //
CREATE PROCEDURE clovia_seed_fill_numbers()
BEGIN
  DECLARE i INT DEFAULT 1;
  WHILE i <= 120 DO
    INSERT INTO clovia_seed_numbers (n) VALUES (i);
    SET i = i + 1;
  END WHILE;
END//
DELIMITER ;

CALL clovia_seed_fill_numbers();
DROP PROCEDURE clovia_seed_fill_numbers;

INSERT INTO users (
  slug, name, email, phone, password_hash, role, verified, verification_status,
  latitude, longitude, home_latitude, home_longitude, premium_tier, created_at, updated_at
)
SELECT
  CONCAT('clovia-loadtest-user-', n),
  CONCAT('Clovia Load User ', n),
  CONCAT('clovia_loadtest_user_', n, '@example.test'),
  CONCAT('0999000', LPAD(n, 4, '0')),
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
  'user',
  TRUE,
  'verified',
  6.9214 + (n * 0.0001),
  122.0790 + (n * 0.0001),
  6.9214 + (n * 0.0001),
  122.0790 + (n * 0.0001),
  'free',
  NOW() - INTERVAL n MINUTE,
  NOW() - INTERVAL n MINUTE
FROM clovia_seed_numbers
WHERE n <= 60
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  password_hash = VALUES(password_hash),
  verified = TRUE,
  verification_status = 'verified',
  updated_at = NOW();

INSERT INTO products (
  slug, title, description, price, image_urls, image_url, seller_id, premium, status,
  allow_buying, barter_only, max_items_per_offer, location, location_type,
  pickup_latitude, pickup_longitude, pickup_address, `condition`, suggested_value,
  category, estimated_value_min, estimated_value_max, show_estimated_value,
  wants, wanted_categories, tags, latitude, longitude, created_at, updated_at
)
SELECT
  CONCAT('clovia-loadtest-product-', n),
  CONCAT('clovia_loadtest_product_', n),
  CONCAT('Disposable staging product ', n, ' for CloviaPH load testing.'),
  100 + (n * 7),
  JSON_ARRAY(CONCAT('/icons/CloviaLogo.svg?seed=', n)),
  CONCAT('/icons/CloviaLogo.svg?seed=', n),
  u.id,
  IF(MOD(n, 9) = 0, TRUE, FALSE),
  'available',
  TRUE,
  FALSE,
  3,
  'Zamboanga City staging meetup area',
  'pickup_location',
  6.9214 + (n * 0.0001),
  122.0790 + (n * 0.0001),
  'Approximate staging pickup area',
  'Good',
  100 + (n * 7),
  CASE MOD(n, 6)
    WHEN 0 THEN 'Electronics'
    WHEN 1 THEN 'Fashion'
    WHEN 2 THEN 'Books'
    WHEN 3 THEN 'Home'
    WHEN 4 THEN 'Sports'
    ELSE 'General'
  END,
  80 + (n * 5),
  160 + (n * 8),
  TRUE,
  'Any useful trade item',
  JSON_ARRAY('Electronics', 'Fashion', 'Books'),
  JSON_ARRAY('loadtest', 'staging'),
  6.9214 + (n * 0.0001),
  122.0790 + (n * 0.0001),
  NOW() - INTERVAL n MINUTE,
  NOW() - INTERVAL n MINUTE
FROM clovia_seed_numbers s
JOIN users u ON u.email = CONCAT('clovia_loadtest_user_', ((s.n - 1) % 60) + 1, '@example.test')
WHERE s.n <= 120
ON DUPLICATE KEY UPDATE
  seller_id = VALUES(seller_id),
  status = 'available',
  updated_at = NOW();

-- Pending offers and ongoing trades.
INSERT INTO trades (
  buyer_id, seller_id, target_product_id, status, buyer_accepted, seller_accepted,
  trade_option, meeting_type, meetup_location, meetup_label, meetup_time,
  message, offered_cash_amount, created_at, updated_at
)
SELECT
  buyer.id,
  seller.id,
  target.id,
  CASE WHEN s.n <= 12 THEN 'pending' ELSE 'active' END,
  TRUE,
  CASE WHEN s.n <= 12 THEN FALSE ELSE TRUE END,
  'meetup',
  'meetup',
  'Clovia staging public meetup point',
  'Staging Meetup',
  DATE_FORMAT(DATE_ADD(NOW(), INTERVAL (s.n + 1) HOUR), '%Y-%m-%d %H:%i:%s'),
  CONCAT('clovia_loadtest_offer_', s.n),
  0,
  NOW() - INTERVAL s.n MINUTE,
  NOW() - INTERVAL s.n MINUTE
FROM clovia_seed_numbers s
JOIN users buyer ON buyer.email = CONCAT('clovia_loadtest_user_', s.n, '@example.test')
JOIN products target ON target.slug = CONCAT('clovia-loadtest-product-', s.n + 60)
JOIN users seller ON seller.id = target.seller_id
WHERE s.n <= 24
  AND NOT EXISTS (
    SELECT 1 FROM trades existing
    WHERE existing.buyer_id = buyer.id
      AND existing.target_product_id = target.id
      AND existing.message = CONCAT('clovia_loadtest_offer_', s.n)
  );

INSERT INTO trade_items (trade_id, product_id, offered_by)
SELECT t.id, offered.id, 'buyer'
FROM trades t
JOIN users buyer ON buyer.id = t.buyer_id
JOIN products offered ON offered.seller_id = buyer.id
  AND offered.slug = CONCAT(
    'clovia-loadtest-product-',
    CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(buyer.email, 'clovia_loadtest_user_', -1), '@', 1) AS UNSIGNED)
  )
WHERE t.message LIKE 'clovia_loadtest_offer_%'
  AND NOT EXISTS (
    SELECT 1 FROM trade_items ti WHERE ti.trade_id = t.id AND ti.product_id = offered.id
  );

INSERT INTO conversations (product_id, buyer_id, seller_id)
SELECT target_product_id, buyer_id, seller_id
FROM trades
WHERE message LIKE 'clovia_loadtest_offer_%'
ON DUPLICATE KEY UPDATE updated_at = NOW();

INSERT INTO messages (conversation_id, sender_id, content)
SELECT c.id, c.buyer_id, CONCAT('clovia_loadtest_seed_message_', c.id)
FROM conversations c
JOIN users u ON u.id = c.buyer_id
WHERE u.email LIKE 'clovia_loadtest_%@example.test'
  AND NOT EXISTS (
    SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.content = CONCAT('clovia_loadtest_seed_message_', c.id)
  );

INSERT INTO notifications (user_id, type, message, is_read, target_type, target_id, target_url, metadata)
SELECT
  t.seller_id,
  'trade_offer',
  CONCAT('clovia_loadtest_notification_offer_', t.id),
  FALSE,
  'trade',
  t.id,
  CONCAT('/offers?trade_id=', t.id),
  JSON_OBJECT('trade_id', t.id)
FROM trades t
WHERE t.message LIKE 'clovia_loadtest_offer_%'
ON DUPLICATE KEY UPDATE created_at = created_at;

SELECT
  'clovia staging seed complete' AS result,
  (SELECT COUNT(*) FROM users WHERE email LIKE 'clovia_loadtest_%@example.test') AS users_seeded,
  (SELECT COUNT(*) FROM products WHERE title LIKE 'clovia_loadtest_%') AS products_seeded,
  (SELECT COUNT(*) FROM trades WHERE message LIKE 'clovia_loadtest_offer_%') AS trades_seeded,
  (SELECT COUNT(*) FROM notifications WHERE message LIKE 'clovia_loadtest_%') AS notifications_seeded;
