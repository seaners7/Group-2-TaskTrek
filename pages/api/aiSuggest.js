// /api/aiSuggest.js

import admin from "firebase-admin";
import OpenAI from "openai";

// 🔹 Required server-side env variables
const requiredEnvVars = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "OPENAI_API_KEY",
];

// 🔹 Check for missing env variables
const missingEnvVars = requiredEnvVars.filter((v) => !process.env[v]);
if (missingEnvVars.length > 0) {
  console.error("❌ Missing environment variables:", missingEnvVars.join(", "));
}

// ✅ Initialize Firebase Admin safely
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

const db = admin.firestore();

// ✅ Initialize OpenAI safely
let openai;
if (!missingEnvVars.includes("OPENAI_API_KEY")) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export default async function handler(req, res) {
  try {
    // 🔹 Check for missing env variables
    if (missingEnvVars.length > 0) {
      return res.status(500).json({
        error: `Missing environment variable(s): ${missingEnvVars.join(", ")}`,
      });
    }

    const { assigneeName } = req.query;

    if (!assigneeName) {
      return res.status(400).json({ error: "Missing assigneeName query parameter" });
    }

    // 🔹 Fetch tasks from Firestore
    const snapshot = await db
      .collection("tasks")
      .where("assigneeName", "==", assigneeName)
      .get();

    let tasks = [];
    if (snapshot.empty) {
      tasks = [];
    } else {
      tasks = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          title: data.title,
          createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : "unknown",
        };
      });
    }

    // 🔹 Prepare AI prompt
    const taskList = tasks
      .map((t) => `${t.title} (created at ${t.createdAt})`)
      .join(", ");

    const prompt = `
You are a smart productivity assistant analyzing when the user usually performs tasks.
Here are their past tasks and when they were created:
${taskList || "No tasks available."}

Today is ${new Date().toLocaleString("en-US", {
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
    })}.
Suggest 3 tasks that would make sense for them to do now, based on timing and recurring patterns. Start with a capital letter.
Return each suggestion on a new line only, no numbering or bullets.
`;

    // 🔹 Generate AI suggestions
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 150,
    });

    const aiResponse =
      completion.choices?.[0]?.message?.content?.trim() || "No suggestions generated.";

    // 🔹 Split AI response into array
    const suggestions = aiResponse.split("\n").filter((line) => line.trim());

    res.status(200).json({ suggestions });
  } catch (error) {
    console.error("🔥 Error fetching AI suggestions:", error);

    // Always return JSON error to frontend
    res.status(500).json({
      error: "Internal Server Error",
      details: error?.message || "Unknown error",
    });
  }
}
