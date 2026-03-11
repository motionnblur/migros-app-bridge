const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('JWT_SECRET is not configured');
    }
    return secret;
}

function createAccessToken(user) {
    return jwt.sign(
        {
            sub: user.id,
            username: user.username
        },
        getJwtSecret(),
        {
            expiresIn: process.env.JWT_EXPIRES_IN || '1h'
        }
    );
}

async function verifyPassword(plainPassword, storedHash) {
    if (!storedHash) {
        return false;
    }

    const isBcryptHash =
        storedHash.startsWith('$2a$') ||
        storedHash.startsWith('$2b$') ||
        storedHash.startsWith('$2y$');

    if (!isBcryptHash) {
        return false;
    }

    return bcrypt.compare(plainPassword, storedHash);
}

function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            message: 'Missing or invalid authorization header'
        });
    }

    const token = authHeader.slice(7);

    try {
        const decoded = jwt.verify(token, getJwtSecret());
        req.auth = decoded;
        return next();
    } catch (error) {
        return res.status(401).json({
            message: 'Invalid or expired token'
        });
    }
}

module.exports = {
    authenticateToken,
    createAccessToken,
    verifyPassword
};