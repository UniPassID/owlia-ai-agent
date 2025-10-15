# Rebalance Queue System

This module implements a BullMQ-based queue system for processing rebalance jobs.

## Features

- **Serial Execution**: Processes one job at a time to prevent resource exhaustion
- **Duplicate Prevention**: Automatically prevents adding duplicate jobs for the same user if they already have a pending/active job
- **Exponential Backoff**: For users with consecutive failures, jobs are delayed exponentially (30s, 60s, 120s, 240s...)
- **Rate Limiting**: Maximum 1 job per 5 seconds
- **Retry Logic**: Up to 3 automatic retries with exponential backoff on failures
- **Priority Queue**: Manual triggers get higher priority than automated jobs

## Configuration

Add the following environment variables to your `.env` file:

```env
REDIS_HOST=localhost
REDIS_PORT=6379
```

## Redis Setup

### Local Development

```bash
# Using Docker
docker run -d --name redis -p 6379:6379 redis:latest

# Or install Redis locally
# macOS
brew install redis
brew services start redis

# Ubuntu/Debian
sudo apt-get install redis-server
sudo systemctl start redis
```

### Production

For production, use a managed Redis service like:
- AWS ElastiCache
- Redis Cloud
- Upstash Redis

## Queue Metrics

Get queue status via the service:

```typescript
const metrics = await queueService.getQueueMetrics();
// Returns: { waiting, active, completed, failed, delayed, total }
```

## Queue Management

Clear the queue (maintenance only):

```typescript
await queueService.clearQueue();
```

## How It Works

1. **Job Creation**: When a rebalance is triggered, a job record is created in the database
2. **Duplicate Check**: System checks if user already has a pending/active job
   - Checks in-memory tracking map for fast lookup
   - Double-checks database for accuracy
   - If duplicate found, new job is rejected with reason
3. **Queue Addition**: The job is added to the BullMQ queue with appropriate delay/priority
4. **Serial Processing**: Worker processes one job at a time
5. **Exponential Backoff**: Failed jobs for the same user trigger increasing delays
6. **Database Updates**: Job status is updated throughout the process
7. **Cleanup**: On completion/failure, user is removed from active jobs tracking

## Job Lifecycle

```
PENDING → (queued) → SIMULATING → APPROVED/REJECTED → EXECUTING → COMPLETED/FAILED
```

## Failure Handling

- **Worker Failure**: BullMQ retries up to 3 times with exponential backoff
- **Consecutive User Failures**: Tracked in-memory, causes delays for subsequent jobs
- **Success**: Resets user failure count and clears from active jobs
- **Duplicate Detection**: Prevents duplicate jobs, marks new job as REJECTED in database

## Duplicate Prevention Logic

The system prevents duplicate jobs using a two-tier approach:

1. **In-Memory Tracking**: Fast lookup using `Map<userId, jobId>` to track active jobs
2. **Database Verification**: Queries database for jobs with status:
   - `PENDING`
   - `SIMULATING`
   - `EXECUTING`

If a duplicate is detected:
- The new job is **not** added to the queue
- Job status is set to `REJECTED` in database
- Error message explains which job is already running
- Returns `{ added: false, reason: "..." }` to caller
