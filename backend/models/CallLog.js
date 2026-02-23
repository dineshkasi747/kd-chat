import mongoose from "mongoose";

const callLogSchema = new mongoose.Schema(
  {
    // ================================
    // PARTICIPANTS
    // ================================
    caller: {
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
    // CALL TYPE
    // ================================
    callType: {
      type: String,
      enum: ["audio", "video"],
      required: true,
    },

    // ================================
    // CALL STATUS
    // ================================
    callStatus: {
      type: String,
      enum: [
        "missed",      // receiver did not answer
        "completed",   // call connected and ended
        "rejected",    // receiver declined
        "cancelled",   // caller cancelled before answer
        "no_answer",   // timed out
        "busy",        // receiver was on another call
        "failed",      // technical failure
      ],
      default: "missed",
    },

    // ================================
    // CALL TIMING
    // ================================
    startedAt: {
      type: Date,
      default: null, // set when receiver accepts
    },
    endedAt: {
      type: Date,
      default: null, // set when call ends
    },
    initiatedAt: {
      type: Date,
      default: Date.now, // when caller pressed call button
    },

    // ================================
    // DURATION
    // ================================
    duration: {
      type: Number, // in seconds
      default: 0,
    },

    // ================================
    // WEBRTC SESSION INFO
    // (optional — for debugging)
    // ================================
    roomId: {
      type: String,
      default: "",
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
    // NETWORK INFO
    // (optional — for analytics)
    // ================================
    networkType: {
      type: String,
      enum: ["wifi", "cellular", "unknown"],
      default: "unknown",
    },
  },
  {
    timestamps: true,
  }
);

// ================================
// INDEXES
// ================================
callLogSchema.index({ caller: 1, createdAt: -1 });
callLogSchema.index({ receiver: 1, createdAt: -1 });
callLogSchema.index({ callStatus: 1 });

// ================================
// STATIC — GET CALL HISTORY FOR USER
// ================================
callLogSchema.statics.getCallHistory = function (userId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  return this.find({
    $or: [{ caller: userId }, { receiver: userId }],
    deletedFor: { $ne: userId },
  })
    .populate("caller", "name profilePic phoneNumber")
    .populate("receiver", "name profilePic phoneNumber")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

// ================================
// STATIC — GET MISSED CALLS
// ================================
callLogSchema.statics.getMissedCalls = function (userId) {
  return this.find({
    receiver: userId,
    callStatus: "missed",
  })
    .populate("caller", "name profilePic phoneNumber")
    .sort({ createdAt: -1 });
};

// ================================
// METHOD — CALCULATE DURATION
// ================================
callLogSchema.methods.calculateDuration = function () {
  if (this.startedAt && this.endedAt) {
    this.duration = Math.floor(
      (this.endedAt - this.startedAt) / 1000
    );
  }
  return this.save();
};

// ================================
// VIRTUAL — FORMATTED DURATION
// e.g. "2:35" or "1:02:10"
// ================================
callLogSchema.virtual("formattedDuration").get(function () {
  const total = this.duration;
  if (total === 0) return "0:00";

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
});

// ================================
// VIRTUAL — IS MISSED CALL
// ================================
callLogSchema.virtual("isMissed").get(function () {
  return this.callStatus === "missed";
});

// ================================
// VIRTUAL — IS INCOMING (for a user)
// ================================
callLogSchema.methods.isIncoming = function (userId) {
  return this.receiver.toString() === userId.toString();
};

const CallLog = mongoose.model("CallLog", callLogSchema);

export default CallLog;