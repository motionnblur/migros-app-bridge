const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../services/authService');

function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            message: 'Missing or invalid authorization header'
        });
    }

    const token = authHeader.slice(7);

    try {
        const decoded = jwt.verify(token, getJwtSecret(), {
            algorithms: ['HS256']
        });
        req.auth = decoded;
        return next();
    } catch (error) {
        return res.status(401).json({
            message: 'Invalid or expired token'
        });
    }
}

module.exports = {
    authenticateToken
};
