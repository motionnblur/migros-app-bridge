const express = require('express');
const dotenv = require('dotenv');

dotenv.config();

const { checkDbConnection, pool } = require('./db');
const { authenticateToken, createAccessToken, verifyPassword } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
    res.json({
        message: 'Server is running',
        timestamp: new Date().toISOString()
    });
});

app.get('/health/db', async (req, res) => {
    try {
        await checkDbConnection();
        res.status(200).json({
            status: 'ok',
            database: 'connected'
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            database: 'disconnected',
            message: error.message
        });
    }
});

app.post('/auth/login', async (req, res) => {
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
});

app.get('/auth/me', authenticateToken, async (req, res) => {
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
});

app.get('/users', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, username, created_at FROM users ORDER BY id DESC'
        );
        res.status(200).json(result.rows);
    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
});

app.get('/users/:id', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, username, created_at FROM users WHERE id = $1',
            [req.params.id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({
                message: 'User not found'
            });
        }

        res.status(200).json(result.rows[0]);
    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});