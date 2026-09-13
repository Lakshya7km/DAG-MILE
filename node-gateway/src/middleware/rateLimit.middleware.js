import rateLimit from 'express-rate-limit';

// Rate limiter for authentication endpoints (login/register)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 15, // Limit each IP to 15 login/register attempts per window
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: 'Too Many Requests',
        error: 'Too many login/registration attempts from this IP. Please try again after 15 minutes.'
    }
});

// Rate limiter for dataset file uploads
const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30, // Limit each IP to 30 dataset uploads per window
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: 'Too Many Requests',
        error: 'Upload limit reached. Please wait a few minutes before uploading more datasets.'
    }
});

// General API rate limiter
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300, // Limit each IP to 300 general requests per window
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: 'Too Many Requests',
        error: 'Too many requests. Please slow down.'
    }
});

export {
    authLimiter,
    uploadLimiter,
    generalLimiter,
};
