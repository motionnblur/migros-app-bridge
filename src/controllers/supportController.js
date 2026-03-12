const { pool } = require('../config/db');

const SPRING_SUPPORT_BASE_URL = process.env.SPRING_SUPPORT_BASE_URL || 'http://localhost:8080';
const SPRING_SUPPORT_INTERNAL_KEY = process.env.SPRING_SUPPORT_INTERNAL_KEY || '';

async function forwardToSpring(path, body) {
    const headers = {
        'Content-Type': 'application/json'
    };

    if (SPRING_SUPPORT_INTERNAL_KEY) {
        headers['x-internal-key'] = SPRING_SUPPORT_INTERNAL_KEY;
    }

    const response = await fetch(`${SPRING_SUPPORT_BASE_URL}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Spring forwarding failed with status ${response.status}${detail ? `: ${detail}` : ''}`);
    }
}

function mapConversation(row) {
    return {
        conversationId: row.conversation_id,
        customerId: row.customer_id,
        lastMessagePreview: row.last_message_preview || '',
        lastMessageAt: row.last_message_at,
        unreadCount: Number(row.unread_count || 0),
        isBanned: Boolean(row.is_banned)
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
        occurredAt: row.occurred_at,
        canEdit: Boolean(row.can_edit),
        editedAt: row.edited_at || null
    };
}

async function listConversations(req, res) {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

        const result = await pool.query(
            `SELECT conversation_id, customer_id, last_message_preview, last_message_at, unread_count, is_banned
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
            `SELECT id, message_id, conversation_id, customer_id, sender, text, occurred_at, can_edit, edited_at
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
            `SELECT conversation_id, customer_id, is_banned
             FROM support_conversations WHERE conversation_id = $1 LIMIT 1 FOR UPDATE`,
            [conversationId]
        );

        if (conversationResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Conversation not found' });
        }

        const conversation = conversationResult.rows[0];
        if (conversation.is_banned) {
            await client.query('ROLLBACK');
            return res.status(403).json({ message: 'User is banned. Sending messages is disabled.' });
        }

        const externalMessageId = `agent-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

        const insertMessageResult = await client.query(
            `INSERT INTO support_messages (message_id, conversation_id, customer_id, sender, text, occurred_at, can_edit)
             VALUES ($1, $2, $3, $4, $5, NOW(), TRUE)
             RETURNING id, message_id, conversation_id, customer_id, sender, text, occurred_at, can_edit, edited_at`,
            [
                externalMessageId,
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

        await forwardToSpring('/internal/support/agent-message', {
            userMail: conversation.customer_id,
            message: text,
            externalMessageId
        });

        await client.query('COMMIT');
        return res.status(201).json(mapMessage(insertMessageResult.rows[0]));
    } catch (error) {
        await client.query('ROLLBACK');
        const isForwardingError = typeof error?.message === 'string' && error.message.startsWith('Spring forwarding failed');
        return res.status(isForwardingError ? 502 : 500).json({
            message: isForwardingError ? `Failed to deliver message: ${error.message}` : error.message
        });
    } finally {
        client.release();
    }
}
async function editAgentMessage(req, res) {
    const client = await pool.connect();

    try {
        const { conversationId, messageId } = req.params;
        const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';

        if (!conversationId || !messageId) {
            return res.status(400).json({ message: 'conversationId and messageId are required' });
        }

        if (!text) {
            return res.status(400).json({ message: 'text is required' });
        }

        await client.query('BEGIN');

        const messageResult = await client.query(
            `SELECT id, message_id, conversation_id, customer_id, sender, text, occurred_at, can_edit, edited_at
             FROM support_messages
             WHERE conversation_id = $1 AND message_id = $2
             LIMIT 1
             FOR UPDATE`,
            [conversationId, messageId]
        );

        if (messageResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Message not found' });
        }

        const message = messageResult.rows[0];

        if (message.sender !== 'AGENT') {
            await client.query('ROLLBACK');
            return res.status(403).json({ message: 'Only support messages can be edited' });
        }

        if (!message.can_edit) {
            await client.query('ROLLBACK');
            return res.status(409).json({ message: 'This message cannot be edited' });
        }

        const updateResult = await client.query(
            `UPDATE support_messages
             SET text = $2,
                 edited_at = NOW()
             WHERE id = $1
             RETURNING id, message_id, conversation_id, customer_id, sender, text, occurred_at, can_edit, edited_at`,
            [message.id, text]
        );

        await forwardToSpring('/internal/support/edit-agent-message', {
            userMail: message.customer_id,
            externalMessageId: message.message_id,
            message: text
        });

        const latestMessageResult = await client.query(
            `SELECT id
             FROM support_messages
             WHERE conversation_id = $1
             ORDER BY id DESC
             LIMIT 1`,
            [conversationId]
        );

        if (
            latestMessageResult.rowCount > 0 &&
            Number(latestMessageResult.rows[0].id) === Number(message.id)
        ) {
            await client.query(
                `UPDATE support_conversations
                 SET last_message_preview = $2,
                     updated_at = NOW()
                 WHERE conversation_id = $1`,
                [conversationId, text.slice(0, 250)]
            );
        }

        await client.query('COMMIT');
        return res.status(200).json(mapMessage(updateResult.rows[0]));
    } catch (error) {
        await client.query('ROLLBACK');
        const isForwardingError = typeof error?.message === 'string' && error.message.startsWith('Spring forwarding failed');
        return res.status(isForwardingError ? 502 : 500).json({
            message: isForwardingError ? `Failed to edit message: ${error.message}` : error.message
        });
    } finally {
        client.release();
    }
}
async function banConversationUser(req, res) {
    const client = await pool.connect();

    try {
      const { conversationId } = req.params;
      await client.query('BEGIN');

      const conversationResult = await client.query(
        `SELECT conversation_id, customer_id, is_banned
         FROM support_conversations WHERE conversation_id = $1 LIMIT 1 FOR UPDATE`,
        [conversationId]
      );

      if (conversationResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Conversation not found' });
      }

      const conversation = conversationResult.rows[0];
      if (conversation.is_banned) {
        await client.query('ROLLBACK');
        return res.status(200).json({ ok: true, alreadyBanned: true });
      }

      await forwardToSpring('/internal/support/ban-user', {
        userMail: conversation.customer_id
      });

      await client.query(
        `UPDATE support_conversations SET is_banned = TRUE, updated_at = NOW() WHERE conversation_id = $1`,
        [conversationId]
      );

      await client.query('COMMIT');
      return res.status(200).json({ ok: true, conversationId, isBanned: true });
    } catch (error) {
      await client.query('ROLLBACK');
      const isForwardingError = typeof error?.message === 'string' && error.message.startsWith('Spring forwarding failed');
      return res.status(isForwardingError ? 502 : 500).json({
        message: isForwardingError ? `Failed to ban user: ${error.message}` : error.message
      });
    } finally {
      client.release();
    }
}

async function unbanConversationUser(req, res) {
    const client = await pool.connect();

    try {
      const { conversationId } = req.params;
      await client.query('BEGIN');

      const conversationResult = await client.query(
        `SELECT conversation_id, customer_id, is_banned
         FROM support_conversations WHERE conversation_id = $1 LIMIT 1 FOR UPDATE`,
        [conversationId]
      );

      if (conversationResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Conversation not found' });
      }

      const conversation = conversationResult.rows[0];
      if (!conversation.is_banned) {
        await client.query('ROLLBACK');
        return res.status(200).json({ ok: true, alreadyUnbanned: true, isBanned: false });
      }

      await forwardToSpring('/internal/support/unban-user', {
        userMail: conversation.customer_id
      });

      await client.query(
        `UPDATE support_conversations SET is_banned = FALSE, updated_at = NOW() WHERE conversation_id = $1`,
        [conversationId]
      );

      await client.query('COMMIT');
      return res.status(200).json({ ok: true, conversationId, isBanned: false });
    } catch (error) {
      await client.query('ROLLBACK');
      const isForwardingError = typeof error?.message === 'string' && error.message.startsWith('Spring forwarding failed');
      return res.status(isForwardingError ? 502 : 500).json({
        message: isForwardingError ? `Failed to unban user: ${error.message}` : error.message
      });
    } finally {
      client.release();
    }
}

async function clearConversation(req, res) {
    const client = await pool.connect();

    try {
      const { conversationId } = req.params;
      await client.query('BEGIN');

      const conversationResult = await client.query(
        `SELECT conversation_id, customer_id
         FROM support_conversations WHERE conversation_id = $1 LIMIT 1 FOR UPDATE`,
        [conversationId]
      );

      if (conversationResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Conversation not found' });
      }

      const conversation = conversationResult.rows[0];

      await forwardToSpring('/internal/support/clear-chat', {
        userMail: conversation.customer_id
      });

      await client.query(`DELETE FROM support_messages WHERE conversation_id = $1`, [conversationId]);
      await client.query(`DELETE FROM support_conversations WHERE conversation_id = $1`, [conversationId]);

      await client.query('COMMIT');
      return res.status(200).json({ ok: true, conversationId, removed: true });
    } catch (error) {
      await client.query('ROLLBACK');
      const isForwardingError = typeof error?.message === 'string' && error.message.startsWith('Spring forwarding failed');
      return res.status(isForwardingError ? 502 : 500).json({
        message: isForwardingError ? `Failed to clear chat: ${error.message}` : error.message
      });
    } finally {
      client.release();
    }
}

module.exports = {
    listConversations,
    getConversationMessages,
    sendAgentMessage,
    editAgentMessage,
    banConversationUser,
    unbanConversationUser,
    clearConversation
};
