import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    // ================================
    // CHAT REFERENCE
    // ================================
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
    },

    // ================================
    // SENDER & RECEIVER
    // ================================
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // ================================
    // MESSAGE CONTENT
    // ================================
    text: {
      type: String,
      trim: true,
      default: "",
      maxlength: [65536, "Message too long"],
    },
    mediaUrl: {
      type: String,
      default: "",
    },
    mediaPublicId: {
      type: String,
      default: "",
    },
    mediaSize: {
      type: Number,
      default: 0,
    },
    mediaDuration: {
      type: Number, // in seconds (for audio/video)
      default: 0,
    },
    mediaThumbnail: {
      type: String, // thumbnail URL for videos
      default: "",
    },

    // ================================
    // MESSAGE TYPE
    // ================================
    messageType: {
      type: String,
      enum: ["text", "image", "video", "audio", "document", "location"],
      default: "text",
    },

    // ================================
    // LOCATION (if messageType === location)
    // ================================
    location: {
      latitude: { type: Number },
      longitude: { type: Number },
      address: { type: String, default: "" },
    },

    // ================================
    // REPLY TO MESSAGE
    // (quoted messages like WhatsApp)
    // ================================
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },

    // ================================
    // DELIVERY STATUS
    // ================================
    status: {
      type: String,
      enum: ["sent", "delivered", "seen"],
      default: "sent",
    },

    // ================================
    // SEEN INFO
    // ================================
    seenAt: {
      type: Date,
      default: null,
    },
    deliveredAt: {
      type: Date,
      default: null,
    },

    // ================================
    // DELETED FOR SPECIFIC USERS
    // ================================
    deletedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // ================================
    // DELETED FOR EVERYONE
    // (like WhatsApp "Delete for Everyone")
    // ================================
    isDeletedForEveryone: {
      type: Boolean,
      default: false,
    },

    // ================================
    // EDITED MESSAGE
    // ================================
    isEdited: {
      type: Boolean,
      default: false,
    },
    editedAt: {
      type: Date,
      default: null,
    },

    // ================================
    // STARRED BY USER
    // ================================
    starredBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // ================================
    // REACTIONS
    // (emoji reactions like WhatsApp)
    // ================================
    reactions: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        emoji: {
          type: String,
          maxlength: 10,
        },
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
messageSchema.index({ chatId: 1, createdAt: -1 });
messageSchema.index({ sender: 1 });
messageSchema.index({ receiver: 1 });
messageSchema.index({ status: 1 });

// ================================
// STATIC — GET CHAT MESSAGES
// with pagination
// ================================
messageSchema.statics.getChatMessages = function (chatId, userId, page = 1, limit = 50) {
  const skip = (page - 1) * limit;
  return this.find({
    chatId,
    deletedFor: { $ne: userId },
    isDeletedForEveryone: false,
  })
    .populate("sender", "name profilePic")
    .populate("replyTo", "text mediaUrl messageType sender")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

// ================================
// STATIC — MARK MESSAGES AS SEEN
// ================================
messageSchema.statics.markAsSeen = function (chatId, receiverId) {
  return this.updateMany(
    {
      chatId,
      receiver: receiverId,
      status: { $ne: "seen" },
    },
    {
      $set: {
        status: "seen",
        seenAt: new Date(),
      },
    }
  );
};

// ================================
// STATIC — MARK AS DELIVERED
// ================================
messageSchema.statics.markAsDelivered = function (receiverId) {
  return this.updateMany(
    {
      receiver: receiverId,
      status: "sent",
    },
    {
      $set: {
        status: "delivered",
        deliveredAt: new Date(),
      },
    }
  );
};

const Message = mongoose.model("Message", messageSchema);

export default Message;