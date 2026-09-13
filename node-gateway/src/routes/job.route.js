import express from 'express';
import authenticateToken from '../middleware/auth.middleware.js';
import {
    enqueueJob,
    getJobStatus,
    listUserJobs,
    streamJobProgressSSE,
} from '../Controllers/job.controller.js';

const router = express.Router();

// Middleware to support SSE token either from Authorization header or ?token= query parameter
const authenticateSSE = (req, res, next) => {
    if (!req.headers['authorization'] && req.query.token) {
        req.headers['authorization'] = `Bearer ${req.query.token}`;
    }
    authenticateToken(req, res, next);
};

// Asynchronous Background Job Endpoints
router.post('/api/v1/jobs', authenticateToken, enqueueJob);
router.get('/api/v1/jobs', authenticateToken, listUserJobs);
router.get('/api/v1/jobs/:id', authenticateToken, getJobStatus);
router.get('/api/v1/jobs/:id/stream', authenticateSSE, streamJobProgressSSE);

export default router;
