import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import { deleteFromCloudinary } from "../config/cloudinary.js";

// ================================
// GET ALL CHATS FOR USER
// GET /api/chats
// ================================
export const getChats = async (req, res) => {
  try {
    const userId = req.user._id;

    const chats = await Chat.getUserChats(userId);

    const formattedChats = chats.map((chat) => {
      const otherParticipant = chat.participants.find(
        (p) => p._id.toString() !== userId.toString()
      );

      const unread = chat.unreadCount.find(
        (u) => u.user?.toString() === userId.toString()
      );

      return {
        _id: chat._id,
        participant: otherParticipant,
        lastMessage: chat.lastMessage,
        unreadCount: unread?.count || 0,
        isPinned: chat.pinnedBy.some(
          (id) => id.toString() === userId.toString()
        ),
        isArchived: chat.archivedBy.some(
          (id) => id.toString() === userId.toString()
        ),
        isMuted: chat.mutedBy.some(
          (m) => m.user?.toString() === userId.toString()
        ),
        updatedAt: chat.updatedAt,
      };
    });

    return res.status(200).json({
      success: true,
      count: formattedChats.length,
      chats: formattedChats,
    });
  } catch (error) {
    console.error("Get chats error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error fetching chats.",
    });
  }
};

// ================================
// GET OR CREATE CHAT
// POST /api/chats
// FIX: Added detailed logging + isActive check was rejecting valid users
// ================================
export const getOrCreateChat = async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const { userId } = req.body;

    // ── Log exactly what we received ──────────────
    console.log(`[getOrCreateChat] currentUser=${currentUserId} targetUserId=${userId}`);

    if (!userId) {
      console.log("[getOrCreateChat] ERROR: userId missing from request body");
      return res.status(400).json({
        success: false,
        message: "userId is required.",
      });
    }

    if (currentUserId.toString() === userId.toString()) {
      return res.status(400).json({
        success: false,
        message: "Cannot create chat with yourself.",
      });
    }

    // ── Find other user ────────────────────────────
    // FIX: removed isActive check — was causing 404 for valid users
    // whose isActive flag wasn't set during registration
    const otherUser = await User.findById(userId).select(
      "name phoneNumber profilePic isOnline lastSeen about isActive"
    );

    console.log(`[getOrCreateChat] otherUser found:`, otherUser ? {
      id: otherUser._id,
      name: otherUser.name,
      phone: otherUser.phoneNumber,
      isActive: otherUser.isActive,
    } : "NOT FOUND");

    if (!otherUser) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    // FIX: Only block if isActive is explicitly false (not undefined/null)
    // New users might not have isActive set yet
    if (otherUser.isActive === false) {
      return res.status(404).json({
        success: false,
        message: "User account is deactivated.",
      });
    }

    // ── Find or create chat ────────────────────────
    let chat = await Chat.findBetween(currentUserId, userId);
    console.log(`[getOrCreateChat] existing chat:`, chat ? chat._id : "none — will create");

    if (!chat) {
      chat = await Chat.create({
        participants: [currentUserId, userId],
        unreadCount: [
          { user: currentUserId, count: 0 },
          { user: userId, count: 0 },
        ],
      });
      console.log(`[getOrCreateChat] Created new chat: ${chat._id}`);
    }

    // Remove from deletedFor if previously deleted
    if (chat.deletedFor.some((id) => id.toString() === currentUserId.toString())) {
      chat.deletedFor = chat.deletedFor.filter(
        (id) => id.toString() !== currentUserId.toString()
      );
      await chat.save();
    }

    console.log(`[getOrCreateChat] SUCCESS chatId=${chat._id}`);

    return res.status(200).json({
      success: true,
      chat: {
        _id: chat._id,
        participant: otherUser,
        lastMessage: chat.lastMessage,
        unreadCount: 0,
        isPinned: false,
        isArchived: false,
        isMuted: false,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
      },
    });
  } catch (error) {
    console.error("Get or create chat error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error creating chat.",
    });
  }
};

// ================================
// GET MESSAGES IN CHAT
// GET /api/chats/:chatId/messages
// ================================
export const getMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    const chat = await Chat.findOne({
      _id: chatId,
      participants: userId,
    });

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: "Chat not found.",
      });
    }

    const messages = await Message.getChatMessages(chatId, userId, page, limit);

    await Message.markAsSeen(chatId, userId);
    await chat.resetUnread(userId);

    return res.status(200).json({
      success: true,
      page,
      count: messages.length,
      messages: messages.reverse(),
    });
  } catch (error) {
    console.error("Get messages error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error fetching messages.",
    });
  }
};

// ================================
// SEND TEXT MESSAGE
// POST /api/chats/:chatId/messages
// ================================
export const sendMessage = async (req, res) => {
  try {
    const { chatId } = req.params;
    const senderId = req.user._id;
    const { text, receiverId, replyTo } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Message text is required.",
      });
    }

    if (!receiverId) {
      return res.status(400).json({
        success: false,
        message: "receiverId is required.",
      });
    }

    const chat = await Chat.findOne({
      _id: chatId,
      participants: { $all: [senderId, receiverId] },
    });

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: "Chat not found.",
      });
    }

    const message = await Message.create({
      chatId,
      sender: senderId,
      receiver: receiverId,
      text: text.trim(),
      messageType: "text",
      replyTo: replyTo || null,
      status: "sent",
    });

    await message.populate("sender", "name profilePic");
    if (replyTo) {
      await message.populate("replyTo", "text mediaUrl messageType sender");
    }

    chat.lastMessage = message._id;
    chat.updatedAt = new Date();
    chat.deletedFor = [];
    await chat.save();

    await chat.incrementUnread(receiverId);

    return res.status(201).json({
      success: true,
      message,
    });
  } catch (error) {
    console.error("Send message error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error sending message.",
    });
  }
};

// ================================
// SEND MEDIA MESSAGE
// POST /api/chats/:chatId/messages/media
// ================================
export const sendMediaMessage = async (req, res) => {
  try {
    const { chatId } = req.params;
    const senderId = req.user._id;
    const { receiverId, caption, replyTo } = req.body;

    if (!req.mediaInfo) {
      return res.status(400).json({
        success: false,
        message: "No media file uploaded.",
      });
    }

    const chat = await Chat.findOne({
      _id: chatId,
      participants: { $all: [senderId, receiverId] },
    });

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: "Chat not found.",
      });
    }

    const message = await Message.create({
      chatId,
      sender: senderId,
      receiver: receiverId,
      text: caption?.trim() || "",
      mediaUrl: req.mediaInfo.mediaUrl,
      mediaPublicId: req.mediaInfo.mediaPublicId,
      mediaSize: req.mediaInfo.mediaSize,
      messageType: req.mediaInfo.mediaType,
      replyTo: replyTo || null,
      status: "sent",
    });

    await message.populate("sender", "name profilePic");

    chat.lastMessage = message._id;
    chat.updatedAt = new Date();
    chat.deletedFor = [];
    await chat.save();

    await chat.incrementUnread(receiverId);

    return res.status(201).json({
      success: true,
      message,
    });
  } catch (error) {
    console.error("Send media message error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error sending media message.",
    });
  }
};

// ================================
// DELETE MESSAGE
// DELETE /api/chats/messages/:messageId
// ================================
export const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { deleteFor } = req.body;
    const userId = req.user._id;

    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found.",
      });
    }

    if (
      deleteFor === "everyone" &&
      message.sender.toString() !== userId.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "Only sender can delete for everyone.",
      });
    }

    if (deleteFor === "everyone") {
      if (message.mediaPublicId) {
        await deleteFromCloudinary(message.mediaPublicId, message.messageType);
      }
      message.isDeletedForEveryone = true;
      message.text = "";
      message.mediaUrl = "";
      await message.save();
    } else {
      message.deletedFor.push(userId);
      await message.save();
    }

    return res.status(200).json({
      success: true,
      message: "Message deleted successfully.",
      deleteFor,
    });
  } catch (error) {
    console.error("Delete message error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error deleting message.",
    });
  }
};

// ================================
// EDIT MESSAGE
// PUT /api/chats/messages/:messageId
// ================================
export const editMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { text } = req.body;
    const userId = req.user._id;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ success: false, message: "Text is required." });
    }

    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({ success: false, message: "Message not found." });
    }

    if (message.sender.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: "You can only edit your own messages.",
      });
    }

    if (message.messageType !== "text") {
      return res.status(400).json({
        success: false,
        message: "Only text messages can be edited.",
      });
    }

    message.text = text.trim();
    message.isEdited = true;
    message.editedAt = new Date();
    await message.save();

    return res.status(200).json({ success: true, message });
  } catch (error) {
    console.error("Edit message error:", error.message);
    return res.status(500).json({ success: false, message: "Server error editing message." });
  }
};

// ================================
// STAR / UNSTAR MESSAGE
// PUT /api/chats/messages/:messageId/star
// ================================
export const toggleStarMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ success: false, message: "Message not found." });
    }

    const isStarred = message.starredBy.some(
      (id) => id.toString() === userId.toString()
    );

    if (isStarred) {
      message.starredBy = message.starredBy.filter(
        (id) => id.toString() !== userId.toString()
      );
    } else {
      message.starredBy.push(userId);
    }

    await message.save();

    return res.status(200).json({
      success: true,
      isStarred: !isStarred,
      message: isStarred ? "Message unstarred." : "Message starred.",
    });
  } catch (error) {
    console.error("Star message error:", error.message);
    return res.status(500).json({ success: false, message: "Server error starring message." });
  }
};

// ================================
// ADD REACTION
// POST /api/chats/messages/:messageId/reaction
// ================================
export const addReaction = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body;
    const userId = req.user._id;

    if (!emoji) {
      return res.status(400).json({ success: false, message: "Emoji is required." });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ success: false, message: "Message not found." });
    }

    message.reactions = message.reactions.filter(
      (r) => r.user.toString() !== userId.toString()
    );
    message.reactions.push({ user: userId, emoji });
    await message.save();

    return res.status(200).json({
      success: true,
      message: "Reaction added.",
      reactions: message.reactions,
    });
  } catch (error) {
    console.error("Add reaction error:", error.message);
    return res.status(500).json({ success: false, message: "Server error adding reaction." });
  }
};

// ================================
// CLEAR CHAT
// DELETE /api/chats/:chatId/clear
// ================================
export const clearChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user._id;

    const chat = await Chat.findOne({ _id: chatId, participants: userId });
    if (!chat) {
      return res.status(404).json({ success: false, message: "Chat not found." });
    }

    await Message.updateMany({ chatId }, { $addToSet: { deletedFor: userId } });

    return res.status(200).json({ success: true, message: "Chat cleared successfully." });
  } catch (error) {
    console.error("Clear chat error:", error.message);
    return res.status(500).json({ success: false, message: "Server error clearing chat." });
  }
};

// ================================
// ARCHIVE / UNARCHIVE
// PUT /api/chats/:chatId/archive
// ================================
export const toggleArchiveChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user._id;

    const chat = await Chat.findOne({ _id: chatId, participants: userId });
    if (!chat) {
      return res.status(404).json({ success: false, message: "Chat not found." });
    }

    const isArchived = chat.archivedBy.some(
      (id) => id.toString() === userId.toString()
    );

    if (isArchived) {
      chat.archivedBy = chat.archivedBy.filter(
        (id) => id.toString() !== userId.toString()
      );
    } else {
      chat.archivedBy.push(userId);
    }

    await chat.save();

    return res.status(200).json({
      success: true,
      isArchived: !isArchived,
      message: isArchived ? "Chat unarchived." : "Chat archived.",
    });
  } catch (error) {
    console.error("Archive chat error:", error.message);
    return res.status(500).json({ success: false, message: "Server error archiving chat." });
  }
};

// ================================
// PIN / UNPIN
// PUT /api/chats/:chatId/pin
// ================================
export const togglePinChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user._id;

    const chat = await Chat.findOne({ _id: chatId, participants: userId });
    if (!chat) {
      return res.status(404).json({ success: false, message: "Chat not found." });
    }

    const userPinnedChats = await Chat.countDocuments({
      participants: userId,
      pinnedBy: userId,
    });

    const isPinned = chat.pinnedBy.some(
      (id) => id.toString() === userId.toString()
    );

    if (!isPinned && userPinnedChats >= 3) {
      return res.status(400).json({
        success: false,
        message: "You can only pin up to 3 chats.",
      });
    }

    if (isPinned) {
      chat.pinnedBy = chat.pinnedBy.filter(
        (id) => id.toString() !== userId.toString()
      );
    } else {
      chat.pinnedBy.push(userId);
    }

    await chat.save();

    return res.status(200).json({
      success: true,
      isPinned: !isPinned,
      message: isPinned ? "Chat unpinned." : "Chat pinned.",
    });
  } catch (error) {
    console.error("Pin chat error:", error.message);
    return res.status(500).json({ success: false, message: "Server error pinning chat." });
  }
};

// ================================
// MUTE / UNMUTE
// PUT /api/chats/:chatId/mute
// ================================
export const toggleMuteChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { muteDuration } = req.body;
    const userId = req.user._id;

    const chat = await Chat.findOne({ _id: chatId, participants: userId });
    if (!chat) {
      return res.status(404).json({ success: false, message: "Chat not found." });
    }

    const muteIndex = chat.mutedBy.findIndex(
      (m) => m.user?.toString() === userId.toString()
    );

    if (muteIndex > -1) {
      chat.mutedBy.splice(muteIndex, 1);
      await chat.save();
      return res.status(200).json({ success: true, isMuted: false, message: "Chat unmuted." });
    }

    const mutedUntil =
      muteDuration > 0
        ? new Date(Date.now() + muteDuration * 60 * 60 * 1000)
        : null;

    chat.mutedBy.push({ user: userId, mutedUntil });
    await chat.save();

    return res.status(200).json({
      success: true,
      isMuted: true,
      mutedUntil,
      message: "Chat muted.",
    });
  } catch (error) {
    console.error("Mute chat error:", error.message);
    return res.status(500).json({ success: false, message: "Server error muting chat." });
  }
};

// ================================
// GET STARRED MESSAGES
// GET /api/chats/messages/starred
// ================================
export const getStarredMessages = async (req, res) => {
  try {
    const userId = req.user._id;

    const messages = await Message.find({
      starredBy: userId,
      isDeletedForEveryone: false,
      deletedFor: { $ne: userId },
    })
      .populate("sender", "name profilePic")
      .populate("chatId", "participants")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: messages.length,
      messages,
    });
  } catch (error) {
    console.error("Get starred messages error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error fetching starred messages.",
    });
  }
};