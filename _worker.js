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

    // 4. Feedback & Quality Control Endpoint: /api/feedback
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

    // 5. Lesson-Aware AI API Endpoint: /api/chat
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

        const isEnglish = (subjectName || "").toLowerCase().includes("english");
        const isNepali = (subjectName || "").toLowerCase().includes("nepali") || (subjectName || "").includes("नेपाली");

        let domainInstructions = "";
        if (isEnglish) {
          domainInstructions = `
Subject-Specific Rules for NEB Compulsory English:
1. Ground your explanation in the specific lesson/text (${chapterName}) from the official CDC Grade 11/12 English syllabus.
2. For Literature (Short Stories, Poems, Essays, Plays):
   - Analyze central themes, plot conflicts, character motivations, narrator point of view, tone, and literary devices (metaphor, simile, personification, symbolism, irony, imagery).
   - For character questions, provide rich character sketches and psychological analysis.
3. For Language & Contextual Grammar:
   - Provide clear grammatical rules, sentence structures (e.g. reported speech, modal verbs, conditionals, causative verbs, connectives, passive voice, question tags), and clear contextual examples.
   - Explain vocabulary with context-based meanings, synonyms, and antonyms.
4. For NEB Board Exam Answers:
   - Provide structured, high-scoring study answers (2-mark concise answers and 5-mark well-structured analytical answers).
   - Label model answers clearly as "AI-Generated Study Answer".`;
        } else if (isNepali) {
          domainInstructions = `
Subject-Specific Rules for NEB अनिवार्य नेपाली:
1. प्रस्तुत पाठ (${chapterName}) पाठ्यक्रम विकास केन्द्र (CDC) को कक्षा ११/१२ को अनिवार्य नेपाली पाठ्यक्रममा आधारित छ।
2. साहित्य विधा (कविता, कथा, निबन्ध, नाटक, जीवनी, नियात्रा, रिपोर्ताज, संवाद, दैनिकी, वक्तृता):
   - पाठको मूल भाव, सन्देश, सारांश, र भावार्थ स्पष्ट, सरल र स्तरीय नेपाली भाषामा बुझाउनुहोस्।
   - पात्रहरूको चरित्र चित्रण गर्दा उनीहरूको स्वभाव, भूमिका र सामाजिक सन्दर्भको विवेचना गर्नुहोस्।
3. व्याकरण र भाषिक अभ्यास:
   - पदवर्ग (नाम, सर्वनाम, विशेषण, क्रियापद, अव्यय), शब्दस्रोत, शब्दनिर्माण (उपसर्ग, प्रत्यय, समास, द्वित्व, सन्धि), काल/पक्ष, भाव/अर्थ, वाच्य र वाक्य परिवर्तनका नियमहरू उदाहरणसहित सिकाउनुहोस्।
4. परीक्षा उत्तर ढाँचा:
   - NEB बोर्ड परीक्षाका लागि आवश्यक ५ अङ्कका विवेचनात्मक तथा समीक्षात्मक उत्तरहरूको स्तरीय ढाँचा प्रस्तुत गर्नुहोस्।`;
        } else {
          domainInstructions = `
Subject-Specific Rules for NEB Science (Physics, Chemistry, Mathematics, Computer Science):
1. For numerical problems, follow the strict 7-Step Method: (1) Given Data, (2) To Find / Required, (3) Formulae Used, (4) Substitution, (5) Calculation with step-by-step arithmetic, (6) Final Answer with SI Units, (7) Explanation & NEB Exam Tips.
2. For derivations and theory, provide structured board-standard points with diagrams/equations where applicable.
3. For Computer Science, write clean standard C syntax with comments and logic breakdown.`;
        }

        // Official NEB Curriculum System Prompt
        const systemPrompt = `You are GyanSetu AI, an expert educational tutor for Nepalese Class 11 and Class 12 NEB (National Examinations Board) and CDC (Curriculum Development Centre) students.
Context:
- Class: ${classId === 'class-11' ? 'Class 11' : 'Class 12'}
- Subject: ${subjectName || 'General'}
- Current Lesson / Chapter: ${chapterName || 'General Curriculum'}
- Study Mode: ${mode || 'Lesson Study & Exam Preparation'}
- Preferred Language: ${language || 'English & Simple Nepali'}

${domainInstructions}

General Guidelines:
1. Base all academic explanations strictly on the official CDC curriculum for Nepal.
2. Keep explanations original, engaging, pedagogically sound, and directly focused on the selected lesson.
3. Do NOT copy long copyrighted textbook passages word-for-word. Provide original analytical summaries and study explanations.
4. If the student asks for an explanation in Nepali or Simple English, adapt your language style naturally.
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

    // 6. Serve all static files (index.html, curriculum.json, notes.json, manifest.json)
    return env.ASSETS.fetch(request);
  }
};
