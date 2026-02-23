import jwt from "jsonwebtoken";
import User from "../models/User.js";

// ================================
// PROTECT ROUTE — VERIFY JWT
// ================================
export const protect = async (req, res, next) => {
  try {
    let token;

    // Get token from header
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not authorized. No token provided.",
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from DB
    const user = await User.findById(decoded.id).select(
      "-firebaseUid -fcmToken"
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found. Token invalid.",
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: "Account has been deactivated.",
      });
    }

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid token.",
      });
    }
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token expired. Please login again.",
      });
    }
    return res.status(500).json({
      success: false,
      message: "Server error in auth middleware.",
    });
  }
};

// ================================
// VERIFY SOCKET TOKEN
// used inside socketHandler.js
// ================================
export const verifySocketToken = async (token) => {
  try {
    if (!token) return null;

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select(
      "name profilePic isOnline phoneNumber"
    );

    if (!user || !user.isActive) return null;

    return user;
  } catch (error) {
    return null;
  }
};

// ================================
// GENERATE JWT TOKEN
// ================================
export const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "30d",
  });
};

// ================================
// CHECK IF BLOCKED
// ================================
export const checkBlocked = async (req, res, next) => {
  try {
    const currentUserId = req.user._id;
    const targetUserId = req.params.userId || req.body.receiverId;

    if (!targetUserId) return next();

    const targetUser = await User.findById(targetUserId).select("blockedUsers");

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    // Check if target has blocked current user
    const isBlockedByTarget = targetUser.blockedUsers.some(
      (id) => id.toString() === currentUserId.toString()
    );

    // Check if current user has blocked target
    const currentUser = await User.findById(currentUserId).select(
      "blockedUsers"
    );
    const hasBlockedTarget = currentUser.blockedUsers.some(
      (id) => id.toString() === targetUserId.toString()
    );

    if (isBlockedByTarget || hasBlockedTarget) {
      return res.status(403).json({
        success: false,
        message: "Action not allowed.",
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error checking block status.",
    });
  }
};