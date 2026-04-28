package services

import (
	"context"
	"database/sql"
	"log/slog"
	"time"
)

func StartReconciliationScheduler(ctx context.Context, db *sql.DB) {
	if ctx == nil {
		ctx = context.Background()
	}
	if db == nil {
		Logger().Warn("reconciliation scheduler not started", "service", "reconciliation", "error", "nil database")
		return
	}
	go func() {
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Minute):
		}
		RunReconciliationPass(ctx, db)

		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				RunReconciliationPass(ctx, db)
			}
		}
	}()
}

func RunReconciliationPass(parent context.Context, db *sql.DB) {
	ctx, cancel := context.WithTimeout(parent, 2*time.Minute)
	defer cancel()

	logger := Logger().With("service", "reconciliation")
	logger.Info("reconciliation pass starting")
	runReconciliationJob(ctx, logger, "lock_products_in_active_trades", func(ctx context.Context) error {
		return reconcileProductsInActiveTrades(ctx, db)
	})
	runReconciliationJob(ctx, logger, "expire_very_stale_pending_trades", func(ctx context.Context) error {
		return reconcileVeryStalePendingTrades(ctx, db)
	})
	runReconciliationJob(ctx, logger, "refresh_recent_response_scores", func(ctx context.Context) error {
		return reconcileRecentResponseScores(ctx, db)
	})
	logger.Info("reconciliation pass complete")
}

func runReconciliationJob(ctx context.Context, logger *slog.Logger, name string, fn func(context.Context) error) {
	start := time.Now()
	if err := fn(ctx); err != nil {
		logger.Error("reconciliation job failed", "job", name, "duration_ms", time.Since(start).Milliseconds(), "error", err)
		return
	}
	logger.Info("reconciliation job complete", "job", name, "duration_ms", time.Since(start).Milliseconds())
}

func reconcileProductsInActiveTrades(ctx context.Context, db *sql.DB) error {
	res, err := db.ExecContext(ctx, `
		UPDATE products p
		JOIN (
			SELECT target_product_id AS product_id
			FROM trades
			WHERE status IN ('accepted','accepted_by_both','active','ongoing','awaiting_confirmation','multiway_active')
			UNION
			SELECT ti.product_id
			FROM trade_items ti
			JOIN trades t ON t.id = ti.trade_id
			WHERE t.status IN ('accepted','accepted_by_both','active','ongoing','awaiting_confirmation','multiway_active')
		) locked ON locked.product_id = p.id
		SET p.status = 'locked', p.updated_at = NOW()
		WHERE p.status = 'available'
	`)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n > 0 {
		Logger().Warn("reconciled available products already in active trades", "service", "reconciliation", "count", n)
	}
	return nil
}

func reconcileVeryStalePendingTrades(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx, `
		SELECT id
		FROM trades
		WHERE status IN ('pending','countered','accepted_by_one')
		  AND updated_at < DATE_SUB(NOW(), INTERVAL 90 DAY)
		LIMIT 100
		FOR UPDATE
	`)
	if err != nil {
		return err
	}
	var tradeIDs []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err == nil {
			tradeIDs = append(tradeIDs, id)
		}
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, id := range tradeIDs {
		if _, err := tx.ExecContext(ctx, "UPDATE trades SET status='expired', updated_at=NOW() WHERE id=? AND status IN ('pending','countered','accepted_by_one')", id); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE products SET status='available', updated_at=NOW()
			WHERE status='locked'
			  AND id IN (
				SELECT target_product_id FROM trades WHERE id=?
				UNION
				SELECT product_id FROM trade_items WHERE trade_id=?
			  )
		`, id, id); err != nil {
			return err
		}
	}
	if len(tradeIDs) > 0 {
		Logger().Warn("expired very stale pending trades", "service", "reconciliation", "count", len(tradeIDs))
	}
	return tx.Commit()
}

func reconcileRecentResponseScores(ctx context.Context, db *sql.DB) error {
	rows, err := db.QueryContext(ctx, `
		SELECT DISTINCT sender_id
		FROM messages
		WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
		LIMIT 50
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var userID int
		if err := rows.Scan(&userID); err != nil || userID <= 0 {
			continue
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		metrics, err := CalculateResponseMetrics(db, userID)
		if err != nil {
			Logger().Warn("response score reconciliation skipped user", "service", "reconciliation", "user_id", userID, "error", err)
			continue
		}
		if _, err := db.ExecContext(ctx, `
			UPDATE users
			SET response_score = ?,
			    average_response_time_hours = ?,
			    response_rate = ?,
			    response_rating = ?,
			    last_response_at = ?
			WHERE id = ?
		`, metrics.ResponseScore, metrics.AverageResponseTimeHours, metrics.ResponseRate, metrics.Rating, metrics.LastResponseAt, userID); err != nil {
			return err
		}
	}
	return rows.Err()
}
