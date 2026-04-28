package services

import (
	"fmt"
	"log"
	"math"
	"sync"
	"sync/atomic"
	"time"
)

// JobType identifies the kind of work a Job represents.
type JobType string

const (
	JobTypeAIAnalysis        JobType = "ai_analysis"
	JobTypeEmail             JobType = "email"
	JobTypePushNotification  JobType = "push_notification"
	JobTypeImageProcess      JobType = "image_process"
	JobTypeTrustScoreUpdate  JobType = "trust_score_update"
	JobTypeCloudinaryCleanup JobType = "cloudinary_cleanup"
)

// Job is the unit of work submitted to the worker queue.
type Job struct {
	ID       string
	Type     JobType
	Payload  interface{}
	Handler  func(payload interface{}) error
	MaxRetry int
	attempt  int
}

// JobQueue is a bounded, concurrent worker pool. Jobs that fail are retried up
// to Job.MaxRetry times with exponential back-off. The queue never blocks the
// caller: Enqueue drops the job and logs a warning if the buffer is full.
type JobQueue struct {
	jobs        chan *Job
	wg          sync.WaitGroup
	sendMu      sync.RWMutex
	started     atomic.Bool
	stopped     atomic.Bool
	totalDone   atomic.Int64
	totalFail   atomic.Int64
	totalDrop   atomic.Int64
	workerCount int
}

type WorkerQueueStats struct {
	Started       bool  `json:"started"`
	Stopped       bool  `json:"stopped"`
	WorkerCount   int   `json:"worker_count"`
	QueueDepth    int   `json:"queue_depth"`
	QueueCapacity int   `json:"queue_capacity"`
	TotalDone     int64 `json:"total_done"`
	TotalFail     int64 `json:"total_fail"`
	TotalDropped  int64 `json:"total_dropped"`
}

var DefaultQueue *JobQueue

// InitWorkerQueue creates the global DefaultQueue and starts n worker goroutines.
// Call this once from main() before enqueuing any jobs.
func InitWorkerQueue(workerCount, bufferSize int) {
	DefaultQueue = NewJobQueue(workerCount, bufferSize)
	DefaultQueue.Start()
}

// NewJobQueue creates a queue without starting workers.
func NewJobQueue(workerCount, bufferSize int) *JobQueue {
	if workerCount < 1 {
		workerCount = 4
	}
	if bufferSize < 1 {
		bufferSize = 256
	}
	return &JobQueue{
		jobs:        make(chan *Job, bufferSize),
		workerCount: workerCount,
	}
}

// Start launches the worker goroutines. Duplicate calls are ignored.
func (q *JobQueue) Start() {
	if !q.started.CompareAndSwap(false, true) {
		return
	}
	for i := 0; i < q.workerCount; i++ {
		q.wg.Add(1)
		go q.worker(i)
	}
	log.Printf("[WorkerQueue] Started %d worker(s)", q.workerCount)
}

// Stop signals all workers to finish their current job and exit. It blocks
// until all in-flight jobs complete.
func (q *JobQueue) Stop() {
	if !q.started.Load() || !q.stopped.CompareAndSwap(false, true) {
		return
	}
	q.sendMu.Lock()
	close(q.jobs)
	q.sendMu.Unlock()
	q.wg.Wait()
	log.Printf("[WorkerQueue] Stopped. done=%d fail=%d", q.totalDone.Load(), q.totalFail.Load())
}

// Enqueue submits a job. If the buffer is full it logs a warning and returns
// false instead of blocking the caller.
func (q *JobQueue) Enqueue(job *Job) bool {
	if job == nil || job.Handler == nil {
		log.Printf("[WorkerQueue] Dropping invalid job")
		q.totalDrop.Add(1)
		return false
	}
	q.sendMu.RLock()
	defer q.sendMu.RUnlock()
	if q.stopped.Load() {
		log.Printf("[WorkerQueue] Queue stopped, dropping job %s (%s)", job.ID, job.Type)
		q.totalDrop.Add(1)
		return false
	}
	if job.MaxRetry < 0 {
		job.MaxRetry = 0
	}
	select {
	case q.jobs <- job:
		return true
	default:
		log.Printf("[WorkerQueue] Buffer full, dropping job %s (%s)", job.ID, job.Type)
		q.totalDrop.Add(1)
		return false
	}
}

// EnqueueFn is a convenience wrapper that wraps a plain function into a Job.
func (q *JobQueue) EnqueueFn(id string, jobType JobType, maxRetry int, fn func() error) bool {
	return q.Enqueue(&Job{
		ID:       id,
		Type:     jobType,
		MaxRetry: maxRetry,
		Handler: func(_ interface{}) error {
			return fn()
		},
	})
}

// Stats returns (totalCompleted, totalFailed) counts since the queue started.
func (q *JobQueue) Stats() (int64, int64) {
	return q.totalDone.Load(), q.totalFail.Load()
}

func (q *JobQueue) Health() WorkerQueueStats {
	if q == nil {
		return WorkerQueueStats{}
	}
	return WorkerQueueStats{
		Started:       q.started.Load(),
		Stopped:       q.stopped.Load(),
		WorkerCount:   q.workerCount,
		QueueDepth:    len(q.jobs),
		QueueCapacity: cap(q.jobs),
		TotalDone:     q.totalDone.Load(),
		TotalFail:     q.totalFail.Load(),
		TotalDropped:  q.totalDrop.Load(),
	}
}

func DefaultWorkerQueueHealth() WorkerQueueStats {
	if DefaultQueue == nil {
		return WorkerQueueStats{}
	}
	return DefaultQueue.Health()
}

func StopDefaultWorkerQueue() {
	if DefaultQueue != nil {
		DefaultQueue.Stop()
	}
}

func (q *JobQueue) worker(id int) {
	defer q.wg.Done()
	for job := range q.jobs {
		q.runJob(id, job)
	}
}

func (q *JobQueue) runJob(workerID int, job *Job) {
	job.attempt++
	start := time.Now()

	defer func() {
		if r := recover(); r != nil {
			log.Printf("[WorkerQueue] worker=%d job=%s type=%s PANIC: %v", workerID, job.ID, job.Type, r)
			q.totalFail.Add(1)
		}
	}()

	err := job.Handler(job.Payload)
	elapsed := time.Since(start)

	if err == nil {
		q.totalDone.Add(1)
		log.Printf("[WorkerQueue] worker=%d job=%s type=%s OK attempt=%d elapsed=%s",
			workerID, job.ID, job.Type, job.attempt, elapsed.Round(time.Millisecond))
		return
	}

	log.Printf("[WorkerQueue] worker=%d job=%s type=%s ERR attempt=%d/%d: %v",
		workerID, job.ID, job.Type, job.attempt, job.MaxRetry+1, err)

	if job.attempt <= job.MaxRetry {
		// Exponential back-off: 1s, 2s, 4s, 8s … capped at 60 s.
		backoff := time.Duration(math.Min(float64(time.Second)*math.Pow(2, float64(job.attempt-1)), float64(60*time.Second)))
		log.Printf("[WorkerQueue] Retrying job %s in %s", job.ID, backoff)
		time.AfterFunc(backoff, func() {
			if q.stopped.Load() {
				return
			}
			q.Enqueue(job)
		})
		return
	}

	q.totalFail.Add(1)
	log.Printf("[WorkerQueue] Job %s (%s) permanently failed after %d attempt(s)", job.ID, job.Type, job.attempt)
}

// ---- Convenience helpers for common job types ----

// EnqueueFnJob queues any function as a named background job with retry support.
// Callers in the handlers package use this to offload push notifications,
// trust-score updates, and other slow work without importing internal packages.
func EnqueueFnJob(id string, jobType JobType, maxRetry int, fn func() error) bool {
	if DefaultQueue == nil {
		return false
	}
	return DefaultQueue.EnqueueFn(id, jobType, maxRetry, fn)
}

// EnqueueTrustScoreUpdate queues a trust-score recalculation for a user.
// The actual recalculation is done by the caller-supplied fn so this package
// does not need to import the database package directly.
func EnqueueTrustScoreUpdate(userID int, fn func(uid int) error) {
	if DefaultQueue == nil {
		return
	}
	id := fmt.Sprintf("trust-%d-%d", userID, time.Now().UnixNano())
	DefaultQueue.EnqueueFn(id, JobTypeTrustScoreUpdate, 1, func() error {
		return fn(userID)
	})
}

// EnqueueImageProcess queues a local-to-Cloudinary compression+upload task.
func EnqueueImageProcess(localPath, cloudFolder string, onDone func(url string, err error)) {
	if DefaultQueue == nil {
		return
	}
	id := fmt.Sprintf("img-%d", time.Now().UnixNano())
	DefaultQueue.EnqueueFn(id, JobTypeImageProcess, 2, func() error {
		if err := CompressLocalJPEG(localPath, 80); err != nil {
			log.Printf("[WorkerQueue] compress %s: %v", localPath, err)
		}
		url, err := UploadLocalFileToCloudinary(localPath, cloudFolder, "")
		if onDone != nil {
			onDone(url, err)
		}
		return err
	})
}
