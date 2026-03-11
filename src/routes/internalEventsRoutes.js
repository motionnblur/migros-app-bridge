const express = require('express');

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
  try {
    const { eventId, conversationId, customerId, messageId, text, occurredAt } = req.body || {};

    if (!conversationId || !customerId || !messageId || !text) {
      return res.status(400).json({
        message: 'Missing required fields',
        required: ['conversationId', 'customerId', 'messageId', 'text']
      });
    }

    // TODO: Persist event data to support DB and publish to websocket consumers.
    return res.status(202).json({
      ok: true,
      received: {
        eventId: eventId || null,
        conversationId,
        customerId,
        messageId,
        occurredAt: occurredAt || null
      }
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

module.exports = router;
