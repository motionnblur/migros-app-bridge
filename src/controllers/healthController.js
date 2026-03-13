const { checkDbConnection } = require('../config/db');

async function getApiHealth(req, res) {
    return res.status(200).json({
        message: 'Server is running',
        timestamp: new Date().toISOString()
    });
}

async function getDbHealth(req, res) {
    try {
        await checkDbConnection();
        return res.status(200).json({
            status: 'ok',
            database: 'connected'
        });
    } catch (error) {
        console.error('[health.db] Database health check failed', {
            message: error?.message
        });
        return res.status(500).json({
            status: 'error',
            database: 'disconnected',
            message: 'Database health check failed'
        });
    }
}

module.exports = {
    getApiHealth,
    getDbHealth
};
