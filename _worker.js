export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. AI API Endpoint: /api/chat
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body = await request.json();
        const { prompt, classId, subjectName, chapterName, mode, language } = body;

        if (!prompt) {
          return new Response(JSON.stringify({ error: "Query prompt is required." }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
          });
        }

        const apiKey = env.GEMINI_API_KEY;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "GEMINI_API_KEY is not configured in Cloudflare." }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }

        // Official NEB Curriculum System Prompt
        const systemPrompt = `You are GyanSetu AI, an expert educational tutor for Nepalese Class 11 and Class 12 NEB (National Examinations Board) Science students.
Context:
- Class: ${classId === 'class-11' ? 'Class 11' : 'Class 12'}
- Subject: ${subjectName || 'Science'}
- Chapter: ${chapterName || 'General Curriculum'}
- Mode: ${mode || 'Concept Explanation'}
- Language: ${language || 'English & Simple Nepali'}

Guidelines:
1. Base answers strictly on the official NEB/CDC syllabus for Nepal.
2. For numericals, use the 7-step method: Given, Required, Formula, Substitution, Calculation, Final Answer (with SI units), Explanation.
3. For theory, structure answers for NEB 2-mark or 4/8-mark board exam standards.
4. For Nepali/bilingual requests, provide natural Nepali-English explanations easy for Nepali high school students.
5. Maintain an encouraging academic tone. Do not claim official government affiliation.`;

        // Active Gemini models list for new Google AI Studio accounts
        const supportedModels = ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash-8b", "gemini-1.5-pro"];
        let geminiRes = null;
        let lastErrorText = "";

        for (const model of supportedModels) {
          const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          
          const res = await fetch(apiUrl, {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey
            },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [{ text: `${systemPrompt}\n\nStudent Question:\n${prompt}` }]
                }
              ],
              generationConfig: {
                temperature: 0.4,
                maxOutputTokens: 1024
              }
            })
          });

          if (res.ok) {
            geminiRes = res;
            break;
          } else {
            lastErrorText = await res.text();
          }
        }

        if (!geminiRes) {
          return new Response(JSON.stringify({ error: "Gemini API error across models", details: lastErrorText }), {
            status: 502,
            headers: { "Content-Type": "application/json" }
          });
        }

        const data = await geminiRes.json();
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";

        return new Response(JSON.stringify({ reply }), {
          headers: { "Content-Type": "application/json" }
        });

      } catch (err) {
        return new Response(JSON.stringify({ error: "Server processing error", details: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // 2. Serve all static files (index.html, curriculum.json, notes.json)
    return env.ASSETS.fetch(request);
  }
};
