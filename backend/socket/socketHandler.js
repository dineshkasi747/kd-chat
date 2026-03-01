import { verifySocketToken } from "../middleware/authMiddleware.js";
import Message from "../models/Message.js";
import Chat from "../models/Chat.js";
import User from "../models/User.js";
import CallLog from "../models/CallLog.js";
import {
  sendMessageNotification,
  sendCallNotification,
  sendMissedCallNotification,
} from "../utils/notifications.js";

const onlineUsers = new Map();

const clearStaleFcmToken = async (userId) => {
  try {
    await User.findByIdAndUpdate(userId, { fcmToken: "" });
    console.log(`🧹 Cleared stale FCM token for user: ${userId}`);
  } catch (err) {
    console.error("clearStaleFcmToken error:", err.message);
  }
};

const socketHandler = (io) => {
  // ================================
  // AUTH MIDDLEWARE
  // ================================
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth.token ||
        socket.handshake.headers.authorization?.split(" ")[1];
      if (!token) return next(new Error("Authentication token missing."));
      const user = await verifySocketToken(token);
      if (!user) return next(new Error("Invalid or expired token."));
      socket.user = user;
      socket.userId = user._id.toString();
      next();
    } catch (error) {
      next(new Error("Socket authentication failed."));
    }
  });

  io.on("connection", async (socket) => {
    const userId = socket.userId;
    console.log(`✅ User connected: ${userId} | Socket: ${socket.id}`);

    onlineUsers.set(userId, socket.id);

    await User.findByIdAndUpdate(userId, {
      isOnline: true,
      lastSeen: new Date(),
    });

    socket.broadcast.emit("userOnline", { userId });

    const delivered = await Message.markAsDelivered(userId);
    if (delivered.modifiedCount > 0) {
      notifyDelivered(io, onlineUsers, userId);
    }

    socket.join(userId);

    // ================================
    // SEND MESSAGE
    // FCM sent as safety net for both online (background/doze)
    // and offline receivers. Flutter suppresses banner if chat is active.
    // ================================
    socket.on("sendMessage", async (data, callback) => {
      try {
        const {
          chatId, receiverId, text,
          messageType = "text", mediaUrl, mediaPublicId,
          mediaSize, replyTo, caption,
        } = data;

        if (!chatId || !receiverId) {
          return callback?.({ success: false, message: "chatId and receiverId required." });
        }
        if (!text && !mediaUrl) {
          return callback?.({ success: false, message: "text or mediaUrl required." });
        }

        const chat = await Chat.findOne({
          _id: chatId,
          participants: { $all: [userId, receiverId] },
        });
        if (!chat) {
          return callback?.({ success: false, message: "Chat not found." });
        }

        const message = await Message.create({
          chatId, sender: userId, receiver: receiverId,
          text: text?.trim() || caption?.trim() || "",
          mediaUrl: mediaUrl || "",
          mediaPublicId: mediaPublicId || "",
          mediaSize: mediaSize || 0,
          messageType, replyTo: replyTo || null, status: "sent",
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

        callback?.({ success: true, message });

        const receiverSocketId = onlineUsers.get(receiverId);

        if (receiverSocketId) {
          io.to(receiverSocketId).emit("receiveMessage", { message, chatId });
          message.status = "delivered";
          message.deliveredAt = new Date();
          await message.save();
          socket.emit("messageDelivered", { messageId: message._id, chatId });
        }

        // Always send FCM — safety net for background/doze/offline
        const receiver = await User.findById(receiverId).select("fcmToken _id");
        if (receiver?.fcmToken) {
          const result = await sendMessageNotification({
            receiverFcmToken: receiver.fcmToken,
            senderName: socket.user.name || "New Message",
            messageType, text, chatId,
            senderId: userId,
            messageId: message._id.toString(),
          });
          if (result.isInvalidToken) await clearStaleFcmToken(receiverId);
        }
      } catch (error) {
        console.error("sendMessage socket error:", error.message);
        callback?.({ success: false, message: "Failed to send message." });
      }
    });

    // ================================
    // MESSAGE SEEN
    // ================================
    socket.on("messageSeen", async (data) => {
      try {
        const { chatId, senderId } = data;
        await Message.markAsSeen(chatId, userId);
        const chat = await Chat.findById(chatId);
        if (chat) await chat.resetUnread(userId);
        const senderSocketId = onlineUsers.get(senderId);
        if (senderSocketId) {
          io.to(senderSocketId).emit("messagesSeen", {
            chatId, seenBy: userId, seenAt: new Date(),
          });
        }
      } catch (error) {
        console.error("messageSeen socket error:", error.message);
      }
    });

    // ================================
    // TYPING
    // ================================
    socket.on("typing", (data) => {
      const { chatId, receiverId } = data;
      const receiverSocketId = onlineUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("userTyping", { chatId, userId, isTyping: true });
      }
    });

    socket.on("stopTyping", (data) => {
      const { chatId, receiverId } = data;
      const receiverSocketId = onlineUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("userTyping", { chatId, userId, isTyping: false });
      }
    });

    // ================================
    // MESSAGE ACTIONS
    // ================================
    socket.on("messageDeleted", (data) => {
      const { chatId, messageId, receiverId, deleteFor } = data;
      const receiverSocketId = onlineUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("messageDeleted", { chatId, messageId, deleteFor });
      }
    });

    socket.on("messageEdited", (data) => {
      const { chatId, messageId, newText, receiverId } = data;
      const receiverSocketId = onlineUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("messageEdited", {
          chatId, messageId, newText, editedAt: new Date(),
        });
      }
    });

    socket.on("reactionAdded", (data) => {
      const { chatId, messageId, emoji, receiverId } = data;
      const receiverSocketId = onlineUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("reactionAdded", { chatId, messageId, emoji, userId });
      }
    });

    // ================================
    // CALL — INITIATE
    // Online  → incomingCall socket (offer bundled)
    // Offline → sendCallNotification FCM only
    // ================================
    socket.on("callUser", async (data) => {
      try {
        const { receiverId, callType, roomId, callId, offer } = data;
        const receiverSocketId = onlineUsers.get(receiverId);

        if (receiverSocketId) {
          io.to(receiverSocketId).emit("incomingCall", {
            callerId: userId,
            caller: {
              _id: socket.user._id,
              name: socket.user.name,
              profilePic: socket.user.profilePic,
              phoneNumber: socket.user.phoneNumber,
            },
            callType, roomId, callId, offer,
          });
        } else {
          const receiver = await User.findById(receiverId).select("fcmToken _id");
          if (receiver?.fcmToken) {
            const result = await sendCallNotification({
              receiverFcmToken: receiver.fcmToken,
              callerName: socket.user.name,
              callType, callerId: userId, callId, roomId,
            });
            if (result.isInvalidToken) await clearStaleFcmToken(receiverId);
          }
          if (callId) {
            await CallLog.findByIdAndUpdate(callId, { callStatus: "missed" });
          }
          socket.emit("callUserOffline", { receiverId });
        }
      } catch (error) {
        console.error("callUser socket error:", error.message);
      }
    });

    // ================================
    // CALL ACCEPTED
    // ================================
    socket.on("acceptCall", async (data) => {
      try {
        const { callerId, roomId, callId } = data;
        const callerSocketId = onlineUsers.get(callerId);
        if (callerSocketId) {
          io.to(callerSocketId).emit("callAccepted", {
            acceptedBy: userId, roomId, callId,
          });
        }
        if (callId) {
          await CallLog.findByIdAndUpdate(callId, {
            callStatus: "completed",
            startedAt: new Date(),
          });
        }
      } catch (error) {
        console.error("acceptCall socket error:", error.message);
      }
    });

    // ================================
    // CALL REJECTED
    // ================================
    socket.on("rejectCall", async (data) => {
      try {
        const { callerId, callId } = data;
        const callerSocketId = onlineUsers.get(callerId);
        if (callerSocketId) {
          io.to(callerSocketId).emit("callRejected", { rejectedBy: userId, callId });
        }
        if (callId) {
          await CallLog.findByIdAndUpdate(callId, { callStatus: "rejected" });
        }
      } catch (error) {
        console.error("rejectCall socket error:", error.message);
      }
    });

    // ================================
    // CALL CANCELLED
    //
    // FIX: Missed call notification sent here (not in callUser).
    // FIX: callType fetched from CallLog DB so video calls correctly
    //      show "Missed Video Call" instead of always "audio".
    //      Flutter's cancelCall() never sends callType in the payload.
    // ================================
    socket.on("cancelCall", async (data) => {
      try {
        const { receiverId, callId } = data;

        const receiverSocketId = onlineUsers.get(receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit("callCancelled", {
            cancelledBy: userId, callId,
          });
        } else {
          // Receiver is offline — send missed call FCM
          // FIX: fetch callType from DB instead of trusting data.callType
          //      which Flutter never sends in cancelCall payload
          let callType = "audio";
          if (callId) {
            const callLog = await CallLog.findById(callId).select("callType");
            if (callLog) callType = callLog.callType;
          }

          const receiver = await User.findById(receiverId).select("fcmToken _id");
          if (receiver?.fcmToken) {
            const result = await sendMissedCallNotification({
              receiverFcmToken: receiver.fcmToken,
              callerName: socket.user.name,
              callType,  // FIX: now correctly "video" or "audio"
              callerId: userId,
            });
            if (result.isInvalidToken) await clearStaleFcmToken(receiverId);
          }
        }

        if (callId) {
          await CallLog.findByIdAndUpdate(callId, { callStatus: "cancelled" });
        }
      } catch (error) {
        console.error("cancelCall socket error:", error.message);
      }
    });

    // ================================
    // CALL ENDED
    //
    // FIX: calculateDuration() no longer calls save() internally,
    // so there is now exactly ONE save() call here.
    // ================================
    socket.on("endCall", async (data) => {
      try {
        const { receiverId, callId } = data;

        const receiverSocketId = onlineUsers.get(receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit("callEnded", { endedBy: userId, callId });
        }

        if (callId) {
          const callLog = await CallLog.findById(callId);
          if (callLog) {
            callLog.endedAt = new Date();
            if (!callLog.startedAt) callLog.startedAt = callLog.initiatedAt;
            callLog.calculateDuration(); // FIX: just calculates, no internal save
            await callLog.save();        // FIX: single save
          }
        }
      } catch (error) {
        console.error("endCall socket error:", error.message);
      }
    });

    // ================================
    // WEBRTC SIGNALING
    // ================================
    socket.on("sendOffer", (data) => {
      const { receiverId, offer, roomId } = data;
      const receiverSocketId = onlineUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("receiveOffer", { offer, roomId, from: userId });
      }
    });

    socket.on("sendAnswer", (data) => {
      const { callerId, answer, roomId } = data;
      const callerSocketId = onlineUsers.get(callerId);
      if (callerSocketId) {
        io.to(callerSocketId).emit("receiveAnswer", { answer, roomId, from: userId });
      }
    });

    socket.on("sendIceCandidate", (data) => {
      const { targetUserId, candidate, roomId } = data;
      const targetSocketId = onlineUsers.get(targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit("receiveIceCandidate", { candidate, roomId, from: userId });
      }
    });

    // ================================
    // STATUS VIEWED
    // ================================
    socket.on("statusViewed", (data) => {
      const { statusOwnerId, statusId } = data;
      const ownerSocketId = onlineUsers.get(statusOwnerId);
      if (ownerSocketId) {
        io.to(ownerSocketId).emit("statusViewed", {
          viewedBy: userId, statusId, viewedAt: new Date(),
        });
      }
    });

    // ================================
    // CHECK ONLINE STATUS
    // ================================
    socket.on("checkOnlineStatus", (data) => {
      const { userIds } = data;
      const onlineStatuses = {};
      userIds.forEach((id) => {
        onlineStatuses[id] = onlineUsers.has(id);
      });
      socket.emit("onlineStatuses", onlineStatuses);
    });

    // ================================
    // DISCONNECT
    // ================================
    socket.on("disconnect", async () => {
      console.log(`❌ User disconnected: ${userId}`);
      onlineUsers.delete(userId);
      const lastSeen = new Date();
      await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen });
      socket.broadcast.emit("userOffline", { userId, lastSeen });
    });
  });
};

// ================================
// HELPER — NOTIFY DELIVERED
// ================================
const notifyDelivered = async (io, onlineUsers, receiverId) => {
  try {
    const messages = await Message.find({
      receiver: receiverId,
      status: "delivered",
    }).select("sender chatId");

    const senderIds = [...new Set(messages.map((m) => m.sender.toString()))];

    senderIds.forEach((senderId) => {
      const senderSocketId = onlineUsers.get(senderId);
      if (senderSocketId) {
        io.to(senderSocketId).emit("messagesDelivered", {
          receiverId, deliveredAt: new Date(),
        });
      }
    });
  } catch (error) {
    console.error("notifyDelivered error:", error.message);
  }
};

export default socketHandler;