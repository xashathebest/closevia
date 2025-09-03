-- Postgres migrations for new features
-- Note: This project currently uses MySQL in code, but this file targets Postgres as requested.

-- condition_multipliers
CREATE TABLE IF NOT EXISTS condition_multipliers (
	condition TEXT PRIMARY KEY,
	multiplier REAL NOT NULL
);
INSERT INTO condition_multipliers (condition, multiplier) VALUES
	('NEW',1.00) ON CONFLICT DO NOTHING,
	('LIKE_NEW',0.85) ON CONFLICT DO NOTHING,
	('USED',0.65) ON CONFLICT DO NOTHING,
	('HEAVILY_USED',0.45) ON CONFLICT DO NOTHING,
	('DEFECTIVE',0.20) ON CONFLICT DO NOTHING;

-- item_value_signals
CREATE TABLE IF NOT EXISTS item_value_signals (
	item_id BIGINT PRIMARY KEY,
	views BIGINT DEFAULT 0,
	saves BIGINT DEFAULT 0,
	messages BIGINT DEFAULT 0,
	trade_offers BIGINT DEFAULT 0,
	last_7d_views BIGINT DEFAULT 0,
	last_7d_saves BIGINT DEFAULT 0,
	updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- value_events
CREATE TABLE IF NOT EXISTS value_events (
	id BIGSERIAL PRIMARY KEY,
	item_id BIGINT NOT NULL,
	source TEXT NOT NULL,
	old_points BIGINT,
	new_points BIGINT,
	context_json JSONB,
	created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_value_events_item ON value_events(item_id);

-- trade loops
CREATE TABLE IF NOT EXISTS trade_loops (
	id BIGSERIAL PRIMARY KEY,
	loop_size INT NOT NULL,
	status TEXT NOT NULL DEFAULT 'PENDING',
	created_at TIMESTAMPTZ DEFAULT NOW(),
	expires_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS trade_loop_members (
	trade_loop_id BIGINT REFERENCES trade_loops(id) ON DELETE CASCADE,
	user_id BIGINT NOT NULL,
	item_id_given BIGINT NOT NULL,
	item_id_received BIGINT NOT NULL,
	points_delta_cents BIGINT DEFAULT 0,
	escrow_required BOOLEAN DEFAULT FALSE,
	signature TEXT,
	PRIMARY KEY (trade_loop_id, user_id)
);

-- user_verifications
CREATE TABLE IF NOT EXISTS user_verifications (
	user_id BIGINT PRIMARY KEY,
	email_verified BOOLEAN DEFAULT FALSE,
	id_verified BOOLEAN DEFAULT FALSE,
	university_verified BOOLEAN DEFAULT FALSE,
	address_verified BOOLEAN DEFAULT FALSE,
	verified_at TIMESTAMPTZ
);

-- escrows
CREATE TABLE IF NOT EXISTS escrows (
	id BIGSERIAL PRIMARY KEY,
	type TEXT NOT NULL,
	trade_id BIGINT,
	buyer_id BIGINT,
	seller_id BIGINT,
	amount_cents BIGINT,
	points BIGINT,
	status TEXT NOT NULL DEFAULT 'PENDING',
	provider_ref TEXT,
	audit_json JSONB,
	created_at TIMESTAMPTZ DEFAULT NOW(),
	updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_escrows_status ON escrows(status);

-- listing_boosts
CREATE TABLE IF NOT EXISTS listing_boosts (
	id BIGSERIAL PRIMARY KEY,
	item_id BIGINT NOT NULL,
	start_at TIMESTAMPTZ NOT NULL,
	end_at TIMESTAMPTZ NOT NULL,
	payment_type TEXT NOT NULL,
	amount BIGINT NOT NULL,
	status TEXT NOT NULL DEFAULT 'ACTIVE'
);
CREATE INDEX IF NOT EXISTS idx_listing_boosts_item ON listing_boosts(item_id);
CREATE INDEX IF NOT EXISTS idx_listing_boosts_dates ON listing_boosts(start_at, end_at);

-- sustainability_metrics
CREATE TABLE IF NOT EXISTS sustainability_metrics (
	user_id BIGINT PRIMARY KEY,
	co2e_kg_saved REAL DEFAULT 0,
	landfill_kg_avoided REAL DEFAULT 0,
	retail_value_saved_cents BIGINT DEFAULT 0,
	updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- follows
CREATE TABLE IF NOT EXISTS follows (
	follower_id BIGINT NOT NULL,
	followed_id BIGINT NOT NULL,
	created_at TIMESTAMPTZ DEFAULT NOW(),
	PRIMARY KEY (follower_id, followed_id)
);

-- ratings
CREATE TABLE IF NOT EXISTS ratings (
	id BIGSERIAL PRIMARY KEY,
	trade_id BIGINT,
	rater_id BIGINT NOT NULL,
	ratee_id BIGINT NOT NULL,
	score INT NOT NULL CHECK (score BETWEEN 1 AND 5),
	comment TEXT,
	created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ratings_ratee ON ratings(ratee_id);

-- items table alterations (Postgres-style)
ALTER TABLE items
	ADD COLUMN IF NOT EXISTS approx_value_points BIGINT DEFAULT 0,
	ADD COLUMN IF NOT EXISTS approx_value_usd_cents BIGINT DEFAULT 0,
	ADD COLUMN IF NOT EXISTS value_confidence REAL DEFAULT 0,
	ADD COLUMN IF NOT EXISTS location_lat REAL,
	ADD COLUMN IF NOT EXISTS location_lng REAL;


