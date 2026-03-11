const express = require('express');
const dotenv = require('dotenv');

dotenv.config();

const {checkDbConnection, pool} = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

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