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

        const fullPrompt = `${systemPrompt}\n\nStudent Question:\n${prompt}`;

        const intRes = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify({
            model: "gemini-3.7-flash",
            input: fullPrompt
          })
        });

        // Handle Free-Tier Rate Limits (429 Too Many Requests)
        if (intRes.status === 429) {
          return new Response(JSON.stringify({ 
            error: "⏱️ Free tier rate limit reached. Please wait 10 seconds before asking your next question." 
          }), {
            status: 429,
            headers: { "Content-Type": "application/json" }
          });
        }

        if (!intRes.ok) {
          const errText = await intRes.text();
          return new Response(JSON.stringify({ error: `Gemini API error: ${intRes.status}`, details: errText }), {
            status: 502,
            headers: { "Content-Type": "application/json" }
          });
        }

        const intData = await intRes.json();
        
        // Extract text from the Interactions API steps response
        let replyText = "";
        if (intData.steps && Array.isArray(intData.steps)) {
          for (const step of intData.steps) {
            if (step.type === "model_output" && Array.isArray(step.content)) {
              for (const part of step.content) {
                if (part.text) {
                  replyText += part.text;
                }
              }
            }
          }
        }

        if (!replyText) {
          replyText = intData.output_text || 
                      (intData.outputs && intData.outputs[0]?.text) || 
                      (intData.candidates && intData.candidates[0]?.content?.parts?.[0]?.text) ||
                      "No response generated.";
        }

        return new Response(JSON.stringify({ reply: replyText }), {
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
