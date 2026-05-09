package handlers

import (
	"testing"
	"time"
)

func TestValidateArrivalConfirmationWindow(t *testing.T) {
	scheduled := time.Date(2026, 4, 30, 14, 0, 0, 0, time.UTC)

	tests := []struct {
		name    string
		now     time.Time
		wantErr string
	}{
		{
			name: "inside window",
			now:  scheduled.Add(-30 * time.Minute),
		},
		{
			name:    "too early",
			now:     scheduled.Add(-61 * time.Minute),
			wantErr: "You can only confirm arrival within 1 hour before the scheduled time.",
		},
		{
			name: "late allowed",
			now:  scheduled.Add(time.Duration(meetupGracePeriodMinutes+1) * time.Minute),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateArrivalConfirmationWindow(tt.now, scheduled)
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || err.Error() != tt.wantErr {
				t.Fatalf("expected %q, got %v", tt.wantErr, err)
			}
		})
	}
}

func TestValidateScheduledTradeNotExpired(t *testing.T) {
	scheduled := time.Date(2026, 4, 30, 14, 0, 0, 0, time.UTC)

	if err := validateScheduledTradeNotExpired(scheduled.Add(90*time.Minute), scheduled); err != nil {
		t.Fatalf("expected schedule to remain actionable during grace period: %v", err)
	}
	err := validateScheduledTradeNotExpired(scheduled.Add(time.Duration(scheduledTradeExpirationGraceHours)*time.Hour+time.Minute), scheduled)
	if err == nil || err.Error() != "Scheduled time has passed. This trade will move to history." {
		t.Fatalf("expected expired schedule error, got %v", err)
	}
}

func TestParseTradeArrivalDeadlineRequiresFullDate(t *testing.T) {
	if _, ok := parseTradeArrivalDeadline("15:04"); ok {
		t.Fatal("time-only meetup value should not be accepted as a reliable arrival deadline")
	}
	if _, ok := parseTradeArrivalDeadline("2026-04-30 15:04"); !ok {
		t.Fatal("full meetup datetime should be accepted")
	}
}

func TestValidateArrivalLocation(t *testing.T) {
	meetupLat := 6.9142
	meetupLng := 122.0620
	insideLat := 6.914205
	insideLng := 122.062005
	outsideLat := 6.9160
	outsideLng := 122.0640
	accuracyGood := 5.0
	accuracyExtreme := 325.0

	tests := []struct {
		name    string
		lat     *float64
		lng     *float64
		acc     *float64
		wantErr string
	}{
		{
			name: "inside radius",
			lat:  &insideLat,
			lng:  &insideLng,
			acc:  &accuracyGood,
		},
		{
			name:    "missing coordinates",
			acc:     &accuracyGood,
			wantErr: "Location access is required to confirm arrival.",
		},
		{
			name: "inside radius allows low accuracy",
			lat:  &insideLat,
			lng:  &insideLng,
			acc:  &accuracyExtreme,
		},
		{
			name:    "outside radius blocks regardless of accuracy",
			lat:     &outsideLat,
			lng:     &outsideLng,
			acc:     &accuracyExtreme,
			wantErr: "Move closer to the meetup point.",
		},
		{
			name:    "outside radius",
			lat:     &outsideLat,
			lng:     &outsideLng,
			acc:     &accuracyGood,
			wantErr: "Move closer to the meetup point.",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateArrivalLocation(tt.lat, tt.lng, tt.acc, meetupLat, meetupLng, meetupConfirmRadiusMeters, "meetup point")
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || err.Error() != tt.wantErr {
				t.Fatalf("expected %q, got %v", tt.wantErr, err)
			}
		})
	}
}
