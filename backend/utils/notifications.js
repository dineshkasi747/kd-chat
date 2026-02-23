import admin from "../config/firebaseAdmin.js";

// ================================
// SEND SINGLE PUSH NOTIFICATION
// ================================
export const sendPushNotification = async ({
  fcmToken,
  title,
  body,
  data = {},
  imageUrl = null,
}) => {
  try {
    if (!fcmToken) {
      console.warn("⚠️ No FCM token provided — skipping notification.");
      return { success: false, message: "No FCM token." };
    }

    const message = {
      token: fcmToken,
      notification: {
        title,
        body,
        ...(imageUrl && { imageUrl }),
      },
      data: {
        // FCM data payload — all values must be strings
        ...Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v)])
        ),
        clickAction: "FLUTTER_NOTIFICATION_CLICK",
      },
      android: {
        priority: "high",
        notification: {
          channelId: "whatsapp_clone_channel",
          priority: "high",
          defaultSound: true,
          defaultVibrateTimings: true,
          ...(imageUrl && { imageUrl }),
        },
      },
      apns: {
        payload: {
          aps: {
            alert: { title, body },
            sound: "default",
            badge: 1,
            contentAvailable: true,
          },
        },
        headers: {
          "apns-priority": "10",
        },
      },
    };

    const response = await admin.messaging().send(message);
    console.log(`✅ Push notification sent: ${response}`);
    return { success: true, response };
  } catch (error) {
    console.error("❌ Push notification error:", error.message);
    return { success: false, message: error.message };
  }
};

// ================================
// SEND NOTIFICATION TO
// MULTIPLE TOKENS (multicast)
// ================================
export const sendMulticastNotification = async ({
  fcmTokens,
  title,
  body,
  data = {},
  imageUrl = null,
}) => {
  try {
    if (!fcmTokens || fcmTokens.length === 0) {
      return { success: false, message: "No FCM tokens provided." };
    }

    // FCM multicast supports max 500 tokens at once
    const chunks = chunkArray(fcmTokens, 500);
    const results = [];

    for (const chunk of chunks) {
      const message = {
        tokens: chunk,
        notification: {
          title,
          body,
          ...(imageUrl && { imageUrl }),
        },
        data: {
          ...Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, String(v)])
          ),
          clickAction: "FLUTTER_NOTIFICATION_CLICK",
        },
        android: {
          priority: "high",
          notification: {
            channelId: "whatsapp_clone_channel",
            priority: "high",
            defaultSound: true,
          },
        },
        apns: {
          payload: {
            aps: {
              alert: { title, body },
              sound: "default",
              badge: 1,
            },
          },
          headers: {
            "apns-priority": "10",
          },
        },
      };

      const response = await admin.messaging().sendEachForMulticast(message);
      results.push(response);

      console.log(
        `✅ Multicast sent — Success: ${response.successCount} | Failed: ${response.failureCount}`
      );
    }

    return { success: true, results };
  } catch (error) {
    console.error("❌ Multicast notification error:", error.message);
    return { success: false, message: error.message };
  }
};

// ================================
// NEW MESSAGE NOTIFICATION
// ================================
export const sendMessageNotification = async ({
  receiverFcmToken,
  senderName,
  messageType,
  text,
  chatId,
  senderId,
  messageId,
}) => {
  const body =
    messageType === "text"
      ? text?.length > 100
        ? text.substring(0, 100) + "..."
        : text
      : messageType === "image"
      ? "📷 Photo"
      : messageType === "video"
      ? "🎥 Video"
      : messageType === "audio"
      ? "🎵 Voice message"
      : messageType === "document"
      ? "📄 Document"
      : messageType === "location"
      ? "📍 Location"
      : "New message";

  return sendPushNotification({
    fcmToken: receiverFcmToken,
    title: senderName || "New Message",
    body,
    data: {
      type: "message",
      chatId,
      senderId,
      messageId,
    },
  });
};

// ================================
// INCOMING CALL NOTIFICATION
// ================================
export const sendCallNotification = async ({
  receiverFcmToken,
  callerName,
  callType,
  callerId,
  callId,
  roomId,
}) => {
  return sendPushNotification({
    fcmToken: receiverFcmToken,
    title: `Incoming ${callType === "video" ? "Video" : "Voice"} Call`,
    body: `${callerName || "Someone"} is calling you`,
    data: {
      type: "call",
      callType,
      callerId,
      callId,
      roomId,
    },
  });
};

// ================================
// MISSED CALL NOTIFICATION
// ================================
export const sendMissedCallNotification = async ({
  receiverFcmToken,
  callerName,
  callType,
  callerId,
}) => {
  return sendPushNotification({
    fcmToken: receiverFcmToken,
    title: `Missed ${callType === "video" ? "Video" : "Voice"} Call`,
    body: `You missed a ${callType} call from ${callerName || "Someone"}`,
    data: {
      type: "missed_call",
      callType,
      callerId,
    },
  });
};

// ================================
// STATUS NOTIFICATION
// ================================
export const sendStatusNotification = async ({
  viewerFcmToken,
  viewerName,
  statusOwnerId,
}) => {
  return sendPushNotification({
    fcmToken: viewerFcmToken,
    title: "New Status Update",
    body: `${viewerName || "A contact"} posted a new status`,
    data: {
      type: "status",
      statusOwnerId,
    },
  });
};

// ================================
// HELPER — CHUNK ARRAY
// for multicast batching
// ================================
const chunkArray = (array, size) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};