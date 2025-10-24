// src/app/api/aiSuggest/route.js
import admin from "firebase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from 'next/server'; // Import NextResponse for app router

// --- Firebase Admin Initialization ---
// Make sure this runs only once
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, "\n"),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
      }),
    });
    console.log("Firebase Admin Initialized Successfully for /api/aiSuggest.");
  } catch (error) {
    console.error("Firebase Admin Initialization Failed:", error);
    // Consider how critical this is. If the API cannot function without Firebase,
    // you might want to prevent the model from being initialized or handle errors later.
  }
}
const db = admin.firestore();

// --- Initialize Google AI ---
let model; // Declare model variable outside the try block
try {
    if (!process.env.GOOGLE_API_KEY) {
        throw new Error("GOOGLE_API_KEY environment variable is not set.");
    }
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    // Specify the model name - ensure "gemini-2.5-flash" is valid or use "gemini-1.5-flash-latest"
    model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    console.log("Google AI Model Initialized Successfully.");
} catch (error) {
    console.error("Google AI Initialization Failed:", error);
    // Model will remain undefined, errors will be caught in the handler
}


// --- Export GET handler for App Router ---
export async function GET(request) {
  // Check if AI model failed to initialize
  if (!model) {
      console.error("Google AI Model is not initialized. Cannot process request.");
      return NextResponse.json({ error: "AI service initialization failed." }, { status: 503 }); // 503 Service Unavailable
  }
  // Check if Firebase Admin failed to initialize (if critical)
  // You might add a check here if db access is absolutely required before proceeding

  try {
      // Get query parameters from the URL object
      const { searchParams } = new URL(request.url);
      const assigneeName = searchParams.get('assigneeName');

      if (!assigneeName) {
        // Use NextResponse for JSON responses
        return NextResponse.json({ error: "Missing assigneeName" }, { status: 400 });
      }

      // --- Fetch tasks from Firestore ---
      let taskList = "No previous tasks found."; // Default
      try {
          const snapshot = await db
            .collection("tasks")
            .where("assigneeName", "==", assigneeName)
            .limit(20)
            .orderBy("createdAt", "desc")
            .get();

          if (!snapshot.empty) {
              const tasks = snapshot.docs.map((doc) => {
                  const data = doc.data();
                  return {
                      title: data.title || "Untitled Task", // Add fallback
                      createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : "unknown date"
                  };
              });
              taskList = tasks
                  .map((t) => `- ${t.title} (created around ${new Date(t.createdAt).toLocaleDateString()})`)
                  .join("\n");
          }
      } catch (firestoreError) {
          console.error("Error fetching tasks from Firestore:", firestoreError);
          // Decide how to proceed - maybe use default taskList or return an error
          // For now, we'll proceed with the default "No previous tasks found."
      }


      // --- Prompt ---
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

      // --- Generate AI suggestions ---
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const aiResponseText = response.text()?.trim();

      console.log("Received response text from Gemini:", aiResponseText);

      let suggestions = [];
      if (!aiResponseText) {
          console.warn("Gemini returned an empty response.");
          return NextResponse.json({ suggestions: [], message: "AI could not generate suggestions." }, { status: 200 });
      }

      // --- Parse the response as JSON ---
      try {
          const cleanedJsonString = aiResponseText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
          suggestions = JSON.parse(cleanedJsonString);

          if (!Array.isArray(suggestions) || suggestions.some(s => typeof s !== 'object' || !s.title || !s.difficulty || typeof s.points !== 'number' )) {
               console.error("Parsed JSON is not in the expected format:", suggestions);
               throw new Error("AI response format incorrect.");
          }

      } catch (parseError) {
          console.error("Failed to parse Gemini response as JSON:", parseError);
          console.error("Original AI Response Text:", aiResponseText);
          // Fallback
          suggestions = aiResponseText.split("\n")
              .map(s => s.trim().replace(/^- /, ''))
              .filter(Boolean)
              .map(title => ({ title: title, description: '', difficulty: '', points: '' })); // Provide default empty values

          if (suggestions.length === 0) {
               // If even fallback fails, return a clearer error
               return NextResponse.json({ error: "Failed to parse AI suggestions.", rawResponse: aiResponseText }, { status: 500 });
          }
           // Send fallback data with a message
           return NextResponse.json({ suggestions: suggestions, message: "AI response format issue, only titles parsed." }, { status: 200 });
      }

      // Return success response using NextResponse
      return NextResponse.json({ suggestions }, { status: 200 });

  } catch (error) {
      console.error("Error in AI suggestion handler:", error);
      const errorMessage = error.message || "Internal Server Error generating suggestions.";
      const status = error.status || 500; // Use status code from error if available
      // Return error response using NextResponse
      return NextResponse.json({ error: errorMessage }, { status: status });
  }
}

// Keep env var logs - they run when the serverless function initializes
console.log("ENV VAR - FIREBASE_PROJECT_ID:", process.env.FIREBASE_PROJECT_ID ? 'Set' : 'MISSING');
console.log("ENV VAR - FIREBASE_CLIENT_EMAIL:", process.env.FIREBASE_CLIENT_EMAIL ? 'Set' : 'MISSING');
console.log("ENV VAR - FIREBASE_PRIVATE_KEY exists?", !!process.env.FIREBASE_PRIVATE_KEY);
console.log("ENV VAR - GOOGLE_API_KEY exists?", !!process.env.GOOGLE_API_KEY);