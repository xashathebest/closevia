# CloviaPH Staging Load Testing

This setup is for disposable staging only. Do not point it at production or any database that contains real users.

## What Was Added

- `env.staging.example`: backend staging configuration template.
- `client/env.staging.example`: frontend staging configuration template.
- `scripts/staging_seed.sql`: guarded seed data for fake users, products, trades, offers, chat, and notifications.
- `scripts/staging_query_checks.sql`: DB query checks for notifications, trade counts, product listing, and multiway-style matching.
- `k6/clovia-staging-load-test.js`: k6 scenarios for homepage browsing, product details, pagination, offer races, acceptance races, chat bursts, uploads, SSE streams, and health metrics.

The k6 script refuses to run unless `ENVIRONMENT=staging` and `STAGING_CONFIRM=I_UNDERSTAND_THIS_IS_DISPOSABLE_STAGING` are set. It also rejects obvious production-looking URLs.

## Safe Setup

1. Create a new disposable database whose name contains `staging`, for example `clovia_staging`.

2. Configure the backend using staging-only values:

```powershell
Copy-Item env.staging.example .env.staging
```

Then set real staging values in `.env.staging`. Do not reuse production DB credentials or production Xendit keys.

3. Start the backend with `APP_ENV=staging` and the staging DB selected.

4. Run migrations/CreateTables against the staging database.

5. Seed fake load-test data:

```powershell
mysql -h 127.0.0.1 -u clovia_staging -p clovia_staging < scripts/staging_seed.sql
```

The seed script stops if the selected database name does not contain `staging`.

6. Optional DB query checks:

```powershell
mysql -h 127.0.0.1 -u clovia_staging -p clovia_staging < scripts/staging_query_checks.sql
```

Review the output for full scans, large row counts, and high actual execution times.

## Run k6 Safely

Local staging:

```powershell
$env:ENVIRONMENT="staging"
$env:STAGING_CONFIRM="I_UNDERSTAND_THIS_IS_DISPOSABLE_STAGING"
$env:ROOT_URL="http://localhost:4000"
$env:API_URL="http://localhost:4000/api"
k6 run k6/clovia-staging-load-test.js
```

Remote staging:

```powershell
$env:ENVIRONMENT="staging"
$env:STAGING_CONFIRM="I_UNDERSTAND_THIS_IS_DISPOSABLE_STAGING"
$env:ROOT_URL="https://staging-api.example.com"
$env:API_URL="https://staging-api.example.com/api"
k6 run k6/clovia-staging-load-test.js
```

## Metrics To Watch

- `http_req_duration`, `clovia_response_time_ms`: API response time.
- `clovia_api_error_rate`: request failures.
- `clovia_duplicate_offer_rejections`: expected 409s from duplicate/race offer attempts.
- `clovia_duplicate_trade_risk`: unexpected trade race statuses.
- `clovia_sse_dropped_events`: backend SSE buffer drops from `/readyz`.
- `clovia_worker_queue_depth`: worker queue backlog from `/readyz`.
- `clovia_worker_dropped_jobs`: worker jobs dropped because the queue was stopped/full/invalid.
- `tmp/clovia-staging-load-summary.json`: full k6 summary written after the run.

## After The Run

Check for duplicate or stuck data:

```sql
SELECT buyer_id, target_product_id, COUNT(*) AS active_count
FROM trades
WHERE status IN ('pending','pending_multiway','countered','accepted','accepted_by_one','active','ongoing','awaiting_confirmation','multiway_active')
  AND message LIKE 'clovia_loadtest_%'
GROUP BY buyer_id, target_product_id
HAVING COUNT(*) > 1;

SELECT COUNT(*) AS stale_pending
FROM trades
WHERE status IN ('pending','pending_multiway','accepted_by_one')
  AND message LIKE 'clovia_loadtest_%'
  AND updated_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE);

SELECT COUNT(*) AS loadtest_notifications
FROM notifications
WHERE message LIKE 'clovia_loadtest_%';
```

Large values in `clovia_sse_dropped_events` or `clovia_worker_dropped_jobs` mean the app stayed up but lost realtime/background work under pressure.
