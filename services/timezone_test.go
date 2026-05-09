package services

import (
	"testing"
	"time"
)

func TestWakeScheduleUsesAsiaManila(t *testing.T) {
	t.Setenv("APP_TIMEZONE", "Asia/Manila")
	t.Setenv("WAKE_ACTIVE_START_HOUR", "6")
	t.Setenv("WAKE_ACTIVE_END_HOUR", "24")
	loc := AppLocation()

	activePH := time.Date(2026, 5, 9, 13, 0, 0, 0, loc)
	if !IsWakeScheduleActivePH(activePH) {
		t.Fatal("expected 1 PM Philippine time to be inside wake schedule")
	}

	inactivePH := time.Date(2026, 5, 9, 1, 0, 0, 0, loc)
	if IsWakeScheduleActivePH(inactivePH) {
		t.Fatal("expected 1 AM Philippine time to be outside wake schedule")
	}
}

func TestWakeScheduleUTCConversion(t *testing.T) {
	t.Setenv("APP_TIMEZONE", "Asia/Manila")
	t.Setenv("WAKE_ACTIVE_START_HOUR", "6")
	t.Setenv("WAKE_ACTIVE_END_HOUR", "24")

	activeUTC := time.Date(2026, 5, 9, 5, 0, 0, 0, time.UTC) // 13:00 PHT
	if !IsWakeScheduleActivePH(activeUTC) {
		t.Fatal("expected 05:00 UTC to be active because it is 13:00 in Asia/Manila")
	}

	inactiveUTC := time.Date(2026, 5, 9, 17, 0, 0, 0, time.UTC) // 01:00 PHT next day
	if IsWakeScheduleActivePH(inactiveUTC) {
		t.Fatal("expected 17:00 UTC to be inactive because it is 01:00 in Asia/Manila")
	}
}

func TestNextWakePingForInactivePHTime(t *testing.T) {
	t.Setenv("APP_TIMEZONE", "Asia/Manila")
	t.Setenv("WAKE_ACTIVE_START_HOUR", "6")
	t.Setenv("WAKE_ACTIVE_END_HOUR", "24")
	t.Setenv("WAKE_PING_INTERVAL_MINUTES", "15")
	loc := AppLocation()

	status := BuildWakeScheduleStatus(time.Date(2026, 5, 9, 1, 30, 0, 0, loc))
	if status.NextPingPH != "2026-05-09T06:00:00+08:00" {
		t.Fatalf("expected next PH ping at 06:00, got %s", status.NextPingPH)
	}
	if status.NextPingUTC != "2026-05-08T22:00:00Z" {
		t.Fatalf("expected next UTC ping at 22:00 previous day, got %s", status.NextPingUTC)
	}
}
