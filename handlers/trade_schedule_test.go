package handlers

import (
	"strings"
	"testing"
	"time"
)

func TestValidateCollectionDateTimeWindow(t *testing.T) {
	location := collectionScheduleLocation()
	now := time.Now().In(location)
	today := now.Format("2006-01-02")
	tomorrow := now.AddDate(0, 0, 1).Format("2006-01-02")
	yesterday := now.AddDate(0, 0, -1).Format("2006-01-02")

	tests := []struct {
		name      string
		date      string
		start     string
		end       string
		wantError string
		skip      bool
	}{
		{
			name:  "same-day window still open",
			date:  today,
			start: "00:00",
			end:   "23:59",
		},
		{
			name:  "same-day future window",
			date:  today,
			start: now.Add(1 * time.Hour).Format("15:04"),
			end:   now.Add(2 * time.Hour).Format("15:04"),
			skip:  now.Hour() >= 22,
		},
		{
			name:      "same-day window ended",
			date:      today,
			start:     "00:00",
			end:       now.Add(-1 * time.Minute).Format("15:04"),
			wantError: "availability window has already ended",
			skip:      now.Hour() == 0 && now.Minute() == 0,
		},
		{
			name:  "future date",
			date:  tomorrow,
			start: "09:00",
			end:   "17:00",
		},
		{
			name:      "past date",
			date:      yesterday,
			start:     "09:00",
			end:       "17:00",
			wantError: "availability window has already ended",
		},
		{
			name:      "missing end time falls back to selected time",
			date:      today,
			start:     now.Add(-1 * time.Hour).Format("15:04"),
			end:       "",
			wantError: "availability window has already ended",
		},
		{
			name:      "invalid time format",
			date:      today,
			start:     "9 AM",
			end:       "17:00",
			wantError: "Invalid collection time",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.skip {
				t.Skip("time-of-day edge case for relative same-day test")
			}
			err := validateCollectionDateTimeWindow(tt.date, tt.start, tt.end)
			if tt.wantError == "" {
				if err != nil {
					t.Fatalf("expected valid window, got %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantError) {
				t.Fatalf("expected error containing %q, got %v", tt.wantError, err)
			}
		})
	}
}
