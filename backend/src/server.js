import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";

dotenv.config();

import connectDB from "../config/db.js";
import authRoutes from "../routes/authRoutes.js";
import userRoutes from "../routes/userRoutes.js";
import chatRoutes from "../routes/chatRoutes.js";
import statusRoutes from "../routes/statusRoutes.js";
import callRoutes from "../routes/callRoutes.js";
import socketHandler from "../socket/socketHandler.js";
import { startCronJobs } from "../utils/cronJobs.js";

// ================================
// CONNECT DATABASE
// ================================
connectDB();

// ================================
// INIT EXPRESS
// ================================
const app = express();
const server = createServer(app);

// ================================
// FIX: TRUST PROXY — Required for Render/Heroku/Railway
// Without this, express-rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// ================================
app.set("trust proxy", 1);

// ================================
// SOCKET.IO SETUP
// ================================
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ================================
// SECURITY MIDDLEWARE
// ================================
app.use(helmet());
app.use(compression());

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  // FIX: use standardHeaders + skip trust proxy validation error
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests, please try again later.",
  },
});
app.use("/api/", limiter);

// ================================
// GENERAL MIDDLEWARE
// ================================
app.use(cors({ origin: process.env.CLIENT_URL || "*", credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// ================================
// HEALTH CHECK
// ================================
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "KD Chat API is running 🚀",
    version: "1.0.0",
    environment: process.env.NODE_ENV,
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Server is healthy ✅",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ================================
// API ROUTES
// ================================
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/chats", chatRoutes);
app.use("/api/status", statusRoutes);
app.use("/api/calls", callRoutes);

// ================================
// SOCKET.IO HANDLER
// ================================
socketHandler(io);

// ================================
// CRON JOBS
// ================================
startCronJobs();

// ================================
// 404 HANDLER
// ================================
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

// ================================
// GLOBAL ERROR HANDLER
// ================================
app.use((err, req, res, next) => {
  console.error("Global Error:", err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

// ================================
// START SERVER
// ================================
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`
  ====================================
  🚀 Server running on port ${PORT}
  🌍 Environment: ${process.env.NODE_ENV}
  📡 Socket.io ready
  ====================================
  `);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err.message);
  server.close(() => process.exit(1));
});

export { app, io };