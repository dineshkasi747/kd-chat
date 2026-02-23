import mongoose from "mongoose";

const chatSchema = new mongoose.Schema(
  {
    // ================================
    // PARTICIPANTS
    // ================================
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],

    // ================================
    // LAST MESSAGE PREVIEW
    // (shown in chat list)
    // ================================
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },

    // ================================
    // UNREAD COUNT PER USER
    // ================================
    unreadCount: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        count: {
          type: Number,
          default: 0,
        },
      },
    ],

    // ================================
    // DELETED FOR SPECIFIC USERS
    // (like WhatsApp clear chat)
    // ================================
    deletedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // ================================
    // MUTED BY SPECIFIC USERS
    // ================================
    mutedBy: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        mutedUntil: {
          type: Date,
          default: null, // null = muted forever
        },
      },
    ],

    // ================================
    // ARCHIVED BY SPECIFIC USERS
    // ================================
    archivedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // ================================
    // PINNED BY SPECIFIC USERS
    // ================================
    pinnedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  {
    timestamps: true,
  }
);

// ================================
// INDEXES
// ================================
chatSchema.index({ participants: 1 });
chatSchema.index({ updatedAt: -1 });

// ================================
// STATIC — FIND EXISTING CHAT
// between two users
// ================================
chatSchema.statics.findBetween = function (userId1, userId2) {
  return this.findOne({
    participants: { $all: [userId1, userId2] },
  });
};

// ================================
// STATIC — GET ALL CHATS FOR USER
// sorted by latest message
// ================================
chatSchema.statics.getUserChats = function (userId) {
  return this.find({
    participants: userId,
    deletedFor: { $ne: userId },
  })
    .populate("participants", "name phoneNumber profilePic isOnline lastSeen")
    .populate({
      path: "lastMessage",
      populate: {
        path: "sender",
        select: "name",
      },
    })
    .sort({ updatedAt: -1 });
};

// ================================
// METHOD — INCREMENT UNREAD COUNT
// ================================
chatSchema.methods.incrementUnread = function (userId) {
  const entry = this.unreadCount.find(
    (u) => u.user.toString() === userId.toString()
  );
  if (entry) {
    entry.count += 1;
  } else {
    this.unreadCount.push({ user: userId, count: 1 });
  }
  return this.save();
};

// ================================
// METHOD — RESET UNREAD COUNT
// ================================
chatSchema.methods.resetUnread = function (userId) {
  const entry = this.unreadCount.find(
    (u) => u.user.toString() === userId.toString()
  );
  if (entry) {
    entry.count = 0;
  }
  return this.save();
};

const Chat = mongoose.model("Chat", chatSchema);

export default Chat;