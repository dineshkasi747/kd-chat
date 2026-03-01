import admin from "../config/firebaseAdmin.js";

// ================================
// SEND SINGLE PUSH NOTIFICATION
//
// FIX: Added android_channel_id to the notification block.
// Android 8+ requires this to be present in BOTH places:
// 1. notification.android_channel_id  (tells FCM which channel)
// 2. android.notification.channelId   (used by the Admin SDK)
// Without both, notifications may be silently dropped on Android 8+.
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
        // FCM data payload — ALL values must be strings
        ...Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v)])
        ),
        clickAction: "FLUTTER_NOTIFICATION_CLICK",
        // FIX: Also include title/body in data payload so Flutter can
        // build notifications from data-only messages (foreground handling)
        title,
        body,
      },
      android: {
        priority: "high",
        notification: {
          channelId: "whatsapp_clone_channel", // FIX: required for Android 8+
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
          "apns-push-type": "alert",
        },
      },
    };

    const response = await admin.messaging().send(message);
    console.log(`✅ Push notification sent: ${response}`);
    return { success: true, response };
  } catch (error) {
    console.error("❌ Push notification error:", error.message);

    // FIX: If the token is invalid/unregistered, callers can detect this
    // and clear the stale token from the database
    const isInvalidToken =
      error.code === "messaging/invalid-registration-token" ||
      error.code === "messaging/registration-token-not-registered";

    return { success: false, message: error.message, isInvalidToken };
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
          title,
          body,
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
            "apns-push-type": "alert",
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
//
// FIX: Changed to DATA-ONLY message (no notification block).
// This is required so Flutter can intercept it via
// firebaseMessagingBackgroundHandler and show a native
// full-screen call UI (answer/decline) using flutter_callkit_incoming.
//
// If we used a normal notification block, FCM would show a
// plain banner and Flutter would never get a chance to show
// the custom call screen.
//
// Used ONLY when receiver is offline.
// Online receivers get incomingCall via socket — not FCM.
// ================================
export const sendCallNotification = async ({
  receiverFcmToken,
  callerName,
  callType,
  callerId,
  callId,
  roomId,
  callerProfilePic = "",
}) => {
  try {
    if (!receiverFcmToken) {
      console.warn("⚠️ No FCM token provided — skipping call notification.");
      return { success: false, message: "No FCM token." };
    }

    const message = {
      token: receiverFcmToken,

      // ✅ NO notification block — data only
      // Flutter background handler will catch this and show
      // flutter_callkit_incoming full-screen UI instead
      data: {
        type: "incoming_call",
        callType: callType || "audio",
        callerId: String(callerId),
        callId: String(callId),
        roomId: String(roomId || ""),
        callerName: callerName || "Unknown",
        callerProfilePic: callerProfilePic || "",
      },

      android: {
        // HIGH priority is critical — without this Android may
        // not wake the device for the incoming call
        priority: "high",
      },

      apns: {
        headers: {
          "apns-priority": "10",
          "apns-push-type": "voip", // VoIP type for call notifications on iOS
        },
        payload: {
          aps: {
            // contentAvailable wakes the app in background on iOS
            contentAvailable: true,
          },
        },
      },
    };

    const response = await admin.messaging().send(message);
    console.log(`✅ Call notification sent to ${callerName}: ${response}`);
    return { success: true, response };
  } catch (error) {
    console.error("❌ Call notification error:", error.message);

    const isInvalidToken =
      error.code === "messaging/invalid-registration-token" ||
      error.code === "messaging/registration-token-not-registered";

    return { success: false, message: error.message, isInvalidToken };
  }
};

// ================================
// MISSED CALL NOTIFICATION
//
// FIX: This should only be called AFTER the call has actually been
// missed (timeout or cancellation), NOT immediately when receiver
// is offline. See socketHandler.js for the correct usage.
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
// ================================
const chunkArray = (array, size) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

