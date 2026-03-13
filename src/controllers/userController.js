const { pool } = require('../config/db');

async function listUsers(req, res) {
    try {
        const result = await pool.query(
            'SELECT id, username, created_at FROM users ORDER BY id DESC'
        );
        return res.status(200).json(result.rows);
    } catch (error) {
        console.error('[users.listUsers] Failed to list users', {
            message: error?.message
        });
        return res.status(500).json({
            message: 'Internal server error'
        });
    }
}

async function getUserById(req, res) {
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

        return res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('[users.getUserById] Failed to load user', {
            message: error?.message,
            userId: req.params?.id
        });
        return res.status(500).json({
            message: 'Internal server error'
        });
    }
}

module.exports = {
    listUsers,
    getUserById
};
