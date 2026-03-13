const { pool } = require('../config/db');
const { createAccessToken, verifyPassword } = require('../services/authService');
const {
    registerLoginFailure,
    clearLoginFailures
} = require('../middlewares/loginRateLimitMiddleware');

function mapUserResponse(user) {
    const response = {
        id: user.id,
        username: user.username,
        created_at: user.created_at
    };

    if (typeof user.role === 'string' && user.role.trim()) {
        response.role = user.role.trim().toLowerCase();
    }

    return response;
}

async function login(req, res) {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                message: 'username and password are required'
            });
        }

        const userResult = await pool.query(
            'SELECT * FROM users WHERE username = $1 LIMIT 1',
            [username]
        );

        if (userResult.rowCount === 0) {
            registerLoginFailure(req, username);
            return res.status(401).json({
                message: 'Invalid username or password'
            });
        }

        const user = userResult.rows[0];
        const isPasswordValid = await verifyPassword(password, user.password_hash);

        if (!isPasswordValid) {
            registerLoginFailure(req, username);
            return res.status(401).json({
                message: 'Invalid username or password'
            });
        }

        const accessToken = createAccessToken(user);
        clearLoginFailures(req, username);

        return res.status(200).json({
            accessToken,
            tokenType: 'Bearer',
            user: mapUserResponse(user)
        });
    } catch (error) {
        console.error('[auth.login] Authentication failed', {
            message: error?.message
        });
        registerLoginFailure(req, req.body?.username);
        return res.status(500).json({
            message: 'Authentication failed'
        });
    }
}

async function me(req, res) {
    try {
        const userResult = await pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [req.auth.sub]);

        if (userResult.rowCount === 0) {
            return res.status(404).json({
                message: 'User not found'
            });
        }

        return res.status(200).json(mapUserResponse(userResult.rows[0]));
    } catch (error) {
        console.error('[auth.me] Failed to load authenticated user', {
            message: error?.message
        });
        return res.status(500).json({
            message: 'Internal server error'
        });
    }
}

module.exports = {
    login,
    me
};
