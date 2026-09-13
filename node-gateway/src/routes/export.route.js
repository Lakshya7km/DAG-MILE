import express from 'express';
import authenticateToken from '../middleware/auth.middleware.js';
import {
    previewDataset,
    exportDatasetMultiFormat,
} from '../Controllers/export.controller.js';

const router = express.Router();

// Preview endpoint
router.get('/api/v1/preview/:sessionId/:filename', authenticateToken, previewDataset);

// Multi-format export endpoint (supports Authorization header or ?token=)
router.get('/api/v1/export/:sessionId/:filename', authenticateToken, exportDatasetMultiFormat);

export default router;
