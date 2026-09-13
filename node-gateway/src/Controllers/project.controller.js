import {
    createProjectService,
    getUserProjectsService,
    getProjectByIdService,
    deleteProjectService,
    syncProjectFilesService,
} from "../services/project.services.js";

const createProject = async (req, res) => {
    const { name, pySessionId } = req.body;

    if (!name || name.trim() === '') {
        return res.status(400).json({
            message: "Bad Request",
            error: "Project name is required",
        });
    }

    try {
        const project = await createProjectService(req.user.id, name.trim(), pySessionId || null);
        return res.status(201).json({
            message: "Project created successfully",
            success: true,
            project,
        });
    } catch (err) {
        console.error('Error creating project:', err.message);
        return res.status(500).json({
            message: "Internal Server Error",
            error: err.message,
        });
    }
};

const getUserProjects = async (req, res) => {
    try {
        const projects = await getUserProjectsService(req.user.id);
        return res.status(200).json({
            message: "Projects retrieved successfully",
            success: true,
            count: projects.length,
            projects,
        });
    } catch (err) {
        console.error('Error fetching projects:', err.message);
        return res.status(500).json({
            message: "Internal Server Error",
            error: err.message,
        });
    }
};

const getProjectDetails = async (req, res) => {
    const { id } = req.params;

    try {
        const project = await getProjectByIdService(req.user.id, id);
        if (!project) {
            return res.status(404).json({
                message: "Not Found",
                error: `Project with ID ${id} was not found`,
            });
        }

        return res.status(200).json({
            message: "Project details retrieved successfully",
            success: true,
            project,
        });
    } catch (err) {
        console.error('Error fetching project details:', err.message);
        return res.status(500).json({
            message: "Internal Server Error",
            error: err.message,
        });
    }
};

const deleteProject = async (req, res) => {
    const { id } = req.params;

    try {
        const deleted = await deleteProjectService(req.user.id, id);
        if (!deleted) {
            return res.status(404).json({
                message: "Not Found",
                error: `Project with ID ${id} was not found or already deleted`,
            });
        }

        return res.status(200).json({
            message: "Project deleted successfully",
            success: true,
        });
    } catch (err) {
        console.error('Error deleting project:', err.message);
        return res.status(500).json({
            message: "Internal Server Error",
            error: err.message,
        });
    }
};

const syncProjectFiles = async (req, res) => {
    const { id } = req.params;
    const { pySessionId, files } = req.body;

    try {
        const result = await syncProjectFilesService(req.user.id, id, pySessionId, files || []);
        if (result.error) {
            return res.status(404).json({
                message: "Not Found",
                error: result.error,
            });
        }

        return res.status(200).json({
            message: "Project files synchronized successfully",
            success: true,
            ...result,
        });
    } catch (err) {
        console.error('Error syncing project files:', err.message);
        return res.status(500).json({
            message: "Internal Server Error",
            error: err.message,
        });
    }
};

export {
    createProject,
    getUserProjects,
    getProjectDetails,
    deleteProject,
    syncProjectFiles,
};
