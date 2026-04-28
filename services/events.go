package services

import "sync"

// SSEPublishFunc is the signature for publishing a real-time event to a user's SSE stream.
type SSEPublishFunc func(userID int, eventType string, data interface{})

var (
	ssePublishFn SSEPublishFunc
	sseMu        sync.RWMutex
)

func SSEPublisherRegistered() bool {
	sseMu.RLock()
	defer sseMu.RUnlock()
	return ssePublishFn != nil
}

// RegisterSSEPublisher is called once by the handlers package (via init) so that
// background services can push real-time events without creating circular imports.
func RegisterSSEPublisher(fn SSEPublishFunc) {
	sseMu.Lock()
	defer sseMu.Unlock()
	ssePublishFn = fn
}

// PublishUserEvent sends an SSE event to a connected user.
// If no SSE publisher is registered (e.g. during tests), the call is a no-op.
func PublishUserEvent(userID int, eventType string, data interface{}) {
	sseMu.RLock()
	fn := ssePublishFn
	sseMu.RUnlock()
	if fn != nil {
		fn(userID, eventType, data)
	}
}
