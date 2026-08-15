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

        // 1. Google AI Studio Interactions API (Latest 2026 standard)
        const models = ["gemini-3.6-flash", "gemini-3-flash-preview", "gemini-2.5-flash-lite", "gemini-3-pro-preview"];
        let finalReply = null;
        let lastErrorText = "";

        for (const model of models) {
          try {
            const intRes = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey
              },
              body: JSON.stringify({
                model: model,
                input: fullPrompt
              })
            });

            if (intRes.ok) {
              const intData = await intRes.json();
              const textOut = intData.output_text || 
                              (intData.outputs && intData.outputs.find(o => o.type === "text" || o.text)?.text) || 
                              (intData.outputs && intData.outputs[0]?.text);
              if (textOut) {
                finalReply = textOut;
                break;
              }
            } else {
              lastErrorText = await intRes.text();
            }
          } catch (e) {
            lastErrorText = e.message;
          }
        }

        // 2. Fallback to generateContent API if needed
        if (!finalReply) {
          const legacyModels = ["gemini-2.0-flash", "gemini-1.5-flash-8b", "gemini-1.5-pro"];
          for (const gModel of legacyModels) {
            try {
              const genRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${gModel}:generateContent?key=${apiKey}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [{ role: "user", parts: [{ text: fullPrompt }] }]
                })
              });
              if (genRes.ok) {
                const gData = await genRes.json();
                finalReply = gData.candidates?.[0]?.content?.parts?.[0]?.text;
                if (finalReply) break;
              }
            } catch (e) {}
          }
        }

        if (!finalReply) {
          return new Response(JSON.stringify({ error: "Unable to generate AI answer", details: lastErrorText }), {
            status: 502,
            headers: { "Content-Type": "application/json" }
          });
        }

        return new Response(JSON.stringify({ reply: finalReply }), {
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
