-- Add AI-based features: response metrics and profile analysis
-- This migration adds fields to store chat response metrics and profile analysis data

-- Add response metrics fields to users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS response_score DECIMAL(3,2) DEFAULT NULL COMMENT 'Chat response score (0.0 to 1.0)',
ADD COLUMN IF NOT EXISTS average_response_time_hours DECIMAL(10,2) DEFAULT NULL COMMENT 'Average response time in hours',
ADD COLUMN IF NOT EXISTS response_rate DECIMAL(3,2) DEFAULT NULL COMMENT 'Response rate (0.0 to 1.0)',
ADD COLUMN IF NOT EXISTS response_rating VARCHAR(20) DEFAULT NULL COMMENT 'Response rating: excellent, good, average, poor',
ADD COLUMN IF NOT EXISTS last_response_at TIMESTAMP NULL DEFAULT NULL COMMENT 'Last response timestamp',
ADD COLUMN IF NOT EXISTS profile_score DECIMAL(3,2) DEFAULT NULL COMMENT 'Profile completeness/activity score (0.0 to 1.0)',
ADD COLUMN IF NOT EXISTS profile_last_analyzed_at TIMESTAMP NULL DEFAULT NULL COMMENT 'Last time profile was analyzed',
ADD COLUMN IF NOT EXISTS is_profile_outdated BOOLEAN DEFAULT FALSE COMMENT 'Flag if profile is outdated',
ADD COLUMN IF NOT EXISTS is_profile_inactive BOOLEAN DEFAULT FALSE COMMENT 'Flag if profile is inactive';

-- Add counterfeit detection fields to products table
ALTER TABLE products
ADD COLUMN IF NOT EXISTS counterfeit_confidence DECIMAL(3,2) DEFAULT NULL COMMENT 'Counterfeit detection confidence (0.0 to 1.0)',
ADD COLUMN IF NOT EXISTS counterfeit_flags JSON DEFAULT NULL COMMENT 'Array of detected counterfeit flags',
ADD COLUMN IF NOT EXISTS last_counterfeit_check_at TIMESTAMP NULL DEFAULT NULL COMMENT 'Last time counterfeit check was performed';

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_users_response_score ON users(response_score);
CREATE INDEX IF NOT EXISTS idx_users_profile_score ON users(profile_score);
CREATE INDEX IF NOT EXISTS idx_products_counterfeit_confidence ON products(counterfeit_confidence);



