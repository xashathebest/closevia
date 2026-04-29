package services

import (
	"sync"
	"time"
)

const recentBackendErrorWindow = 24 * time.Hour

var backendErrorMonitor = struct {
	sync.Mutex
	events []time.Time
}{}

func RecordBackendError() {
	now := time.Now()
	cutoff := now.Add(-recentBackendErrorWindow)

	backendErrorMonitor.Lock()
	defer backendErrorMonitor.Unlock()

	kept := backendErrorMonitor.events[:0]
	for _, event := range backendErrorMonitor.events {
		if event.After(cutoff) {
			kept = append(kept, event)
		}
	}
	backendErrorMonitor.events = append(kept, now)
}

func RecentBackendErrorCount() int {
	cutoff := time.Now().Add(-recentBackendErrorWindow)

	backendErrorMonitor.Lock()
	defer backendErrorMonitor.Unlock()

	kept := backendErrorMonitor.events[:0]
	for _, event := range backendErrorMonitor.events {
		if event.After(cutoff) {
			kept = append(kept, event)
		}
	}
	backendErrorMonitor.events = kept
	return len(backendErrorMonitor.events)
}
