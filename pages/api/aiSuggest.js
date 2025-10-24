// /pages/api/aiSuggest.js

import admin from "firebase-admin";
// Import the Google AI SDK
import { GoogleGenerativeAI } from "@google/generative-ai";

// Initialize Firebase Admin (server-side) - Keep this part
if (!admin.apps.length) {
  try {
      admin.initializeApp({
        credential: admin.credential.cert({
          project_id: process.env.FIREBASE_PROJECT_ID,
          // Ensure private key newlines are handled correctly
          private_key: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, "\n"),
          client_email: process.env.FIREBASE_CLIENT_EMAIL,
        }),
      });
      console.log("Firebase Admin Initialized Successfully.");
  } catch (error) {
      console.error("Firebase Admin Initialization Failed:", error);
      // Decide if you want the function to fail hard here or try to continue
  }
}

const db = admin.firestore();

// --- Initialize Google AI ---
// Check if the API key exists
if (!process.env.GOOGLE_API_KEY) {
    console.error("GOOGLE_API_KEY environment variable is not set.");
    // Optionally throw an error or handle it gracefully
}
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model:"gemini-2.5-flash" }); // Or another suitable Gemini model like "gemini-1.5-flash"

// --- API Handler ---
export default async function handler(req, res) {
  try {
    const { assigneeName } = req.query;

    if (!assigneeName) {
      return res.status(400).json({ error: "Missing assigneeName" });
    }

    // Fetch tasks from Firestore (Keep this part)
    const snapshot = await db
      .collection("tasks")
      .where("assigneeName", "==", assigneeName)
      .limit(20) // Limit the number of tasks fetched for the prompt
      .orderBy("createdAt", "desc") // Get the most recent tasks
      .get();

    let taskList = "No previous tasks found."; // Default if snapshot is empty

    if (!snapshot.empty) {
        const tasks = snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
                title: data.title,
                // Handle potential missing or non-timestamp createdAt
                createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : "unknown date"
            };
        });
        taskList = tasks
            .map((t) => `- ${t.title} (created around ${new Date(t.createdAt).toLocaleDateString()})`)
            .join("\n");
    }
// --- MODIFIED Prompt for JSON Output ---
const prompt = `You are a helpful productivity assistant analyzing a user's task history.
Here are some of their recent tasks and approximate creation dates:
${taskList}

Based on this history and the current time (${new Date().toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}), suggest exactly 3 short, actionable tasks this user might typically do.

For each suggestion, provide:
1.  A concise 'title'.
2.  A brief 'description' (one sentence).
3.  A 'difficulty' level ('bronze', 'silver', or 'gold').
4.  An estimated 'points' value (integer between 10 and 100 based on title and difficulty).

Format the output strictly as a JSON array of objects, like this example:
[
  {
    "title": "Example Task 1",
    "description": "This is a sample description.",
    "difficulty": "silver",
    "points": 50
  },
  {
    "title": "Example Task 2",
    "description": "Another sample description.",
    "difficulty": "bronze",
    "points": 25
  }
]
Do not include any text before or after the JSON array.`;

    console.log("Sending prompt to Gemini for JSON...");

    // --- Generate AI suggestions using Gemini ---
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const aiResponseText = response.text()?.trim(); // Get raw text first

    console.log("Received response text from Gemini:", aiResponseText);

    let suggestions = []; // Default to empty array

    if (!aiResponseText) {
        console.warn("Gemini returned an empty response.");
        return res.status(200).json({ suggestions: [], message: "AI could not generate suggestions." });
    }

    // --- MODIFIED: Parse the response as JSON ---
    try {
        // Sometimes the model might wrap the JSON in ```json ... ```, try to remove it
        const cleanedJsonString = aiResponseText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        suggestions = JSON.parse(cleanedJsonString); // Attempt to parse the cleaned string

        // Basic validation that we got an array of objects with expected keys
        if (!Array.isArray(suggestions) || suggestions.some(s => !s.title || !s.difficulty || !s.points)) {
             console.error("Parsed JSON is not in the expected format:", suggestions);
             throw new Error("AI response format incorrect."); // Force fallback
        }

    } catch (parseError) {
        console.error("Failed to parse Gemini response as JSON:", parseError);
        console.error("Original AI Response Text:", aiResponseText);
        // Fallback: Try to extract titles if JSON fails (less ideal)
        suggestions = aiResponseText.split("\n")
            .map(s => s.trim().replace(/^- /, '')) // Basic cleanup
            .filter(Boolean)
            .map(title => ({ title: title, description: '', difficulty: '', points: '' })); // Create objects with only title

        if (suggestions.length === 0) {
             return res.status(500).json({ error: "Failed to parse AI suggestions.", rawResponse: aiResponseText });
        }
         // If fallback worked, send titles only with a warning message
         return res.status(200).json({ suggestions: suggestions, message: "AI response format issue, only titles parsed." });
    }

    res.status(200).json({ suggestions }); // Send the array of task objects

  } catch (error) {
    console.error("Error in AI suggestion handler:", error);
    res.status(500).json({ error: error.message || "Internal Server Error generating suggestions." });
  }
}

// Log environment variable status on server startup (for debugging)
console.log("ENV VAR - FIREBASE_PROJECT_ID:", process.env.FIREBASE_PROJECT_ID ? 'Set' : 'MISSING');
console.log("ENV VAR - FIREBASE_CLIENT_EMAIL:", process.env.FIREBASE_CLIENT_EMAIL ? 'Set' : 'MISSING');
console.log("ENV VAR - FIREBASE_PRIVATE_KEY exists?", !!process.env.FIREBASE_PRIVATE_KEY);
console.log("ENV VAR - GOOGLE_API_KEY exists?", !!process.env.GOOGLE_API_KEY);