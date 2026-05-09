package services

import (
	"log"
	"os"
	"strconv"
	"strings"
	"time"
)

const DefaultAppTimezone = "Asia/Manila"

type WakeScheduleStatus struct {
	Timezone         string `json:"timezone"`
	UTC              string `json:"utc"`
	PhilippineTime   string `json:"philippine_time"`
	Active           bool   `json:"active"`
	ActiveStartHour  int    `json:"active_start_hour"`
	ActiveEndHour    int    `json:"active_end_hour"`
	PingIntervalMins int    `json:"ping_interval_minutes"`
	NextPingUTC      string `json:"next_ping_utc"`
	NextPingPH       string `json:"next_ping_ph"`
}

func AppTimezoneName() string {
	if value := strings.TrimSpace(os.Getenv("APP_TIMEZONE")); value != "" {
		return value
	}
	if value := strings.TrimSpace(os.Getenv("WAKE_TIMEZONE")); value != "" {
		return value
	}
	return DefaultAppTimezone
}

func AppLocation() *time.Location {
	name := AppTimezoneName()
	loc, err := time.LoadLocation(name)
	if err != nil {
		log.Printf("[TIMEZONE] Failed to load %s, falling back to fixed UTC+8 Philippine time: %v", name, err)
		return time.FixedZone("PHT", 8*60*60)
	}
	return loc
}

func ConfigureAppTimezone() *time.Location {
	loc := AppLocation()
	time.Local = loc
	status := BuildWakeScheduleStatus(time.Now())
	log.Printf("[TIMEZONE] APP_TIMEZONE=%s WAKE_TIMEZONE=%s effective=%s",
		strings.TrimSpace(os.Getenv("APP_TIMEZONE")),
		strings.TrimSpace(os.Getenv("WAKE_TIMEZONE")),
		AppTimezoneName(),
	)
	log.Printf("[TIMEZONE] Current UTC time: %s", status.UTC)
	log.Printf("[TIMEZONE] Current Asia/Manila time: %s", status.PhilippineTime)
	log.Printf("[TIMEZONE] Wake schedule active based on PH time: %t", status.Active)
	log.Printf("[TIMEZONE] Next ping time based on PH time: %s", status.NextPingPH)
	return loc
}

func NowPH() time.Time {
	return time.Now().In(AppLocation())
}

func WakeActiveStartHour() int {
	return envHour("WAKE_ACTIVE_START_HOUR", 6)
}

func WakeActiveEndHour() int {
	return envHour("WAKE_ACTIVE_END_HOUR", 24)
}

func WakePingIntervalMinutes() int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv("WAKE_PING_INTERVAL_MINUTES")))
	if err != nil || value <= 0 {
		return 15
	}
	return value
}

func IsWakeScheduleActivePH(now time.Time) bool {
	ph := now.In(AppLocation())
	start := WakeActiveStartHour()
	end := WakeActiveEndHour()
	hour := ph.Hour()
	if start == end {
		return true
	}
	if start < end {
		return hour >= start && hour < end
	}
	return hour >= start || hour < end
}

func BuildWakeScheduleStatus(now time.Time) WakeScheduleStatus {
	loc := AppLocation()
	ph := now.In(loc)
	interval := WakePingIntervalMinutes()
	nextPH := nextWakePingPH(ph, time.Duration(interval)*time.Minute)
	return WakeScheduleStatus{
		Timezone:         AppTimezoneName(),
		UTC:              now.UTC().Format(time.RFC3339),
		PhilippineTime:   ph.Format(time.RFC3339),
		Active:           IsWakeScheduleActivePH(now),
		ActiveStartHour:  WakeActiveStartHour(),
		ActiveEndHour:    WakeActiveEndHour(),
		PingIntervalMins: interval,
		NextPingUTC:      nextPH.UTC().Format(time.RFC3339),
		NextPingPH:       nextPH.Format(time.RFC3339),
	}
}

func envHour(key string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(key)))
	if err != nil || value < 0 || value > 24 {
		return fallback
	}
	return value
}

func nextWakePingPH(ph time.Time, interval time.Duration) time.Time {
	if IsWakeScheduleActivePH(ph) {
		next := ph.Truncate(interval).Add(interval)
		if next.After(ph) {
			return next
		}
		return ph.Add(interval)
	}
	start := WakeActiveStartHour()
	end := WakeActiveEndHour()
	next := time.Date(ph.Year(), ph.Month(), ph.Day(), start%24, 0, 0, 0, ph.Location())
	if start < end {
		if ph.Hour() >= end || !ph.Before(next) {
			next = next.AddDate(0, 0, 1)
		}
		return next
	}
	if ph.Hour() >= end && ph.Hour() < start {
		return next
	}
	return next.AddDate(0, 0, 1)
}
