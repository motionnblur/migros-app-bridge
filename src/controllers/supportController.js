const { pool } = require('../config/db');

const SPRING_SUPPORT_BASE_URL = process.env.SPRING_SUPPORT_BASE_URL || 'http://localhost:8080';
const SPRING_SUPPORT_INTERNAL_KEY = process.env.SPRING_SUPPORT_INTERNAL_KEY || '';

function mapConversation(row) {
    return {
        conversationId: row.conversation_id,
        customerId: row.customer_id,
        lastMessagePreview: row.last_message_preview || '',
        lastMessageAt: row.last_message_at,
        unreadCount: Number(row.unread_count || 0)
    };
}

function mapMessage(row) {
    return {
        id: Number(row.id),
        messageId: row.message_id,
        conversationId: row.conversation_id,
        customerId: row.customer_id,
        sender: row.sender,
        text: row.text,
        occurredAt: row.occurred_at
    };
}

async function listConversations(req, res) {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

        const result = await pool.query(
            `SELECT conversation_id, customer_id, last_message_preview, last_message_at, unread_count
             FROM support_conversations
             ORDER BY last_message_at DESC
             LIMIT $1`,
            [limit]
        );

        return res.status(200).json(result.rows.map(mapConversation));
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
}

async function getConversationMessages(req, res) {
    try {
        const { conversationId } = req.params;
        const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

        const conversationResult = await pool.query(
            `SELECT conversation_id, customer_id FROM support_conversations WHERE conversation_id = $1 LIMIT 1`,
            [conversationId]
        );

        if (conversationResult.rowCount === 0) {
            return res.status(404).json({ message: 'Conversation not found' });
        }

        const messageResult = await pool.query(
            `SELECT id, message_id, conversation_id, customer_id, sender, text, occurred_at
             FROM support_messages
             WHERE conversation_id = $1
             ORDER BY id DESC
             LIMIT $2`,
            [conversationId, limit]
        );

        await pool.query(
            `UPDATE support_conversations
             SET unread_count = 0, updated_at = NOW()
             WHERE conversation_id = $1`,
            [conversationId]
        );

        const messages = messageResult.rows.reverse().map(mapMessage);
        return res.status(200).json(messages);
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
}

async function sendAgentMessage(req, res) {
    const client = await pool.connect();

    try {
        const { conversationId } = req.params;
        const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';

        if (!text) {
            return res.status(400).json({ message: 'text is required' });
        }

        await client.query('BEGIN');

        const conversationResult = await client.query(
            `SELECT conversation_id, customer_id FROM support_conversations WHERE conversation_id = $1 LIMIT 1 FOR UPDATE`,
            [conversationId]
        );

        if (conversationResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Conversation not found' });
        }

        const conversation = conversationResult.rows[0];

        const insertMessageResult = await client.query(
            `INSERT INTO support_messages (message_id, conversation_id, customer_id, sender, text, occurred_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             RETURNING id, message_id, conversation_id, customer_id, sender, text, occurred_at`,
            [
                `agent-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
                conversation.conversation_id,
                conversation.customer_id,
                'AGENT',
                text
            ]
        );

        await client.query(
            `UPDATE support_conversations
             SET last_message_preview = $2,
                 last_message_at = NOW(),
                 unread_count = 0,
                 updated_at = NOW()
             WHERE conversation_id = $1`,
            [conversation.conversation_id, text.slice(0, 250)]
        );

        const headers = {
            'Content-Type': 'application/json'
        };

        if (SPRING_SUPPORT_INTERNAL_KEY) {
            headers['x-internal-key'] = SPRING_SUPPORT_INTERNAL_KEY;
        }

        const forwardResponse = await fetch(`${SPRING_SUPPORT_BASE_URL}/internal/support/agent-message`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                userMail: conversation.customer_id,
                message: text
            })
        });

        if (!forwardResponse.ok) {
            throw new Error(`Spring forwarding failed with status ${forwardResponse.status}`);
        }

        await client.query('COMMIT');
        return res.status(201).json(mapMessage(insertMessageResult.rows[0]));
    } catch (error) {
        await client.query('ROLLBACK');
        return res.status(502).json({ message: `Failed to deliver message: ${error.message}` });
    } finally {
        client.release();
    }
}

module.exports = {
    listConversations,
    getConversationMessages,
    sendAgentMessage
};

