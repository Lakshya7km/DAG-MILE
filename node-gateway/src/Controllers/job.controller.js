import {
    jobEvents,
    createJobService,
    getJobByIdService,
    getUserJobsService,
} from "../services/job.services.js";

/**
 * Enqueue a new background job (Async processing)
 */
const enqueueJob = async (req, res) => {
    const { projectId, jobType, payload } = req.body;

    if (!jobType) {
        return res.status(400).json({
            message: "Bad Request",
            error: "jobType is required (e.g. 'preprocess', 'merge')",
        });
    }

    try {
        const job = await createJobService(
            req.user.id,
            projectId || null,
            jobType,
            payload || {}
        );

        // Return 202 Accepted (Standard HTTP status for asynchronous background jobs)
        return res.status(202).json({
            message: "Job accepted and enqueued for background processing",
            success: true,
            jobId: job.id,
            status: job.status,
            pollUrl: `/api/v1/jobs/${job.id}`,
            streamUrl: `/api/v1/jobs/${job.id}/stream`,
        });
    } catch (err) {
        console.error("Error enqueuing job:", err.message);
        return res.status(500).json({
            message: "Internal Server Error",
            error: err.message,
        });
    }
};

/**
 * Get the current status and result of a job
 */
const getJobStatus = async (req, res) => {
    const { id } = req.params;

    try {
        const job = await getJobByIdService(id, req.user.id);
        if (!job) {
            return res.status(404).json({
                message: "Not Found",
                error: `Job with ID ${id} was not found`,
            });
        }

        return res.status(200).json({
            success: true,
            job,
        });
    } catch (err) {
        console.error("Error getting job status:", err.message);
        return res.status(500).json({
            message: "Internal Server Error",
            error: err.message,
        });
    }
};

/**
 * Get all background jobs for the logged-in user
 */
const listUserJobs = async (req, res) => {
    try {
        const jobs = await getUserJobsService(req.user.id);
        return res.status(200).json({
            success: true,
            count: jobs.length,
            jobs,
        });
    } catch (err) {
        console.error("Error listing jobs:", err.message);
        return res.status(500).json({
            message: "Internal Server Error",
            error: err.message,
        });
    }
};

/**
 * Real-Time Server-Sent Events (SSE) stream for live job progress
 */
const streamJobProgressSSE = async (req, res) => {
    const { id } = req.params;

    // Check if job exists
    const job = await getJobByIdService(id, req.user.id);
    if (!job) {
        return res.status(404).json({
            message: "Not Found",
            error: "Job not found",
        });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send initial status immediately
    res.write(`data: ${JSON.stringify({ jobId: job.id, progress: job.progress, status: job.status })}\n\n`);

    if (job.status === 'completed' || job.status === 'failed') {
        return res.end();
    }

    // Listener for live updates
    const onProgress = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (data.status === 'completed' || data.status === 'failed') {
            jobEvents.off(`job:${id}`, onProgress);
            res.end();
        }
    };

    jobEvents.on(`job:${id}`, onProgress);

    // Clean up if client disconnects early
    req.on('close', () => {
        jobEvents.off(`job:${id}`, onProgress);
    });
};

export {
    enqueueJob,
    getJobStatus,
    listUserJobs,
    streamJobProgressSSE,
};
