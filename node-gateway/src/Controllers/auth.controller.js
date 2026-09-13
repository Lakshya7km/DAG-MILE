import {
    userLogin,
    userRegistrationService,
    refreshTokenService,
    userLogoutService,
} from "../services/auth.services.js";

function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

const userRegistration = async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            message: "Bad Request",
            error: "Enter email and password",
        });
    }

    if (!validateEmail(email)) {
        return res.status(400).json({
            message: "Bad Request",
            error: "Enter a valid email",
        });
    }

    if (password.length < 8) {
        return res.status(400).json({
            message: "Bad Request",
            error: "Password must be at least 8 characters",
        });
    }

    const result = await userRegistrationService(email, password);

    if (result.error) {
        return res.status(409).json({
            message: "Conflict",
            error: result.error,
        });
    }

    return res.status(201).json({
        message: "User created successfully",
        success: true,
        user: result.user,
    });
};

const userLoginController = async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            message: "Bad Request",
            error: "Enter email and password",
        });
    }

    if (!validateEmail(email)) {
        return res.status(400).json({
            message: "Bad Request",
            error: "Enter a valid email",
        });
    }

    if (password.length < 8) {
        return res.status(400).json({
            message: "Bad Request",
            error: "Password must be at least 8 characters",
        });
    }

    const result = await userLogin(email, password);

    if (result.error) {
        return res.status(401).json({
            message: "Unauthorized",
            error: result.error,
        });
    }

    return res.status(200).json({
        message: "Login successful",
        success: true,
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
    });
};

const refreshTokenController = async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        return res.status(400).json({
            message: "Bad Request",
            error: "refreshToken is required in request body",
        });
    }

    const result = await refreshTokenService(refreshToken);

    if (result.error) {
        return res.status(401).json({
            message: "Unauthorized",
            error: result.error,
        });
    }

    return res.status(200).json({
        message: "Token refreshed successfully",
        success: true,
        accessToken: result.accessToken,
    });
};

const userLogoutController = async (req, res) => {
    const { refreshToken } = req.body;
    await userLogoutService(refreshToken);

    return res.status(200).json({
        message: "Logged out successfully",
        success: true,
    });
};

export {
    userRegistration,
    userLoginController as userLogin,
    refreshTokenController,
    userLogoutController,
};