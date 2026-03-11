const dotenv = require('dotenv');

dotenv.config();

module.exports = {
    port: Number(process.env.PORT) || 3000,
    jwtSecret: process.env.JWT_SECRET,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h'
};