import jwt from "jsonwebtoken";
import User from "../models/User.js";

// ================================
// PROTECT ROUTE — VERIFY JWT
// ================================
export const protect = async (req, res, next) => {
  try {
    let token;
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
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
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
// FIX: Added detailed logging so we can see exactly why the socket
// token is being rejected even when the HTTP token works fine.
// ================================
export const verifySocketToken = async (token) => {
  try {
    // Log 1: Check if token arrived at all
    if (!token) {
      console.log("❌ verifySocketToken: no token provided");
      return null;
    }

    // Log 2: Check JWT_SECRET is loaded
    if (!process.env.JWT_SECRET) {
      console.log("❌ verifySocketToken: JWT_SECRET is undefined — check .env");
      return null;
    }

    // Log 3: Show first 30 chars of token so we can confirm it matches
    console.log("🔍 verifySocketToken: token preview =", token.substring(0, 30) + "...");

    // Decode without verifying first to inspect payload
    const rawDecoded = jwt.decode(token);
    console.log("🔍 verifySocketToken: decoded payload =", rawDecoded);

    // Now verify signature + expiry
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError) {
      console.log("❌ verifySocketToken: jwt.verify failed —", jwtError.name, ":", jwtError.message);
      return null;
    }

    console.log("✅ verifySocketToken: jwt.verify passed, userId =", decoded.id);

    // Look up user
    const user = await User.findById(decoded.id).select(
      "name profilePic isOnline phoneNumber isActive"
    );

    if (!user) {
      console.log("❌ verifySocketToken: user not found in DB for id =", decoded.id);
      return null;
    }

    if (!user.isActive) {
      console.log("❌ verifySocketToken: user is inactive, id =", decoded.id);
      return null;
    }

    console.log("✅ verifySocketToken: user authenticated =", user._id.toString());
    return user;

  } catch (error) {
    // Log 4: Catch anything else
    console.log("❌ verifySocketToken: unexpected error —", error.message);
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

    const isBlockedByTarget = targetUser.blockedUsers.some(
      (id) => id.toString() === currentUserId.toString()
    );

    const currentUser = await User.findById(currentUserId).select("blockedUsers");
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