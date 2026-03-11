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
        return res.status(500).json({
            status: 'error',
            database: 'disconnected',
            message: error.message
        });
    }
}

module.exports = {
    getApiHealth,
    getDbHealth
};