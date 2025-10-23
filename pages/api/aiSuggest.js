import admin from "firebase-admin";
import OpenAI from "openai";

// 🔹 Required environment variables
const requiredEnvVars = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "OPENAI_API_KEY",
];

// 🔹 Check for missing env vars
const missingEnvVars = requiredEnvVars.filter((v) => !process.env[v]);
if (missingEnvVars.length > 0) {
  console.error("❌ Missing environment variables:", missingEnvVars.join(", "));
}

// 🔹 Initialize Firebase Admin safely
if (!admin.apps.length && !missingEnvVars.includes("FIREBASE_PRIVATE_KEY")) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        project_id: process.env.FIREBASE_PROJECT_ID,
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    });
    console.log("✅ Firebase Admin initialized");
  } catch (err) {
    console.error("🔥 Firebase initialization error:", err);
  }
}

// 🔹 Initialize OpenAI safely
let openai;
if (!missingEnvVars.includes("OPENAI_API_KEY")) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export default async function handler(req, res) {
  try {
    // 🔹 Return error if any env var is missing
    if (missingEnvVars.length > 0) {
      return res.status(500).json({
        error: `Missing environment variable(s): ${missingEnvVars.join(", ")}`,
      });
    }

    // ✅ Validate query parameter
    const assigneeName = req.query.assigneeName;
    if (!assigneeName) {
      return res.status(400).json({ error: "Missing assigneeName query parameter" });
    }

    // 🔹 Example OpenAI call
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `Generate AI suggestions for task assignee: ${assigneeName}`,
        },
      ],
    });

    // 🔹 Return result as JSON
    res.status(200).json({ result: completion.choices[0].message.content });
  } catch (err) {
    console.error("🔥 API error:", err);
    res.status(500).json({ error: err.message });
  }
}
