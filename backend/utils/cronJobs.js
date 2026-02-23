import cron from "node-cron";
import Status from "../models/Status.js";
import CallLog from "../models/CallLog.js";
import User from "../models/User.js";
import { deleteFromCloudinary } from "../config/cloudinary.js";

// ================================
// START ALL CRON JOBS
// ================================
export const startCronJobs = () => {
  console.log("⏰ Starting cron jobs...");

  cleanExpiredStatuses();
  cleanOldCallLogs();
  resetStaleOnlineStatus();

  console.log("✅ All cron jobs started.");
};

// ================================
// JOB 1 — CLEAN EXPIRED STATUSES
// Runs every 1 hour
// Backup for MongoDB TTL index
// Deletes media from Cloudinary too
// ================================
const cleanExpiredStatuses = () => {
  cron.schedule("0 * * * *", async () => {
    try {
      console.log("🔄 Running: Clean expired statuses...");

      // Find expired statuses
      const expiredStatuses = await Status.find({
        expiresAt: { $lt: new Date() },
        isActive: true,
      });

      if (expiredStatuses.length === 0) {
        console.log("✅ No expired statuses found.");
        return;
      }

      // Delete media from Cloudinary
      const deletePromises = expiredStatuses.map(async (status) => {
        if (status.mediaPublicId) {
          await deleteFromCloudinary(
            status.mediaPublicId,
            status.mediaType === "video" ? "video" : "image"
          );
        }
      });

      await Promise.allSettled(deletePromises);

      // Delete from MongoDB
      const result = await Status.deleteMany({
        expiresAt: { $lt: new Date() },
      });

      console.log(`✅ Deleted ${result.deletedCount} expired statuses.`);
    } catch (error) {
      console.error("❌ Clean expired statuses error:", error.message);
    }
  });
};

// ================================
// JOB 2 — CLEAN OLD CALL LOGS
// Runs every day at midnight
// Deletes call logs older than 30 days
// where deletedFor includes both users
// ================================
const cleanOldCallLogs = () => {
  cron.schedule("0 0 * * *", async () => {
    try {
      console.log("🔄 Running: Clean old call logs...");

      const thirtyDaysAgo = new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000
      );

      // Delete call logs older than 30 days
      const result = await CallLog.deleteMany({
        createdAt: { $lt: thirtyDaysAgo },
      });

      console.log(`✅ Deleted ${result.deletedCount} old call logs.`);
    } catch (error) {
      console.error("❌ Clean old call logs error:", error.message);
    }
  });
};

// ================================
// JOB 3 — RESET STALE ONLINE STATUS
// Runs every 5 minutes
// Fixes users stuck as "online"
// after server crash or restart
// ================================
const resetStaleOnlineStatus = () => {
  cron.schedule("*/5 * * * *", async () => {
    try {
      console.log("🔄 Running: Reset stale online status...");

      // Users marked online but lastSeen > 10 minutes ago
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

      const result = await User.updateMany(
        {
          isOnline: true,
          lastSeen: { $lt: tenMinutesAgo },
        },
        {
          $set: {
            isOnline: false,
          },
        }
      );

      if (result.modifiedCount > 0) {
        console.log(
          `✅ Reset ${result.modifiedCount} stale online users.`
        );
      }
    } catch (error) {
      console.error("❌ Reset stale online status error:", error.message);
    }
  });
};