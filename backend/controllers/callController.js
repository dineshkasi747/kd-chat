import CallLog from "../models/CallLog.js";
import User from "../models/User.js";
import { v4 as uuidv4 } from "uuid";

// ================================
// INITIATE CALL
// POST /api/calls/initiate
// ================================
export const initiateCall = async (req, res) => {
  try {
    const callerId = req.user._id;
    const { receiverId, callType } = req.body;

    if (!receiverId || !callType) {
      return res.status(400).json({
        success: false,
        message: "receiverId and callType are required.",
      });
    }

    if (!["audio", "video"].includes(callType)) {
      return res.status(400).json({
        success: false,
        message: "callType must be audio or video.",
      });
    }

    if (callerId.toString() === receiverId) {
      return res.status(400).json({
        success: false,
        message: "Cannot call yourself.",
      });
    }

    const receiver = await User.findById(receiverId).select(
      "name profilePic isOnline fcmToken blockedUsers isActive"
    );

    if (!receiver || !receiver.isActive) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const isBlocked = receiver.blockedUsers.some(
      (id) => id.toString() === callerId.toString()
    );

    if (isBlocked) {
      return res.status(403).json({
        success: false,
        message: "Cannot call this user.",
      });
    }

    const roomId = uuidv4();

    const callLog = await CallLog.create({
      caller: callerId,
      receiver: receiverId,
      callType,
      callStatus: "missed",
      roomId,
      initiatedAt: new Date(),
    });

    await callLog.populate("caller", "name profilePic phoneNumber");
    await callLog.populate("receiver", "name profilePic phoneNumber");

    return res.status(201).json({
      success: true,
      message: "Call initiated.",
      callLog,
      roomId,
    });
  } catch (error) {
    console.error("Initiate call error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error initiating call.",
    });
  }
};

// ================================
// UPDATE CALL STATUS
// PUT /api/calls/:callId/status
// ================================
export const updateCallStatus = async (req, res) => {
  try {
    const { callId } = req.params;
    const { callStatus, networkType } = req.body;
    const userId = req.user._id;

    const validStatuses = [
      "missed", "completed", "rejected", "cancelled",
      "no_answer", "busy", "failed",
    ];

    if (!validStatuses.includes(callStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid call status.",
      });
    }

    const callLog = await CallLog.findById(callId);

    if (!callLog) {
      return res.status(404).json({
        success: false,
        message: "Call log not found.",
      });
    }

    const isParticipant =
      callLog.caller.toString() === userId.toString() ||
      callLog.receiver.toString() === userId.toString();

    if (!isParticipant) {
      return res.status(403).json({ success: false, message: "Not authorized." });
    }

    callLog.callStatus = callStatus;
    if (networkType) callLog.networkType = networkType;
    if (callStatus === "completed" && !callLog.startedAt) {
      callLog.startedAt = new Date();
    }

    await callLog.save();

    return res.status(200).json({
      success: true,
      message: "Call status updated.",
      callLog,
    });
  } catch (error) {
    console.error("Update call status error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error updating call status.",
    });
  }
};

// ================================
// END CALL
// PUT /api/calls/:callId/end
//
// FIX: Removed double save.
// Old code called calculateDuration() which internally called
// this.save(), then called callLog.save() again — two DB writes.
// Now calculateDuration() only calculates (no save),
// and we call save() exactly once here.
// ================================
export const endCall = async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user._id;

    const callLog = await CallLog.findById(callId);

    if (!callLog) {
      return res.status(404).json({
        success: false,
        message: "Call log not found.",
      });
    }

    const isParticipant =
      callLog.caller.toString() === userId.toString() ||
      callLog.receiver.toString() === userId.toString();

    if (!isParticipant) {
      return res.status(403).json({ success: false, message: "Not authorized." });
    }

    callLog.endedAt = new Date();
    if (!callLog.startedAt) callLog.startedAt = callLog.initiatedAt;
    if (callLog.callStatus === "missed") callLog.callStatus = "completed";

    // FIX: calculateDuration() now only calculates — does NOT call save()
    callLog.calculateDuration();

    // FIX: single save() call
    await callLog.save();

    return res.status(200).json({
      success: true,
      message: "Call ended.",
      duration: callLog.duration,
      formattedDuration: callLog.formattedDuration,
      callLog,
    });
  } catch (error) {
    console.error("End call error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error ending call.",
    });
  }
};

// ================================
// GET CALL HISTORY
// GET /api/calls
// ================================
export const getCallHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const callType = req.query.callType;

    const query = {
      $or: [{ caller: userId }, { receiver: userId }],
      deletedFor: { $ne: userId },
    };

    if (callType && ["audio", "video"].includes(callType)) {
      query.callType = callType;
    }

    const skip = (page - 1) * limit;

    const [callLogs, total] = await Promise.all([
      CallLog.find(query)
        .populate("caller", "name profilePic phoneNumber")
        .populate("receiver", "name profilePic phoneNumber")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      CallLog.countDocuments(query),
    ]);

    const formattedLogs = callLogs.map((log) => ({
      _id: log._id,
      callType: log.callType,
      callStatus: log.callStatus,
      duration: log.duration,
      formattedDuration: log.formattedDuration,
      isIncoming: log.isIncoming(userId),
      isMissed: log.isMissed,
      caller: log.caller,
      receiver: log.receiver,
      initiatedAt: log.initiatedAt,
      startedAt: log.startedAt,
      endedAt: log.endedAt,
      createdAt: log.createdAt,
    }));

    return res.status(200).json({
      success: true,
      page,
      total,
      totalPages: Math.ceil(total / limit),
      count: formattedLogs.length,
      callLogs: formattedLogs,
    });
  } catch (error) {
    console.error("Get call history error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error fetching call history.",
    });
  }
};

// ================================
// GET MISSED CALLS
// GET /api/calls/missed
// ================================
export const getMissedCalls = async (req, res) => {
  try {
    const userId = req.user._id;
    const missedCalls = await CallLog.getMissedCalls(userId);
    return res.status(200).json({
      success: true,
      count: missedCalls.length,
      missedCalls,
    });
  } catch (error) {
    console.error("Get missed calls error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error fetching missed calls.",
    });
  }
};

// ================================
// DELETE CALL LOG
// DELETE /api/calls/:callId
// ================================
export const deleteCallLog = async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user._id;

    const callLog = await CallLog.findById(callId);

    if (!callLog) {
      return res.status(404).json({
        success: false,
        message: "Call log not found.",
      });
    }

    const isParticipant =
      callLog.caller.toString() === userId.toString() ||
      callLog.receiver.toString() === userId.toString();

    if (!isParticipant) {
      return res.status(403).json({ success: false, message: "Not authorized." });
    }

    callLog.deletedFor.push(userId);
    await callLog.save();

    return res.status(200).json({ success: true, message: "Call log deleted." });
  } catch (error) {
    console.error("Delete call log error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error deleting call log.",
    });
  }
};

// ================================
// CLEAR ALL CALL HISTORY
// DELETE /api/calls/clear-all
// ================================
export const clearAllCallHistory = async (req, res) => {
  try {
    const userId = req.user._id;

    await CallLog.updateMany(
      {
        $or: [{ caller: userId }, { receiver: userId }],
        deletedFor: { $ne: userId },
      },
      { $addToSet: { deletedFor: userId } }
    );

    return res.status(200).json({ success: true, message: "Call history cleared." });
  } catch (error) {
    console.error("Clear call history error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error clearing call history.",
    });
  }
};

// ================================
// GET SINGLE CALL DETAILS
// GET /api/calls/:callId
// ================================
export const getCallDetails = async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user._id;

    const callLog = await CallLog.findById(callId)
      .populate("caller", "name profilePic phoneNumber")
      .populate("receiver", "name profilePic phoneNumber");

    if (!callLog) {
      return res.status(404).json({
        success: false,
        message: "Call log not found.",
      });
    }

    const isParticipant =
      callLog.caller._id.toString() === userId.toString() ||
      callLog.receiver._id.toString() === userId.toString();

    if (!isParticipant) {
      return res.status(403).json({ success: false, message: "Not authorized." });
    }

    return res.status(200).json({
      success: true,
      callLog: {
        ...callLog.toObject(),
        formattedDuration: callLog.formattedDuration,
        isIncoming: callLog.isIncoming(userId),
        isMissed: callLog.isMissed,
      },
    });
  } catch (error) {
    console.error("Get call details error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error fetching call details.",
    });
  }
};