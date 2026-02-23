import { uploadChatMedia, uploadProfilePic, uploadStatusMedia } from "../config/cloudinary.js";

// ================================
// SINGLE FILE UPLOAD HANDLERS
// ================================

// Chat media — image/video/audio/document
export const handleChatMediaUpload = (req, res, next) => {
  const upload = uploadChatMedia.single("media");

  upload(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          success: false,
          message: "File too large. Maximum size is 50MB.",
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || "File upload failed.",
      });
    }
    next();
  });
};

// Profile picture
export const handleProfilePicUpload = (req, res, next) => {
  const upload = uploadProfilePic.single("profilePic");

  upload(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          success: false,
          message: "File too large. Maximum size is 5MB.",
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || "Profile picture upload failed.",
      });
    }
    next();
  });
};

// Status media — image/video
export const handleStatusMediaUpload = (req, res, next) => {
  const upload = uploadStatusMedia.single("media");

  upload(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          success: false,
          message: "File too large. Maximum size is 50MB.",
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || "Status media upload failed.",
      });
    }
    next();
  });
};

// ================================
// ATTACH MEDIA INFO TO REQUEST
// after upload — formats file data
// for controller use
// ================================
export const attachMediaInfo = (req, res, next) => {
  if (!req.file) return next();

  // Cloudinary returns these fields
  req.mediaInfo = {
    mediaUrl: req.file.path,           // Cloudinary URL
    mediaPublicId: req.file.filename,  // Cloudinary public_id
    mediaSize: req.file.size,
    mediaType: getMediaType(req.file.mimetype),
  };

  next();
};

// ================================
// HELPER — GET MEDIA TYPE
// ================================
const getMediaType = (mimetype) => {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "audio";
  return "document";
};

// ================================
// VALIDATE — NO FILE UPLOADED
// use when file is required
// ================================
export const requireFile = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "No file uploaded. Please attach a file.",
    });
  }
  next();
};