import pool from '../db/index.js';
import { deleteProjectFolderFromCloud } from './storage.services.js';

const createProjectService = async (userId, name, pySessionId = null) => {
    const result = await pool.query(
        `INSERT INTO projects (user_id, name, py_session_id, status)
         VALUES ($1, $2, $3, 'created')
         RETURNING id, user_id, name, py_session_id, status, created_at`,
        [userId, name, pySessionId]
    );
    return result.rows[0];
};

const getUserProjectsService = async (userId) => {
    const result = await pool.query(
        `SELECT p.id, p.name, p.py_session_id, p.status, p.created_at,
                COUNT(f.id)::int AS file_count
         FROM projects p
         LEFT JOIN project_files f ON f.project_id = p.id
         WHERE p.user_id = $1
           AND p.status <> 'deleted'
         GROUP BY p.id
         ORDER BY p.created_at DESC`,
        [userId]
    );
    return result.rows;
};

const getProjectByIdService = async (userId, projectId) => {
    const projectRes = await pool.query(
        `SELECT id, user_id, name, py_session_id, status, created_at
         FROM projects
         WHERE id = $1 AND user_id = $2 AND status <> 'deleted'`,
        [projectId, userId]
    );

    if (projectRes.rows.length === 0) {
        return null;
    }

    const filesRes = await pool.query(
        `SELECT id, filename, rows, cols, cloud_url, uploaded_at
         FROM project_files
         WHERE project_id = $1
         ORDER BY uploaded_at ASC`,
        [projectId]
    );

    return {
        ...projectRes.rows[0],
        files: filesRes.rows,
    };
};

/**
 * Deletes files from Cloud Storage (freeing quota) but preserves metadata in PostgreSQL!
 */
const deleteProjectService = async (userId, projectId) => {
    // 1. Fetch project to get py_session_id
    const projectRes = await pool.query(
        `SELECT id, py_session_id FROM projects WHERE id = $1 AND user_id = $2`,
        [projectId, userId]
    );

    if (projectRes.rows.length === 0) {
        return false;
    }

    const pySessionId = projectRes.rows[0].py_session_id;

    // 2. Purge files from Supabase Cloud Storage to free up space
    await deleteProjectFolderFromCloud(userId, projectId);
    if (pySessionId) {
        await deleteProjectFolderFromCloud(userId, pySessionId);
    }

    // 3. Preserve metadata in Neon PostgreSQL (mark status as 'deleted')
    await pool.query(
        `UPDATE projects 
         SET status = 'deleted' 
         WHERE id = $1 AND user_id = $2`,
        [projectId, userId]
    );

    await pool.query(
        `UPDATE project_files 
         SET cloud_url = 'removed_from_cloud' 
         WHERE project_id = $1`,
        [projectId]
    );

    console.log(`✅ [METADATA PRESERVED] Project ${projectId} marked as deleted. Files removed from cloud, historical metadata safely kept in PostgreSQL.`);
    return true;
};

const syncProjectFilesService = async (userId, projectId, pySessionId, files = []) => {
    const projectRes = await pool.query(
        `UPDATE projects
         SET py_session_id = COALESCE($1, py_session_id),
             status = 'active'
         WHERE id = $2 AND user_id = $3
         RETURNING id, name, py_session_id`,
        [pySessionId, projectId, userId]
    );

    if (projectRes.rows.length === 0) {
        return { error: 'Project not found' };
    }

    const insertedFiles = [];
    for (const file of files) {
        const fileRes = await pool.query(
            `INSERT INTO project_files (project_id, filename, rows, cols, cloud_url)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, filename, rows, cols, cloud_url, uploaded_at`,
            [projectId, file.filename, file.rows || 0, file.cols || 0, file.cloudUrl || null]
        );
        insertedFiles.push(fileRes.rows[0]);
    }

    return {
        project: projectRes.rows[0],
        files: insertedFiles,
    };
};

export {
    createProjectService,
    getUserProjectsService,
    getProjectByIdService,
    deleteProjectService,
    syncProjectFilesService,
};
