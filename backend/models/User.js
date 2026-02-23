import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    // ================================
    // CORE IDENTITY
    // ================================
    phoneNumber: {
      type: String,
      required: [true, "Phone number is required"],
      unique: true,
      trim: true,
    },
    firebaseUid: {
      type: String,
      required: [true, "Firebase UID is required"],
      unique: true,
    },

    // ================================
    // PROFILE INFO
    // ================================
    name: {
      type: String,
      trim: true,
      default: "",
      maxlength: [50, "Name cannot exceed 50 characters"],
    },
    about: {
      type: String,
      trim: true,
      default: "Hey there! I am using WhatsApp Clone.",
      maxlength: [139, "About cannot exceed 139 characters"],
    },
    profilePic: {
      type: String,
      default: "",
    },
    profilePicPublicId: {
      type: String,
      default: "",
    },

    // ================================
    // ONLINE / OFFLINE STATUS
    // ================================
    isOnline: {
      type: Boolean,
      default: false,
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },

    // ================================
    // PRIVACY SETTINGS
    // ================================
    privacy: {
      lastSeen: {
        type: String,
        enum: ["everyone", "contacts", "nobody"],
        default: "everyone",
      },
      profilePhoto: {
        type: String,
        enum: ["everyone", "contacts", "nobody"],
        default: "everyone",
      },
      about: {
        type: String,
        enum: ["everyone", "contacts", "nobody"],
        default: "everyone",
      },
      status: {
        type: String,
        enum: ["everyone", "contacts", "nobody"],
        default: "everyone",
      },
    },

    // ================================
    // BLOCKED USERS
    // ================================
    blockedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // ================================
    // PUSH NOTIFICATIONS
    // ================================
    fcmToken: {
      type: String,
      default: "",
    },

    // ================================
    // ACCOUNT STATUS
    // ================================
    isActive: {
      type: Boolean,
      default: true,
    },
    isProfileComplete: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// ================================
// INDEXES
// ================================
userSchema.index({ phoneNumber: 1 });
userSchema.index({ firebaseUid: 1 });
userSchema.index({ isOnline: 1 });

// ================================
// HIDE SENSITIVE FIELDS
// ================================
userSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.firebaseUid;
  delete user.fcmToken;
  delete user.profilePicPublicId;
  delete user.__v;
  return user;
};

// ================================
// STATIC — FIND BY PHONE
// ================================
userSchema.statics.findByPhone = function (phoneNumber) {
  return this.findOne({ phoneNumber, isActive: true });
};

// ================================
// STATIC — FIND CONTACTS IN DB
// (Contact sync feature)
// ================================
userSchema.statics.findContacts = function (phoneNumbers) {
  return this.find({
    phoneNumber: { $in: phoneNumbers },
    isActive: true,
  }).select("name phoneNumber profilePic isOnline lastSeen about");
};

const User = mongoose.model("User", userSchema);

export default User;