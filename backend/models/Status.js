import mongoose from "mongoose";

const statusSchema = new mongoose.Schema(
  {
    // ================================
    // OWNER
    // ================================
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // ================================
    // MEDIA
    // ================================
    mediaUrl: {
      type: String,
      required: [true, "Media URL is required"],
    },
    mediaPublicId: {
      type: String,
      default: "",
    },
    mediaType: {
      type: String,
      enum: ["image", "video"],
      required: true,
    },
    mediaDuration: {
      type: Number, // in seconds (for video)
      default: 0,
    },
    thumbnail: {
      type: String, // video thumbnail
      default: "",
    },

    // ================================
    // CAPTION
    // ================================
    caption: {
      type: String,
      trim: true,
      default: "",
      maxlength: [700, "Caption cannot exceed 700 characters"],
    },

    // ================================
    // BACKGROUND COLOR
    // (for text-only status like WhatsApp)
    // ================================
    backgroundColor: {
      type: String,
      default: "",
    },

    // ================================
    // EXPIRY — AUTO DELETE AFTER 24HRS
    // ================================
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      index: { expires: 0 }, // MongoDB TTL index
    },

    // ================================
    // VIEWS
    // (who viewed this status)
    // ================================
    views: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        viewedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // ================================
    // PRIVACY
    // ================================
    privacy: {
      type: String,
      enum: ["everyone", "contacts", "except"],
      default: "contacts",
    },

    // ================================
    // HIDDEN FROM SPECIFIC USERS
    // ================================
    hiddenFrom: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // ================================
    // VISIBLE TO ONLY THESE USERS
    // (when privacy === "except")
    // ================================
    visibleTo: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // ================================
    // MUTED BY
    // ================================
    mutedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // ================================
    // IS ACTIVE
    // ================================
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// ================================
// INDEXES
// ================================
statusSchema.index({ user: 1, createdAt: -1 });
statusSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL
statusSchema.index({ "views.user": 1 });

// ================================
// STATIC — GET CONTACTS STATUS
// returns all active statuses of contacts
// ================================
statusSchema.statics.getContactsStatus = function (contactIds, currentUserId) {
  return this.find({
    user: { $in: contactIds },
    isActive: true,
    expiresAt: { $gt: new Date() },
    hiddenFrom: { $ne: currentUserId },
    mutedBy: { $ne: currentUserId },
  })
    .populate("user", "name profilePic phoneNumber")
    .sort({ createdAt: -1 });
};

// ================================
// STATIC — GET MY STATUS
// ================================
statusSchema.statics.getMyStatus = function (userId) {
  return this.find({
    user: userId,
    isActive: true,
    expiresAt: { $gt: new Date() },
  })
    .populate("views.user", "name profilePic")
    .sort({ createdAt: -1 });
};

// ================================
// METHOD — ADD VIEW
// ================================
statusSchema.methods.addView = function (userId) {
  const alreadyViewed = this.views.some(
    (v) => v.user.toString() === userId.toString()
  );
  if (!alreadyViewed) {
    this.views.push({ user: userId, viewedAt: new Date() });
    return this.save();
  }
  return Promise.resolve(this);
};

// ================================
// VIRTUAL — VIEW COUNT
// ================================
statusSchema.virtual("viewCount").get(function () {
  return this.views.length;
});

// ================================
// VIRTUAL — IS EXPIRED
// ================================
statusSchema.virtual("isExpired").get(function () {
  return new Date() > this.expiresAt;
});

const Status = mongoose.model("Status", statusSchema);

export default Status;