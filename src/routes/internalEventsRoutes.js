const express = require('express');
const { pool } = require('../config/db');

const router = express.Router();

function authenticateInternalEvent(req, res, next) {
  const expectedKey = process.env.INTERNAL_EVENT_KEY;

  // If no key configured, allow local development without blocking.
  if (!expectedKey) {
    return next();
  }

  const incomingKey = req.headers['x-internal-key'];
  if (incomingKey !== expectedKey) {
    return res.status(401).json({ message: 'Unauthorized internal event' });
  }

  return next();
}

router.use(authenticateInternalEvent);

router.post('/customer-message-created', async (req, res) => {
  const client = await pool.connect();

  try {
    const { eventId, conversationId, customerId, messageId, text, occurredAt } = req.body || {};

    if (!conversationId || !customerId || !messageId || !text) {
      return res.status(400).json({
        message: 'Missing required fields',
        required: ['conversationId', 'customerId', 'messageId', 'text']
      });
    }

    await client.query('BEGIN');

    if (eventId) {
      const eventInsert = await client.query(
        `INSERT INTO support_ingested_events (event_id) VALUES ($1)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [eventId]
      );

      if (eventInsert.rowCount === 0) {
        await client.query('COMMIT');
        return res.status(202).json({ ok: true, duplicate: true });
      }
    }

    await client.query(
      `INSERT INTO support_conversations (conversation_id, customer_id, last_message_preview, last_message_at, unread_count)
       VALUES ($1, $2, '', $3, 0)
       ON CONFLICT (conversation_id) DO NOTHING`,
      [conversationId, customerId, occurredAt || new Date().toISOString()]
    );

    const messageInsert = await client.query(
      `INSERT INTO support_messages (message_id, conversation_id, customer_id, sender, text, occurred_at)
       VALUES ($1, $2, $3, 'USER', $4, $5)
       ON CONFLICT (message_id) DO NOTHING
       RETURNING id`,
      [
        messageId,
        conversationId,
        customerId,
        text,
        occurredAt || new Date().toISOString()
      ]
    );

    if (messageInsert.rowCount > 0) {
      await client.query(
        `UPDATE support_conversations
         SET customer_id = $2,
             last_message_preview = $3,
             last_message_at = $4,
             unread_count = unread_count + 1,
             updated_at = NOW()
         WHERE conversation_id = $1`,
        [
          conversationId,
          customerId,
          text.slice(0, 250),
          occurredAt || new Date().toISOString()
        ]
      );
    }

    await client.query('COMMIT');

    return res.status(202).json({
      ok: true,
      duplicate: messageInsert.rowCount === 0,
      received: {
        eventId: eventId || null,
        conversationId,
        customerId,
        messageId,
        occurredAt: occurredAt || null
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: error.message || 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
