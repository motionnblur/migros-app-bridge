const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'migros_support_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres'
});

async function checkDbConnection() {
    const result = await pool.query('SELECT 1 AS ok');
    return result.rows[0];
}

async function initializeSupportSchema() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS support_conversations (
            conversation_id TEXT PRIMARY KEY,
            customer_id TEXT NOT NULL,
            last_message_preview TEXT,
            last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            unread_count INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS support_messages (
            id BIGSERIAL PRIMARY KEY,
            message_id TEXT UNIQUE,
            conversation_id TEXT NOT NULL REFERENCES support_conversations(conversation_id) ON DELETE CASCADE,
            customer_id TEXT NOT NULL,
            sender TEXT NOT NULL,
            text TEXT NOT NULL,
            occurred_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS support_ingested_events (
            event_id TEXT PRIMARY KEY,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_support_messages_conversation_id_id
        ON support_messages(conversation_id, id DESC);
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_support_conversations_last_message_at
        ON support_conversations(last_message_at DESC);
    `);
}

module.exports = {
    pool,
    checkDbConnection,
    initializeSupportSchema
};
