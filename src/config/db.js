require('./env');

const { Pool } = require('pg');

function isEnabled(value) {
    return String(value || '').trim().toLowerCase() === 'true';
}

const allowInsecureDbDefaults =
    process.env.NODE_ENV !== 'production' &&
    isEnabled(process.env.ALLOW_INSECURE_DB_DEFAULTS);

const dbUser = process.env.DB_USER || (allowInsecureDbDefaults ? 'postgres' : '');
const dbPassword = process.env.DB_PASSWORD || (allowInsecureDbDefaults ? 'postgres' : '');

if (!dbUser || !dbPassword) {
    throw new Error('DB_USER and DB_PASSWORD must be configured');
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
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
            is_banned BOOLEAN NOT NULL DEFAULT FALSE,
            is_cleared BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await pool.query(`
        ALTER TABLE support_conversations
        ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    await pool.query(`
        ALTER TABLE support_conversations
        ADD COLUMN IF NOT EXISTS is_cleared BOOLEAN NOT NULL DEFAULT FALSE;
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
            can_edit BOOLEAN NOT NULL DEFAULT FALSE,
            edited_at TIMESTAMPTZ NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await pool.query(`
        ALTER TABLE support_messages
        ADD COLUMN IF NOT EXISTS can_edit BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    await pool.query(`
        ALTER TABLE support_messages
        ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ NULL;
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
