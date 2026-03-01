import mongoose from "mongoose";

const callLogSchema = new mongoose.Schema(
  {
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
    callType: {
      type: String,
      enum: ["audio", "video"],
      required: true,
    },
    callStatus: {
      type: String,
      enum: ["missed", "completed", "rejected", "cancelled", "no_answer", "busy", "failed"],
      default: "missed",
    },
    startedAt: { type: Date, default: null },
    endedAt:   { type: Date, default: null },
    initiatedAt: { type: Date, default: Date.now },
    duration: { type: Number, default: 0 }, // seconds
    roomId: { type: String, default: "" },
    deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    networkType: {
      type: String,
      enum: ["wifi", "cellular", "unknown"],
      default: "unknown",
    },
  },
  { timestamps: true }
);

// ================================
// INDEXES
// ================================
callLogSchema.index({ caller: 1, createdAt: -1 });
callLogSchema.index({ receiver: 1, createdAt: -1 });
callLogSchema.index({ callStatus: 1 });

// ================================
// STATIC — GET CALL HISTORY
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
  return this.find({ receiver: userId, callStatus: "missed" })
    .populate("caller", "name profilePic phoneNumber")
    .sort({ createdAt: -1 });
};

// ================================
// METHOD — CALCULATE DURATION
//
// FIX: Removed internal this.save() call.
// Old code called save() here AND callers (endCall controller,
// socketHandler endCall) also called save() after — causing a
// double DB write on every call end.
// Now this method ONLY calculates — callers decide when to save.
// ================================
callLogSchema.methods.calculateDuration = function () {
  if (this.startedAt && this.endedAt) {
    this.duration = Math.floor((this.endedAt - this.startedAt) / 1000);
  }
  // FIX: no longer calls this.save() — just mutates and returns self
  return this;
};

// ================================
// VIRTUAL — FORMATTED DURATION
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

callLogSchema.virtual("isMissed").get(function () {
  return this.callStatus === "missed";
});

callLogSchema.methods.isIncoming = function (userId) {
  return this.receiver.toString() === userId.toString();
};

const CallLog = mongoose.model("CallLog", callLogSchema);
export default CallLog;