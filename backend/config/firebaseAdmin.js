import admin from "firebase-admin";

import dotenv from "dotenv";

// Load .env FIRST before reading any variables
dotenv.config();

const initializeFirebase = () => {
  try {
    // Prevent re-initialization
    if (admin.apps.length > 0) {
      return admin.app();
    }

    const serviceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    };

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    console.log("✅ Firebase Admin Initialized");
    return admin.app();

  } catch (error) {
    console.error("❌ Firebase Admin Init Failed:", error.message);
    process.exit(1);
  }
};

initializeFirebase();

// ================================
// VERIFY FIREBASE TOKEN
// ================================
export const verifyFirebaseToken = async (idToken) => {
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return {
      success: true,
      uid: decodedToken.uid,
      phoneNumber: decodedToken.phone_number,
      email: decodedToken.email || null,
    };
  } catch (error) {
    return {
      success: false,
      message: error.message,
    };
  }
};

// ================================
// GET USER BY UID (optional helper)
// ================================
export const getFirebaseUser = async (uid) => {
  try {
    const userRecord = await admin.auth().getUser(uid);
    return {
      success: true,
      user: userRecord,
    };
  } catch (error) {
    return {
      success: false,
      message: error.message,
    };
  }
};

export default admin;
