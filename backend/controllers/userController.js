import User from "../models/User.js";
import { deleteFromCloudinary } from "../config/cloudinary.js";

// ================================
// GET USER PROFILE BY ID
// GET /api/users/:userId
// ================================
export const getUserById = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user._id;

    const user = await User.findById(userId).select(
      "name phoneNumber profilePic about isOnline lastSeen privacy"
    );

    if (!user || !user.isActive) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    // Apply privacy settings
    const userData = applyPrivacySettings(user, currentUserId);

    return res.status(200).json({
      success: true,
      user: userData,
    });
  } catch (error) {
    console.error("Get user error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error fetching user.",
    });
  }
};

// ================================
// UPDATE PROFILE
// PUT /api/users/profile
// ================================
export const updateProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const { name, about } = req.body;

    const updateData = {};

    if (name !== undefined) {
      if (name.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: "Name cannot be empty.",
        });
      }
      updateData.name = name.trim();
    }

    if (about !== undefined) {
      updateData.about = about.trim();
    }

    // Handle profile pic upload
    if (req.mediaInfo) {
      // Delete old profile pic from cloudinary
      const currentUser = await User.findById(userId).select(
        "profilePicPublicId"
      );
      if (currentUser.profilePicPublicId) {
        await deleteFromCloudinary(
          currentUser.profilePicPublicId,
          "image"
        );
      }

      updateData.profilePic = req.mediaInfo.mediaUrl;
      updateData.profilePicPublicId = req.mediaInfo.mediaPublicId;
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select("-firebaseUid -fcmToken -profilePicPublicId");

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      user,
    });
  } catch (error) {
    console.error("Update profile error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error updating profile.",
    });
  }
};

// ================================
// UPDATE PRIVACY SETTINGS
// PUT /api/users/privacy
// ================================
export const updatePrivacy = async (req, res) => {
  try {
    const userId = req.user._id;
    const { lastSeen, profilePhoto, about, status } = req.body;

    const validOptions = ["everyone", "contacts", "nobody"];
    const privacyUpdate = {};

    if (lastSeen && validOptions.includes(lastSeen)) {
      privacyUpdate["privacy.lastSeen"] = lastSeen;
    }
    if (profilePhoto && validOptions.includes(profilePhoto)) {
      privacyUpdate["privacy.profilePhoto"] = profilePhoto;
    }
    if (about && validOptions.includes(about)) {
      privacyUpdate["privacy.about"] = about;
    }
    if (status && validOptions.includes(status)) {
      privacyUpdate["privacy.status"] = status;
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: privacyUpdate },
      { new: true }
    ).select("privacy");

    return res.status(200).json({
      success: true,
      message: "Privacy settings updated.",
      privacy: user.privacy,
    });
  } catch (error) {
    console.error("Update privacy error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error updating privacy.",
    });
  }
};

// ================================
// SYNC CONTACTS
// POST /api/users/sync-contacts
// Flutter sends phone numbers from
// device contacts — we return
// which ones are registered users
// ================================
export const syncContacts = async (req, res) => {
  try {
    const { phoneNumbers } = req.body;
    const currentUserId = req.user._id;

    if (!phoneNumbers || !Array.isArray(phoneNumbers)) {
      return res.status(400).json({
        success: false,
        message: "phoneNumbers array is required.",
      });
    }

    // Limit to 1000 contacts per request
    const limitedNumbers = phoneNumbers.slice(0, 1000);

    // Find registered users
    const registeredContacts = await User.findContacts(limitedNumbers);

    // Filter out current user and blocked users
    const currentUser = await User.findById(currentUserId).select(
      "blockedUsers"
    );

    const filteredContacts = registeredContacts.filter(
      (contact) =>
        contact._id.toString() !== currentUserId.toString() &&
        !currentUser.blockedUsers.some(
          (blockedId) => blockedId.toString() === contact._id.toString()
        )
    );

    return res.status(200).json({
      success: true,
      count: filteredContacts.length,
      contacts: filteredContacts,
    });
  } catch (error) {
    console.error("Sync contacts error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error syncing contacts.",
    });
  }
};

// ================================
// BLOCK USER
// POST /api/users/block/:userId
// ================================
export const blockUser = async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const { userId } = req.params;

    if (currentUserId.toString() === userId) {
      return res.status(400).json({
        success: false,
        message: "You cannot block yourself.",
      });
    }

    const userToBlock = await User.findById(userId);
    if (!userToBlock) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    // Add to blocked list if not already blocked
    await User.findByIdAndUpdate(currentUserId, {
      $addToSet: { blockedUsers: userId },
    });

    return res.status(200).json({
      success: true,
      message: "User blocked successfully.",
    });
  } catch (error) {
    console.error("Block user error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error blocking user.",
    });
  }
};

// ================================
// UNBLOCK USER
// POST /api/users/unblock/:userId
// ================================
export const unblockUser = async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const { userId } = req.params;

    await User.findByIdAndUpdate(currentUserId, {
      $pull: { blockedUsers: userId },
    });

    return res.status(200).json({
      success: true,
      message: "User unblocked successfully.",
    });
  } catch (error) {
    console.error("Unblock user error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error unblocking user.",
    });
  }
};

// ================================
// GET BLOCKED USERS LIST
// GET /api/users/blocked
// ================================
export const getBlockedUsers = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select("blockedUsers")
      .populate("blockedUsers", "name phoneNumber profilePic");

    return res.status(200).json({
      success: true,
      blockedUsers: user.blockedUsers,
    });
  } catch (error) {
    console.error("Get blocked users error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error fetching blocked users.",
    });
  }
};

// ================================
// UPDATE FCM TOKEN
// PUT /api/users/fcm-token
// ================================
export const updateFcmToken = async (req, res) => {
  try {
    const { fcmToken } = req.body;

    if (!fcmToken) {
      return res.status(400).json({
        success: false,
        message: "FCM token is required.",
      });
    }

    await User.findByIdAndUpdate(req.user._id, { fcmToken });

    return res.status(200).json({
      success: true,
      message: "FCM token updated.",
    });
  } catch (error) {
    console.error("Update FCM token error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error updating FCM token.",
    });
  }
};

// ================================
// SEARCH USERS BY PHONE
// GET /api/users/search?phone=+91XXXXXXXXXX
// ================================
export const searchByPhone = async (req, res) => {
  try {
    const { phone } = req.query;
    const currentUserId = req.user._id;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required.",
      });
    }

    const user = await User.findOne({
      phoneNumber: phone,
      isActive: true,
    }).select("name phoneNumber profilePic about isOnline lastSeen");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No user found with this number.",
      });
    }

    if (user._id.toString() === currentUserId.toString()) {
      return res.status(400).json({
        success: false,
        message: "This is your own number.",
      });
    }

    return res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("Search user error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error searching user.",
    });
  }
};

// ================================
// HELPER — APPLY PRIVACY SETTINGS
// ================================
const applyPrivacySettings = (user, viewerId) => {
  const userData = user.toObject();

  // Last seen privacy
  if (
    user.privacy.lastSeen === "nobody" ||
    (user.privacy.lastSeen === "contacts" && !isContact(user, viewerId))
  ) {
    delete userData.lastSeen;
    delete userData.isOnline;
  }

  // About privacy
  if (
    user.privacy.about === "nobody" ||
    (user.privacy.about === "contacts" && !isContact(user, viewerId))
  ) {
    delete userData.about;
  }

  // Profile photo privacy
  if (
    user.privacy.profilePhoto === "nobody" ||
    (user.privacy.profilePhoto === "contacts" && !isContact(user, viewerId))
  ) {
    userData.profilePic = "";
  }

  delete userData.privacy;
  return userData;
};

// ================================
// HELPER — IS CONTACT CHECK
// (simplified — extend with
// actual contacts list if needed)
// ================================
const isContact = (user, viewerId) => {
  // In a real app, check if viewerId is in user's contact list
  // For now returns true — extend based on your contacts model
  return true;
};