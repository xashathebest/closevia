package services

import (
	"context"
	"database/sql"
	"time"
)

type ComponentHealth struct {
	Status string      `json:"status"`
	Detail interface{} `json:"detail,omitempty"`
	Error  string      `json:"error,omitempty"`
}

type HealthSnapshot struct {
	Status     string                     `json:"status"`
	CheckedAt  time.Time                  `json:"checked_at"`
	Components map[string]ComponentHealth `json:"components"`
}

func BuildHealthSnapshot(ctx context.Context, db *sql.DB, includeDependencies bool) HealthSnapshot {
	if ctx == nil {
		ctx = context.Background()
	}
	snapshot := HealthSnapshot{
		Status:     "ok",
		CheckedAt:  time.Now(),
		Components: map[string]ComponentHealth{},
	}

	snapshot.Components["server"] = ComponentHealth{Status: "ok"}
	snapshot.Components["cache"] = ComponentHealth{Status: "ok", Detail: GlobalCache.Stats()}
	workers := workerStatus()
	snapshot.Components["workers"] = ComponentHealth{Status: workers, Detail: DefaultWorkerQueueHealth()}
	if workers != "ok" {
		snapshot.Status = "unhealthy"
	}
	sseBridge := boolStatus(SSEPublisherRegistered())
	snapshot.Components["sse_bridge"] = ComponentHealth{Status: sseBridge}
	if sseBridge != "ok" {
		snapshot.Status = "unhealthy"
	}

	if db == nil {
		snapshot.Components["db"] = ComponentHealth{Status: "down", Error: "nil database"}
		snapshot.Status = "unhealthy"
	} else {
		pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		err := db.PingContext(pingCtx)
		cancel()
		if err != nil {
			snapshot.Components["db"] = ComponentHealth{Status: "down", Error: err.Error()}
			snapshot.Status = "unhealthy"
		} else {
			snapshot.Components["db"] = ComponentHealth{Status: "ok", Detail: db.Stats()}
		}
	}

	if includeDependencies {
		if err := EnsureCloudinaryReady(); err != nil {
			snapshot.Components["cloudinary"] = ComponentHealth{Status: "degraded", Error: err.Error()}
		} else {
			snapshot.Components["cloudinary"] = ComponentHealth{Status: "ok"}
		}
		aiProvider := GetActiveAIProvider()
		status := "ok"
		if aiProvider == "none" {
			status = "degraded"
		}
		snapshot.Components["ai"] = ComponentHealth{Status: status, Detail: map[string]string{"provider": aiProvider}}
	}

	return snapshot
}

func workerStatus() string {
	stats := DefaultWorkerQueueHealth()
	if !stats.Started || stats.Stopped {
		return "degraded"
	}
	return "ok"
}

func boolStatus(ok bool) string {
	if ok {
		return "ok"
	}
	return "degraded"
}
