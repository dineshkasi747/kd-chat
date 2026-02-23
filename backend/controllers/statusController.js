import Status from "../models/Status.js";
import User from "../models/User.js";
import { deleteFromCloudinary } from "../config/cloudinary.js";

// ================================
// UPLOAD STATUS
// POST /api/status
// ================================
export const uploadStatus = async (req, res) => {
  try {
    const userId = req.user._id;
    const { caption, backgroundColor, privacy } = req.body;

    if (!req.mediaInfo) {
      return res.status(400).json({
        success: false,
        message: "No media file uploaded.",
      });
    }

    const status = await Status.create({
      user: userId,
      mediaUrl: req.mediaInfo.mediaUrl,
      mediaPublicId: req.mediaInfo.mediaPublicId,
      mediaType: req.mediaInfo.mediaType,
      mediaSize: req.mediaInfo.mediaSize,
      caption: caption?.trim() || "",
      backgroundColor: backgroundColor || "",
      privacy: privacy || "contacts",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    await status.populate("user", "name profilePic phoneNumber");

    return res.status(201).json({
      success: true,
      message: "Status uploaded successfully.",
      status,
    });
  } catch (error) {
    console.error("Upload status error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error uploading status.",
    });
  }
};

// ================================
// GET MY STATUS
// GET /api/status/me
// ================================
export const getMyStatus = async (req, res) => {
  try {
    const userId = req.user._id;

    const statuses = await Status.getMyStatus(userId);

    return res.status(200).json({
      success: true,
      count: statuses.length,
      statuses,
    });
  } catch (error) {
    console.error("Get my status error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error fetching your status.",
    });
  }
};

// ================================
// GET CONTACTS STATUS
// GET /api/status/contacts
// ================================
export const getContactsStatus = async (req, res) => {
  try {
    const currentUserId = req.user._id;

    // Get user's contacts from synced contacts
    // For now fetch all registered non-blocked users
    const currentUser = await User.findById(currentUserId).select(
      "blockedUsers"
    );

    const blockedIds = currentUser.blockedUsers.map((id) => id.toString());

    // Get all active users except current and blocked
    const contacts = await User.find({
      _id: { $ne: currentUserId },
      isActive: true,
    }).select("_id");

    const contactIds = contacts
      .map((c) => c._id)
      .filter((id) => !blockedIds.includes(id.toString()));

    // Get their statuses
    const statuses = await Status.getContactsStatus(
      contactIds,
      currentUserId
    );

    // Group statuses by user
    const groupedStatuses = groupByUser(statuses);

    return res.status(200).json({
      success: true,
      count: groupedStatuses.length,
      statuses: groupedStatuses,
    });
  } catch (error) {
    console.error("Get contacts status error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error fetching contacts status.",
    });
  }
};

// ================================
// VIEW STATUS
// PUT /api/status/:statusId/view
// ================================
export const viewStatus = async (req, res) => {
  try {
    const { statusId } = req.params;
    const userId = req.user._id;

    const status = await Status.findById(statusId);

    if (!status) {
      return res.status(404).json({
        success: false,
        message: "Status not found or expired.",
      });
    }

    // Cannot view own status as a view
    if (status.user.toString() === userId.toString()) {
      return res.status(400).json({
        success: false,
        message: "Cannot view your own status.",
      });
    }

    // Add view
    await status.addView(userId);

    return res.status(200).json({
      success: true,
      message: "Status viewed.",
    });
  } catch (error) {
    console.error("View status error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error viewing status.",
    });
  }
};

// ================================
// GET STATUS VIEWERS
// GET /api/status/:statusId/viewers
// ================================
export const getStatusViewers = async (req, res) => {
  try {
    const { statusId } = req.params;
    const userId = req.user._id;

    const status = await Status.findById(statusId)
      .populate("views.user", "name profilePic phoneNumber");

    if (!status) {
      return res.status(404).json({
        success: false,
        message: "Status not found.",
      });
    }

    // Only owner can see viewers
    if (status.user.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Only status owner can see viewers.",
      });
    }

    return res.status(200).json({
      success: true,
      viewCount: status.views.length,
      viewers: status.views,
    });
  } catch (error) {
    console.error("Get status viewers error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error fetching viewers.",
    });
  }
};

// ================================
// DELETE STATUS
// DELETE /api/status/:statusId
// ================================
export const deleteStatus = async (req, res) => {
  try {
    const { statusId } = req.params;
    const userId = req.user._id;

    const status = await Status.findById(statusId);

    if (!status) {
      return res.status(404).json({
        success: false,
        message: "Status not found.",
      });
    }

    // Only owner can delete
    if (status.user.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this status.",
      });
    }

    // Delete media from Cloudinary
    if (status.mediaPublicId) {
      await deleteFromCloudinary(
        status.mediaPublicId,
        status.mediaType === "video" ? "video" : "image"
      );
    }

    await Status.findByIdAndDelete(statusId);

    return res.status(200).json({
      success: true,
      message: "Status deleted successfully.",
    });
  } catch (error) {
    console.error("Delete status error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error deleting status.",
    });
  }
};

// ================================
// MUTE / UNMUTE USER STATUS
// PUT /api/status/mute/:targetUserId
// ================================
export const toggleMuteUserStatus = async (req, res) => {
  try {
    const { targetUserId } = req.params;
    const currentUserId = req.user._id;

    // Find all statuses of target user
    const statuses = await Status.find({ user: targetUserId });

    if (statuses.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No active status found for this user.",
      });
    }

    // Check if already muted
    const isMuted = statuses[0].mutedBy.some(
      (id) => id.toString() === currentUserId.toString()
    );

    if (isMuted) {
      // Unmute
      await Status.updateMany(
        { user: targetUserId },
        { $pull: { mutedBy: currentUserId } }
      );
    } else {
      // Mute
      await Status.updateMany(
        { user: targetUserId },
        { $addToSet: { mutedBy: currentUserId } }
      );
    }

    return res.status(200).json({
      success: true,
      isMuted: !isMuted,
      message: isMuted
        ? "Status unmuted."
        : "Status muted.",
    });
  } catch (error) {
    console.error("Mute status error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error muting status.",
    });
  }
};

// ================================
// UPDATE STATUS PRIVACY
// PUT /api/status/:statusId/privacy
// ================================
export const updateStatusPrivacy = async (req, res) => {
  try {
    const { statusId } = req.params;
    const { privacy, hiddenFrom, visibleTo } = req.body;
    const userId = req.user._id;

    const status = await Status.findById(statusId);

    if (!status) {
      return res.status(404).json({
        success: false,
        message: "Status not found.",
      });
    }

    if (status.user.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized.",
      });
    }

    const validPrivacy = ["everyone", "contacts", "except"];
    if (privacy && !validPrivacy.includes(privacy)) {
      return res.status(400).json({
        success: false,
        message: "Invalid privacy option.",
      });
    }

    if (privacy) status.privacy = privacy;
    if (hiddenFrom) status.hiddenFrom = hiddenFrom;
    if (visibleTo) status.visibleTo = visibleTo;

    await status.save();

    return res.status(200).json({
      success: true,
      message: "Status privacy updated.",
      privacy: status.privacy,
    });
  } catch (error) {
    console.error("Update status privacy error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error updating status privacy.",
    });
  }
};

// ================================
// HELPER — GROUP STATUSES BY USER
// ================================
const groupByUser = (statuses) => {
  const grouped = {};

  statuses.forEach((status) => {
    const userId = status.user._id.toString();
    if (!grouped[userId]) {
      grouped[userId] = {
        user: status.user,
        statuses: [],
        latestAt: status.createdAt,
      };
    }
    grouped[userId].statuses.push(status);
  });

  // Sort by latest status time
  return Object.values(grouped).sort(
    (a, b) => new Date(b.latestAt) - new Date(a.latestAt)
  );
};