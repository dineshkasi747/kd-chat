import express from "express";
import {
  getChats,
  getOrCreateChat,
  getMessages,
  sendMessage,
  sendMediaMessage,
  deleteMessage,
  editMessage,
  toggleStarMessage,
  addReaction,
  clearChat,
  toggleArchiveChat,
  togglePinChat,
  toggleMuteChat,
  getStarredMessages,
} from "../controllers/chatController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  handleChatMediaUpload,
  attachMediaInfo,
} from "../middleware/uploadMiddleware.js";

const router = express.Router();

// All routes protected
router.use(protect);

// Chat routes
router.get("/", getChats);
router.post("/", getOrCreateChat);

// Starred messages
router.get("/messages/starred", getStarredMessages);

// Message routes
router.get("/:chatId/messages", getMessages);
router.post("/:chatId/messages", sendMessage);
router.post(
  "/:chatId/messages/media",
  handleChatMediaUpload,
  attachMediaInfo,
  sendMediaMessage
);

// Message actions
router.put("/messages/:messageId", editMessage);
router.delete("/messages/:messageId", deleteMessage);
router.put("/messages/:messageId/star", toggleStarMessage);
router.post("/messages/:messageId/reaction", addReaction);

// Chat actions
router.delete("/:chatId/clear", clearChat);
router.put("/:chatId/archive", toggleArchiveChat);
router.put("/:chatId/pin", togglePinChat);
router.put("/:chatId/mute", toggleMuteChat);

export default router;