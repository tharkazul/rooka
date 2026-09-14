const express = require('express');
const router = express.Router();
const db = require('../services/db');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const physiqueStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "../secure_uploads/physique");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `physique_${req.user.id}_${crypto.randomUUID()}${ext}`);
  },
});
const uploadPhysique = multer({ storage: physiqueStorage });

const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "../public/uploads/profiles");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `profile_${req.user.id}_${Date.now()}${ext}`);
  },
});
const uploadProfile = multer({ storage: profileStorage });
const { authenticateToken } = require('../services/auth');
const { sseClients, sendSSEEvent } = require('../services/sse');
const { generateWithFallback, generateImage } = require('../services/ai');
const { encrypt, decrypt } = require('../services/crypto');
const muscleLoad = require('../services/muscleLoad');
const { getUserGoalPromptContext } = require('../services/goalPromptContext');
const {
  extractAndCleanFoodItems,
  matchGarminExercise,
  getAMSDateString,
  getAMSWeekday,
  getUserGamificationContext,
  getUserLeaderboardString,
  getWeatherContext,
  getUserMacroPhase,
  getUserGoalsContext,
  generatePublicProfile,
  processTokenRefresh,
  getStravaTokenForUser,
  getRookaLevelInfo,
  calculateRookaScoreZoned,
  mapStravaSportToRooka,
  formatStepsForStrava,
  tagStravaActivity,
  getStravaActivity,
  syncAllStravaUsersOnStartup,
  triggerBackgroundSummary,
  updateUserRookaAndCheckLevel,
  triggerLevelUpCoachPrompt,
  generateQuestForUser,
  evaluateQuestsAgainstActivity,
  canAccessQuests,
  getEffectiveTokenLimit
} = require('../services/utils');

function splitCoachReply(text) {
  if (!text) return [];
  const parts = text
    .split(/(?:\r?\n)?(?:---(?:MSG|SPLIT|BREAK)---|\[\[SPLIT\]\]|<break\s*\/?>|<br\s*\/?>)(?:\r?\n)?/gi)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts : [text.trim()];
}

router.get("/api/events", authenticateToken, (req, res) => {
  const userId = req.user.id;

  // Set headers for SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable Nginx/Cloudflare buffering if applicable

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ connected: true })}\n\n`);

  // Store the client
  if (!sseClients.has(userId)) {
    sseClients.set(userId, new Set());
  }
  const clients = sseClients.get(userId);
  clients.add(res);

  // Send a heartbeat ping every 30 seconds to keep connection alive (prevents Cloudflare QUIC timeout)
  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch (err) {
      clearInterval(heartbeat);
    }
  }, 30000);

  // Remove client when connection closes
  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
    if (clients.size === 0) {
      sseClients.delete(userId);
    }
  });
});

router.get("/api/chat/history", authenticateToken, (req, res) => {
  db.all(
    `SELECT id, role, content, mood, timestamp, image_path, payload_json FROM chat_history WHERE user_id = ? ORDER BY id ASC`,
    [req.user.id],
    (err, rows) => {
      if (err)
        return res.status(500).json({ error: "Failed to load chat history." });
      res.json(rows || []);
    },
  );
});

router.post("/api/chat", authenticateToken, async (req, res) => {
  const { message, imagesBase64 } = req.body;
  db.run(`UPDATE users SET chat_count = chat_count + 1 WHERE id = ?`, [
    req.user.id,
  ]);

  let base64DataArray = [];
  let imagePathsDB = [];

  if (imagesBase64 && Array.isArray(imagesBase64)) {
    for (const b64 of imagesBase64) {
      try {
        const matches = b64.match(
          /^data:image\/([A-Za-z-+\/]+);base64,(.+)$/,
        );
        if (matches && matches.length === 3) {
          const ext = matches[1];
          const base64Data = matches[2];
          const fileName = `img_${req.user.id}_${crypto.randomUUID()}.${ext}`;
          const dir = path.join(__dirname, "secure_uploads/chat_images");
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const savePath = path.join(dir, fileName);
          fs.writeFileSync(savePath, base64Data, "base64");
          imagePathsDB.push(`/api/images/chat/${fileName}`);
          base64DataArray.push(base64Data);
        }
      } catch (e) {
        console.error("Image saving error:", e);
      }
    }
  }

  db.get(
    `SELECT coach_tone, coach_name, coach_context, athlete_context, gender, long_term_memory, daily_token_usage, common_token_usage, last_token_reset_date, daily_token_limit, subscription_tier, role, daily_image_count, last_image_reset_date FROM users WHERE id = ?`,
    [req.user.id],
    async (err, user) => {
      if (err) {
        console.error("DB Error fetching user context:", err);
        return res
          .status(500)
          .json({ error: "Failed to load athlete context." });
      }
      if (!user) {
        user = {
          coach_tone: 'hype',
          coach_name: 'Rooka',
          coach_context: 'Empathetic athletic performance coach',
          athlete_context: 'Active athlete',
          gender: 'prefer_not_to_say',
          long_term_memory: '',
          daily_token_usage: 0,
          common_token_usage: 0,
          last_token_reset_date: new Date().toISOString().split("T")[0],
          daily_token_limit: 50000,
          subscription_tier: 'rooka_plus',
          role: 'user',
          daily_image_count: 0,
          last_image_reset_date: new Date().toISOString().split("T")[0]
        };
      }

      // Token limit logic
      const todayStr = new Date().toISOString().split("T")[0];
      let currentDailyUsage = user.daily_token_usage || 0;
      let currentDailyLimit = getEffectiveTokenLimit(user);

      if (user.last_token_reset_date !== todayStr) {
        currentDailyUsage = 0;
        // Reset to their tier default limit on a new day
        currentDailyLimit = user.subscription_tier === 'rooka_plus' ? 50000 : 10000;
        db.run(
          `UPDATE users SET daily_token_usage = 0, common_token_usage = 0, daily_token_limit = ?, last_token_reset_date = ? WHERE id = ?`,
          [currentDailyLimit, todayStr, req.user.id],
        );
      }

      // Image generation quota logic (Admin tier only: 1 image/day)
      const isAdminTier = user.subscription_tier === 'admin' || user.role === 'admin';
      let dailyImageCount = user.daily_image_count || 0;
      if (user.last_image_reset_date !== todayStr) {
        dailyImageCount = 0;
        db.run(
          `UPDATE users SET daily_image_count = 0, last_image_reset_date = ? WHERE id = ?`,
          [todayStr, req.user.id]
        );
      }
      const canGenerateImage = isAdminTier && dailyImageCount < 1;

      if (currentDailyUsage > currentDailyLimit) {
        const replyText = "You have run out of tokens today, if you are eager to chat more, consider subscribing [Upgrade Page](rooka://profile?subtab=account)";
        return db.run(
          `INSERT INTO chat_history (user_id, role, content) VALUES (?, 'user', ?)`,
          [req.user.id, message],
          (err) => {
            db.run(
              `INSERT INTO chat_history (user_id, role, content, mood) VALUES (?, 'coach', ?, 'default')`,
              [req.user.id, replyText],
              (err) => {
                return res.json({ reply: replyText, mood: "default" });
              }
            );
          }
        );
      }

      // Check if the athlete recently sent this exact message (within the last 3 minutes)
      // and we already generated a coach response in a previous attempt (e.g. client connection dropped).
      db.all(
        `SELECT id, role, content, mood, timestamp FROM chat_history WHERE user_id = ? ORDER BY id DESC LIMIT 6`,
        [req.user.id],
        async (historyCheckErr, recentRows) => {
          if (!historyCheckErr && recentRows && recentRows.length > 0) {
            const userMsgTrimmed = (message || '').trim();
            const latestUserRow = recentRows.find((r) => r.role === 'user');

            if (latestUserRow && latestUserRow.content && latestUserRow.content.trim() === userMsgTrimmed) {
              const rawTs = latestUserRow.timestamp;
              const msgAgeMs = rawTs 
                ? (Date.now() - new Date(typeof rawTs === 'string' && (rawTs.includes('Z') || rawTs.includes('T')) ? rawTs : String(rawTs).replace(' ', 'T') + 'Z').getTime())
                : 0;

              // If sent within the last 3 minutes (180,000 ms) or fresh timestamp
              if (msgAgeMs >= 0 && msgAgeMs < 180000) {
                const matchedCoachRows = recentRows.filter((r) => r.role === 'coach' && r.id > latestUserRow.id);
                if (matchedCoachRows.length > 0) {
                  matchedCoachRows.reverse(); // chronological ASC
                  const existingReplies = matchedCoachRows.map((r) => r.content);
                  const existingReply = existingReplies.join('\n\n');
                  const mood = matchedCoachRows[0].mood || 'default';
                  console.log(`⚡️ Replaying existing coach response for retried message (User ${req.user.id})`);
                  return res.json({
                    reply: existingReply,
                    replies: existingReplies,
                    mood: mood,
                    planUpdated: false,
                    replayed: true,
                  });
                }
              }
            }
          }

          db.all(
            `SELECT metric, value FROM athlete_metrics WHERE user_id = ?`,
            [req.user.id],
            async (err, metricsRows) => {
              const metricsText =
                metricsRows && metricsRows.length > 0
                  ? metricsRows.map((m) => `${m.metric}: ${m.value}`).join(", ")
                  : "None explicitly recorded yet.";

              const phase = await getUserMacroPhase(req.user.id);
              try {
                db.all(
                  `SELECT name, sport_type, distance_km, moving_time_min, rooka_score, start_date, laps_json FROM activities WHERE user_id = ? ORDER BY start_date DESC LIMIT 3`,
                  [req.user.id],
                  async (err, recentActivities) => {
                const recentActivitiesText =
                  recentActivities && recentActivities.length > 0
                    ? recentActivities
                        .map(
                          (a) => {
                            let lapStr = "";
                            if (a.laps_json) {
                              try {
                                const laps = JSON.parse(a.laps_json);
                                if (laps && laps.length > 0) {
                                  lapStr = " | Laps: " + laps.map(l => {
                                    let pace = "";
                                    if (l.average_speed > 0) {
                                      const paceSecs = 1000 / l.average_speed;
                                      const m = Math.floor(paceSecs / 60);
                                      const s = Math.floor(paceSecs % 60);
                                      pace = `, ${m}:${s.toString().padStart(2, '0')}/km`;
                                    }
                                    const hr = l.average_heartrate ? `, ${Math.round(l.average_heartrate)}bpm` : "";
                                    return `[${l.name || 'Lap'}: ${(l.distance/1000).toFixed(1)}km in ${Math.round(l.moving_time/60)}m${pace}${hr}]`;
                                  }).join(" ");
                                }
                              } catch (e) {}
                            }
                            return `- ${getAMSDateString(a.start_date)} at ${new Date(a.start_date).toLocaleTimeString("en-GB", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit" })}: ${a.name} (${a.sport_type}) | ${parseFloat(a.distance_km).toFixed(1)}km | ${Math.round(a.moving_time_min)}min | ${Math.round(a.rooka_score || 0)} Rooka${lapStr}`;
                          }
                        )
                        .join("\n                    ")
                    : "No recent activities recorded.";

                db.all(
                  `SELECT sport_type, start_date, sets_json FROM activities WHERE user_id = ? AND sets_json IS NOT NULL AND sets_json != '[]' ORDER BY start_date DESC LIMIT 5`,
                  [req.user.id],
                  async (err, recentSetsRows) => {
                    let recentSetsText = "No recent strength/PB data recorded.";
                    if (recentSetsRows && recentSetsRows.length > 0) {
                      recentSetsText = recentSetsRows
                        .map(
                          (row) =>
                            `Date: ${row.start_date}, Sport: ${row.sport_type}, Details: ${row.sets_json}`,
                        )
                        .join("\n");
                    }

                    const todayStr = getAMSDateString();
                    db.all(
                      `SELECT * FROM micro_plan WHERE user_id = ? AND date >= ? ORDER BY date ASC LIMIT 14`,
                      [req.user.id, todayStr],
                      async (err, planRows) => {
                        const planText =
                          planRows && planRows.length > 0
                            ? planRows
                                .map(
                                  (p) =>
                                    `- ${p.date}: ${p.sport} - ${p.description} (${p.target_rooka || p.target_tss || 0} Rooka)`,
                                )
                                .join("\n                    ")
                            : "No upcoming workouts scheduled.";

                        const milestonesText = await getUserGoalsContext(req.user.id);
                        const goalContext = await getUserGoalPromptContext(req.user.id, user);

                            db.all(
                              `SELECT body_part, severity, notes, status FROM athlete_niggles WHERE user_id = ?`,
                              [req.user.id],
                              async (err, allNiggleRows) => {
                                const activeNiggles = (allNiggleRows || []).filter((n) => n.status === "active");
                                const resolvedNiggles = (allNiggleRows || []).filter((n) => n.status === "resolved");

                                let nigglesText = "No active injuries or niggles reported. Athlete is 100% healthy with no active physical limitations.";
                                if (activeNiggles.length > 0) {
                                  nigglesText = activeNiggles
                                    .map(
                                      (n) =>
                                        `- ${n.body_part}: Severity ${n.severity}/5. ${n.notes || ""}`,
                                    )
                                    .join("\n                    ");
                                }

                                let resolvedNigglesText = "";
                                if (resolvedNiggles.length > 0) {
                                  resolvedNigglesText =
                                    "\n                    RESOLVED / HEALED INJURIES (NO LONGER ACTIVE):\n                    " +
                                    resolvedNiggles
                                      .map((n) => `- ${n.body_part}: FULLY HEALED / RESOLVED`)
                                      .join("\n                    ");
                                }
                                    // Muscle load now comes from the athlete's own activities via the
                                    // shared model, not from `athlete_muscle_status`. That table was filled
                                    // by one AI call per synced activity, so it held nothing for anyone
                                    // whose activities landed after the daily quota ran out — and the coach
                                    // then reasoned from "no significant fatigue" about an athlete in the
                                    // middle of a heavy block. These are the numbers the athlete is looking
                                    // at on the Progress tab.
                                    db.all(
                                      `SELECT ${muscleLoad.ACTIVITY_COLUMNS} FROM activities WHERE user_id = ? AND substr(replace(start_date, 'T', ' '), 1, 10) >= date('now', '-8 days')`,
                                      [req.user.id],
                                      async (err, muscleRows) => {
                                        const muscleStatusText = muscleLoad.describeMuscleStatus(
                                          err ? [] : muscleRows || []
                                        );

                                        db.all(
                                          `SELECT sport_type, test_name, metrics_json, coach_notes, completed_at FROM benchmark_tests WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
                                          [req.user.id],
                                          async (err, benchmarkRows) => {
                                            let benchmarkText = "No completed benchmark test yet. Encourage athlete to complete their initial onboarding benchmark assessment.";
                                            if (benchmarkRows && benchmarkRows.length > 0) {
                                              benchmarkText = benchmarkRows.map(b => `- ${b.sport_type} [${b.test_name}]: ${b.metrics_json} (${b.coach_notes || 'Completed'})`).join("\n                    ");
                                            }

                                            db.all(
                                              `SELECT role, content FROM (SELECT * FROM chat_history WHERE user_id = ? ORDER BY id DESC LIMIT 6) ORDER BY id ASC`,
                                              [req.user.id],
                                              async (err, historyRows) => {
                                                const todayStr = getAMSDateString();
                                                db.get(
                                                  `SELECT logged_carbs, logged_protein, logged_fat, items_summary FROM daily_diet_logs WHERE user_id = ? AND date = ?`,
                                                  [req.user.id, todayStr],
                                                  async (err, todayDietRow) => {
                                                    const loggedCarbs = Math.round((todayDietRow && todayDietRow.logged_carbs) || 0);
                                                    const loggedProtein = Math.round((todayDietRow && todayDietRow.logged_protein) || 0);
                                                    const loggedFat = Math.round((todayDietRow && todayDietRow.logged_fat) || 0);
                                                    const itemsSummary = todayDietRow && todayDietRow.items_summary ? todayDietRow.items_summary.trim() : "";

                                                    let nutritionContextText = "TODAY'S LOGGED NUTRITION (SINGLE SOURCE OF TRUTH FOR DIET):\n";
                                                    if (itemsSummary || loggedCarbs > 0 || loggedProtein > 0 || loggedFat > 0) {
                                                      nutritionContextText += `- Current Logged Intake: ${loggedCarbs}g Carbs, ${loggedProtein}g Protein, ${loggedFat}g Fat\n`;
                                                      nutritionContextText += `- Items Already Logged Today: ${itemsSummary || "None explicitly named"}`;
                                                    } else {
                                                      nutritionContextText += "No food or drinks have been logged yet today. (0g Carbs, 0g Protein, 0g Fat)";
                                                    }

                                    // Declared out here so the catch below can release it.
                                    let releaseTx = null;
                                    try {
                                      let cleanHistory = [];

                                      (historyRows || []).forEach((row) => {
                                        let currentRole =
                                          row.role === "coach"
                                            ? "model"
                                            : "user";

                                        if (
                                          cleanHistory.length > 0 &&
                                          cleanHistory[cleanHistory.length - 1]
                                            .role === currentRole
                                        ) {
                                          cleanHistory[
                                            cleanHistory.length - 1
                                          ].parts[0].text +=
                                            "\n\n" + row.content;
                                        } else {
                                          cleanHistory.push({
                                            role: currentRole,
                                            parts: [{ text: row.content }],
                                          });
                                        }
                                      });

                                      if (
                                        cleanHistory.length > 0 &&
                                        cleanHistory[0].role !== "user"
                                      ) {
                                        cleanHistory.shift();
                                      }
                                      if (
                                        cleanHistory.length > 0 &&
                                        cleanHistory[cleanHistory.length - 1]
                                          .role === "user"
                                      ) {
                                        cleanHistory.pop();
                                      }

                                      // Deduplicate: If previous turn in cleanHistory answered this exact message,
                                      // strip it out so Gemini treats this message fresh without repetition.
                                      const incomingTrimmed = (message || "").trim();
                                      if (cleanHistory.length >= 2) {
                                        const lastTurnUser = cleanHistory[cleanHistory.length - 2];
                                        if (
                                          lastTurnUser &&
                                          lastTurnUser.role === "user" &&
                                          lastTurnUser.parts &&
                                          lastTurnUser.parts[0] &&
                                          lastTurnUser.parts[0].text &&
                                          lastTurnUser.parts[0].text.trim() === incomingTrimmed
                                        ) {
                                          cleanHistory.pop();
                                          cleanHistory.pop();
                                        }
                                      }

                                      const todayStr = getAMSDateString();
                                      const next7Days = Array.from(
                                        { length: 7 },
                                        (_, i) => {
                                          const d = new Date();
                                          d.setDate(d.getDate() + i);
                                          return `${getAMSWeekday(d)}: ${getAMSDateString(d)}`;
                                        },
                                      ).join(", ");

                                      const gamification =
                                        await getUserGamificationContext(
                                          req.user.id,
                                        );

                                      const coachName = user.coach_name || 'Rooka';
                                      let coachToneText = user.coach_tone;
                                      if (user.coach_tone === 'custom' || user.coach_tone === 'Configure own coach') {
                                          coachToneText = user.coach_context ? `Custom tone: ${user.coach_context}` : 'Custom coach persona';
                                      }

                                      const systemPrompt = `You are a real, highly experienced endurance coach sending text messages to an athlete.
                    Name coach: ${coachName}
                    Tone: ${coachToneText}
                    ${user.coach_context ? `Coach Custom Context & Rules: ${user.coach_context}` : ''}
                    
                    PERSONA & TONE ENFORCEMENT (CRITICAL):
                    - Your active voice, vocabulary, and personality MUST STRICTLY match 'Tone: ${coachToneText}'.
                    - DO NOT let previous message history bleed into your active tone. If previous conversation turns used flirty language, pet names (e.g. "babe", "my love"), or cheerleader hype that contradicts your current assigned Tone, you MUST DISREGARD that style completely.
                    - Adopt your assigned tone with 100% fidelity on every single response.
                    - CONCISE CHAT APP COMMUNICATION (MANDATORY): You are texting inside a mobile chat application (like WhatsApp or iMessage). Formulate all responses to be concise, punchy, and direct. Keep regular turns compact (typically 1 to 3 short sentences/paragraphs max). Never output long monolithic walls of text.
                    - MULTI-MESSAGE SPLITTING (<br> or ---MSG---): If you want to send multiple separate messages (e.g. to convey distinct thoughts, convey a larger message, or text more naturally in separate consecutive bubbles), separate each message with \`<br>\` or \`---MSG---\`. The app will automatically split and render them into separate consecutive chat bubbles in the exact right order.
                    Current Training Phase: ${phase || user.training_phase || "Base/General"}
                    
                    TIME CONTEXT:
                    Current Date & Time: ${todayStr} at ${new Date().toLocaleTimeString("en-GB", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit" })}
                    The upcoming week mapping is:
                    ${next7Days}
                    
                    ${await getWeatherContext()}
                    
                    ATHLETE CONTEXT:
                    Gender: ${user.gender || "Prefer not to share"}
                    ${user.athlete_context}
                    
                    ${nutritionContextText}
                    
                    ${(user.gender === "Female" || user.gender === "Prefer not to share" || user.gender === "Prefer not to say") && user.cycle_tracking_enabled !== 0 ? "IMPORTANT FOR FEMALE & ATHLETES TRACKING CYCLES: Proactively ask when her/their menstrual cycle starts to optimize training. Track these dates in your long term memory. Suggest and distribute exercises carefully, reducing physical demand during the strenuous days of the cycle." : ""}

                    LONG-TERM MEMORY (From Past Conversations):
                    ${user.long_term_memory}

                    PHYSIOLOGICAL METRICS:
                    ${metricsText}
                    
                     UPCOMING EVENTS/MILESTONES:
                    ${milestonesText}

                    ${goalContext.promptContext}

                    UPCOMING SCHEDULED WORKOUTS (Microplan):
                    ${planText}
                    
                    RECENT COMPLETED WORKOUTS (For context):
                    ${recentActivitiesText}

                    RECENT STRENGTH & PB HISTORY:
                    ${recentSetsText}
                    
                    MUSCLE STATUS (Fatigue vs Peak Development):
                    ${muscleStatusText}

                    BENCHMARK ASSESSMENTS & PERFORMANCE BASELINES:
                    ${benchmarkText}
                    
                    ACTIVE INJURIES / NIGGLES (REAL-TIME SINGLE SOURCE OF TRUTH):
                    ${nigglesText}${resolvedNigglesText}

                    INJURY TRUTH & ACTIVE STATUS DIRECTIVES (CRITICAL):
                    - The ACTIVE INJURIES section above is the SINGLE SOURCE OF TRUTH regarding physical injuries.
                    - If an injury or body part (e.g. heel, knee, ankle, shoulder, back) is NOT listed under ACTIVE INJURIES or is listed under RESOLVED INJURIES, the athlete is FULLY HEALED and recovered.
                    - NEVER ask about, mention, or express concern over past injuries (such as a heel injury) if they are NOT currently in ACTIVE INJURIES. Ignore any outdated references to past injuries in long-term memory or athlete context.

                    PHASE GUIDANCE:
                    - If phase is BASE: Focus on aerobic volume and consistency. Discourage racing or excessive intensity.
                    - If phase is BUILD: Focus on progressing their threshold and VO2max intervals. Tell them it's time to push.
                    - If phase is PEAK: Focus on race-specific intensity and sharpening. Keep them focused on executing race pace perfectly.
                    - If phase is TAPER: Focus heavily on recovery and shedding fatigue. Ensure they rest up for the race.

                    CRITICAL RULES:
                    0. ACTIVITY TYPE (SPORT): The 'sport' field is REQUIRED for every workout in the JSON and MUST be exactly one of: 'Run', 'Bike', 'Swim', 'Strength', 'Rest'. Never leave it blank. For Strength workouts, you MUST include an "exerciseName" in each step.
                    1. CONCISE CHAT APPLICATION STYLE & MULTI-MESSAGE BREAKS (CRITICAL): Act like a real coach texting in a mobile chat app (such as WhatsApp or iMessage). Keep your conversational text formulated concisely, punchily, directly, and naturally (typically 1-3 short sentences or paragraphs). If you need to send multiple distinct messages or break up a larger thought into separate chat bubbles, use "<br>" or "---MSG---" between each message. The app will split them and display them in the exact right order.
                    2. RETRIES & REPEATED MESSAGES (CRITICAL): If the athlete's message seems repeated or identical to a previous message (which happens when a mobile user retries after a connection error), NEVER say things like "did you want to tell me this twice?" or "you already said that". Treat it naturally and helpfully as a single message, and NEVER duplicate activity or diet logs.
                    3. NEVER repeat your previous greetings, praises, or paragraphs verbatim. Do not bring up old topics unless the athlete explicitly mentions them.
                    4. Always use metric measurements exclusively (meters for distance, km/h for speed, min/km for pace). Never use imperial units. IMPORTANT: For 'distance' condition_type in the JSON steps, the condition_value MUST be in pure METERS (e.g., use 5000 for a 5km interval, NOT 5).
                    5. Respond directly with your conversational text. Do not wrap your main reply in JSON.
                    6. CRITICAL DATE CONTEXT: If an activity in the user's recent history is tagged with [TODAY], you MUST refer to it as happening "today". NEVER refer to a [TODAY] activity as "yesterday" or "last night".
                    7. INJURY GUARDRAILS:
                       - If ACTIVE INJURIES lists "No active injuries or niggles reported", treat the athlete as 100% healthy with ZERO physical restrictions.
                       - Only if an injury is currently active:
                         * Lower Body (Severity 3+): Avoid high-impact running. Substitute with swimming or indoor cycling.
                         * Grip/Hands: Substitute swimming/heavy upper-body with running or indoor cycling.
                         * Severity 5: Schedule complete rest for the affected area.
                         * Explain any substitution made due to an active injury.
                    5. BRICK WORKOUTS: If you prescribe a multi-sport Brick workout (e.g., Bike + Run), you MUST create two separate objects in the JSON array (one for "Bike", one for "Run") for that same date.
                    6. INTERVALS: To create a repeating block (e.g., 8x 1000m fast, 1min rest), use a "repeat" object in steps_json with "iterations" and an array of "steps".
                    7. SENTIMENT & SUPPORT: Pay close attention to the athlete's physical and mental state. If they mention soreness, exhaustion, poor sleep, or lack of motivation, immediately prioritize empathy and recovery. Strongly advise them to rest or dial back intensity, even if it means modifying the plan.
                    8. STRENGTH & FUNCTIONAL TRAINING PARITY (CRITICAL):
                       - Only prescribe 'Strength' workouts if the Athlete Context explicitly mentions strength training, weightlifting, or being a hybrid athlete.
                       - EXERCISE & STEP PARITY MANDATE: EVERY single exercise, station, carry, lift, or core movement described in 'details' MUST have its own corresponding repeat block or step in the 'steps' (or 'steps_json') array! NEVER omit exercises or only output 1 exercise when multiple exercises were prescribed in 'details'.
                       - For Strength workouts, put each exercise into 'steps' with "condition_type": "reps" (for reps), "distance" (in meters for carries/sled pushes, e.g. 100), or "time_sec"/"time" (for planks/timed holds). Set "condition_value" to the number of reps, meters, or seconds. Add "weight": <kg_number> and "exerciseName": "<name>" to the step object. Use standard exercise names (e.g., "Barbell Back Squat", "Farmers Carry", "Pallof Press").
                       - Between sets, use a "rest" step with "condition_type": "time_sec" and set "condition_value" to the number of SECONDS to rest (e.g., 90 for 90 seconds).
                       - On Warmup and Cooldown steps, ALWAYS include "exerciseName" specifying the mobility drills or stretches (e.g., "Cossack Squats & Inchworms", "Couch Stretch & Pigeon Pose").
                       - Reference the Athlete Context for their past weights, and try to prescribe slight progressive overload (e.g., +2.5kg).
                    9. TARGETS: If a workout step requires a specific pace or power target:
                       - For exact pace (e.g. 4:15 min/km): set "target_type": "pace.exact" and set "target_value": "4:15" (do NOT include "min/km" in target_value!).
                       - For exact power (e.g. 250W): set "target_type": "power.exact" and set "target_value": "250" (do NOT include "W" in target_value!).
                       - For a power zone instead of an exact wattage: set "target_type": "power.zone" and "zone": <1-7>.
                       - For HR Zones: set "target_type": "heart.rate.zone" and "zone": <1-5>.
                       - For open targets: set "target_type": "no.target".
                    10. PREDICTIVE LOGISTICS: If the WEATHER ALERT is active and the user agrees to move an outdoor workout (Bike/Run) indoors, use the JSON block to update their microplan (e.g. changing 'Bike' to 'Zwift' or 'Run' to 'Treadmill').
                    11. GAMIFICATION (CRITICAL):
                        - The athlete's current activity streak is: ${gamification.streak} days.
                        - The athlete has earned a total of ${gamification.bonusPoints} bonus rooka points.
                        - The athlete's latest earned title/badge is: "${gamification.latestTitle}".
                        - Mention their streak or title occasionally to motivate them, especially if their streak is high (e.g., "You're on a ${gamification.streak} day streak, keep the momentum going!"). Do NOT mention it every single time.
                        - IMPORTANT: Warmup and Cooldown steps should generally use "target_type": "no.target" or open intensity so the athlete can gradually ease in and elevate their heart rate without triggering out-of-zone alarms while cold. Rest and Recovery steps can be Zone 1.

                    WORKOUT PLANNING & PRESCRIPTION DETAILS (CRITICAL):
                    If you create, suggest, or modify a workout plan, you MUST append a JSON code block at the very end of your response. 
                    - To CANCEL or CLEAR a workout for a day, you MUST include that date in the JSON array and set "sport": "Rest". Otherwise, the old workout will remain in the database!
                    - WORKOUT DETAILS FIELD (CRITICAL): The 'details' field in each workout object is the athlete's primary coaching note and guide. NEVER write basic, vague one-liners like "intervals", "easy run", or "tempo session". You MUST prescribe concrete technique cues, drills, equipment (e.g. pull buoy & hand paddles, aero bars, SkiErg, sled push), specific movement focus (e.g. "focus on high heels / rapid heel recovery", "early vertical forearm EVF catch", "single-leg pedaling"), dynamic mobility warm-ups, and session fueling guidance.
                    - EXERCISE PARITY DIRECTIVE: While machine-readable structured intervals go into the "steps" JSON array, the rich human-readable drills, equipment, and technique instructions go into "details". EVERY exercise/station in 'details' MUST be represented with its own step/repeat block in 'steps'!
                    The JSON must be a valid Array of objects. Format it EXACTLY like this inside triple backticks:
                    \`\`\`json
                    [
                      {
                        "date": "YYYY-MM-DD",
                        "sport": "Run", 
                        "description": "5k Speed Intervals & Form Drills",
                        "target_rooka": 80,
                        "details": "Warm-up: 2x10 ankle rocks, 3x30m A-skips and butt kicks cueing rapid heel recovery (high heels). Main set: 8x1000m at threshold with 1min active recoveries. Cool-down: 10 min easy jog + calf mobility.",
                        "steps": [{"type": "warmup", "exerciseName": "A-Skips & Ankle Rocks", "condition_type": "time", "condition_value": 15, "target_type": "heart.rate.zone", "zone": 2}, {"type": "repeat", "iterations": 8, "steps": [{"type": "interval", "exerciseName": "1000m Threshold Interval", "condition_type": "distance", "condition_value": 1000, "target_type": "heart.rate.zone", "zone": 4}, {"type": "rest", "condition_type": "time", "condition_value": 1, "target_type": "heart.rate.zone", "zone": 1}]}, {"type": "cooldown", "exerciseName": "Easy Jog & Mobility", "condition_type": "time", "condition_value": 10, "target_type": "heart.rate.zone", "zone": 2}]
                      },
                      {
                        "date": "YYYY-MM-DD",
                        "sport": "Strength",
                        "description": "Lower Body & Hyrox Core Power",
                        "target_rooka": 45,
                        "details": "Warmup: Cossack squats, inchworms (10 min). Main: Barbell Back Squat 3x10 reps (90s rest), Farmers Carry 4x100m (60s rest), Pallof Press 3x12 reps (45s rest). Cooldown: Couch stretch & pigeon pose (5 min).",
                        "steps": [{"type": "warmup", "exerciseName": "Cossack Squats & Inchworms", "condition_type": "time", "condition_value": 10, "target_type": "no.target"}, {"type": "repeat", "iterations": 3, "steps": [{"type": "interval", "exerciseName": "Barbell Back Squat", "condition_type": "reps", "condition_value": 10, "weight": 60, "target_type": "weight"}, {"type": "rest", "condition_type": "time_sec", "condition_value": 90, "target_type": "no.target"}]}, {"type": "repeat", "iterations": 4, "steps": [{"type": "interval", "exerciseName": "Farmers Carry", "condition_type": "distance", "condition_value": 100, "weight": 20, "target_type": "weight"}, {"type": "rest", "condition_type": "time_sec", "condition_value": 60, "target_type": "no.target"}]}, {"type": "repeat", "iterations": 3, "steps": [{"type": "interval", "exerciseName": "Pallof Press", "condition_type": "reps", "condition_value": 12, "target_type": "no.target"}, {"type": "rest", "condition_type": "time_sec", "condition_value": 45, "target_type": "no.target"}]}, {"type": "cooldown", "exerciseName": "Couch Stretch & Pigeon Pose", "condition_type": "time", "condition_value": 5, "target_type": "no.target"}]
                      },
                      {
                        "date": "YYYY-MM-DD",
                        "sport": "Rest", 
                        "description": "Active Recovery",
                        "target_rooka": 0,
                        "details": "Rest and recovery. 15-min light walk, hydration, and 3 minutes box breathing.",
                        "steps": []
                      }
                    ]
                    \`\`\`
                    
                    IMAGE GENERATION (NEW):
                    If the athlete asks for an illustration, visualization, diagram, or picture of an exercise, route, pose, or anything else, you can seamlessly generate an image by outputting a Markdown image tag with the following URL format:
                    \`![Description of Image](https://image.pollinations.ai/prompt/{URL_ENCODED_PROMPT}?nologo=true)\`
                    Replace {URL_ENCODED_PROMPT} with a highly detailed, descriptive prompt for an image generation model. Always include '?nologo=true'. The app will automatically render this image!

                    ATHLETE METRICS MEMORY (CRITICAL):
                    If the athlete mentions a new personal best, physiological metric, or baseline number (e.g., FTP, 5K pace, Max HR, resting heart rate, swim threshold), you MUST output an additional JSON block at the very end of your response to commit it to your long-term memory. Format it exactly like this inside triple backticks:
                    \`\`\`json
                    {
                      "type": "metrics",
                      "data": {
                        "FTP": "285W",
                        "5K Pace": "4:05 min/km"
                      }
                    }
                    \`\`\`
                    
                    MANUAL ACTIVITY LOGGING (CRITICAL REQUIREMENT):
                    If the athlete mentions completing, running, cycling, swimming, lifting, or performing ANY workout, run, or activity in their message (e.g. "I ran 10km", "Just finished 10k", "Did a 45 min run"), YOU MUST output a "log_activity" JSON block at the very end of your response.
                    DO NOT ONLY praise them in conversational text—YOU MUST INCLUDE THE "log_activity" JSON BLOCK! If you do not include the JSON block, the workout WILL NOT be saved to their activity log ("My Log")!
                    Always estimate reasonable values for distance_km, moving_time_min, and rooka_score if not explicitly specified.
                    Format it EXACTLY like this inside triple backticks:
                    \`\`\`json
                    {
                      "type": "log_activity",
                      "data": {
                        "name": "10k Run",
                        "sport_type": "Run",
                        "distance_km": 10.0,
                        "moving_time_min": 50,
                        "rooka_score": 50
                      }
                    }
                    \`\`\`

                    ${(user.gender === "Female" || user.gender === "Prefer not to share" || user.gender === "Prefer not to say") && user.cycle_tracking_enabled !== 0 ? `MENSTRUAL CYCLE LOGGING:
                    If the athlete mentions that their period/menstrual cycle started today or on a specific date, you MUST update the cycle tracking system by outputting an additional JSON block. Format it exactly like this inside triple backticks:
                    \`\`\`json
                    {
                      "type": "log_cycle",
                      "data": {
                        "start_date": "YYYY-MM-DD"
                      }
                    }
                    \`\`\`
` : ""}

                    DIET & MEAL LOGGING DIRECTIVES (CRITICAL - DELTA ONLY):
                    When the athlete tells you about food or drink they consumed (e.g. "I just had a pepperoni pizza", "protein shake with 24g protein", "ate 2 bananas", "had a cookie"):
                    1. ONLY output a "log_diet" JSON block if the athlete mentions NEW food/drink items in their LATEST text message.
                    2. DELTA ONLY (CRITICAL): You MUST estimate the macro nutritional values (carbs, protein, fat) for ONLY the specific NEW item(s) in this single message. NEVER calculate cumulative daily totals, and NEVER sum up previous meals.
                    3. DO NOT RE-LOG PAST FOODS: NEVER include or re-emit foods already listed under "TODAY'S LOGGED NUTRITION" or mentioned in previous turns. Even if the user says "and besides that...", they are only adding the new item!
                    4. CLEAN ITEM NAMES: Provide concise, clean food descriptions in an "items" array without conversational filler.
                       - NEVER include phrases like "and besides that", "also had", "and a", "had a", "ate a".
                       - NEVER join multiple distinct foods into one string with 'and' (e.g. DO NOT do ["Pizza and a shake"]). Put them into separate array elements: ["Pepperoni pizza", "Protein shake (24g protein)"].
                    5. Format EXACTLY like this inside triple backticks:
                    \`\`\`json
                    {
                      "type": "log_diet",
                      "data": {
                        "items": ["Protein shake (24g protein)"],
                        "carbs": 5,
                        "protein": 24,
                        "fat": 2
                      }
                    }
                    \`\`\`
                    *(If multiple new items are mentioned in one message, e.g. "had a banana and an apple", list both in "items": ["1 Banana", "1 Apple"] with their combined delta macros).*

                    WEIGHT LOGGING:
                     If the athlete mentions their current weight, you MUST log it by outputting an additional JSON block. Format it exactly like this inside triple backticks:
                     \`\`\`json
                     {
                       "type": "log_weight",
                       "data": {
                         "weight_kg": 75.5,
                         "body_fat_percent": 15.0
                       }
                     }
                     \`\`\`

                     INJURY & NIGGLE TRACKING DIRECTIVES:
                     When the athlete reports pain, injury, tightness, soreness, discomfort, or a niggle in any body part (e.g. "My heel hurts", "Left Achilles tightness", "knee pain", "sore quads"):
                     You MUST log it by outputting a JSON block:
                     \`\`\`json
                     {
                       "type": "log_niggle",
                       "data": {
                         "body_part": "left_ankle_foot",
                         "severity": 3,
                         "notes": "Heel pain"
                       }
                     }
                     \`\`\`
                     - Valid body_parts: head_neck, left_shoulder, right_shoulder, chest, upper_back, lower_back, core, left_arm, right_arm, left_glute, right_glute, left_quad, right_quad, left_hamstring, right_hamstring, left_knee, right_knee, left_calf, right_calf, left_ankle_foot, right_ankle_foot.
                     - Severity: integer from 1 (mild/twinge) to 5 (severe/cannot train). If the athlete mentions a 1-10 rating, convert to 1-5 (e.g. 3/10 -> 2 or 3, 6/10 -> 3, 10/10 -> 5).
                     - If the athlete reports that an injury/niggle has healed, resolved, or is pain-free (e.g. "my heel is completely recovered", "knee feels 100% now"):
                     \`\`\`json
                      {
                        "type": "resolve_niggle",
                        "data": {
                          "body_part": "left_ankle_foot"
                        }
                      }
                      \`\`\`

                      ${
                        !isAdminTier
                          ? `VISUAL COACHING & IMAGE STATUS: DISABLED (ADMIN ACCESS ONLY).
                      If the athlete asks you to generate, show, or draw an image, photograph, or visual guide:
                      Politely explain the coaching cues and biomechanics in text and mention: "AI visual coaching guides and custom race artwork are currently in testing for administrators."
                      NEVER output a generate_image JSON block for non-admin athletes.`
                          : dailyImageCount >= 1
                          ? `VISUAL COACHING & IMAGE STATUS: DAILY LIMIT REACHED (1 of 1 visual credits used today).
                      If the athlete asks for an image/photo/visual guide:
                      Explain the coaching cues and biomechanics thoroughly in text and let them know: "You've used your 1 visual coaching credit for today (it resets tomorrow)!"
                      NEVER output a generate_image JSON block when the daily credit is already used.`
                          : `VISUAL COACHING & HIGH-FIDELITY IMAGE GENERATION DIRECTIVES (NANO BANANA ENGINE):
                      You have 1 visual guide credit available for this Admin athlete today.
                      When the athlete asks for a visual explanation or asks to generate an image:
                      Explain the concept clearly in text AND output a JSON block to generate the studio photograph following the Nano Banana 4-part formula:
                      \`\`\`json
                      {
                        "type": "generate_image",
                        "data": {
                          "prompt": "Studio sports photography of a real human athlete executing [precise movement/technique details, exact limb angles, and body alignment]. Deep depth of field, f/8 aperture, razor-sharp focus across entire body and equipment, bright even studio/pool/track lighting, freeze-frame, 1/4000s shutter speed, zero motion blur, authentic human anatomy, clean background, 8k commercial sports quality",
                          "caption": "Short descriptive title of the visual guide",
                          "aspectRatio": "1:1"
                        }
                      }
                      \`\`\`
                      DO NOT request illustrations, drawings, sketches, or cartoons, and NEVER use words like 'cinematic depth of field' or 'motion blur' which cause distortion. Always request razor-sharp, studio-lit commercial sports photography!`
                      }`;

                                      let aiReply = await generateWithFallback(
                                        message,
                                        systemPrompt,
                                        cleanHistory,
                                        base64DataArray,
                                        req.user.id,
                                      );
                                      let planUpdated = false;
                                      const pendingImageTasks = [];
                                      let questCelebrationPrompt = null;

                                      // Wrap the plan mutations below and the chat_history writes further down
                                      // in a single transaction, so a workout can never get committed to the
                                      // plan without the chat message that produced it being saved (or vice versa).
                                      // Serialised: one SQLite connection means two overlapping chat
                                      // requests would otherwise interleave their BEGIN/COMMIT and
                                      // commit each other's half-written work.
                                      releaseTx = await db.beginSerializedTransaction("chat");

                                      const jsonMatches = [
                                        ...aiReply.matchAll(
                                          /```(?:json)?\n?([\s\S]*?)```/gi,
                                        ),
                                      ];

                                      // Fallback: if no fenced code block was found, check if a raw JSON object exists in the reply
                                      if (jsonMatches.length === 0) {
                                        const rawJsonMatch = aiReply.match(/\{\s*"type"\s*:\s*"(?:log_diet|log_nutrition|log_activity|log_weight|log_cycle|log_niggle|resolve_niggle|metrics|generate_image)"[\s\S]*?\}/);
                                        if (rawJsonMatch) {
                                          jsonMatches.push([rawJsonMatch[0], rawJsonMatch[0]]);
                                        }
                                      }

                                      for (const match of jsonMatches) {
                                        try {
                                          const parsedData = JSON.parse(
                                            match[1],
                                          );

                                          if (Array.isArray(parsedData)) {
                                            const planData = parsedData;
                                            const affectedDates = [
                                              ...new Set(
                                                planData.map((day) => day.date),
                                              ),
                                            ];

                                            if (affectedDates.length > 0) {
                                              await new Promise((resolvePlan) => {
                                                const placeholders = affectedDates
                                                  .map(() => "?")
                                                  .join(",");
                                                db.serialize(() => {
                                                  db.run(
                                                    `DELETE FROM micro_plan WHERE user_id = ? AND date IN (${placeholders})`,
                                                    [req.user.id, ...affectedDates],
                                                    (err) => {
                                                      if (err)
                                                        console.error(
                                                          "Failed to clear old plan data:",
                                                          err,
                                                        );
                                                    }
                                                  );

                                                  const stmt = db.prepare(`
                                                      INSERT INTO micro_plan (user_id, date, sport, description, target_rooka, details, steps_json, source) 
                                                      VALUES (?, ?, ?, ?, ?, ?, ?, 'coach')
                                                  `);

                                                  planData.forEach((day) => {
                                                    stmt.run(
                                                      req.user.id,
                                                      day.date,
                                                      day.sport,
                                                      day.description,
                                                      require('../services/zones').planDayTargetRooka(day),
                                                      day.details,
                                                      day.steps ? JSON.stringify(day.steps) : (day.steps_json || "[]"),
                                                    );
                                                  });
                                                  stmt.finalize(() => resolvePlan());
                                                });
                                              });
                                            }
                                            planUpdated = true;
                                          } else if (
                                            parsedData &&
                                            parsedData.type === "metrics" &&
                                            parsedData.data
                                          ) {
                                            await new Promise((resolveMetrics) => {
                                              db.serialize(() => {
                                                const stmt = db.prepare(
                                                  `INSERT INTO athlete_metrics (user_id, metric, value) VALUES (?, ?, ?) ON CONFLICT(user_id, metric) DO UPDATE SET value=excluded.value`,
                                                );
                                                for (const [
                                                  key,
                                                  val,
                                                ] of Object.entries(
                                                  parsedData.data,
                                                )) {
                                                  stmt.run(
                                                    req.user.id,
                                                    key,
                                                    String(val),
                                                  );
                                                }
                                                stmt.finalize(() => resolveMetrics());
                                              });
                                            });
                                          } else if (
                                            parsedData &&
                                            parsedData.type === "log_cycle" &&
                                            parsedData.data &&
                                            parsedData.data.start_date
                                          ) {
                                            const startDate =
                                              parsedData.data.start_date;
                                            await new Promise((resolveCycle) => {
                                              db.run(
                                                `UPDATE users SET last_cycle_start = ? WHERE id = ?`,
                                                [startDate, req.user.id],
                                                (err) => {
                                                  if (err)
                                                    console.error(
                                                      "Failed to update cycle start date from chat:",
                                                      err,
                                                    );
                                                  resolveCycle();
                                                },
                                              );
                                            });
                                            planUpdated = true;
                                          } else if (
                                             parsedData &&
                                             parsedData.type === "log_weight" &&
                                             parsedData.data &&
                                             parsedData.data.weight_kg
                                           ) {
                                             const weightKg = parseFloat(parsedData.data.weight_kg);
                                             const bodyFat = parsedData.data.body_fat_percent !== undefined ? parseFloat(parsedData.data.body_fat_percent) : null;
                                             const todayStr = getAMSDateString();

                                             // Wait for both inserts to complete before continuing
                                             await new Promise((resolveWeight) => {
                                               let completed = 0;
                                               const checkDone = () => {
                                                 completed++;
                                                 if (completed === 2) resolveWeight();
                                               };

                                               db.run(
                                                 `INSERT INTO physique_logs (user_id, date, weight_kg, notes) VALUES (?, ?, ?, ?)`,
                                                 [req.user.id, todayStr, weightKg, "Caught via AI Coach chat"],
                                                 (err) => {
                                                   if (err) console.error("Failed to log physique weight from chat:", err);
                                                   checkDone();
                                                 }
                                               );

                                               db.run(
                                                 `INSERT INTO biometrics (user_id, date, weight_kg, body_fat_percent) VALUES (?, ?, ?, ?)
                                                  ON CONFLICT(user_id, date) DO UPDATE SET weight_kg=excluded.weight_kg, body_fat_percent=COALESCE(excluded.body_fat_percent, biometrics.body_fat_percent)`,
                                                 [req.user.id, todayStr, weightKg, bodyFat],
                                                 (err) => {
                                                   if (err) console.error("Failed to log biometrics from chat:", err);
                                                   checkDone();
                                                 }
                                               );
                                             });
                                          } else if (
                                            parsedData &&
                                            (parsedData.type === "log_nutrition" || parsedData.type === "log_diet") &&
                                            parsedData.data
                                          ) {
                                            const diet = parsedData.data;
                                            const todayStr = getAMSDateString();
                                            const carbs = Number(diet.carbs || 0);
                                            const protein = Number(diet.protein || 0);
                                            const fat = Number(diet.fat || 0);

                                            // Sync daily_diet_logs & nutrition_intake with smart item extraction and deduplication
                                            await new Promise((resolveDiet) => {
                                              db.get(
                                                `SELECT logged_carbs, logged_protein, logged_fat, items_summary FROM daily_diet_logs WHERE user_id = ? AND date = ?`,
                                                [req.user.id, todayStr],
                                                (err, existingRow) => {
                                                  const existingSummary = existingRow ? (existingRow.items_summary || "") : "";
                                                  const existingItems = existingSummary
                                                    ? existingSummary.split(',').map((s) => s.trim()).filter(Boolean)
                                                    : [];
                                                  const existingNormalized = existingItems.map((s) => s.toLowerCase().replace(/[^a-z0-9]/g, ''));

                                                  const candidateItems = extractAndCleanFoodItems(diet);

                                                  // Filter out items that already exist in today's log
                                                  const newItems = candidateItems.filter((item) => {
                                                    const norm = item.toLowerCase().replace(/[^a-z0-9]/g, '');
                                                    if (!norm) return false;
                                                    const isDuplicate = existingNormalized.some(
                                                      (exNorm) =>
                                                        exNorm === norm ||
                                                        (exNorm.length > 5 && norm.length > 5 && (exNorm.includes(norm) || norm.includes(exNorm)))
                                                    );
                                                    return !isDuplicate;
                                                  });

                                                  // Guard: If all candidate items were already logged today, skip adding duplicate calories/macros
                                                  if (newItems.length === 0 && candidateItems.length > 0) {
                                                    console.log(`[Diet] Skipping duplicate diet log. All items already logged: "${candidateItems.join(', ')}"`);
                                                    return resolveDiet();
                                                  }

                                                  const itemsToAdd = newItems.length > 0 ? newItems : candidateItems;

                                                  const newCarbs = Math.max(0, (existingRow ? (existingRow.logged_carbs || 0) : 0) + carbs);
                                                  const newProtein = Math.max(0, (existingRow ? (existingRow.logged_protein || 0) : 0) + protein);
                                                  const newFat = Math.max(0, (existingRow ? (existingRow.logged_fat || 0) : 0) + fat);

                                                  const updatedItemsList = [...existingItems, ...itemsToAdd];
                                                  const newSummary = updatedItemsList.join(', ');

                                                  // 1. Sync nutrition_intake
                                                  db.run(
                                                    `INSERT INTO nutrition_intake (user_id, date, carbs, protein, fat)
                                                     VALUES (?, ?, ?, ?, ?)
                                                     ON CONFLICT(user_id, date) DO UPDATE SET
                                                       carbs = excluded.carbs,
                                                       protein = excluded.protein,
                                                       fat = excluded.fat`,
                                                    [req.user.id, todayStr, newCarbs, newProtein, newFat],
                                                    (err) => {
                                                      if (err) console.error("Failed to insert nutrition intake:", err);
                                                    }
                                                  );

                                                  // 2. Sync daily_diet_logs
                                                  db.run(
                                                    `INSERT INTO daily_diet_logs (user_id, date, logged_carbs, logged_protein, logged_fat, items_summary, updated_at)
                                                     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                                                     ON CONFLICT(user_id, date) DO UPDATE SET
                                                       logged_carbs = excluded.logged_carbs,
                                                       logged_protein = excluded.logged_protein,
                                                       logged_fat = excluded.logged_fat,
                                                       items_summary = excluded.items_summary,
                                                       updated_at = CURRENT_TIMESTAMP`,
                                                    [req.user.id, todayStr, newCarbs, newProtein, newFat, newSummary],
                                                    (err) => {
                                                      if (err) console.error("Failed to upsert daily_diet_logs:", err);
                                                      resolveDiet();
                                                    }
                                                  );
                                                }
                                              );
                                            });
                                            planUpdated = true;
                                          } else if (
                                            parsedData &&
                                            parsedData.type ===
                                              "log_activity" &&
                                            parsedData.data
                                          ) {
                                            const act = parsedData.data;
                                            // Use negative ID to avoid collision with real Strava IDs
                                            const manualId = -Date.now();
                                            const startDate =
                                              new Date().toISOString();
                                            const rookaScore =
                                              act.rooka_score ||
                                              (await calculateRookaScoreZoned({
                                                userId: req.user.id,
                                                movingTimeMin: act.moving_time_min,
                                                avgHr: act.average_heartrate,
                                                sport: act.sport_type,
                                              }));

                                            await new Promise((resolveInsert) => {
                                              db.run(
                                                `INSERT INTO activities (id, user_id, name, sport_type, distance_km, moving_time_min, start_date, rooka_score, sets_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                                [
                                                  manualId,
                                                  req.user.id,
                                                  act.name || "Manual Workout",
                                                  act.sport_type || "Workout",
                                                  act.distance_km || 0,
                                                  act.moving_time_min || 0,
                                                  startDate,
                                                  rookaScore,
                                                  JSON.stringify(act.sets || []),
                                                ],
                                                (err) => {
                                                  if (err)
                                                    console.error(
                                                      "Failed to insert manual activity:",
                                                      err,
                                                    );
                                                  else {
                                                    updateUserRookaAndCheckLevel(
                                                      req.user.id,
                                                    );
                                                    // Invalidate today's nutrition cache so it incorporates the new workout
                                                    const todayStr =
                                                      startDate.split("T")[0];
                                                    db.run(
                                                      `DELETE FROM nutrition_protocols WHERE user_id = ? AND date = ?`,
                                                      [req.user.id, todayStr],
                                                    );
                                                    sendSSEEvent(req.user.id, "activity_logged", { activityId: manualId });
                                                  }
                                                  resolveInsert();
                                                },
                                              );
                                            });

                                            // QUEST EVALUATION AFTER INSERT (paid tiers only)
                                            if (canAccessQuests(req.user.subscription_tier)) {
                                              try {
                                                const completedQuests =
                                                  await evaluateQuestsAgainstActivity(
                                                    req.user.id,
                                                    {
                                                      distance_km:
                                                        act.distance_km || 0,
                                                      moving_time_min:
                                                        act.moving_time_min || 0,
                                                      rooka_score: rookaScore,
                                                      sport_type: act.sport_type || "Workout",
                                                    },
                                                  );

                                                sendSSEEvent(req.user.id, "quest_updated", {});

                                                if (completedQuests && completedQuests.length > 0) {
                                                  // The reward lands in `bonus_points` after the
                                                  // total was recomputed above, so recompute again
                                                  // or the reward — and any level-up it triggers —
                                                  // only appears on some later unrelated request.
                                                  updateUserRookaAndCheckLevel(req.user.id);
                                                }

                                                if (
                                                  completedQuests &&
                                                  completedQuests.length > 0
                                                ) {
                                                  // Deferred until after COMMIT. This only appends celebration
                                                  // text, but awaiting the model here held the transaction open
                                                  // for as long as it took - up to a minute once the rate-limit
                                                  // backoff kicks in.
                                                  questCelebrationPrompt = `The user just manually logged an activity and ALSO completed their active quest: "${completedQuests[0].description}" earning ${completedQuests[0].reward_points} Rooka points! Give a short 1-2 sentence highly motivating response celebrating their completed quest!`;
                                                }
                                              } catch (e) {
                                                console.error(
                                                  "Quest evaluation failed during manual sync:",
                                                  e,
                                                );
                                              }
                                            }
                                            planUpdated = true; // Signal frontend to reload data/charts
                                          } else if (
                                            parsedData &&
                                            parsedData.type === "log_niggle" &&
                                            parsedData.data &&
                                            parsedData.data.body_part
                                          ) {
                                            const { body_part, severity, notes } = parsedData.data;
                                            const sev = Math.max(1, Math.min(5, Math.round(Number(severity) || 2)));
                                            await new Promise((resolveNiggle) => {
                                              db.get(
                                                `SELECT id FROM athlete_niggles WHERE user_id = ? AND body_part = ? AND status = 'active'`,
                                                [req.user.id, body_part],
                                                (err, row) => {
                                                  if (err) {
                                                    console.error("DB error checking niggle:", err);
                                                    return resolveNiggle();
                                                  }
                                                  if (row) {
                                                    db.run(
                                                      `UPDATE athlete_niggles SET severity = ?, notes = ? WHERE id = ?`,
                                                      [sev, notes || "", row.id],
                                                      () => {
                                                        triggerBackgroundSummary(req.user.id);
                                                        resolveNiggle();
                                                      }
                                                    );
                                                  } else {
                                                    db.run(
                                                      `INSERT INTO athlete_niggles (user_id, body_part, severity, notes, status) VALUES (?, ?, ?, ?, 'active')`,
                                                      [req.user.id, body_part, sev, notes || ""],
                                                      () => {
                                                        triggerBackgroundSummary(req.user.id);
                                                        resolveNiggle();
                                                      }
                                                    );
                                                  }
                                                }
                                              );
                                            });
                                            planUpdated = true;
                                          } else if (
                                            parsedData &&
                                            parsedData.type === "resolve_niggle" &&
                                            parsedData.data &&
                                            parsedData.data.body_part
                                          ) {
                                            const { body_part } = parsedData.data;
                                            await new Promise((resolveNiggle) => {
                                              db.run(
                                                `UPDATE athlete_niggles SET status = 'resolved', resolved_date = CURRENT_TIMESTAMP WHERE user_id = ? AND body_part = ? AND status = 'active'`,
                                                [req.user.id, body_part],
                                                (err) => {
                                                  if (err) console.error("Failed to resolve niggle via chat:", err);
                                                  triggerBackgroundSummary(req.user.id);
                                                  resolveNiggle();
                                                }
                                              );
                                            });
                                            planUpdated = true;
                                          } else if (
                                            parsedData &&
                                            parsedData.type === "generate_image" &&
                                            parsedData.data
                                          ) {
                                            const imgPrompt = parsedData.data.prompt || parsedData.data.description;
                                            const caption = parsedData.data.caption || "Coaching Visual";
                                            if (imgPrompt) {
                                              const pendingKey = `pending_${crypto.randomUUID()}`;
                                              pendingImageTasks.push({
                                                prompt: imgPrompt,
                                                caption,
                                                pendingKey,
                                                aspectRatio: parsedData.data.aspectRatio || "1:1",
                                              });
                                            }
                                          }
                                         } catch (e) {
                                           console.error(
                                             "Failed to parse an AI JSON block",
                                             e,
                                           );
                                         }
                                       }

                                       aiReply = aiReply
                                         .replace(/```(?:json)?[\s\S]*?```/gi, "")
                                         .replace(/\{\s*"type"\s*:\s*"(?:log_diet|log_nutrition|log_activity|log_weight|log_cycle|log_niggle|resolve_niggle|metrics|generate_image)"[\s\S]*?\}/gi, "")
                                         .trim();
                                         
                                       aiReply = aiReply.replace(/[^.!?\n]*:\s*$/i, "").trim();

                                       for (const task of pendingImageTasks) {
                                         aiReply += `\n\n![${task.caption}](loading://${task.pendingKey})`;
                                       }

                                      let mood = "default";
                                      const lowerReply = aiReply.toLowerCase();

                                      // if (lowerReply.includes('crush') || lowerReply.includes('!')) mood = 'hype';
                                      // if (lowerReply.includes('disappoint') || lowerReply.includes('skip')) mood = 'disappointed';

                                      // Define your keyword arrays here
                                      const hypeKeywords = [
                                        "crush",
                                        "!",
                                        "epic",
                                        "beast",
                                        "machine",
                                        "proud",
                                        "smash",
                                        "nailed",
                                        "unstoppable",
                                        "fire",
                                        "stellar",
                                      ];
                                      const disappointedKeywords = [
                                        "disappoint",
                                        "skip",
                                        "excuse",
                                        "slack",
                                        "shortcut",
                                        "off track",
                                        "slipping",
                                        "warning",
                                      ];
                                      const hornyKeywords = [
                                        "horny",
                                        "sexy",
                                        "flirt",
                                        "desire",
                                        "attractive",
                                        "love",
                                        "passion",
                                        "lust",
                                        "dream",
                                        "hot",
                                      ];
                                      // .some() acts as a giant OR statement across the whole array
                                      if (
                                        hypeKeywords.some((word) =>
                                          lowerReply.includes(word),
                                        )
                                      ) {
                                        mood = "hype";
                                      } else if (
                                        hornyKeywords.some((word) =>
                                          lowerReply.includes(word),
                                        )
                                      ) {
                                        mood = "horny";
                                      } else if (
                                        disappointedKeywords.some((word) =>
                                          lowerReply.includes(word),
                                         )
                                      ) {
                                        mood = "disappointed";
                                      }

                                       const imagePathValue = imagePathsDB.length > 0 ? JSON.stringify(imagePathsDB) : null;

                                       // 1. Insert user message first and await its completion to guarantee lower ID and earlier timestamp
                                       try {
                                         await new Promise((resolve, reject) => {
                                           db.run(
                                             `INSERT INTO chat_history (user_id, role, content, image_path, timestamp) VALUES (?, 'user', ?, ?, datetime('now'))`,
                                             [req.user.id, message, imagePathValue],
                                             function (err) {
                                               if (err) return reject(err);
                                               resolve(this.lastID);
                                             }
                                           );
                                         });
                                       } catch (userInsertErr) {
                                         console.error("Failed to insert user chat message:", userInsertErr);
                                       }

                                       // 2. Sequentially insert coach reply parts with ordered timestamps (+1s, +2s, etc.)
                                       const messageParts = splitCoachReply(aiReply);
                                       for (let i = 0; i < messageParts.length; i++) {
                                         const part = messageParts[i];
                                         try {
                                           await new Promise((resolve, reject) => {
                                             db.run(
                                               `INSERT INTO chat_history (user_id, role, content, mood, timestamp) VALUES (?, 'coach', ?, ?, datetime('now', '+${i + 1} seconds'))`,
                                               [req.user.id, part, mood],
                                               function (err) {
                                                 if (err) return reject(err);
                                                 resolve(this.lastID);
                                               }
                                             );
                                           });
                                         } catch (partInsertErr) {
                                           console.error(`Failed to insert coach reply part ${i}:`, partInsertErr);
                                         }
                                       }

                                       db.get(
                                         `SELECT COUNT(*) as count FROM chat_history WHERE user_id = ?`,
                                         [req.user.id],
                                         (err, row) => {
                                           if (
                                             row &&
                                             row.count > 0 &&
                                             row.count % 6 === 0
                                           ) {
                                             triggerBackgroundSummary(
                                               req.user.id,
                                             );
                                           }
                                         },
                                       );

                                       try {
                                         await new Promise((resolve, reject) => {
                                           db.run("COMMIT", (err) => (err ? reject(err) : resolve()));
                                         });
                                       } catch (commitErr) {
                                         if (releaseTx) {
                                           releaseTx();
                                           releaseTx = null;
                                         }
                                         console.error(
                                           "Failed to commit chat/plan transaction:",
                                           commitErr,
                                         );
                                         return res.status(500).json({
                                           error: "Failed to save chat and plan updates.",
                                         });
                                       }

                                       if (releaseTx) {
                                         releaseTx();
                                         releaseTx = null;
                                       }

                                       // The celebration runs here, outside the transaction. The
                                       // stored coach message is patched to match, so history and
                                       // what the athlete sees do not diverge.
                                       if (questCelebrationPrompt) {
                                         try {
                                           const coachAddendum = await generateWithFallback(
                                             questCelebrationPrompt,
                                             "You are a motivating elite coach.",
                                             null,
                                             base64DataArray,
                                           );
                                           if (coachAddendum) {
                                             aiReply += "\n\n" + coachAddendum;
                                             messageParts.push(coachAddendum);
                                             await new Promise((resolve) => {
                                               db.run(
                                                 `INSERT INTO chat_history (user_id, role, content, mood, timestamp) VALUES (?, 'coach', ?, 'hype', datetime('now', '+${messageParts.length + 1} seconds'))`,
                                                 [req.user.id, coachAddendum],
                                                 () => resolve()
                                               );
                                             });
                                           }
                                         } catch (celebrationErr) {
                                           console.error("Quest celebration generation failed:", celebrationErr.message);
                                         }
                                       }

                                        // 1. Send the instant response to the client immediately!
                                        res.json({
                                          reply: messageParts.join('\n\n'),
                                          replies: messageParts,
                                          mood: mood,
                                          planUpdated: planUpdated,
                                        });

                                        // 2. Asynchronously generate any requested images in the background ONLY if allowed by tier and quota
                                        if (pendingImageTasks.length > 0) {
                                          if (!canGenerateImage) {
                                            console.log(`🚫 Image generation blocked: User ${req.user.id} has no image credits available (Tier: ${user.subscription_tier}, Used: ${dailyImageCount}/1).`);
                                            for (const task of pendingImageTasks) {
                                              db.run(
                                                `UPDATE chat_history SET content = REPLACE(content, ?, '') WHERE user_id = ? AND content LIKE ?`,
                                                [`![${task.caption}](loading://${task.pendingKey})`, req.user.id, `%loading://${task.pendingKey}%`]
                                              );
                                              sendSSEEvent(req.user.id, "chat_image_failed", {
                                                pendingKey: task.pendingKey,
                                              });
                                            }
                                          } else {
                                            // Increment user's daily image count
                                            db.run(
                                              `UPDATE users SET daily_image_count = daily_image_count + 1 WHERE id = ?`,
                                              [req.user.id]
                                            );

                                            for (const task of pendingImageTasks) {
                                              (async () => {
                                                try {
                                                  console.log(`🎨 Background image generation starting for prompt: "${task.prompt}"...`);
                                                  const { base64Data, mimeType } = await generateImage(task.prompt, { aspectRatio: task.aspectRatio });
                                                  const ext = mimeType.includes("png") ? "png" : "jpg";
                                                  const fileName = `img_${req.user.id}_${crypto.randomUUID()}.${ext}`;
                                                  const dir = path.join(__dirname, "../secure_uploads/chat_images");
                                                  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                                                  const filePath = path.join(dir, fileName);
                                                  fs.writeFileSync(filePath, base64Data, "base64");

                                                  const realImageUrl = `/api/images/chat/${fileName}`;
                                                  // Update SQLite record so history persists
                                                  db.run(
                                                    `UPDATE chat_history SET content = REPLACE(content, ?, ?) WHERE user_id = ? AND content LIKE ?`,
                                                    [`loading://${task.pendingKey}`, realImageUrl, req.user.id, `%loading://${task.pendingKey}%`]
                                                  );

                                                  // Broadcast live to mobile app over WebSocket / SSE
                                                  sendSSEEvent(req.user.id, "chat_image_ready", {
                                                    pendingKey: task.pendingKey,
                                                    imageUrl: realImageUrl,
                                                    caption: task.caption,
                                                  });
                                                  console.log(`✅ Background image completed & broadcasted to athlete!`);
                                                } catch (bgErr) {
                                                  console.error("Background image generation error:", bgErr.message);
                                                  db.run(
                                                    `UPDATE chat_history SET content = REPLACE(content, ?, '') WHERE user_id = ? AND content LIKE ?`,
                                                    [`![${task.caption}](loading://${task.pendingKey})`, req.user.id, `%loading://${task.pendingKey}%`]
                                                  );
                                                  sendSSEEvent(req.user.id, "chat_image_failed", {
                                                    pendingKey: task.pendingKey,
                                                  });
                                                }
                                              })();
                                            }
                                          }
                                        }
                                      } catch (err) {
                                      console.error("Chat parsing error:", err);
                                      db.run("ROLLBACK", () => {
                                        if (releaseTx) {
                                          releaseTx();
                                          releaseTx = null;
                                        }
                                      });
                                      res
                                        .status(500)
                                        .json({
                                          error: err.message || "Failed to generate response.",
                                        });
                                    }
                                  },
                                ); // End daily diet logs
                                        },
                                      ); // End chat history
                                        },
                                      ); // End benchmark tests
                                    },
                                  ); // End muscle status
                                },
                               ); // End niggles fetch
                             },
                           ); // End microplan
                         },
                       ); // End recent sets
                     },
                     );
                 } catch (err) {
                   console.error("Error building context:", err);
                   res.status(500).json({ error: "Context building failed." });
                 }
        },
      ); // End metrics
    },
  ); // End recent history check
},
); // End user fetch
});

router.get("/api/chat/briefing", authenticateToken, (req, res) => {
  db.get(
    `SELECT content, mood, timestamp FROM chat_history 
            WHERE user_id = ? AND role = 'coach' AND date(timestamp, 'localtime') = date('now', 'localtime') 
            ORDER BY timestamp ASC LIMIT 1`,
    [req.user.id],
    (err, row) => {
      if (err) {
        console.error("Error fetching briefing:", err);
        return res.status(500).json({ error: "Failed to fetch briefing." });
      }
      res.json({ briefing: row || null });
    },
  );
});

router.post("/api/chat/checkin", authenticateToken, async (req, res) => {
  const { sendMorningMessageForUser } = require("../services/utils");
  try {
    const morningResult = await sendMorningMessageForUser(req.user.id);
    if (morningResult && morningResult.success) {
      return res.json({ reply: morningResult.message, message: morningResult.message, mood: "hype" });
    }
    if (morningResult && morningResult.skipped) {
      return res.json({ alreadySent: true });
    }
  } catch (mErr) {
    console.warn("sendMorningMessageForUser error during checkin:", mErr);
  }

  db.get(
    `SELECT coach_tone, coach_name, coach_context, athlete_context, gender FROM users WHERE id = ?`,
    [req.user.id],
    async (err, user) => {
      if (!user) {
        user = {
          coach_tone: 'hype',
          coach_name: 'Rooka',
          coach_context: 'Empathetic athletic performance coach',
          athlete_context: 'Active athlete',
          gender: 'prefer_not_to_say',
        };
      }

      db.all(
        `SELECT name, sport_type, distance_km, moving_time_min, rooka_score, start_date, laps_json FROM activities WHERE user_id = ? ORDER BY start_date DESC LIMIT 3`,
        [req.user.id],
        async (err, recentActivities) => {
          const recentActivitiesText =
            recentActivities && recentActivities.length > 0
              ? recentActivities
                  .map(
                    (a) => {
                      let lapStr = "";
                      if (a.laps_json) {
                        try {
                          const laps = JSON.parse(a.laps_json);
                          if (laps && laps.length > 0) {
                            lapStr = " | Laps: " + laps.map(l => {
                              let pace = "";
                              if (l.average_speed > 0) {
                                const paceSecs = 1000 / l.average_speed;
                                const m = Math.floor(paceSecs / 60);
                                const s = Math.floor(paceSecs % 60);
                                pace = `, ${m}:${s.toString().padStart(2, '0')}/km`;
                              }
                              const hr = l.average_heartrate ? `, ${Math.round(l.average_heartrate)}bpm` : "";
                              return `[${l.name || 'Lap'}: ${(l.distance/1000).toFixed(1)}km in ${Math.round(l.moving_time/60)}m${pace}${hr}]`;
                            }).join(" ");
                          }
                        } catch (e) {}
                      }
                      return `- ${getAMSDateString(a.start_date)}: ${a.name} (${a.sport_type}) | ${parseFloat(a.distance_km).toFixed(1)}km | ${Math.round(a.moving_time_min)}min | ${Math.round(a.rooka_score || 0)} Rooka${lapStr}`;
                    }
                  )
                  .join("\n")
              : "No recent activities recorded.";

          db.all(
            `SELECT metric, value FROM athlete_metrics WHERE user_id = ?`,
            [req.user.id],
            async (err, metrics) => {
              const metricsText =
                metrics && metrics.length > 0
                  ? metrics.map((m) => `${m.metric}: ${m.value}`).join(", ")
                  : "No metrics recorded.";

              db.all(
                `SELECT date, sport, description FROM micro_plan WHERE user_id = ? AND date >= date('now') ORDER BY date ASC LIMIT 2`,
                [req.user.id],
                async (err, upcomingPlan) => {
                  const upcomingText =
                    upcomingPlan && upcomingPlan.length > 0
                      ? upcomingPlan
                          .map(
                            (p) => `- ${p.date}: ${p.sport} - ${p.description}`,
                          )
                          .join("\n")
                      : "No upcoming workouts scheduled.";

                  const phase = await getUserMacroPhase(req.user.id);
                  const todayStr = getAMSDateString();
                  const nowAMS = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }));
                  const amsHour = nowAMS.getHours();
                  const timeOfDayGreeting = amsHour < 12 ? "morning" : amsHour < 18 ? "afternoon" : "evening";
                  const weatherContext = await getWeatherContext();
                  const gamification = await getUserGamificationContext(
                    req.user.id,
                  );
                  const coachName = user.coach_name || "Rooka";
                  let coachToneText = user.coach_tone;
                  if (user.coach_tone === "custom" || user.coach_tone === "Configure own coach") {
                    coachToneText = user.coach_context ? `Custom tone: ${user.coach_context}` : "Custom coach persona";
                  }
                  const goalsText = await getUserGoalsContext(req.user.id);
                  let systemPrompt = `You are ${coachName}, an elite endurance coach.
Today is ${todayStr}. It is currently ${timeOfDayGreeting} (${nowAMS.toLocaleTimeString("en-GB", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit" })}).
${user.coach_context ? `Coach Custom Context & Rules: ${user.coach_context}` : ""}
Athlete Context: ${user.athlete_context || "General endurance athlete"}
Gender: ${user.gender || "Prefer not to share"}
${(user.gender === "Female" || user.gender === "Prefer not to share" || user.gender === "Prefer not to say") && user.cycle_tracking_enabled !== 0 ? "IMPORTANT: Track menstrual cycle phases and adjust demands based on the physically demanding days of the cycle." : ""}
Key Physiological Metrics:
${metricsText}
Current Macro Phase: ${phase}
Athlete Goals (Primary & Secondary):
${goalsText}
Recent Completed Workouts:
${recentActivitiesText}
Upcoming Workouts (Next 2 days):
${upcomingText}
Your Tone & Persona: ${coachToneText || "empathetic"}

${weatherContext}

MACRO BLOCK FOCUS RULES:
- If phase is BASE: Focus intensely on keeping their volume high and heart rate low (Zone 2). Discourage speedwork.
- If phase is BUILD: Focus on progressing their threshold and VO2max intervals. Tell them it's time to push.
- If phase is PEAK: Focus on race-specific intensity and sharpening. Keep them focused on executing race pace perfectly.
- If phase is TAPER: Focus heavily on recovery and shedding fatigue. Ensure they rest up for the race.

CRITICAL RULES:
1. Generate a single, highly personalized, proactive 1-2 sentence greeting for the athlete who just opened the app. Acknowledge the time of day naturally (${timeOfDayGreeting}). If it's evening, check in on how today's efforts felt or help them wind down; if morning, look ahead to the day.
2. Analyze their fitness (CTL), fatigue (ATL), and readiness (TSB) from their Key Physiological Metrics. Reference these trends to steer the user towards action (e.g., prioritize recovery if TSB is very negative, or push hard if TSB is positive). You can also reference a recent/upcoming workout.
3. Keep it brief, extremely human, and supportive. 
4. DO NOT generate any JSON or workout plan updates. Just the greeting.
5. PREDICTIVE LOGISTICS: If the WEATHER ALERT is present and the athlete has an outdoor workout (e.g. Bike or Run) scheduled for today, you MUST proactively ask if they want to convert today's outdoor session into an indoor Zwift/treadmill session due to the miserable weather. For example: "Looks miserable out there today. Do you want me to convert today's ride into an indoor Zwift session?"
6. GAMIFICATION: The athlete has a current activity streak of ${gamification.streak} days and has ${gamification.bonusPoints} bonus points. Occasionally mention their streak if it's impressive to hype them up.`;

                  try {
                    let aiReply = await generateWithFallback(
                      "Generate the proactive greeting.",
                      systemPrompt,
                      [],
                    );
                    aiReply = aiReply
                      .replace(/```json[\s\S]*?```/gi, "")
                      .trim();
                      
                    const messageParts = splitCoachReply(aiReply);
                    for (let i = 0; i < messageParts.length; i++) {
                      await new Promise((resolve) => {
                        db.run(
                          `INSERT INTO chat_history (user_id, role, content, mood, timestamp) VALUES (?, 'coach', ?, 'default', datetime('now', '+${i} seconds'))`,
                          [req.user.id, messageParts[i]],
                          () => resolve()
                        );
                      });
                    }
                    res.json({ reply: messageParts.join('\n\n'), replies: messageParts, mood: "default" });
                  } catch (e) {
                    console.error("Checkin Server Error:", e);
                    res.status(500).json({ error: "AI failed to respond." });
                  }
                },
              );
            },
          );
        },
      );
    },
  );
});

module.exports = router;
