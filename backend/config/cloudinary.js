import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import multer from "multer";

// ================================
// CLOUDINARY CONFIG
// ================================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

console.log("✅ Cloudinary Configured");

// ================================
// STORAGE FOR CHAT MEDIA
// (images, videos, audio messages)
// ================================
const chatMediaStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "whatsapp_clone/chat_media",
    allowed_formats: ["jpg", "jpeg", "png", "gif", "mp4", "mov", "mp3", "ogg", "aac", "webm"],
    resource_type: "auto",
  },
});

// ================================
// STORAGE FOR PROFILE PICTURES
// ================================
const profilePicStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "whatsapp_clone/profile_pics",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    resource_type: "image",
    transformation: [
      { width: 400, height: 400, crop: "fill", gravity: "face" },
    ],
  },
});

// ================================
// STORAGE FOR STATUS MEDIA
// (images/videos - 24hr stories)
// ================================
const statusMediaStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "whatsapp_clone/status_media",
    allowed_formats: ["jpg", "jpeg", "png", "mp4", "mov", "webm"],
    resource_type: "auto",
  },
});

// ================================
// FILE SIZE LIMITS
// ================================
const limits = {
  chatMedia: { fileSize: 50 * 1024 * 1024 },    // 50MB
  profilePic: { fileSize: 5 * 1024 * 1024 },     // 5MB
  statusMedia: { fileSize: 50 * 1024 * 1024 },   // 50MB
};

// ================================
// MULTER UPLOAD INSTANCES
// ================================
export const uploadChatMedia = multer({
  storage: chatMediaStorage,
  limits: limits.chatMedia,
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg", "image/png", "image/gif",
      "video/mp4", "video/quicktime", "video/webm",
      "audio/mpeg", "audio/ogg", "audio/aac", "audio/webm",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("File type not supported"), false);
    }
  },
});

export const uploadProfilePic = multer({
  storage: profilePicStorage,
  limits: limits.profilePic,
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files allowed for profile picture"), false);
    }
  },
});

export const uploadStatusMedia = multer({
  storage: statusMediaStorage,
  limits: limits.statusMedia,
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg", "image/png",
      "video/mp4", "video/quicktime", "video/webm",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only images and videos allowed for status"), false);
    }
  },
});

// ================================
// DELETE FILE FROM CLOUDINARY
// ================================
export const deleteFromCloudinary = async (publicUrl, resourceType = "image") => {
  try {
    // Extract public_id from URL
    const urlParts = publicUrl.split("/");
    const folderAndFile = urlParts.slice(-3).join("/");
    const publicId = folderAndFile.replace(/\.[^/.]+$/, ""); // remove extension

    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
    });

    return { success: true, result };
  } catch (error) {
    console.error("Cloudinary delete error:", error.message);
    return { success: false, message: error.message };
  }
};

export default cloudinary;