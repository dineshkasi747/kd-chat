import { verifySocketToken } from "../middleware/authMiddleware.js";
import Message from "../models/Message.js";
import Chat from "../models/Chat.js";
import User from "../models/User.js";
import CallLog from "../models/CallLog.js";
import { sendPushNotification } from "../utils/notifications.js";

// ================================
// ONLINE USERS MAP
// userId => socketId
// ================================
const onlineUsers = new Map();

const socketHandler = (io) => {
  // ================================
  // AUTHENTICATION MIDDLEWARE
  // ================================
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth.token ||
        socket.handshake.headers.authorization?.split(" ")[1];

      if (!token) {
        return next(new Error("Authentication token missing."));
      }

      const user = await verifySocketToken(token);

      if (!user) {
        return next(new Error("Invalid or expired token."));
      }

      socket.user = user;
      socket.userId = user._id.toString();
      next();
    } catch (error) {
      next(new Error("Socket authentication failed."));
    }
  });

  // ================================
  // ON CONNECTION
  // ================================
  io.on("connection", async (socket) => {
    const userId = socket.userId;

    console.log(`✅ User connected: ${userId} | Socket: ${socket.id}`);

    // ================================
    // REGISTER USER AS ONLINE
    // ================================
    onlineUsers.set(userId, socket.id);

    await User.findByIdAndUpdate(userId, {
      isOnline: true,
      lastSeen: new Date(),
    });

    // Notify contacts user is online
    socket.broadcast.emit("userOnline", { userId });

    // Mark pending messages as delivered
    const delivered = await Message.markAsDelivered(userId);
    if (delivered.modifiedCount > 0) {
      notifyDelivered(io, onlineUsers, userId);
    }

    // ================================
    // JOIN PERSONAL ROOM
    // ================================
    socket.join(userId);

    // ================================
    // SEND MESSAGE
    // ================================
    socket.on("sendMessage", async (data, callback) => {
      try {
        const {
          chatId,
          receiverId,
          text,
          messageType = "text",
          mediaUrl,
          mediaPublicId,
          mediaSize,
          replyTo,
          caption,
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
          chatId,
          sender: userId,
          receiver: receiverId,
          text: text?.trim() || caption?.trim() || "",
          mediaUrl: mediaUrl || "",
          mediaPublicId: mediaPublicId || "",
          mediaSize: mediaSize || 0,
          messageType,
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

        // Confirm to sender
        callback?.({ success: true, message });

        const receiverSocketId = onlineUsers.get(receiverId);

        if (receiverSocketId) {
          io.to(receiverSocketId).emit("receiveMessage", { message, chatId });

          message.status = "delivered";
          message.deliveredAt = new Date();
          await message.save();

          socket.emit("messageDelivered", {
            messageId: message._id,
            chatId,
          });
        } else {
          // Receiver offline — push notification
          const receiver = await User.findById(receiverId).select("fcmToken name");
          if (receiver?.fcmToken) {
            await sendPushNotification({
              fcmToken: receiver.fcmToken,
              title: socket.user.name || "New Message",
              body: messageType === "text" ? text : `Sent a ${messageType}`,
              data: {
                type: "message",
                chatId,
                senderId: userId,
                messageId: message._id.toString(),
              },
            });
          }
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
            chatId,
            seenBy: userId,
            seenAt: new Date(),
          });
        }
      } catch (error) {
        console.error("messageSeen socket error:", error.message);
      }
    });

    // ================================
    // TYPING INDICATOR
    // ================================
    socket.on("typing", (data) => {
      const { chatId, receiverId } = data;
      const receiverSocketId = onlineUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("userTyping", {
          chatId,
          userId,
          isTyping: true,
        });
      }
    });

    socket.on("stopTyping", (data) => {
      const { chatId, receiverId } = data;
      const receiverSocketId = onlineUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("userTyping", {
          chatId,
          userId,
          isTyping: false,
        });
      }
    });

    // ================================
    // MESSAGE DELETED
    // ================================
    socket.on("messageDeleted", (data) => {
      const { chatId, messageId, receiverId, deleteFor } = data;
      const receiverSocketId = onlineUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("messageDeleted", {
          chatId,
          messageId,
          deleteFor,
        });
      }
    });

    // ================================
    // MESSAGE EDITED
    // ================================
    socket.on("messageEdited", (data) => {
      const { chatId, messageId, newText, receiverId } = data;
      const receiverSocketId = onlineUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("messageEdited", {
          chatId,
          messageId,
          newText,
          editedAt: new Date(),
        });
      }
    });

    // ================================
    // REACTION ADDED
    // ================================
    socket.on("reactionAdded", (data) => {
      const { chatId, messageId, emoji, receiverId } = data;
      const receiverSocketId = onlineUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("reactionAdded", {
          chatId,
          messageId,
          emoji,
          userId,
        });
      }
    });

    // ================================
    // VOICE / VIDEO CALL — INITIATE
    // FIX: Pass the SDP offer WITH the call invite so the receiver has it
    //      immediately when they accept. Previously offer was sent separately
    //      via sendOffer AFTER callUser, causing a race condition where the
    //      receiver's peer connection was set up before the offer arrived.
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
            callType,
            roomId,
            callId,
            offer, // FIX: include SDP offer so receiver can process it on accept
          });
        } else {
          // Receiver offline — push notification
          const receiver = await User.findById(receiverId).select("fcmToken name");

          if (receiver?.fcmToken) {
            await sendPushNotification({
              fcmToken: receiver.fcmToken,
              title: `Incoming ${callType} call`,
              body: `${socket.user.name || "Someone"} is calling you`,
              data: {
                type: "call",
                callType,
                callerId: userId,
                callId,
                roomId,
              },
            });
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
            acceptedBy: userId,
            roomId,
            callId,
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
          io.to(callerSocketId).emit("callRejected", {
            rejectedBy: userId,
            callId,
          });
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
    // ================================
    socket.on("cancelCall", async (data) => {
      try {
        const { receiverId, callId } = data;

        const receiverSocketId = onlineUsers.get(receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit("callCancelled", {
            cancelledBy: userId,
            callId,
          });
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
    // FIX: Added missing await callLog.save() — duration was being
    //      calculated but never persisted to the database.
    // ================================
    socket.on("endCall", async (data) => {
      try {
        const { receiverId, callId } = data;

        const receiverSocketId = onlineUsers.get(receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit("callEnded", {
            endedBy: userId,
            callId,
          });
        }

        if (callId) {
          const callLog = await CallLog.findById(callId);
          if (callLog) {
            callLog.endedAt = new Date();
            if (!callLog.startedAt) callLog.startedAt = callLog.initiatedAt;
            await callLog.calculateDuration();
            await callLog.save(); // FIX: was missing — duration never saved
          }
        }
      } catch (error) {
        console.error("endCall socket error:", error.message);
      }
    });

    // ================================
    // WEBRTC SIGNALING — OFFER
    // This is now a fallback. Ideally the offer travels with callUser above.
    // Keeping this so ICE restart offers still work during an active call.
    // ================================
    socket.on("sendOffer", (data) => {
      const { receiverId, offer, roomId } = data;
      const receiverSocketId = onlineUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("receiveOffer", {
          offer,
          roomId,
          from: userId,
        });
      }
    });

    // ================================
    // WEBRTC SIGNALING — ANSWER
    // ================================
    socket.on("sendAnswer", (data) => {
      const { callerId, answer, roomId } = data;
      const callerSocketId = onlineUsers.get(callerId);
      if (callerSocketId) {
        io.to(callerSocketId).emit("receiveAnswer", {
          answer,
          roomId,
          from: userId,
        });
      }
    });

    // ================================
    // WEBRTC SIGNALING — ICE CANDIDATE
    // ================================
    socket.on("sendIceCandidate", (data) => {
      const { targetUserId, candidate, roomId } = data;
      const targetSocketId = onlineUsers.get(targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit("receiveIceCandidate", {
          candidate,
          roomId,
          from: userId,
        });
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
          viewedBy: userId,
          statusId,
          viewedAt: new Date(),
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

      await User.findByIdAndUpdate(userId, {
        isOnline: false,
        lastSeen,
      });

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
          receiverId,
          deliveredAt: new Date(),
        });
      }
    });
  } catch (error) {
    console.error("notifyDelivered error:", error.message);
  }
};

export default socketHandler;