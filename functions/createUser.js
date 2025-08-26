// functions/createUser.js

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require("cors")({ origin: true });

admin.initializeApp();
const db = admin.firestore();

/**
 * HTTP‐triggered function to let managers create new Auth users.
 * Expected JSON body: { email, password, displayName, role }
 * Only callable by a logged‐in user whose Firestore role === "manager".
 */
exports.createUser = functions.https.onRequest(async (req, res) => {
  return cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    // 1) Get the manager’s ID token from the Authorization header
    const idToken = 
      (req.headers.authorization || "").split("Bearer ")[1] || "";

    if (!idToken) {
      return res.status(401).send("Unauthorized: No ID token provided");
    }

    try {
      // 2) Verify the manager’s token
      const decoded = await admin.auth().verifyIdToken(idToken);
      const managerUid = decoded.uid;

      // 3) Check Firestore to confirm this user is a manager
      const mgrDoc = await db.collection("users").doc(managerUid).get();
      if (!mgrDoc.exists || mgrDoc.data().role !== "manager") {
        return res.status(403).send("Forbidden: Only managers can create users");
      }
    } catch (err) {
      console.error("Auth error:", err);
      return res.status(401).send("Unauthorized: Invalid ID token");
    }

    // 4) Extract new user data from the request body
    const { email, password, displayName, role } = req.body || {};

    if (!email || !password || !displayName || !role) {
      return res
        .status(400)
        .send("Missing fields: email, password, displayName, and role are all required");
    }
    if (!["manager", "staff"].includes(role)) {
      return res.status(400).send("Invalid role: must be “manager” or “staff”");
    }

    try {
      // 5) Create the new Auth user
      const userRecord = await admin.auth().createUser({
        email,
        password,
        displayName,
        emailVerified: false,
        disabled: false,
      });

      const newUid = userRecord.uid;

      // 6) Write their role (and displayName/email) into /users/{uid}
      await db.collection("users").doc(newUid).set({
        displayName,
        email,
        role,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.status(200).json({
        uid: newUid,
        message: `User ${displayName} (${email}) created as ${role}.`,
      });
    } catch (err) {
      console.error("Error creating user:", err);
      return res.status(500).send("Error creating user: " + err.message);
    }
  });
});
