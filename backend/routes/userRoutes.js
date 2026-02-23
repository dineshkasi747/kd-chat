import express from "express";
import {
  getUserById,
  updateProfile,
  updatePrivacy,
  syncContacts,
  blockUser,
  unblockUser,
  getBlockedUsers,
  updateFcmToken,
  searchByPhone,
} from "../controllers/userController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  handleProfilePicUpload,
  attachMediaInfo,
} from "../middleware/uploadMiddleware.js";

const router = express.Router();

// All routes protected
router.use(protect);

router.get("/search", searchByPhone);
router.get("/blocked", getBlockedUsers);
router.get("/:userId", getUserById);

router.put(
  "/profile",
  handleProfilePicUpload,
  attachMediaInfo,
  updateProfile
);
router.put("/privacy", updatePrivacy);
router.put("/fcm-token", updateFcmToken);

router.post("/sync-contacts", syncContacts);
router.post("/block/:userId", blockUser);
router.post("/unblock/:userId", unblockUser);

export default router;