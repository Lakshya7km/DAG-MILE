import express from 'express';
import {
    userLogin,
    userRegistration,
    refreshTokenController,
    userLogoutController,
} from "../Controllers/auth.controller.js";
import { authLimiter } from "../middleware/rateLimit.middleware.js";

const router = express.Router();

// User Registration & Login (Protected by authLimiter against brute-force)
router.post('/api/v1/register', authLimiter, userRegistration);
router.post('/api/v1/login', authLimiter, userLogin);

// Token Refresh & Logout
router.post('/api/v1/refresh', refreshTokenController);
router.post('/api/v1/logout', userLogoutController);

export default router;