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
const FRONTEND_INDEX = path.join(FRONTEND_DIR, 'index.html');
const UPLOADS_DIR = path.resolve(__dirname, '../uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const noStoreHeaders = {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
};

function sendFrontend(res) {
    res.set(noStoreHeaders);
    return res.sendFile(FRONTEND_INDEX);
}

async function proxyMlRequest(req, res) {
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
            signal: abortController.signal,
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
                    error: "Operation was cancelled by the client.",
                });
            }
            return;
        }

        console.error('❌ Proxy error connecting to Python ML backend:', error.message);
        if (!res.headersSent) {
            res.status(502).json({
                message: "Bad Gateway",
                error: "Python ML engine is unavailable. Please ensure Python backend is running on port 8000.",
            });
        }
    }
}

// ─── 1. HTTP Logger & Security ───────────────────────────────────
app.use(morgan('dev'));
app.use(helmet({
    contentSecurityPolicy: false,
}));
app.use(cors());

// ─── 2. Public Node APIs (login / register / refresh) ────────────
// JSON is scoped to /api/v1 so ML proxy routes still receive a raw body stream.
app.use('/api/v1', generalLimiter, express.json({ limit: '2mb' }));
app.use('/', userRoute);

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'DAG-MILE Node.js Gateway',
        pythonML: PYTHON_ML_URL,
        frontend: FRONTEND_DIR,
        timestamp: new Date().toISOString(),
    });
});

// ─── 3. Authenticated workspace APIs ─────────────────────────────
app.use('/', projectRoute);
app.use('/', jobRoute);
app.use('/', exportRoute);

// ─── 4. Multer + authenticated upload (same /api/upload contract as the ML repo)
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES },
});

app.post('/api/upload', uploadLimiter, authenticateToken, upload.array('files'), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({
            message: "Bad Request",
            error: "No files provided in upload",
        });
    }

    const userId = req.user.id;
    const requestedSessionId = req.body.session_id || null;
    const requestedProjectId = req.body.project_id || null;

    try {
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

            for (const f of pythonData.files) {
                const cloudUrl = cloudUploadResults[f.filename] || null;

                await pool.query(
                    `INSERT INTO project_files (project_id, filename, rows, cols, cloud_url)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [projectId, f.filename, f.rows || 0, f.cols || 0, cloudUrl]
                );
            }
        } catch (dbErr) {
            console.warn('⚠️ Non-fatal PostgreSQL save warning:', dbErr.message);
        }

        return res.status(200).json(pythonData);
    } catch (err) {
        console.error('❌ Upload gateway error:', err.message);
        const isOffline = err.message.includes('fetch failed') || err.message.includes('ECONNREFUSED');
        return res.status(502).json({
            message: "Upload Gateway Error",
            error: isOffline
                ? "Python ML engine is unavailable. Please ensure Python backend is running on port 8000."
                : err.message,
        });
    }
});

// ─── 5. Remaining ML routes (analyze, merge, preprocess, download, …) ─
// Same paths as the GitHub ML repo, but JWT is required first.
app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/v1')) return next();
    if (req.method === 'OPTIONS') return next();

    authenticateToken(req, res, () => proxyMlRequest(req, res));
});

// ─── 6. Serve the ML frontend the same way FastAPI did (one public origin)
app.get('/', (req, res) => sendFrontend(res));
app.use(express.static(FRONTEND_DIR, {
    setHeaders: (res) => {
        res.set(noStoreHeaders);
    },
}));

startJobWorker();

app.use((req, res) => {
    if (req.originalUrl.startsWith('/api') || req.method !== 'GET') {
        return res.status(404).json({
            error: 'Route not found',
            path: req.originalUrl,
            method: req.method,
        });
    }
    return sendFrontend(res);
});

app.listen(PORT, () => {
    console.log(`🚀 DAG-MILE public server: http://localhost:${PORT}`);
    console.log(`🔐 Login/register required before ML workspace APIs`);
    console.log(`📡 Internal ML engine: ${PYTHON_ML_URL}`);
    console.log(`🌐 Frontend (ml-preprocessing): ${FRONTEND_DIR}`);
});
