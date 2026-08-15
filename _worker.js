// Helper for SHA-256 password hashing
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Student Registration: /api/auth/register
    if (url.pathname === "/api/auth/register" && request.method === "POST") {
      try {
        const { fullName, email, password, classLevel } = await request.json();
        if (!fullName || !email || !password) {
          return new Response(JSON.stringify({ error: "Missing registration fields." }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
          });
        }

        const passHash = await hashPassword(password);
        const userId = "u_" + Date.now();

        if (env.DB) {
          await env.DB.prepare(
            "INSERT INTO users (id, email, password_hash, full_name, class_level, stream) VALUES (?, ?, ?, ?, ?, ?)"
          ).bind(userId, email, passHash, fullName, classLevel || "class-11", "Science").run();
        }

        return new Response(JSON.stringify({ 
          success: true, 
          user: { id: userId, email, fullName, classLevel: classLevel || "class-11" } 
        }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Registration failed. Email may already exist.", details: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // 2. Student Login: /api/auth/login
    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      try {
        const { email, password } = await request.json();
        if (!email || !password) {
          return new Response(JSON.stringify({ error: "Email and password are required." }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
          });
        }

        const passHash = await hashPassword(password);
        let user = null;

        if (env.DB) {
          user = await env.DB.prepare(
            "SELECT id, email, full_name, class_level, stream FROM users WHERE email = ? AND password_hash = ?"
          ).bind(email, passHash).first();
        }

        if (!user && env.DB) {
          return new Response(JSON.stringify({ error: "Invalid email or password." }), {
            status: 401,
            headers: { "Content-Type": "application/json" }
          });
        }

        return new Response(JSON.stringify({ 
          success: true, 
          user: user || { email, fullName: email.split("@")[0], classLevel: "class-11" } 
        }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Login failed", details: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // 3. Progress & Quiz Sync Endpoint: /api/progress/sync
    if (url.pathname === "/api/progress/sync" && request.method === "POST") {
      try {
        const { userEmail, type, classLevel, subjectId, chapterId, score, totalQuestions, weakTopics } = await request.json();
        
        if (env.DB && userEmail) {
          if (type === "mastery") {
            const sessId = "s_" + Date.now();
            await env.DB.prepare(
              "INSERT INTO study_sessions (id, user_email, class_level, subject_id, chapter_id, study_mode, completed) VALUES (?, ?, ?, ?, ?, ?, 1)"
            ).bind(sessId, userEmail, classLevel || "class-11", subjectId || "core", chapterId, "chapter_mastery").run();
          } else if (type === "quiz" || type === "mock") {
            const attemptId = "q_" + Date.now();
            await env.DB.prepare(
              "INSERT INTO quiz_attempts (id, user_email, chapter_id, score, total_questions, weak_topics) VALUES (?, ?, ?, ?, ?, ?)"
            ).bind(attemptId, userEmail, chapterId || "mock_exam", score || 0, totalQuestions || 1, weakTopics || "").run();
          }
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Progress sync error", details: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // 4. AI API Endpoint: /api/chat
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

        // High-capacity free tier models
        const activeModels = [
          "gemini-2.5-flash-lite",
          "gemini-3.5-flash-lite",
          "gemini-3.1-flash-lite",
          "gemini-3.6-flash",
          "gemini-3.7-flash"
        ];

        let finalReply = null;
        let lastError = "";

        for (const model of activeModels) {
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
              let text = "";
              if (intData.steps && Array.isArray(intData.steps)) {
                for (const step of intData.steps) {
                  if (step.type === "model_output" && Array.isArray(step.content)) {
                    for (const part of step.content) {
                      if (part.text) text += part.text;
                    }
                  }
                }
              }
              if (!text) {
                text = intData.output_text || (intData.outputs && intData.outputs[0]?.text);
              }
              if (text) {
                finalReply = text;
                break;
              }
            } else if (intRes.status === 429) {
              lastError = "Rate limit on " + model;
              continue;
            } else {
              lastError = await intRes.text();
            }
          } catch (e) {
            lastError = e.message;
          }
        }

        if (!finalReply) {
          return new Response(JSON.stringify({ 
            error: "⏱️ AI capacity is busy right now. Please wait 15 seconds and try again.", 
            details: lastError 
          }), {
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

    // 5. Serve all static files (index.html, curriculum.json, notes.json)
    return env.ASSETS.fetch(request);// 4. Feedback & Quality Control Endpoint: /api/feedback
    if (url.pathname === "/api/feedback" && request.method === "POST") {
      try {
        const { userEmail, chapterId, reportType, details } = await request.json();
        console.log(`[Feedback Report] From: ${userEmail || 'Anonymous'}, Type: ${reportType}, Chapter: ${chapterId}, Details: ${details}`);
        
        return new Response(JSON.stringify({ 
          success: true, 
          message: "Thank you for helping maintain high academic accuracy! Your report has been logged." 
        }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Failed to record feedback" }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
  }
};
