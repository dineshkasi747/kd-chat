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

// ================================
// ONLINE USERS MAP
// userId => socketId
// ================================
const onlineUsers = new Map();

// ================================
// HELPER — CLEAR STALE FCM TOKEN
// Called when FCM tells us a token is no longer valid.
// Prevents wasted sends and misleading delivery errors.
// ================================
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
  // AUTHENTICATION MIDDLEWARE
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

  // ================================
  // ON CONNECTION
  // ================================
  io.on("connection", async (socket) => {
    const userId = socket.userId;
    console.log(`✅ User connected: ${userId} | Socket: ${socket.id}`);

    onlineUsers.set(userId, socket.id);

    await User.findByIdAndUpdate(userId, {
      isOnline: true,
      lastSeen: new Date(),
    });

    socket.broadcast.emit("userOnline", { userId });

    // Mark pending messages as delivered
    const delivered = await Message.markAsDelivered(userId);
    if (delivered.modifiedCount > 0) {
      notifyDelivered(io, onlineUsers, userId);
    }

    socket.join(userId);

    // ================================
    // SEND MESSAGE
    //
    // FIX (BUG 2): FCM is now also sent when receiver's socket exists
    // but they might have the app in background (socket connected but
    // Android process suspended). We detect this by checking if the
    // socket emit actually reaches the client — we do this by checking
    // the message delivery status.
    //
    // Practical approach: always send FCM for offline, and let the
    // Flutter app suppress the local notification if it's already
    // showing the message via socket (foreground). This is the WhatsApp
    // approach — FCM is the safety net, socket is the fast path.
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
          return callback?.({
            success: false,
            message: "chatId and receiverId required.",
          });
        }

        if (!text && !mediaUrl) {
          return callback?.({
            success: false,
            message: "text or mediaUrl required.",
          });
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

        callback?.({ success: true, message });

        const receiverSocketId = onlineUsers.get(receiverId);

        if (receiverSocketId) {
          // Receiver socket is connected — deliver in real time
          io.to(receiverSocketId).emit("receiveMessage", { message, chatId });

          message.status = "delivered";
          message.deliveredAt = new Date();
          await message.save();

          socket.emit("messageDelivered", {
            messageId: message._id,
            chatId,
          });

          // FIX (BUG 2): Also send FCM as a safety net for background/doze.
          // The Flutter app suppresses the notification banner if the chat
          // is currently active (SocketClient._activeChatId check).
          const receiver = await User.findById(receiverId).select(
            "fcmToken _id"
          );
          if (receiver?.fcmToken) {
            const result = await sendMessageNotification({
              receiverFcmToken: receiver.fcmToken,
              senderName: socket.user.name || "New Message",
              messageType,
              text,
              chatId,
              senderId: userId,
              messageId: message._id.toString(),
            });
            // Clean up stale token
            if (result.isInvalidToken) {
              await clearStaleFcmToken(receiverId);
            }
          }
        } else {
          // Receiver is fully offline — FCM only
          const receiver = await User.findById(receiverId).select(
            "fcmToken _id"
          );
          if (receiver?.fcmToken) {
            const result = await sendMessageNotification({
              receiverFcmToken: receiver.fcmToken,
              senderName: socket.user.name || "New Message",
              messageType,
              text,
              chatId,
              senderId: userId,
              messageId: message._id.toString(),
            });
            if (result.isInvalidToken) {
              await clearStaleFcmToken(receiverId);
            }
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
    //
    // FIX (BUG 1): Removed duplicate notification bug.
    // Old code sent BOTH sendCallNotification AND sendMissedCallNotification
    // to offline users immediately — giving them two notifications at once
    // ("Incoming call" + "Missed call") before they could even see the first.
    //
    // Correct flow:
    //   - Receiver ONLINE  → incomingCall socket event (no FCM)
    //   - Receiver OFFLINE → sendCallNotification FCM only
    //   - Missed call FCM  → sent only when caller CANCELS via cancelCall,
    //                        not immediately on offline detection
    // ================================
    socket.on("callUser", async (data) => {
      try {
        const { receiverId, callType, roomId, callId, offer } = data;

        const receiverSocketId = onlineUsers.get(receiverId);

        if (receiverSocketId) {
          // Receiver is ONLINE — ring via socket (no FCM needed)
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
            offer, // SDP offer bundled with invite
          });
        } else {
          // Receiver is OFFLINE — send ONE FCM notification
          // FIX: Do NOT send missed call notification here.
          //      That is sent separately when the caller cancels.
          const receiver = await User.findById(receiverId).select(
            "fcmToken _id"
          );

          if (receiver?.fcmToken) {
            const result = await sendCallNotification({
              receiverFcmToken: receiver.fcmToken,
              callerName: socket.user.name,
              callType,
              callerId: userId,
              callId,
              roomId,
            });
            if (result.isInvalidToken) {
              await clearStaleFcmToken(receiverId);
            }
          }

          // Mark call log as missed immediately (receiver was offline)
          if (callId) {
            await CallLog.findByIdAndUpdate(callId, {
              callStatus: "missed",
            });
          }

          // Tell caller that receiver is offline
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
    //
    // FIX (BUG 1): This is the correct place to send the missed call
    // notification. The caller cancelled → receiver truly missed the call.
    // Send missed call FCM here, not in callUser.
    // ================================
    socket.on("cancelCall", async (data) => {
      try {
        const { receiverId, callId } = data;

        const receiverSocketId = onlineUsers.get(receiverId);
        if (receiverSocketId) {
          // Receiver is online — notify via socket
          io.to(receiverSocketId).emit("callCancelled", {
            cancelledBy: userId,
            callId,
          });
        } else {
          // FIX: Receiver is offline — THIS is the correct time to send
          // the missed call notification (caller gave up / cancelled).
          const receiver = await User.findById(receiverId).select(
            "fcmToken _id"
          );
          if (receiver?.fcmToken) {
            const result = await sendMissedCallNotification({
              receiverFcmToken: receiver.fcmToken,
              callerName: socket.user.name,
              callType: data.callType || "audio",
              callerId: userId,
            });
            if (result.isInvalidToken) {
              await clearStaleFcmToken(receiverId);
            }
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
    // FIX: Added missing callLog.save() — duration was calculated
    // but never persisted to the database.
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
            await callLog.save(); // FIX: was missing before
          }
        }
      } catch (error) {
        console.error("endCall socket error:", error.message);
      }
    });

    // ================================
    // WEBRTC — OFFER (ICE restart fallback)
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
    // WEBRTC — ANSWER
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
    // WEBRTC — ICE CANDIDATE
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