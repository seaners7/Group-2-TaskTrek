// /api/aiSuggest.js

import admin from "firebase-admin";
import OpenAI from "openai";

// ✅ Initialize Firebase Admin (server-side)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
    }),
  });
}

const db = admin.firestore();

// ✅ Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  try {
    const { assigneeName } = req.query;

    if (!assigneeName) {
      return res.status(400).json({ error: "Missing assigneeName" });
    }

    // Fetch tasks from Firestore for the given user
    const snapshot = await db
      .collection("tasks")
      .where("assigneeName", "==", assigneeName)
      .get();

    if (snapshot.empty) {
      return res.status(200).json({
        suggestions: ["No tasks found for this user."],
      });
    }
//changed
    const tasks = snapshot.docs.map((doc) => {
  const data = doc.data();
  return {
    title: data.title,
    createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : "unknown"
  };
});


    // changed for AI changed
   const taskList = tasks
  .map((t) => `${t.title} (created at ${t.createdAt})`)
  .join(", ");

const prompt = `
You are a smart productivity assistant analyzing when the user usually performs tasks.
Here are their past tasks and when they were created:
${taskList}

Today is ${new Date().toLocaleString("en-US", { weekday: "long", hour: "2-digit", minute: "2-digit" })}.
Suggest 3 tasks that would make sense for them to do now, based on timing and recurring patterns. Start with a capital letter.
Return each suggestion on a new line only, no need to format it like a list (example: numbering, bullets, etc.).
`;


    // Generate AI suggestions
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 150,
    });

    const aiResponse =
      completion.choices?.[0]?.message?.content?.trim() ||
      "No suggestions generated.";

    // Split the AI response into list items
    const suggestions = aiResponse.split("\n").filter((line) => line.trim());

    res.status(200).json({ suggestions });
  } catch (error) {
  console.error("❌ Error fetching AI suggestions:", error);

  // ✅ Return detailed error info in JSON for debugging (only for development)
  res.status(500).json({
    error: "Internal Server Error",
    message: error.message || "Unknown error",
    stack: error.stack || "No stack trace",
  });
}

