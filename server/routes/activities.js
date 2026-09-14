const express = require('express');
const router = express.Router();
const db = require('../services/db');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { authenticateToken } = require('../services/auth');
const { sseClients, sendSSEEvent } = require('../services/sse');
const { generateWithFallback } = require('../services/ai');
const { encrypt, decrypt } = require('../services/crypto');
const { sendPushToUser } = require('../services/pushNotificationService');
const { getUserGoalPromptContext } = require('../services/goalPromptContext');
const {
  matchGarminExercise,
  getAMSDateString,
  getAMSWeekday,
  getUserGamificationContext,
  getUserLeaderboardString,
  getWeatherContext,
  getUserMacroPhase,
  generatePublicProfile,
  processTokenRefresh,
  getStravaTokenForUser,
  getRookaLevelInfo,
  calculateRookaScore,
  calculateRookaScoreZoned,
  mapStravaSportToRooka,
  formatStepsForStrava,
  extractStravaPolyline,
  tagStravaActivity,
  getStravaActivity,
  syncAllStravaUsersOnStartup,
  triggerBackgroundSummary,
  updateUserRookaAndCheckLevel,
  triggerLevelUpCoachPrompt,
  generateQuestForUser,
  evaluateQuestsAgainstActivity,
  normalizeShareSettings,
  canHideRookaLink,
  canAccessQuests,
  STRAVA_SHARE_SPORTS,
  STRAVA_SHARE_FLAGS
} = require('../services/utils');
const muscleLoad = require('../services/muscleLoad');

router.get("/api/micro-plan", authenticateToken, (req, res) => {
  db.all(
    `SELECT * FROM micro_plan WHERE user_id = ? ORDER BY date ASC`,
    [req.user.id],
    (err, rows) => {
      res.json(rows || []);
    },
  );
});

// --- BENCHMARK ASSESSMENTS ENDPOINTS ---
router.get("/api/benchmarks", authenticateToken, (req, res) => {
  db.all(
    `SELECT * FROM benchmark_tests WHERE user_id = ? ORDER BY created_at DESC`,
    [req.user.id],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Failed to fetch benchmark tests" });
      }
      res.json(rows || []);
    }
  );
});

router.post("/api/benchmarks", authenticateToken, (req, res) => {
  const { sport_type, test_name, metrics_json, coach_notes, completed_at } = req.body;
  if (!sport_type || !test_name) {
    return res.status(400).json({ error: "sport_type and test_name are required" });
  }

  const completedDate = completed_at || new Date().toISOString();
  db.run(
    `INSERT INTO benchmark_tests (user_id, sport_type, test_name, metrics_json, coach_notes, completed_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      req.user.id,
      sport_type,
      test_name,
      typeof metrics_json === 'object' ? JSON.stringify(metrics_json) : (metrics_json || '{}'),
      coach_notes || '',
      completedDate
    ],
    function (err) {
      if (err) {
        return res.status(500).json({ error: "Failed to record benchmark test" });
      }
      res.json({ success: true, id: this.lastID });
    }
  );
});

router.put("/api/benchmarks/:id", authenticateToken, (req, res) => {
  const { id } = req.params;
  const { sport_type, test_name, metrics_json, coach_notes, completed_at } = req.body;

  db.run(
    `UPDATE benchmark_tests 
     SET sport_type = COALESCE(?, sport_type),
         test_name = COALESCE(?, test_name),
         metrics_json = COALESCE(?, metrics_json),
         coach_notes = COALESCE(?, coach_notes),
         completed_at = COALESCE(?, completed_at)
     WHERE id = ? AND user_id = ?`,
    [
      sport_type || null,
      test_name || null,
      metrics_json !== undefined ? (typeof metrics_json === 'object' ? JSON.stringify(metrics_json) : metrics_json) : null,
      coach_notes !== undefined ? coach_notes : null,
      completed_at || null,
      id,
      req.user.id
    ],
    function (err) {
      if (err) {
        return res.status(500).json({ error: "Failed to update benchmark test" });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: "Benchmark test not found or unauthorized" });
      }
      res.json({ success: true, message: "Benchmark test updated" });
    }
  );
});

router.delete("/api/benchmarks/:id", authenticateToken, (req, res) => {
  const { id } = req.params;
  db.run(
    `DELETE FROM benchmark_tests WHERE id = ? AND user_id = ?`,
    [id, req.user.id],
    function (err) {
      if (err) {
        return res.status(500).json({ error: "Failed to delete benchmark test" });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: "Benchmark test not found or unauthorized" });
      }
      res.json({ success: true, message: "Benchmark test deleted" });
    }
  );
});

router.get("/api/user/metrics", authenticateToken, (req, res) => {
  db.all(
    `SELECT id, metric, value FROM athlete_metrics WHERE user_id = ? ORDER BY metric ASC`,
    [req.user.id],
    (err, rows) => {
      if (err)
        return res.status(500).json({ error: "Failed to load metrics." });
      res.json(rows || []);
    },
  );
});

router.post("/api/user/metrics", authenticateToken, (req, res) => {
  const { metrics } = req.body;
  if (!metrics || !Array.isArray(metrics)) {
    return res.status(400).json({ error: "Invalid metrics array format." });
  }

  db.serialize(() => {
    // We will just clear all custom metrics and re-insert what the user passed, or update them.
    // But some might have been auto-added by the AI, and we MUST preserve system metrics like strava_opt_out_activities and strava_share_settings.
    db.run(
      `DELETE FROM athlete_metrics WHERE user_id = ? AND metric NOT IN ('strava_opt_out_activities', 'strava_share_settings')`,
      [req.user.id],
    );
    const stmt = db.prepare(
      `INSERT INTO athlete_metrics (user_id, metric, value) VALUES (?, ?, ?)`,
    );
    metrics.forEach((m) => {
      if (
        m.metric !== "strava_opt_out_activities" &&
        m.metric !== "strava_share_settings"
      ) {
        stmt.run(req.user.id, m.metric, m.value);
      }
    });
    stmt.finalize();
    res.json({ message: "Metrics updated successfully!" });
  });
});

router.get("/api/user/activities/types", authenticateToken, (req, res) => {
  db.all(
    `SELECT DISTINCT sport_type FROM activities WHERE user_id = ? ORDER BY sport_type ASC`,
    [req.user.id],
    (err, rows) => {
      if (err)
        return res
          .status(500)
          .json({ error: "Failed to load activity types." });
      res.json(rows.map((r) => r.sport_type));
    },
  );
});

router.post("/api/user/strava-opt-out", authenticateToken, (req, res) => {
  const { optOutActivities } = req.body;
  if (!Array.isArray(optOutActivities)) {
    return res.status(400).json({ error: "optOutActivities must be an array" });
  }
  const val = JSON.stringify(optOutActivities);

  db.run(
    `INSERT INTO athlete_metrics (user_id, metric, value) VALUES (?, 'strava_opt_out_activities', ?) 
            ON CONFLICT(user_id, metric) DO UPDATE SET value=excluded.value`,
    [req.user.id, val],
    (err) => {
      if (err)
        return res.status(500).json({ error: "Failed to update preferences." });
      res.json({ success: true });
    },
  );
});

// What the app shows on the Connections tab. `linkIsOptional` tells the client
// whether the rooka.io toggle is theirs to change - free accounts always carry
// the credit, and the server enforces that on write and on read regardless.
router.get("/api/user/strava-share-settings", authenticateToken, (req, res) => {
  db.get(
    `SELECT subscription_tier FROM users WHERE id = ?`,
    [req.user.id],
    (tierErr, userRow) => {
      const linkIsOptional = canHideRookaLink(userRow && userRow.subscription_tier);

      db.get(
        `SELECT value FROM athlete_metrics WHERE user_id = ? AND metric = 'strava_share_settings'`,
        [req.user.id],
        (err, row) => {
          let stored = {};
          if (row && row.value) {
            try {
              stored = JSON.parse(row.value) || {};
            } catch (_) {}
          }

          const shareSettings = {};
          for (const sport of STRAVA_SHARE_SPORTS) {
            const entry = normalizeShareSettings(stored[sport]);
            if (!linkIsOptional) entry.shareLink = true;
            shareSettings[sport] = entry;
          }

          res.json({ shareSettings, linkIsOptional });
        },
      );
    },
  );
});

router.post("/api/user/strava-share-settings", authenticateToken, (req, res) => {
  const { shareSettings } = req.body;
  if (!shareSettings || typeof shareSettings !== "object" || Array.isArray(shareSettings)) {
    return res.status(400).json({ error: "shareSettings must be an object" });
  }

  db.get(
    `SELECT subscription_tier FROM users WHERE id = ?`,
    [req.user.id],
    (tierErr, userRow) => {
      const linkIsOptional = canHideRookaLink(userRow && userRow.subscription_tier);

      // Store only sports and flags we recognise, as real booleans. The value
      // goes straight back out to Strava captions, so it is not a free-form
      // blob to be written back verbatim.
      const clean = {};
      for (const sport of STRAVA_SHARE_SPORTS) {
        const incoming = shareSettings[sport];
        if (!incoming || typeof incoming !== "object") continue;

        const entry = {};
        for (const flag of STRAVA_SHARE_FLAGS) {
          if (flag in incoming) entry[flag] = !!incoming[flag];
        }
        if (!linkIsOptional) entry.shareLink = true;
        if (Object.keys(entry).length > 0) clean[sport] = entry;
      }

      if (Object.keys(clean).length === 0) {
        return res
          .status(400)
          .json({ error: "No recognised sport settings in payload." });
      }

      db.run(
        `INSERT INTO athlete_metrics (user_id, metric, value) VALUES (?, 'strava_share_settings', ?) 
            ON CONFLICT(user_id, metric) DO UPDATE SET value=excluded.value`,
        [req.user.id, JSON.stringify(clean)],
        (err) => {
          if (err)
            return res
              .status(500)
              .json({ error: "Failed to update Strava share settings." });
          res.json({ success: true, shareSettings: clean, linkIsOptional });
        },
      );
    },
  );
});

router.get("/api/activity/:id", authenticateToken, (req, res) => {
  const activityId = req.params.id;

  const fallbackToLocalDB = (defaultStatus = 404, defaultError = "Activity not found on Strava or local database.") => {
    db.get(
      `SELECT a.*, (SELECT COUNT(*) FROM kudos k WHERE k.activity_id = a.id) as kudos_count 
       FROM activities a 
       WHERE a.id = ? AND (a.user_id = ? OR a.user_id IN (SELECT friend_id FROM connections WHERE user_id = ? AND status = 'accepted'))`,
      [activityId, req.user.id, req.user.id],
      (dbErr, row) => {
        if (dbErr || !row) {
          return res.status(defaultStatus).json({ error: defaultError });
        }
        let sets = [];
        if (row.sets_json) {
          try {
            sets = typeof row.sets_json === "string" ? JSON.parse(row.sets_json) : row.sets_json;
          } catch (e) {
            sets = [];
          }
        }
        const fallbackData = {
          id: row.id,
          name: row.name || "Activity Details",
          type: row.sport_type || "Workout",
          sport_type: row.sport_type || "Workout",
          distance: (row.distance_km || 0) * 1000,
          moving_time: (row.moving_time_min || 0) * 60,
          elapsed_time: (row.moving_time_min || 0) * 60,
          total_elevation_gain: row.elevation_m || 0,
          average_heartrate: row.average_heartrate || 0,
          has_heartrate: row.average_heartrate > 0,
          suffer_score: Math.round(row.rooka_score || row.tss || 0),
          rooka_score: Math.round(row.rooka_score || row.tss || 0),
          start_date: row.start_date,
          start_date_local: row.start_date,
          sets_json: sets,
          kudos_count: row.kudos_count || 0,
          // Without this the client had no route to decode and fell back to a
          // hardcoded square over Amsterdam.
          polyline: row.polyline || null,
          average_watts: row.average_watts || null,
          max_heartrate: row.max_heartrate || null,
        };
        return res.json(fallbackData);
      }
    );
  };

  db.get(
    "SELECT strava_refresh_token FROM users WHERE id = ?",
    [req.user.id],
    async (err, user) => {
      if (err || !user || !user.strava_refresh_token) {
        return fallbackToLocalDB(400, "Strava token missing from settings.");
      }

      try {
        const tokenRes = await fetch("https://www.strava.com/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: process.env.STRAVA_CLIENT_ID,
            client_secret: process.env.STRAVA_CLIENT_SECRET,
            grant_type: "refresh_token",
            refresh_token: user.strava_refresh_token,
          }),
        });

        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) {
          return fallbackToLocalDB(401, "Strava rejected the token.");
        }

        const actRes = await fetch(
          `https://www.strava.com/api/v3/activities/${activityId}`,
          {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
          },
        );

        if (!actRes.ok) {
          return fallbackToLocalDB(actRes.status, "Activity not found on Strava.");
        }

        const activityData = await actRes.json();

        // Extract sets or best efforts for the AI Coach
        let extractedSets = [];

        if (activityData.best_efforts && activityData.best_efforts.length > 0) {
          extractedSets = activityData.best_efforts.map((be) => ({
            name: be.name,
            time: be.moving_time || be.elapsed_time,
            elapsed_time: be.elapsed_time,
            distance: be.distance,
            pr_rank: be.pr_rank,
          }));
        }
        // Strava strength training structure (defensive parsing)
        if (activityData.sport_type === "WeightTraining") {
          // Try to pull from sets, exercises, or laps (depending on how partner apps sync)
          if (activityData.sets) extractedSets = activityData.sets;
          else if (activityData.exercises)
            extractedSets = activityData.exercises;
          else if (activityData.laps) extractedSets = activityData.laps; // sometimes sets are stored as laps
        }

        if (extractedSets.length > 0) {
          db.run(`UPDATE activities SET sets_json = ? WHERE id = ?`, [
            JSON.stringify(extractedSets),
            activityId,
          ]);
          activityData.sets_json = extractedSets; // attach for frontend
        }

        // Opportunistic backfill: whenever an older activity is opened and the
        // live fetch succeeds, keep its route so the next open works offline too.
        const livePolyline = extractStravaPolyline(activityData);
        if (livePolyline) {
          db.run(
            `UPDATE activities SET polyline = ? WHERE user_id = ? AND (id = ? OR strava_activity_id = ?) AND (polyline IS NULL OR polyline = '')`,
            [livePolyline, req.user.id, activityId, String(activityId)],
          );
        }

        res.json(activityData);
      } catch (err) {
        console.error("Single Activity Fetch Error:", err);
        fallbackToLocalDB(500, "Failed to fetch activity details.");
      }
    },
  );
});

router.get("/api/dashboard-data", authenticateToken, (req, res) => {
  db.all(
    `SELECT substr(start_date, 1, 10) as date, sport_type, SUM(rooka_score) as daily_rooka FROM activities WHERE user_id = ? GROUP BY date, sport_type ORDER BY date ASC`,
    [req.user.id],
    (err, rows) => {
      if (!rows) return res.json([]);
      const aggregated = {};
      rows.forEach((r) => {
        const mappedSport = mapStravaSportToRooka(r.sport_type);
        const key = `${r.date}_${mappedSport}`;
        if (!aggregated[key])
          aggregated[key] = {
            date: r.date,
            sport_type: mappedSport,
            daily_rooka: 0,
          };
        aggregated[key].daily_rooka += r.daily_rooka;
      });
      res.json(Object.values(aggregated));
    },
  );
});

router.get("/api/history", authenticateToken, (req, res) => {
  db.all(
    `SELECT id, name, sport_type, start_date, rooka_score, distance_km, moving_time_min, average_heartrate, average_watts, max_heartrate, elevation_m, polyline FROM activities WHERE user_id = ? ORDER BY start_date DESC LIMIT 50`,
    [req.user.id],
    (err, rows) => {
      res.json(rows || []);
    },
  );
});

router.post("/api/activities", authenticateToken, async (req, res) => {
  try {
    const {
      name,
      sport_type,
      type,
      distance_km,
      distance,
      moving_time_min,
      moving_time,
      start_date,
      elevation_m,
      total_elevation_gain,
      average_heartrate,
      sets,
    } = req.body;

    const rawSport = sport_type || type || "Run";
    const finalSport = mapStravaSportToRooka(rawSport) || rawSport;
    const finalMovingTimeMin =
      moving_time_min !== undefined
        ? parseFloat(moving_time_min)
        : moving_time !== undefined
          ? parseFloat(moving_time) / 60
          : 30;
    const finalDistanceKm =
      distance_km !== undefined
        ? parseFloat(distance_km)
        : distance !== undefined
          ? parseFloat(distance) / 1000
          : 0;
    const finalElevation =
      elevation_m !== undefined
        ? parseInt(elevation_m, 10)
        : total_elevation_gain !== undefined
          ? parseInt(total_elevation_gain, 10)
          : 0;
    const finalAvgHr = average_heartrate ? parseFloat(average_heartrate) : 0;
    const finalStartDate = start_date || new Date().toISOString();
    const manualId = -Date.now();

    const rookaScore = await calculateRookaScoreZoned({
      userId: req.user.id,
      movingTimeMin: finalMovingTimeMin,
      avgHr: finalAvgHr,
      sport: finalSport,
    });

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO activities (id, user_id, name, sport_type, distance_km, elevation_m, moving_time_min, average_heartrate, start_date, rooka_score, sets_json) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          manualId,
          req.user.id,
          name || `Manual ${finalSport}`,
          finalSport,
          finalDistanceKm,
          finalElevation,
          finalMovingTimeMin,
          finalAvgHr,
          finalStartDate,
          rookaScore,
          JSON.stringify(sets || []),
        ],
        function (err) {
          if (err) return reject(err);
          resolve(this);
        }
      );
    });

    // Update user's total Rooka & level
    updateUserRookaAndCheckLevel(req.user.id, { isRealtime: true });

    // Invalidate today's nutrition cache so it incorporates the new workout
    const todayStr = finalStartDate.split("T")[0];
    db.run(
      `DELETE FROM nutrition_protocols WHERE user_id = ? AND date = ?`,
      [req.user.id, todayStr],
    );

    // Evaluate active quests (paid tiers only)
    let completedQuests = [];
    if (canAccessQuests(req.user.subscription_tier)) {
      try {
        completedQuests = await evaluateQuestsAgainstActivity(req.user.id, {
          distance_km: finalDistanceKm,
          moving_time_min: finalMovingTimeMin,
          rooka_score: rookaScore,
          sport_type: finalSport,
        });
      } catch (questErr) {
        console.error("Error evaluating quests after manual activity log:", questErr);
      }
    }

    sendSSEEvent(req.user.id, "activity_logged", { activityId: manualId });
    sendSSEEvent(req.user.id, "activity_synced", { activityId: manualId });
    if (canAccessQuests(req.user.subscription_tier)) {
      sendSSEEvent(req.user.id, "quest_updated", {});
    }

    const activityObj = {
      id: manualId,
      user_id: req.user.id,
      name: name || `Manual ${finalSport}`,
      sport_type: finalSport,
      distance_km: finalDistanceKm,
      elevation_m: finalElevation,
      moving_time_min: finalMovingTimeMin,
      average_heartrate: finalAvgHr,
      start_date: finalStartDate,
      rooka_score: rookaScore,
    };

    res.json({
      success: true,
      activity: activityObj,
      completedQuests: completedQuests || [],
    });
  } catch (error) {
    console.error("POST /api/activities error:", error);
    res.status(500).json({ error: "Failed to log activity", details: error.message });
  }
});

router.post("/api/micro-plan", authenticateToken, (req, res) => {
  const { date, sport, description, target_rooka, details, steps_json } =
    req.body;
  db.run(
    `INSERT INTO micro_plan (user_id, date, sport, description, target_rooka, details, steps_json, source) VALUES (?, ?, ?, ?, ?, ?, ?, 'user')`,
    [
      req.user.id,
      date,
      sport,
      description,
      target_rooka,
      details,
      steps_json || "[]",
    ],
    (err) => {
      if (err) {
        console.error("POST /api/micro-plan error:", err.message);
        return res
          .status(500)
          .json({ error: "Failed to create plan", details: err.message });
      }
      res.json({ success: true });
    },
  );
});

router.post("/api/micro-plan/push-forward", authenticateToken, (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: "date is required" });

  const userId = req.user.id;

  // Shift everything from `date` up to `date + 6 days` forward by 1 day
  db.run(
    `UPDATE micro_plan SET date = DATE(date, '+1 day') WHERE user_id = ? AND date >= ? AND date <= DATE(?, '+6 days')`,
    [userId, date, date],
    function (err) {
      if (err)
        return res.status(500).json({ error: "Failed to update micro plan." });

      const msg = `I've shifted your schedule starting from ${date} forward by one day. Take it easy and recover!`;
      db.run(
        `INSERT INTO chat_history (user_id, role, content, mood) VALUES (?, 'assistant', ?, 'empathetic')`,
        [userId, msg],
        (err2) => {
          res.json({ success: true, message: msg });
        },
      );
    },
  );
});

router.post("/api/micro-plan/day", authenticateToken, (req, res) => {
  const { date, workouts } = req.body;
  if (!date || !Array.isArray(workouts))
    return res.status(400).json({ error: "Invalid data format" });

  db.run(
    `DELETE FROM micro_plan WHERE user_id = ? AND date = ?`,
    [req.user.id, date],
    (err) => {
      if (err) return res.status(500).json({ error: "Failed to update plan" });

      if (workouts.length === 0) return res.json({ success: true });

      const stmt = db.prepare(
        `INSERT INTO micro_plan (user_id, date, sport, description, target_rooka, details, steps_json, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      workouts.forEach((w) => {
        stmt.run(
          req.user.id,
          date,
          w.sport,
          w.description,
          w.target_rooka,
          w.details,
          w.steps_json || "[]",
          // This route rewrites a whole day, so a caller replaying a
          // coach-written session has to say so or its provenance is lost.
          w.source === "coach" ? "coach" : "user",
        );
      });
      stmt.finalize();
      res.json({ success: true });
    },
  );
});

router.put("/api/micro-plan/:id", authenticateToken, (req, res) => {
  const { date, sport, description, target_rooka, details, steps_json } =
    req.body;
  db.run(
    `UPDATE micro_plan SET date = ?, sport = ?, description = ?, target_rooka = ?, details = ?, steps_json = ? WHERE id = ? AND user_id = ?`,
    [
      date,
      sport,
      description,
      target_rooka,
      details,
      steps_json,
      req.params.id,
      req.user.id,
    ],
    (err) => {
      if (err) {
        console.error("PUT /api/micro-plan error:", err.message);
        return res
          .status(500)
          .json({ error: "Failed to update plan", details: err.message });
      }
      res.json({ success: true });
    },
  );
});

router.delete("/api/micro-plan/:id", authenticateToken, (req, res) => {
  db.run(
    `DELETE FROM micro_plan WHERE id = ? AND user_id = ?`,
    [req.params.id, req.user.id],
    (err) => {
      if (err) return res.status(500).json({ error: "Failed to delete plan" });
      res.json({ success: true });
    },
  );
});

router.post("/api/generate-plan", authenticateToken, async (req, res) => {
  const { targetDate } = req.body;

  db.get(
    `SELECT coach_tone, coach_name, coach_context, athlete_context, gender, training_availability, current_ctl, current_atl, training_phase, cycle_tracking_enabled FROM users WHERE id = ?`,
    [req.user.id],
    async (err, user) => {
      if (err) {
        console.error(
          "DB Error fetching user context for plan generation:",
          err,
        );
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
        };
      }

      const goalContext = await getUserGoalPromptContext(req.user.id, user);

      db.all(
        `SELECT metric, value FROM athlete_metrics WHERE user_id = ?`,
        [req.user.id],
        async (err, metricsRows) => {
          const metricsText =
            metricsRows && metricsRows.length > 0
              ? metricsRows.map((m) => `${m.metric}: ${m.value}`).join(", ")
              : "None explicitly recorded yet.";

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

              let availabilityText = "No specific schedule boundaries set.";
              if (user.training_availability) {
                try {
                  const availObj = JSON.parse(user.training_availability);
                  availabilityText = Object.entries(availObj)
                    .map(([day, data]) => {
                      return `- ${day.charAt(0).toUpperCase() + day.slice(1)}: ${data.status} (Max minutes: ${data.max_minutes})`;
                    })
                    .join("\n            ");
                } catch (e) {}
              }

              db.all(
                `SELECT body_part, severity, notes FROM athlete_niggles WHERE user_id = ? AND status = 'active'`,
                [req.user.id],
                async (err, niggleRows) => {
                  let nigglesText = "No active injuries or niggles reported.";
                  if (niggleRows && niggleRows.length > 0) {
                    nigglesText = JSON.stringify(niggleRows);
                  }

                  // Plan generation saw active injuries but never muscle load, so
                  // nothing stopped it stacking a third quad-heavy day in a row.
                  let muscleStatusText = "All muscle groups fresh.";
                  try {
                    muscleStatusText = await muscleLoad.getMuscleStatusTextForUser(req.user.id);
                  } catch (e) {
                    console.error("Muscle load for plan generation failed:", e.message);
                  }

                  const coachName = user.coach_name || 'Rooka';
                  let coachToneText = user.coach_tone || 'Empathetic but demanding elite endurance coach.';
                  if (user.coach_tone === 'custom' || user.coach_tone === 'Configure own coach') {
                    coachToneText = user.coach_context ? `Custom tone: ${user.coach_context}` : 'Custom coach persona';
                  }

                  const systemPrompt = `You are Coach ${coachName}, an elite endurance and athletic performance coach.
                Tone: ${coachToneText}
                ${user.coach_context ? `Coach Custom Context & Rules: ${user.coach_context}` : ''}
                Athlete Context: ${user.athlete_context || "General endurance athlete"}
                Athlete Primary Goal: ${goalContext.goalName} (${goalContext.goalDate || 'Target Date TBD'})
                Gender: ${user.gender || "Prefer not to share"}
                ${(user.gender === "Female" || user.gender === "Prefer not to share" || user.gender === "Prefer not to say") && user.cycle_tracking_enabled !== 0 ? "IMPORTANT: Adjust training load taking the menstrual cycle into consideration. Distribute exercises carefully around the physically demanding days." : ""}
                Schedule Boundaries:
                ${availabilityText}
                Key Physiological Metrics: ${metricsText}
                MUSCLE LOAD OVER THE LAST 7 DAYS (0-100% of a reference load, derived from completed activities):
                    ${muscleStatusText}
                Recent Strength & PB History:
                ${recentSetsText}
                ACTIVE INJURIES/NIGGLES:
                ${nigglesText}

                ${goalContext.promptContext}
            
            CRITICAL RULES:
            0. ACTIVITY TYPE (SPORT): The 'sport' field is REQUIRED for every workout in the JSON and MUST be exactly one of: 'Run', 'Bike', 'Swim', 'Strength', 'Rest'. Never leave it blank. For Strength workouts, you MUST include an "exerciseName" in each step.
            1. You are generating a 7-day training plan starting exactly on ${targetDate}.
            2. SCHEDULE BOUNDARIES: You MUST adhere to the daily time constraints listed in "Schedule Boundaries". If a day is marked 'blocked' or max_minutes is 0, you are strictly forbidden from scheduling any active training on that day (you may only schedule 'Rest'). Do not spike the ATL excessively on a single day to compensate; distribute the load safely across the 'Available' and 'Time-Capped' days.
            3. MUSCLE LOAD: Read "MUSCLE LOAD OVER THE LAST 7 DAYS". Any group listed HIGH is already heavily loaded — do not schedule two consecutive sessions whose main driver is that group, and prefer a sport that spares it (a HIGH quadriceps or calf reading favours swimming over running or riding). Groups not listed are fresh and available.
            4. INJURY GUARDRAILS: The athlete has active injuries listed above. You MUST alter the training plan based on this data to prevent further injury.
               - If an injury is Lower Body (Severity 3+): Strictly avoid high-impact running. Substitute required aerobic load with swimming or indoor cycling.
               - If an injury affects Grip/Hands: Substitute swimming or heavy upper-body strength with running or indoor cycling.
               - If Severity is 5: Schedule complete rest for the affected area.
               - Whenever you modify a template due to an active injury, you must add a brief note in the 'description' explaining the substitution (e.g., 'Swapped today's run for a ride to protect your Achilles').
            5. You must append a JSON code block at the very end of your response containing the schedule.
            6. Use metric measurements exclusively (km, kg, km/h). IMPORTANT: For 'distance' condition_type in the JSON steps, the condition_value MUST be in pure METERS (e.g., use 5000 for a 5km interval, NOT 5). DO NOT repeat greetings, filler words, or preamble.
            7. BRICK WORKOUTS: If you prescribe a multi-sport Brick workout, create two separate objects in the JSON array (one for "Bike", one for "Run") for that same date.
            8. STRENGTH & FUNCTIONAL TRAINING PARITY (CRITICAL):
               - Only prescribe 'Strength' workouts if the Athlete Context explicitly mentions strength training, weightlifting, or being a hybrid athlete.
               - EXERCISE & STEP PARITY MANDATE: EVERY single exercise, station, carry, lift, or core movement described in 'details' MUST have its own corresponding repeat block or step in the 'steps_json' array! NEVER omit exercises or only output 1 exercise when multiple exercises were prescribed in 'details'.
               - For Strength workouts, put each exercise into 'steps_json' with "condition_type": "reps" (for reps), "distance" (in meters for carries/sled pushes, e.g. 100), or "time_sec"/"time" (for planks/timed holds). Set "condition_value" to the number of reps, meters, or seconds. Add "weight": <kg_number> and "exerciseName": "<name>" to the step object. Use standard exercise names (e.g., "Barbell Back Squat", "Farmers Carry", "Pallof Press").
               - Between sets, use a "rest" step with "condition_type": "time_sec" and set "condition_value" to the number of SECONDS to rest (e.g., 90 for 90 seconds).
               - On Warmup and Cooldown steps, ALWAYS include "exerciseName" specifying the mobility drills or stretches (e.g., "Cossack Squats & Inchworms", "Couch Stretch & Pigeon Pose").
               - Reference the Athlete Context for their past weights, and push for progressive overload.
            9. TARGETS: If a workout step requires a specific pace or power target:
               - For exact pace (e.g. 4:15 min/km): set "target_type": "pace.exact" and set "target_value": "4:15" (do NOT include "min/km" in target_value!).
               - For exact power (e.g. 250W): set "target_type": "power.exact" and set "target_value": "250" (do NOT include "W" in target_value!).
               - For a power zone instead of an exact wattage: set "target_type": "power.zone" and "zone": <1-7>.
               - For HR Zones: set "target_type": "heart.rate.zone" and "zone": <1-5>.
               - For open targets: set "target_type": "no.target".
            10. ROOKA TARGETS: Calculate "target_rooka" for your plan. 1 minute of endurance activity = 1.2 Rooka. For high intensity (Zone 3/4+), use 1.3 or 1.4 Rooka per min. For Zone 1/Rest, use 1.0 Rooka per min. For Strength Training, allocate exactly 0.5 Rooka per set (ignore rest time).
            11. BENCHMARK ASSESSMENT: If the athlete is new or setting up an onboarding plan, Day 1 or Day 2 MUST contain exactly ONE sport-tailored Benchmark Assessment workout to establish baseline capabilities:
                 - For RUNNING / MARATHON focus: Schedule a 5k Pace & HR Benchmark Run ("sport": "Run", "description": "🎯 Benchmark Assessment: 5k Pace & HR Test").
                 - For CYCLING focus: Schedule a 20-min FTP Baseline Test ("sport": "Bike", "description": "🎯 Benchmark Assessment: 20-Min FTP Baseline Test").
                 - For SWIMMING focus: Schedule a 400m CSS Swim Test ("sport": "Swim", "description": "🎯 Benchmark Assessment: 400m CSS Swim Test").
                 - For HYROX / FUNCTIONAL FITNESS focus: Schedule a Hyrox Benchmark Test ("sport": "Strength", "description": "🎯 Benchmark Assessment: Hyrox Functional Fitness Test").
                 - NEVER assign a running test to pure swimmers/cyclists or a cycling test to Hyrox athletes. Respect their specific sport/goal context strictly.
            12. IMPORTANT: Warmup and Cooldown steps should generally use "target_type": "no.target" or open intensity so the athlete can gradually ease in and elevate their heart rate without triggering out-of-zone alarms while cold. Rest and Recovery steps can be Zone 1.
            13. WORKOUT DETAILS & PRESCRIPTION GRANULARITY (CRITICAL):
                - Every workout's 'details' field is the primary athlete-facing coaching prescription and MUST NEVER be a basic, vague one-liner like "intervals" or "easy run".
                - You MUST prescribe concrete technique cues, drills, equipment (e.g. pull buoy & hand paddles, aero bars, SkiErg, sled push), specific movement focus (e.g. "focus on high heels / rapid heel recovery", "early vertical forearm EVF catch", "single-leg pedaling"), dynamic mobility warm-ups, and session fueling guidance.
                - Ensure 100% PARITY between all movements described in 'details' and all step blocks in 'steps_json'.

        WORKOUT PLANNING (CRITICAL):
        If you create, suggest, or modify a workout plan, you MUST append a JSON code block at the very end of your response. 
        The JSON must be a valid Array of objects. Format it EXACTLY JSON FORMAT REQUIRED AT THE END OF YOUR RESPONSE:
        \`\`\`json
        [
          {
            "date": "YYYY-MM-DD",
            "sport": "Run", 
            "description": "5k Speed Intervals & Form Drills",
            "target_rooka": 80,
            "details": "Warm-up: 2x10 ankle rocks, 3x30m A-skips and butt kicks cueing rapid heel recovery (high heels). Main set: 8x1000m at threshold with 1min active recoveries. Cool-down: 10 min easy jog + calf mobility.",
            "steps_json": "[{\\"type\\": \\"warmup\\", \\"exerciseName\\": \\"A-Skips & Ankle Rocks\\", \\"condition_type\\": \\"time\\", \\"condition_value\\": 15, \\"target_type\\": \\"heart.rate.zone\\", \\"zone\\": 2}, {\\"type\\": \\"repeat\\", \\"iterations\\": 8, \\"steps\\": [{\\"type\\": \\"interval\\", \\"exerciseName\\": \\"1000m Threshold Interval\\", \\"condition_type\\": \\"distance\\", \\"condition_value\\": 1000, \\"target_type\\": \\"heart.rate.zone\\", \\"zone\\": 4}, {\\"type\\": \\"recovery\\", \\"condition_type\\": \\"time\\", \\"condition_value\\": 1, \\"target_type\\": \\"heart.rate.zone\\", \\"zone\\": 1}]}, {\\"type\\": \\"cooldown\\", \\"exerciseName\\": \\"Easy Jog & Mobility\\", \\"condition_type\\": \\"time\\", \\"condition_value\\": 10, \\"target_type\\": \\"heart.rate.zone\\", \\"zone\\": 2}]"
          },
          {
            "date": "YYYY-MM-DD",
            "sport": "Strength", 
            "description": "Lower Body & Hyrox Core Power",
            "target_rooka": 45,
            "details": "Warmup: Cossack squats, inchworms (10 min). Main: Barbell Back Squat 3x10 reps (90s rest), Farmers Carry 4x100m (60s rest), Pallof Press 3x12 reps (45s rest). Cooldown: Couch stretch & pigeon pose (5 min).",
            "steps_json": "[{\\"type\\": \\"warmup\\", \\"exerciseName\\": \\"Cossack Squats & Inchworms\\", \\"condition_type\\": \\"time\\", \\"condition_value\\": 10, \\"target_type\\": \\"no.target\\"}, {\\"type\\": \\"repeat\\", \\"iterations\\": 3, \\"steps\\": [{\\"type\\": \\"interval\\", \\"exerciseName\\": \\"Barbell Back Squat\\", \\"condition_type\\": \\"reps\\", \\"condition_value\\": 10, \\"weight\\": 60, \\"target_type\\": \\"weight\\"}, {\\"type\\": \\"rest\\", \\"condition_type\\": \\"time_sec\\", \\"condition_value\\": 90, \\"target_type\\": \\"no.target\\"}]}, {\\"type\\": \\"repeat\\", \\"iterations\\": 4, \\"steps\\": [{\\"type\\": \\"interval\\", \\"exerciseName\\": \\"Farmers Carry\\", \\"condition_type\\": \\"distance\\", \\"condition_value\\": 100, \\"weight\\": 20, \\"target_type\\": \\"weight\\"}, {\\"type\\": \\"rest\\", \\"condition_type\\": \\"time_sec\\", \\"condition_value\\": 60, \\"target_type\\": \\"no.target\\"}]}, {\\"type\\": \\"repeat\\", \\"iterations\\": 3, \\"steps\\": [{\\"type\\": \\"interval\\", \\"exerciseName\\": \\"Pallof Press\\", \\"condition_type\\": \\"reps\\", \\"condition_value\\": 12, \\"target_type\\": \\"no.target\\"}, {\\"type\\": \\"rest\\", \\"condition_type\\": \\"time_sec\\", \\"condition_value\\": 45, \\"target_type\\": \\"no.target\\"}]}, {\\"type\\": \\"cooldown\\", \\"exerciseName\\": \\"Couch Stretch & Pigeon Pose\\", \\"condition_type\\": \\"time\\", \\"condition_value\\": 5, \\"target_type\\": \\"no.target\\"}]"
          }
        ]
        \`\`\`
        *Note: Ensure "steps_json" is formatted as a stringified JSON array as shown in the examples. All exercises from details MUST be included in steps_json!*`;

                  const ctl = user.current_ctl || 0;
                  const atl = user.current_atl || 0;
                  const tsb = ctl - atl;
                  const phase = user.training_phase || "Base";

                  const userPrompt = `Please generate a 7-day training plan for me starting on ${targetDate}. 
        
        Here are my current physiological metrics to govern the volume and intensity of this block:
        - Training Phase: ${phase}
        - Fitness (CTL): ${ctl}
        - Fatigue (ATL): ${atl}
        - Form (TSB): ${tsb}

        Analyze my Form (TSB). If I am highly fatigued (negative TSB), prioritize recovery. If I am fresh (positive TSB), you can push the intensity. Give me a quick encouraging summary of the week's focus based on these metrics, and then provide the JSON block.`;

                  try {
                    let aiReply = await generateWithFallback(
                      userPrompt,
                      systemPrompt,
                    );
                    let planUpdated = false;

                    const jsonMatch = aiReply.match(/```json([\s\S]*?)```/);
                    if (jsonMatch) {
                      try {
                        const planData = JSON.parse(jsonMatch[1]);
                        const affectedDates = [
                          ...new Set(planData.map((day) => day.date)),
                        ];

                        if (affectedDates.length > 0) {
                          const placeholders = affectedDates
                            .map(() => "?")
                            .join(",");

                          db.run(
                            `DELETE FROM micro_plan WHERE user_id = ? AND date IN (${placeholders})`,
                            [req.user.id, ...affectedDates],
                            (err) => {
                              if (err)
                                console.error(
                                  "Failed to clear old plan data:",
                                  err,
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
                                  Array.isArray(day.steps)
                                    ? JSON.stringify(day.steps)
                                    : typeof day.steps_json === 'object'
                                    ? JSON.stringify(day.steps_json)
                                    : (day.steps_json || "[]"),
                                );
                              });
                              stmt.finalize();
                            },
                          );
                        }

                        planUpdated = true;
                        aiReply = aiReply
                          .replace(/```json[\s\S]*?```/, "")
                          .trim();
                        aiReply = aiReply.replace(/[^.!?\n]*:\s*$/i, "").trim();
                      } catch (e) {
                        console.error("Failed to parse AI JSON block", e);
                      }
                    }

                    let mood = "default";
                    const lowerReply = aiReply.toLowerCase();
                    if (
                      lowerReply.includes("crush") ||
                      lowerReply.includes("!")
                    )
                      mood = "hype";
                    if (
                      lowerReply.includes("disappoint") ||
                      lowerReply.includes("skip")
                    )
                      mood = "disappointed";

                    const simulatedUserMessage = `Can you build my plan for next week, Rooka?`;
                    const coachAcknowledgement = `I've just crunched your latest numbers and pushed a fresh ${phase} phase plan to your dashboard. Go check it out—you're going to crush it!`;

                    db.run(
                      `INSERT INTO chat_history (user_id, role, content) VALUES (?, 'user', ?)`,
                      [req.user.id, simulatedUserMessage],
                    );
                    db.run(
                      `INSERT INTO chat_history (user_id, role, content, mood) VALUES (?, 'coach', ?, ?)`,
                      [req.user.id, coachAcknowledgement, mood],
                    );
                    res.json({
                      reply: aiReply,
                      mood: mood,
                      planUpdated: planUpdated,
                    });
                  } catch (e) {
                    console.error("AI Generation Error:", e);
                    res.status(500).json({ error: "AI failed to respond." });
                  }
                },
              ); // End niggles fetch
            },
          ); // End activities fetch
        },
      ); // End metrics fetch
    },
  ); // End users fetch
});
// --- ACTIVITY COMMENTS API ---
router.get("/api/activities/:id/comments", authenticateToken, (req, res) => {
  const activityId = req.params.id;
  db.all(
    `
    SELECT c.*, u.username, u.profile_picture_url
    FROM activity_comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.activity_id = ?
    ORDER BY c.created_at ASC
    `,
    [activityId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Failed to fetch comments" });
      res.json({ comments: rows || [] });
    }
  );
});

router.post("/api/activities/:id/comments", authenticateToken, (req, res) => {
  const activityId = req.params.id;
  const { comment } = req.body;
  if (!comment || !comment.trim()) {
    return res.status(400).json({ error: "Comment text cannot be empty" });
  }

  db.run(
    `INSERT INTO activity_comments (activity_id, user_id, comment) VALUES (?, ?, ?)`,
    [activityId, req.user.id, comment.trim()],
    function (err) {
      if (err) return res.status(500).json({ error: "Failed to add comment" });
      const commentId = this.lastID;

      db.get(
        `SELECT c.*, u.username, u.profile_picture_url FROM activity_comments c JOIN users u ON c.user_id = u.id WHERE c.id = ?`,
        [commentId],
        (errGet, newComment) => {
          // Notify activity owner if different from commenter
          db.get(
            `SELECT user_id, name FROM activities WHERE id = ?`,
            [activityId],
            (errAct, act) => {
              if (act && act.user_id !== req.user.id) {
                const commenterName = req.user.username || "Someone";
                const activityName = act.name || "activity";
                const coachMsg = `${commenterName} left a comment on your "${activityName}": "${comment.trim()}"`;

                db.run(
                  `INSERT INTO chat_history (user_id, role, content, mood) VALUES (?, 'coach', ?, 'support')`,
                  [act.user_id, coachMsg],
                  (errChat) => {
                    if (!errChat) {
                      sendSSEEvent(act.user_id, "unread_message", {
                        message: coachMsg,
                        mood: "support",
                      });
                    }
                  }
                );

                sendSSEEvent(act.user_id, "comment_received", {
                  activityName: activityName,
                  fromUsername: commenterName,
                  comment: comment.trim(),
                });

                sendPushToUser(act.user_id, {
                  title: "New Comment on Your Workout! 💬",
                  body: `${commenterName} commented on "${activityName}": "${comment.trim()}"`,
                  data: { url: "/(tabs)/social", type: "comment" },
                });
              }
            }
          );

          res.json({ success: true, comment: newComment });
        }
      );
    }
  );
});

router.delete("/api/activities/:id/comments/:commentId", authenticateToken, (req, res) => {
  const commentId = req.params.commentId;
  db.run(
    `DELETE FROM activity_comments WHERE id = ? AND user_id = ?`,
    [commentId, req.user.id],
    function (err) {
      if (err) return res.status(500).json({ error: "Failed to delete comment" });
      res.json({ success: true, deletedId: commentId });
    }
  );
});

module.exports = router;

module.exports = router;
