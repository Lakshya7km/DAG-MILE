import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import pool from '../db/index.js';

// Hash helper for storing refresh tokens securely in DB
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const userRegistrationService = async (email, password) => {
    // 1. Check if email already exists
    const existing = await pool.query(
        'SELECT id FROM users WHERE email = $1',
        [email]
    );

    if (existing.rows.length > 0) {
        return { error: 'This email is already registered. Please log in instead.' };
    }

    // 2. Hash password with bcrypt (12 salt rounds)
    const hashedPassword = await bcrypt.hash(password, 12);

    // 3. Save user to database
    const result = await pool.query(
        'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email, created_at',
        [email, hashedPassword]
    );

    return { user: result.rows[0] };
};

const userLogin = async (email, password) => {
    // 1. Fetch user by email
    const result = await pool.query(
        'SELECT id, email, password, created_at FROM users WHERE email = $1',
        [email]
    );

    if (result.rows.length === 0) {
        return { error: 'No account found with this email. Please create an account first.' };
    }

    const user = result.rows[0];

    // 2. Compare passwords
    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
        return { error: 'Incorrect password. Please check your credentials.' };
    }

    // 3. Generate JWT Tokens
    const accessToken = jwt.sign(
        { id: user.id, email: user.email },
        process.env.JWT_ACCESS_SECRET,
        { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
        { id: user.id },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: '7d' }
    );

    // 4. Store hashed refresh token in database (7 days expiration)
    const tokenHash = hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await pool.query(
        'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [user.id, tokenHash, expiresAt]
    );

    return {
        user: {
            id: user.id,
            email: user.email,
            created_at: user.created_at,
        },
        accessToken,
        refreshToken,
    };
};

const refreshTokenService = async (refreshToken) => {
    if (!refreshToken) {
        return { error: 'Refresh token is required' };
    }

    // 1. Verify token signature
    let decoded;
    try {
        decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch (err) {
        return { error: 'Invalid or expired refresh token' };
    }

    // 2. Check if token exists and is not expired in DB
    const tokenHash = hashToken(refreshToken);
    const stored = await pool.query(
        'SELECT id, user_id, expires_at FROM refresh_tokens WHERE token_hash = $1 AND expires_at > NOW()',
        [tokenHash]
    );

    if (stored.rows.length === 0) {
        return { error: 'Refresh token has been revoked or expired' };
    }

    // 3. Fetch user details for the new access token
    const userRes = await pool.query('SELECT id, email FROM users WHERE id = $1', [decoded.id]);
    if (userRes.rows.length === 0) {
        return { error: 'User not found' };
    }

    const user = userRes.rows[0];

    // 4. Issue fresh 15-minute access token
    const newAccessToken = jwt.sign(
        { id: user.id, email: user.email },
        process.env.JWT_ACCESS_SECRET,
        { expiresIn: '15m' }
    );

    return { accessToken: newAccessToken };
};

const userLogoutService = async (refreshToken) => {
    if (!refreshToken) return { success: true };

    const tokenHash = hashToken(refreshToken);
    await pool.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
    return { success: true };
};

export {
    userRegistrationService,
    userLogin,
    refreshTokenService,
    userLogoutService,
};