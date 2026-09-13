import EventEmitter from 'events';
import pool from '../db/index.js';

const jobEvents = new EventEmitter();
const PYTHON_ML_URL = process.env.PYTHON_ML_URL || 'http://127.0.0.1:8000';
const MAX_CONCURRENT_JOBS = 2; // Process up to 2 heavy ML jobs concurrently
let activeJobsCount = 0;

/**
 * Creates a new background job in the PostgreSQL queue
 */
const createJobService = async (userId, projectId, jobType, payload = {}) => {
    const result = await pool.query(
        `INSERT INTO background_jobs (user_id, project_id, job_type, payload, status, progress)
         VALUES ($1, $2, $3, $4, 'queued', 0)
         RETURNING id, user_id, project_id, job_type, status, progress, created_at`,
        [userId, projectId || null, jobType, JSON.stringify(payload)]
    );

    const job = result.rows[0];
    console.log(`📥 [JOB QUEUED] Job ${job.id} (${jobType}) enqueued for user ${userId}`);

    // Trigger the background worker asynchronously
    setImmediate(() => processQueue());

    return job;
};

/**
 * Gets the current status of a specific job
 */
const getJobByIdService = async (jobId, userId) => {
    const result = await pool.query(
        `SELECT id, user_id, project_id, job_type, status, progress, payload, result, error_msg, created_at, updated_at
         FROM background_jobs
         WHERE id = $1 AND user_id = $2`,
        [jobId, userId]
    );
    return result.rows[0] || null;
};

/**
 * Lists all background jobs for a user
 */
const getUserJobsService = async (userId, limit = 20) => {
    const result = await pool.query(
        `SELECT id, project_id, job_type, status, progress, error_msg, created_at, updated_at
         FROM background_jobs
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, limit]
    );
    return result.rows;
};

/**
 * Updates progress and broadcasts real-time event
 */
const updateJobProgress = async (jobId, progress, status = 'processing', extra = {}) => {
    await pool.query(
        `UPDATE background_jobs 
         SET progress = $1, status = $2, updated_at = NOW() 
         WHERE id = $3`,
        [progress, status, jobId]
    );

    jobEvents.emit(`job:${jobId}`, {
        jobId,
        progress,
        status,
        ...extra
    });
};

/**
 * Background Queue Worker Loop
 */
const processQueue = async () => {
    if (activeJobsCount >= MAX_CONCURRENT_JOBS) {
        return; // Max concurrency reached; next free slot will pick up remaining jobs
    }

    // Atomic fetch & lock next queued job using PostgreSQL's SKIP LOCKED
    const client = await pool.connect();
    let job = null;
    try {
        await client.query('BEGIN');
        const res = await client.query(
            `SELECT id, user_id, project_id, job_type, payload
             FROM background_jobs
             WHERE status = 'queued'
             ORDER BY created_at ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED`
        );

        if (res.rows.length > 0) {
            job = res.rows[0];
            await client.query(
                `UPDATE background_jobs 
                 SET status = 'processing', progress = 10, updated_at = NOW() 
                 WHERE id = $1`,
                [job.id]
            );
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error picking queued job:', err.message);
    } finally {
        client.release();
    }

    if (!job) return; // No jobs queued

    activeJobsCount++;
    console.log(`⚙️ [JOB STARTED] Processing Job ${job.id} (${job.job_type}) [Active: ${activeJobsCount}/${MAX_CONCURRENT_JOBS}]`);

    try {
        const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
        let jobResult = null;

        // Execute task based on job type
        if (job.job_type === 'preprocess') {
            await updateJobProgress(job.id, 25, 'processing');

            const { sessionId, filename, options } = payload;
            const res = await fetch(`${PYTHON_ML_URL}/api/preprocess/${encodeURIComponent(sessionId)}/${encodeURIComponent(filename)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(options || {}),
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`ML Preprocessing failed: ${errText}`);
            }

            await updateJobProgress(job.id, 75, 'processing');
            jobResult = await res.json();
        } else if (job.job_type === 'merge') {
            await updateJobProgress(job.id, 30, 'processing');

            const { sessionId, mergeBody } = payload;
            const res = await fetch(`${PYTHON_ML_URL}/api/merge/${encodeURIComponent(sessionId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(mergeBody || {}),
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`Dataset Merge failed: ${errText}`);
            }

            await updateJobProgress(job.id, 80, 'processing');
            jobResult = await res.json();
        } else {
            // Generic custom task
            await updateJobProgress(job.id, 50, 'processing');
            jobResult = { message: 'Task completed successfully', details: payload };
        }

        // Job Completed Successfully
        await pool.query(
            `UPDATE background_jobs 
             SET status = 'completed', progress = 100, result = $1, updated_at = NOW() 
             WHERE id = $2`,
            [JSON.stringify(jobResult), job.id]
        );

        jobEvents.emit(`job:${job.id}`, {
            jobId: job.id,
            progress: 100,
            status: 'completed',
            result: jobResult
        });

        console.log(`🎉 [JOB COMPLETED] Job ${job.id} (${job.job_type}) finished successfully!`);
    } catch (err) {
        console.error(`❌ [JOB FAILED] Job ${job.id} failed:`, err.message);

        await pool.query(
            `UPDATE background_jobs 
             SET status = 'failed', error_msg = $1, updated_at = NOW() 
             WHERE id = $2`,
            [err.message, job.id]
        );

        jobEvents.emit(`job:${job.id}`, {
            jobId: job.id,
            status: 'failed',
            error: err.message
        });
    } finally {
        activeJobsCount--;
        // Immediately check if another job is waiting in the queue
        setImmediate(() => processQueue());
    }
};

/**
 * Periodically polls the queue to handle any stranded jobs
 */
const startJobWorker = () => {
    console.log(`👷 Background Job Worker started (Concurrency: ${MAX_CONCURRENT_JOBS})`);
    setInterval(() => processQueue(), 5000); // Check every 5 seconds
};

export {
    jobEvents,
    createJobService,
    getJobByIdService,
    getUserJobsService,
    startJobWorker,
};
