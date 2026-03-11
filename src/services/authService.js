const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { jwtSecret, jwtExpiresIn } = require('../config/env');

function getJwtSecret() {
    if (!jwtSecret) {
        throw new Error('JWT_SECRET is not configured');
    }
    return jwtSecret;
}

function createAccessToken(user) {
    return jwt.sign(
        {
            sub: user.id,
            username: user.username
        },
        getJwtSecret(),
        {
            expiresIn: jwtExpiresIn
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

module.exports = {
    createAccessToken,
    verifyPassword,
    getJwtSecret
};