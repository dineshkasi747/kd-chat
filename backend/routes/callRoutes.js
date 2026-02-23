import express from "express";
import {
  initiateCall,
  updateCallStatus,
  endCall,
  getCallHistory,
  getMissedCalls,
  deleteCallLog,
  clearAllCallHistory,
  getCallDetails,
} from "../controllers/callController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// All routes protected
router.use(protect);

// Call routes
router.get("/", getCallHistory);
router.get("/missed", getMissedCalls);
router.delete("/clear-all", clearAllCallHistory);

router.post("/initiate", initiateCall);

router.get("/:callId", getCallDetails);
router.put("/:callId/status", updateCallStatus);
router.put("/:callId/end", endCall);
router.delete("/:callId", deleteCallLog);

export default router;