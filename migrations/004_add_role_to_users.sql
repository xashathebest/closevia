-- Migration: Add role column to users table
-- Up migration
ALTER TABLE users ADD COLUMN role VARCHAR(10) NOT NULL DEFAULT 'user';

-- Down migration
-- ALTER TABLE users DROP COLUMN role;
