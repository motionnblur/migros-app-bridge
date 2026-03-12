const express = require('express');
const { authenticateToken } = require('../middlewares/authMiddleware');
const {
  listCustomers,
  listConversations,
  listConversationStatuses,
  getConversationMessages,
  sendAgentMessage,
  editAgentMessage,
  deleteAgentMessage,
  banConversationUser,
  unbanConversationUser,
  clearConversation
} = require('../controllers/supportController');

const router = express.Router();

router.use(authenticateToken);

router.get('/customers', listCustomers);
router.get('/conversations', listConversations);
router.get('/conversations/status', listConversationStatuses);
router.get('/conversations/:conversationId/messages', getConversationMessages);
router.post('/conversations/:conversationId/messages', sendAgentMessage);
router.patch('/conversations/:conversationId/messages/:messageId', editAgentMessage);
router.delete('/conversations/:conversationId/messages/:messageId', deleteAgentMessage);
router.post('/conversations/:conversationId/ban', banConversationUser);
router.post('/conversations/:conversationId/unban', unbanConversationUser);
router.post('/conversations/:conversationId/clear', clearConversation);

module.exports = router;
