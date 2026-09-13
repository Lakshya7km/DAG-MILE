import express from 'express';
import authenticateToken from '../middleware/auth.middleware.js';
import {
    createProject,
    getUserProjects,
    getProjectDetails,
    deleteProject,
    syncProjectFiles,
} from '../Controllers/project.controller.js';

const router = express.Router();

// All project routes require valid JWT authentication
router.post('/api/v1/projects', authenticateToken, createProject);
router.get('/api/v1/projects', authenticateToken, getUserProjects);
router.get('/api/v1/projects/:id', authenticateToken, getProjectDetails);
router.delete('/api/v1/projects/:id', authenticateToken, deleteProject);
router.post('/api/v1/projects/:id/sync', authenticateToken, syncProjectFiles);

export default router;
