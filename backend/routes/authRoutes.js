import express from "express";
import {
  login,
  setupProfile,
  refreshToken,
  logout,
  deleteAccount,
  getMe,
} from "../controllers/authController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  handleProfilePicUpload,
  attachMediaInfo,
} from "../middleware/uploadMiddleware.js";

const router = express.Router();

// Public routes
router.post("/login", login);

// Protected routes
router.get("/me", protect, getMe);
router.post("/refresh-token", protect, refreshToken);
router.post("/logout", protect, logout);
router.delete("/delete-account", protect, deleteAccount);
router.put(
  "/setup-profile",
  protect,
  handleProfilePicUpload,
  attachMediaInfo,
  setupProfile
);

export default router;