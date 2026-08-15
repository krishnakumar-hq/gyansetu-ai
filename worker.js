/**
 * GyanSetu AI - Cloudflare Worker Backend
 * Provides secure server-side API endpoints & Gemini AI proxy
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Handle CORS Preflight Requests
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // 2. Health Check Route
    if (url.pathname === "/api/health" && request.method === "GET") {
      return new Response(
        JSON.stringify({
          status: "ok",
          app: "GyanSetu AI",
          version: "1.0.0",
          timestamp: new Date().toISOString(),
        }),
        {
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // 3. Secure AI Explanation Route
    if (url.pathname === "/api/ai/explain" && request.method === "POST") {
      try {
        if (!env.GEMINI_API_KEY) {
          return new Response(
            JSON.stringify({
              error: "AI service configuration error: GEMINI_API_KEY is not set in Worker secrets.",
            }),
            {
              status: 500,
              headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            }
          );
        }

        const body = await request.json();
        const {
          class_level = "11",
          subject = "Mathematics",
          chapter = "",
          exercise = "",
          question_number = "",
          question_text = "",
          source_solution = "",
          user_prompt = "Explain this step-by-step in simple terms for an NEB student.",
          language = "English",
        } = body;

        // Build pedagogical lesson-aware prompt grounded strictly in the source solution
        const systemPrompt = `You are GyanSetu AI, an expert, patient educational assistant for Nepalese Class 11 and Class 12 students following the official NEB (National Examination Board) curriculum.

Context:
- Class: ${class_level}
- Subject: ${subject}
- Chapter: ${chapter}
- Exercise / Topic: ${exercise}
- Question ${question_number}: ${question_text}

Official Source Solution (Ground Truth):
"""
${source_solution}
"""

Student Request:
"${user_prompt}"

Instructions:
1. Ground your explanation strictly on the provided Official Source Solution.
2. Break down each mathematical or conceptual step clearly and explain WHY that step was taken.
3. Keep the tone encouraging, clear, and easy for an NEB student to understand.
4. Format all mathematical equations using standard LaTeX ($...$ for inline math and $$...$$ for block formulas).
5. Preferred response language: ${language === "Nepali" ? "Nepali" : language === "Mixed" ? "Simple English with Nepali contextual terms where helpful" : "Clear English"}.
6. Do NOT invent new problem statements or conflicting answers.`;

        // Request to Google Gemini API
        const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;

        const geminiPayload = {
          contents: [
            {
              role: "user",
              parts: [{ text: systemPrompt }],
            },
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 1500,
          },
        };

        const aiResponse = await fetch(geminiEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(geminiPayload),
        });

        if (!aiResponse.ok) {
          const errorData = await aiResponse.text();
          return new Response(
            JSON.stringify({
              error: "Gemini API request failed",
              details: errorData,
            }),
            {
              status: aiResponse.status,
              headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            }
          );
        }

        const data = await aiResponse.json();
        const generatedText =
          data?.candidates?.[0]?.content?.parts?.[0]?.text ||
          "No explanation could be generated at this time.";

        return new Response(
          JSON.stringify({
            success: true,
            explanation: generatedText,
            meta: {
              class_level,
              subject,
              chapter,
              exercise,
              question_number,
            },
          }),
          {
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json",
            },
          }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({
            error: "Failed to process AI explanation request",
            message: err.message,
          }),
          {
            status: 500,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          }
        );
      }
    }

    // 4. Static Asset Serving / Fallback
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    // Fallback response for unhandled endpoints
    return new Response(
      "GyanSetu AI Backend Worker is active. Use /api/health or frontend routes.",
      {
        headers: { "Content-Type": "text/plain" },
      }
    );
  },
};
