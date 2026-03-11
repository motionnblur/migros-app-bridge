const express = require('express');
const { authenticateToken } = require('../middlewares/authMiddleware');
const {
  listConversations,
  getConversationMessages,
  sendAgentMessage
} = require('../controllers/supportController');

const router = express.Router();

router.use(authenticateToken);

router.get('/conversations', listConversations);
router.get('/conversations/:conversationId/messages', getConversationMessages);
router.post('/conversations/:conversationId/messages', sendAgentMessage);

module.exports = router;
