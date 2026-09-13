import jwt from 'jsonwebtoken';

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    // Support Bearer header or ?token= query parameter (for direct file downloads/streams)
    const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;

    if (!token) {
        return res.status(401).json({
            message: 'Unauthorized',
            error: 'Access token missing. Please provide Authorization: Bearer <token> or ?token=<token>',
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
        req.user = decoded; // { id, email, iat, exp }
        next();
    } catch (err) {
        return res.status(403).json({
            message: 'Forbidden',
            error: 'Access token is invalid or has expired',
        });
    }
};

export default authenticateToken;
