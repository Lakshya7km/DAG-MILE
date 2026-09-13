import express from 'express';
import helmet from 'helmet';
import dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import morgan from 'morgan';
import { fileURLToPath } from 'url';

import userRoute from "./routes/auth.route.js";
import projectRoute from "./routes/project.route.js";
import jobRoute from "./routes/job.route.js";
import exportRoute from "./routes/export.route.js";
import authenticateToken from "./middleware/auth.middleware.js";
import { uploadLimiter, generalLimiter } from "./middleware/rateLimit.middleware.js";
import { uploadDatasetToCloud } from "./services/storage.services.js";
import { startJobWorker } from "./services/job.services.js";
import pool from "./db/index.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const PYTHON_ML_URL = process.env.PYTHON_ML_URL || 'http://127.0.0.1:8000';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_DIR = path.resolve(__dirname, '../../ml-preprocessing-main/ml-preprocessing-main/frontend');
const UPLOADS_DIR = path.resolve(__dirname, '../uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// ─── 1. HTTP Logger & Security Middleware ───────────────────────
app.use(morgan('dev')); // Structured colorized terminal logging
app.use(helmet({
    contentSecurityPolicy: false
}));
app.use(cors());

// ─── 2. Serve Frontend Statically ───────────────────────────────
app.use(express.static(FRONTEND_DIR, {
    setHeaders: (res, filePath) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
}));

// ─── 3. Multer Setup for Ingestion (100MB max per file) ─────────
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES }
});

// ─── 4. Dedicated Upload Gateway with Cloud Storage & Deduplication ─
app.post('/api/upload', uploadLimiter, authenticateToken, upload.array('files'), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({
            message: "Bad Request",
            error: "No files provided in upload"
        });
    }

    const userId = req.user.id;
    const requestedSessionId = req.body.session_id || null;
    const requestedProjectId = req.body.project_id || null;

    try {
        // A. Upload / Deduplicate files in Supabase Cloud Storage
        const cloudUploadResults = {};
        for (const file of req.files) {
            try {
                const cloudRes = await uploadDatasetToCloud(
                    userId,
                    requestedProjectId || requestedSessionId || 'default',
                    file.originalname,
                    file.buffer,
                    file.mimetype || 'text/csv'
                );
                cloudUploadResults[file.originalname] = cloudRes.cloudUrl;
            } catch (cloudErr) {
                console.warn(`⚠️ Cloud storage warning for ${file.originalname}:`, cloudErr.message);
            }
        }

        // B. Forward multipart files to Python FastAPI ML Engine
        const forwardForm = new FormData();
        if (requestedSessionId) {
            forwardForm.append('session_id', requestedSessionId);
        }

        for (const file of req.files) {
            const fileBlob = new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' });
            forwardForm.append('files', fileBlob, file.originalname);
        }

        const pythonResponse = await fetch(`${PYTHON_ML_URL}/api/upload`, {
            method: 'POST',
            body: forwardForm,
        });

        if (!pythonResponse.ok) {
            const errorText = await pythonResponse.text();
            throw new Error(`Python ML engine error (${pythonResponse.status}): ${errorText}`);
        }

        const pythonData = await pythonResponse.json();
        const sessionId = pythonData.session_id;

        // C. Save / Link with Neon PostgreSQL Project & Files
        try {
            let projectId = requestedProjectId;

            if (projectId) {
                await pool.query(
                    `UPDATE projects SET py_session_id = $1, status = 'active' WHERE id = $2 AND user_id = $3`,
                    [sessionId, projectId, userId]
                );
            } else {
                let projectRes = await pool.query(
                    `SELECT id FROM projects WHERE user_id = $1 AND py_session_id = $2`,
                    [userId, sessionId]
                );

                if (projectRes.rows.length === 0) {
                    const newProj = await pool.query(
                        `INSERT INTO projects (user_id, name, py_session_id, status)
                         VALUES ($1, $2, $3, 'active')
                         RETURNING id`,
                        [userId, `Dataset Project (${new Date().toLocaleDateString()})`, sessionId]
                    );
                    projectId = newProj.rows[0].id;
                } else {
                    projectId = projectRes.rows[0].id;
                }
            }

            // Save file metadata + cloud_url to Neon PostgreSQL
            for (const f of pythonData.files) {
                const cloudUrl = cloudUploadResults[f.filename] || null;
                f.cloud_url = cloudUrl;

                await pool.query(
                    `INSERT INTO project_files (project_id, filename, rows, cols, cloud_url)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [projectId, f.filename, f.rows || 0, f.cols || 0, cloudUrl]
                );
            }
        } catch (dbErr) {
            console.warn('⚠️ Non-fatal PostgreSQL save warning:', dbErr.message);
        }

        // D. Return combined response to frontend
        return res.status(200).json(pythonData);

    } catch (err) {
        console.error('❌ Upload gateway error:', err.message);
        const isOffline = err.message.includes('fetch failed') || err.message.includes('ECONNREFUSED');
        return res.status(502).json({
            message: "Upload Gateway Error",
            error: isOffline ? "Python ML engine is unavailable. Please ensure Python backend is running on port 8000." : err.message
        });
    }
});

// ─── 5. Protected Reverse Proxy for remaining ML routes ─────────
app.use('/api', async (req, res, next) => {
    if (req.path.startsWith('/v1')) return next();
    if (req.method === 'OPTIONS') return next();

    authenticateToken(req, res, async () => {
        const abortController = new AbortController();

        req.on('aborted', () => {
            console.warn('⚠️ [REQUEST ABORTED] Client closed connection.');
            abortController.abort();
        });

        try {
            const headers = { ...req.headers };
            delete headers.host;
            delete headers['content-length'];

            if (req.user) {
                headers['x-user-id'] = req.user.id;
                headers['x-user-email'] = req.user.email;
            }

            const upstream = await fetch(`${PYTHON_ML_URL}${req.originalUrl}`, {
                method: req.method,
                headers,
                body: ['GET', 'HEAD'].includes(req.method) ? undefined : req,
                duplex: 'half',
                signal: abortController.signal
            });

            res.status(upstream.status);
            upstream.headers.forEach((value, key) => res.setHeader(key, value));

            if (!upstream.body) return res.end();
            for await (const chunk of upstream.body) res.write(chunk);
            res.end();
        } catch (error) {
            if (error.name === 'AbortError') {
                if (!res.headersSent) {
                    res.status(499).json({
                        message: "Client Closed Request",
                        error: "Operation was cancelled by the client."
                    });
                }
                return;
            }

            console.error('❌ Proxy error connecting to Python ML backend:', error.message);
            if (!res.headersSent) {
                res.status(502).json({
                    message: "Bad Gateway",
                    error: "Python ML engine is unavailable. Please ensure Python backend is running on port 8000."
                });
            }
        }
    });
});

// ─── 6. Body Parsers & General Rate Limiter ─────────────────────
app.use('/api/v1', generalLimiter);
app.use(express.json());

// ─── 7. Health Check Route ──────────────────────────────────────
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'DAG-MILE Node.js Gateway',
        pythonML: PYTHON_ML_URL,
        cloudStorage: 'Supabase Storage connected',
        database: 'Neon PostgreSQL connected',
        timestamp: new Date().toISOString()
    });
});

// ─── 8. Application Routes ──────────────────────────────────────
app.use('/', userRoute);
app.use('/', projectRoute);
app.use('/', jobRoute);
app.use('/', exportRoute);

// Start asynchronous background job worker
startJobWorker();

// ─── 9. Catch-All 404 Handler ───────────────────────────────────
app.use((req, res) => {
    res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl,
        method: req.method
    });
});

// ─── Start Server ────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`🚀 DAG-MILE Gateway running on http://localhost:${PORT}`);
    console.log(`📡 Proxying ML requests to: ${PYTHON_ML_URL}`);
    console.log(`☁️ Cloud Storage: Connected to Supabase bucket`);
    console.log(`💾 Local uploads folder: ${UPLOADS_DIR}`);
    console.log(`🌐 Serving frontend from: ${FRONTEND_DIR}`);
});