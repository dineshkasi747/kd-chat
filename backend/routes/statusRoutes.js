import express from "express";
import {
  uploadStatus,
  getMyStatus,
  getContactsStatus,
  viewStatus,
  getStatusViewers,
  deleteStatus,
  toggleMuteUserStatus,
  updateStatusPrivacy,
} from "../controllers/statusController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  handleStatusMediaUpload,
  attachMediaInfo,
  requireFile,
} from "../middleware/uploadMiddleware.js";

const router = express.Router();

// All routes protected
router.use(protect);

// Status routes
router.get("/me", getMyStatus);
router.get("/contacts", getContactsStatus);

router.post(
  "/",
  handleStatusMediaUpload,
  requireFile,
  attachMediaInfo,
  uploadStatus
);

router.put("/:statusId/view", viewStatus);
router.get("/:statusId/viewers", getStatusViewers);
router.delete("/:statusId", deleteStatus);
router.put("/:statusId/privacy", updateStatusPrivacy);
router.put("/mute/:targetUserId", toggleMuteUserStatus);

export default router;