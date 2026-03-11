const { pool } = require('../config/db');
const { createAccessToken, verifyPassword } = require('../services/authService');

async function login(req, res) {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                message: 'username and password are required'
            });
        }

        const userResult = await pool.query(
            'SELECT id, username, password_hash, created_at FROM users WHERE username = $1 LIMIT 1',
            [username]
        );

        if (userResult.rowCount === 0) {
            return res.status(401).json({
                message: 'Invalid username or password'
            });
        }

        const user = userResult.rows[0];
        const isPasswordValid = await verifyPassword(password, user.password_hash);

        if (!isPasswordValid) {
            return res.status(401).json({
                message: 'Invalid username or password'
            });
        }

        const accessToken = createAccessToken(user);

        return res.status(200).json({
            accessToken,
            tokenType: 'Bearer',
            user: {
                id: user.id,
                username: user.username,
                created_at: user.created_at
            }
        });
    } catch (error) {
        return res.status(500).json({
            message: error.message
        });
    }
}

async function me(req, res) {
    try {
        const userResult = await pool.query(
            'SELECT id, username, created_at FROM users WHERE id = $1 LIMIT 1',
            [req.auth.sub]
        );

        if (userResult.rowCount === 0) {
            return res.status(404).json({
                message: 'User not found'
            });
        }

        return res.status(200).json(userResult.rows[0]);
    } catch (error) {
        return res.status(500).json({
            message: error.message
        });
    }
}

module.exports = {
    login,
    me
};