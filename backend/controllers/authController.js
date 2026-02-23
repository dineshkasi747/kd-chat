import User from "../models/User.js";
import { verifyFirebaseToken } from "../config/firebaseAdmin.js";
import { generateToken } from "../middleware/authMiddleware.js";
import Message from "../models/Message.js";

// ================================
// LOGIN / REGISTER
// POST /api/auth/login
// ================================
export const login = async (req, res) => {
  try {
    const { firebaseToken, fcmToken } = req.body;

    if (!firebaseToken) {
      return res.status(400).json({
        success: false,
        message: "Firebase token is required.",
      });
    }

    // Step 1 — Verify Firebase Token
    const firebaseData = await verifyFirebaseToken(firebaseToken);

    if (!firebaseData.success) {
      return res.status(401).json({
        success: false,
        message: "Invalid Firebase token.",
      });
    }

    const { uid, phoneNumber } = firebaseData;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: "Phone number not found in token.",
      });
    }

    // Step 2 — Find or Create User
    let user = await User.findOne({
      $or: [{ firebaseUid: uid }, { phoneNumber }],
    });

    let isNewUser = false;

    if (!user) {
      // New user — create account
      user = await User.create({
        phoneNumber,
        firebaseUid: uid,
        fcmToken: fcmToken || "",
        isActive: true,
      });
      isNewUser = true;
    } else {
      // Existing user — update fcmToken
      user.fcmToken = fcmToken || user.fcmToken;
      user.isActive = true;
      await user.save();
    }

    // Step 3 — Generate App JWT
    const token = generateToken(user._id);

    // Step 4 — Mark pending messages as delivered
    await Message.markAsDelivered(user._id);

    return res.status(200).json({
      success: true,
      message: isNewUser ? "Account created successfully." : "Login successful.",
      isNewUser,
      token,
      user: {
        _id: user._id,
        phoneNumber: user.phoneNumber,
        name: user.name,
        profilePic: user.profilePic,
        about: user.about,
        isOnline: user.isOnline,
        isProfileComplete: user.isProfileComplete,
        privacy: user.privacy,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("Login error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error during login.",
    });
  }
};

// ================================
// COMPLETE PROFILE SETUP
// PUT /api/auth/setup-profile
// (called after first login)
// ================================
export const setupProfile = async (req, res) => {
  try {
    const { name, about } = req.body;
    const userId = req.user._id;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Name is required.",
      });
    }

    const updateData = {
      name: name.trim(),
      about: about?.trim() || "Hey there! I am using WhatsApp Clone.",
      isProfileComplete: true,
    };

    // If profile pic was uploaded
    if (req.mediaInfo) {
      updateData.profilePic = req.mediaInfo.mediaUrl;
      updateData.profilePicPublicId = req.mediaInfo.mediaPublicId;
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: "Profile setup complete.",
      user,
    });
  } catch (error) {
    console.error("Setup profile error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error during profile setup.",
    });
  }
};

// ================================
// REFRESH TOKEN
// POST /api/auth/refresh-token
// ================================
export const refreshToken = async (req, res) => {
  try {
    const userId = req.user._id;
    const { fcmToken } = req.body;

    // Update fcmToken if provided
    if (fcmToken) {
      await User.findByIdAndUpdate(userId, { fcmToken });
    }

    const token = generateToken(userId);

    return res.status(200).json({
      success: true,
      message: "Token refreshed.",
      token,
    });
  } catch (error) {
    console.error("Refresh token error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error refreshing token.",
    });
  }
};

// ================================
// LOGOUT
// POST /api/auth/logout
// ================================
export const logout = async (req, res) => {
  try {
    const userId = req.user._id;

    // Clear FCM token + set offline
    await User.findByIdAndUpdate(userId, {
      fcmToken: "",
      isOnline: false,
      lastSeen: new Date(),
    });

    return res.status(200).json({
      success: true,
      message: "Logged out successfully.",
    });
  } catch (error) {
    console.error("Logout error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error during logout.",
    });
  }
};

// ================================
// DELETE ACCOUNT
// DELETE /api/auth/delete-account
// ================================
export const deleteAccount = async (req, res) => {
  try {
    const userId = req.user._id;

    // Soft delete — keep data but deactivate
    await User.findByIdAndUpdate(userId, {
      isActive: false,
      fcmToken: "",
      isOnline: false,
      name: "Deleted Account",
      profilePic: "",
      about: "",
      lastSeen: new Date(),
    });

    return res.status(200).json({
      success: true,
      message: "Account deleted successfully.",
    });
  } catch (error) {
    console.error("Delete account error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error deleting account.",
    });
  }
};

// ================================
// GET CURRENT USER
// GET /api/auth/me
// ================================
export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "-firebaseUid -fcmToken -profilePicPublicId"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    return res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("Get me error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error fetching user.",
    });
  }
};