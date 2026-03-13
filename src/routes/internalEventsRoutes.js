const express = require('express');
const { pool } = require('../config/db');

const router = express.Router();

function isEnabled(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function authenticateInternalEvent(req, res, next) {
  const expectedKey = process.env.INTERNAL_EVENT_KEY;
  const allowInsecureInternalEvents =
    process.env.NODE_ENV !== 'production' &&
    isEnabled(process.env.ALLOW_INSECURE_INTERNAL_EVENTS);

  if (!expectedKey && allowInsecureInternalEvents) {
    return next();
  }

  if (!expectedKey) {
    return res.status(503).json({ message: 'Internal event ingestion is disabled' });
  }

  const incomingKey = req.headers['x-internal-key'];
  if (incomingKey !== expectedKey) {
    return res.status(401).json({ message: 'Unauthorized internal event' });
  }

  return next();
}

router.use(authenticateInternalEvent);

async function ingestEventId(client, eventId) {
  if (!eventId) {
    return true;
  }

  const eventInsert = await client.query(
    `INSERT INTO support_ingested_events (event_id) VALUES ($1)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [eventId]
  );

  return eventInsert.rowCount > 0;
}

async function recomputeConversationState(client, conversationId) {
  const latestMessageResult = await client.query(
    `SELECT text, occurred_at
     FROM support_messages
     WHERE conversation_id = $1
     ORDER BY id DESC
     LIMIT 1`,
    [conversationId]
  );

  if (latestMessageResult.rowCount === 0) {
    await client.query(
      `DELETE FROM support_conversations
       WHERE conversation_id = $1`,
      [conversationId]
    );
    return { conversationRemoved: true };
  }

  const latestMessage = latestMessageResult.rows[0];
  await client.query(
    `UPDATE support_conversations
     SET last_message_preview = $2,
         last_message_at = $3,
         updated_at = NOW()
     WHERE conversation_id = $1`,
    [conversationId, String(latestMessage.text || '').slice(0, 250), latestMessage.occurred_at]
  );

  return { conversationRemoved: false };
}

function normalizeCustomerMessageEvent(body) {
  const payload = body || {};
  const fallbackUserMail = typeof payload.userMail === 'string' ? payload.userMail.trim() : '';

  const normalizedConversationId =
    typeof payload.conversationId === 'string' && payload.conversationId.trim()
      ? payload.conversationId.trim()
      : fallbackUserMail;

  const normalizedCustomerId =
    typeof payload.customerId === 'string' && payload.customerId.trim()
      ? payload.customerId.trim()
      : fallbackUserMail;

  const normalizedMessageId =
    typeof payload.messageId === 'string' && payload.messageId.trim()
      ? payload.messageId.trim()
      : String(payload.messageId || '').trim();

  const normalizedText = typeof payload.text === 'string' ? payload.text : '';

  return {
    eventId: payload.eventId || null,
    occurredAt: payload.occurredAt || null,
    conversationId: normalizedConversationId,
    customerId: normalizedCustomerId,
    messageId: normalizedMessageId,
    text: normalizedText,
    usedUserMailFallback:
      Boolean(fallbackUserMail) && (!payload.conversationId || !payload.customerId)
  };
}

router.post('/customer-message-created', async (req, res) => {
  const client = await pool.connect();

  try {
    const normalized = normalizeCustomerMessageEvent(req.body);

    if (normalized.usedUserMailFallback) {
      console.warn('[internal-event] customer-message-created used userMail fallback', {
        eventId: normalized.eventId,
        conversationId: normalized.conversationId,
        customerId: normalized.customerId
      });
    }

    if (!normalized.conversationId || !normalized.customerId || !normalized.messageId || !normalized.text) {
      console.warn('[internal-event] customer-message-created missing required fields', {
        eventId: normalized.eventId,
        conversationId: normalized.conversationId || null,
        customerId: normalized.customerId || null,
        messageId: normalized.messageId || null,
        hasText: Boolean(normalized.text)
      });

      return res.status(400).json({
        message: 'Missing required fields',
        required: ['conversationId', 'customerId', 'messageId', 'text']
      });
    }

    const occurredAt = normalized.occurredAt || new Date().toISOString();

    await client.query('BEGIN');

    const shouldProcess = await ingestEventId(client, normalized.eventId);
    if (!shouldProcess) {
      await client.query('COMMIT');
      return res.status(202).json({ ok: true, duplicate: true });
    }

    await client.query(
      `INSERT INTO support_conversations (conversation_id, customer_id, last_message_preview, last_message_at, unread_count, is_cleared)
       VALUES ($1, $2, '', $3, 0, FALSE)
       ON CONFLICT (conversation_id) DO UPDATE
       SET customer_id = EXCLUDED.customer_id,
           is_cleared = FALSE,
           updated_at = NOW()`,
      [normalized.conversationId, normalized.customerId, occurredAt]
    );

    const messageInsert = await client.query(
      `INSERT INTO support_messages (message_id, conversation_id, customer_id, sender, text, occurred_at)
       VALUES ($1, $2, $3, 'USER', $4, $5)
       ON CONFLICT (message_id) DO NOTHING
       RETURNING id`,
      [
        normalized.messageId,
        normalized.conversationId,
        normalized.customerId,
        normalized.text,
        occurredAt
      ]
    );

    if (messageInsert.rowCount > 0) {
      await client.query(
        `UPDATE support_conversations
         SET customer_id = $2,
             last_message_preview = $3,
             last_message_at = $4,
             unread_count = unread_count + 1,
             is_cleared = FALSE,
             updated_at = NOW()
         WHERE conversation_id = $1`,
        [
          normalized.conversationId,
          normalized.customerId,
          normalized.text.slice(0, 250),
          occurredAt
        ]
      );
    }

    await client.query('COMMIT');

    return res.status(202).json({
      ok: true,
      duplicate: messageInsert.rowCount === 0,
      received: {
        eventId: normalized.eventId || null,
        conversationId: normalized.conversationId,
        customerId: normalized.customerId,
        messageId: normalized.messageId,
        occurredAt: normalized.occurredAt || null
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[internal-events.customer-message-created] Failed to process event', {
      message: error?.message
    });
    return res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
});

router.post('/support-message-edited', async (req, res) => {
  const client = await pool.connect();

  try {
    const { eventId, userMail, messageId, text } = req.body || {};

    if (!userMail || !messageId || !text) {
      return res.status(400).json({
        message: 'Missing required fields',
        required: ['userMail', 'messageId', 'text']
      });
    }

    await client.query('BEGIN');

    const shouldProcess = await ingestEventId(client, eventId);
    if (!shouldProcess) {
      await client.query('COMMIT');
      return res.status(202).json({ ok: true, duplicate: true });
    }

    const updateResult = await client.query(
      `UPDATE support_messages
       SET text = $3,
           edited_at = NOW()
       WHERE conversation_id = $1
         AND message_id = $2
       RETURNING id`,
      [userMail, messageId, text]
    );

    if (updateResult.rowCount === 0) {
      await client.query('COMMIT');
      return res.status(202).json({ ok: true, missing: true });
    }

    const conversationState = await recomputeConversationState(client, userMail);

    await client.query('COMMIT');

    return res.status(202).json({
      ok: true,
      updated: true,
      conversationRemoved: conversationState.conversationRemoved
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[internal-events.support-message-edited] Failed to process event', {
      message: error?.message
    });
    return res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
});

router.post('/support-message-deleted', async (req, res) => {
  const client = await pool.connect();

  try {
    const { eventId, userMail, messageId } = req.body || {};

    if (!userMail || !messageId) {
      return res.status(400).json({
        message: 'Missing required fields',
        required: ['userMail', 'messageId']
      });
    }

    await client.query('BEGIN');

    const shouldProcess = await ingestEventId(client, eventId);
    if (!shouldProcess) {
      await client.query('COMMIT');
      return res.status(202).json({ ok: true, duplicate: true });
    }

    const deleteResult = await client.query(
      `DELETE FROM support_messages
       WHERE conversation_id = $1
         AND message_id = $2
       RETURNING id`,
      [userMail, messageId]
    );

    if (deleteResult.rowCount === 0) {
      await client.query('COMMIT');
      return res.status(202).json({ ok: true, missing: true });
    }

    const conversationState = await recomputeConversationState(client, userMail);

    await client.query('COMMIT');

    return res.status(202).json({
      ok: true,
      deleted: true,
      conversationRemoved: conversationState.conversationRemoved
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[internal-events.support-message-deleted] Failed to process event', {
      message: error?.message
    });
    return res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
