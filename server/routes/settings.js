const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const db = require("../services/db");
const { authenticateToken } = require("../services/auth");
const { getRookaLevelInfo } = require("../services/utils");
const athleteZones = require("../services/athleteZones");
const zoneModel = require("../services/zones");

const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "../public/uploads/profiles");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `profile_${req.user.id}_${Date.now()}${ext}`);
  },
});
const uploadProfile = multer({ storage: profileStorage });

const coachAvatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "../public/uploads/coaches");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const mood = req.body.mood || "neutral";
    cb(null, `coach_${req.user.id}_${mood}_${Date.now()}${ext}`);
  },
});
const uploadCoachAvatar = multer({ storage: coachAvatarStorage });


router.post("/api/settings/privacy", authenticateToken, (req, res) => {
  const { searchPrivacy } = req.body;
  db.run(
    `UPDATE users SET search_privacy = ? WHERE id = ?`,
    [searchPrivacy ? 1 : 0, req.user.id],
    function (err) {
      if (err) return res.status(500).json({ error: "DB_ERROR" });
      res.json({ success: true });
    },
  );
});

router.post("/api/notifications/register-push-token", authenticateToken, (req, res) => {
  const { pushToken, platform } = req.body;
  if (!pushToken) return res.status(400).json({ error: "Missing pushToken" });

  db.run(
    `INSERT INTO push_tokens (user_id, push_token, platform) VALUES (?, ?, ?)
     ON CONFLICT(push_token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform`,
    [req.user.id, pushToken, platform || 'expo'],
    function (err) {
      if (err) {
        console.error("Push token save error:", err);
        return res.status(500).json({ error: "DB_ERROR" });
      }
      res.json({ success: true });
    }
  );
});

router.post(
  "/api/settings/profile-picture",
  authenticateToken,
  uploadProfile.single("photo"),
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const url = `/uploads/profiles/${req.file.filename}`;

    db.run(
      `UPDATE users SET profile_picture_url = ? WHERE id = ?`,
      [url, req.user.id],
      function (err) {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: "DB_ERROR" });
        }
        res.json({ success: true, url });
      },
    );
  },
);

const handleCoachAvatarUpload = (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const mood = (req.body.mood || "neutral").toLowerCase();
  const url = `/uploads/coaches/${req.file.filename}`;

  let colName = "coach_avatar_neutral";
  if (mood === "hype") colName = "coach_avatar_hype";
  else if (mood === "disappointed") colName = "coach_avatar_disappointed";

  db.run(
    `UPDATE users SET ${colName} = ? WHERE id = ?`,
    [url, req.user.id],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "DB_ERROR" });
      }
      res.json({ success: true, mood, url });
    },
  );
};

router.post(
  "/api/settings/coach-avatar",
  authenticateToken,
  uploadCoachAvatar.single("photo"),
  handleCoachAvatarUpload
);

router.post(
  "/api/user/settings/coach-avatar",
  authenticateToken,
  uploadCoachAvatar.single("photo"),
  handleCoachAvatarUpload
);

router.get("/api/user/settings", authenticateToken, (req, res) => {
  db.get(
    `SELECT id, username, email, strava_refresh_token, garmin_username, coach_tone, coach_name, coach_context, coach_avatar_neutral, coach_avatar_hype, coach_avatar_disappointed, athlete_context, gender, language, last_cycle_start, average_cycle_length, search_privacy, profile_picture_url, training_availability, total_rooka, daily_token_usage, daily_token_limit, subscription_tier, last_token_reset_date, onboarding_completed FROM users WHERE id = ?`,
    [req.user.id],
    (err, row) => {
      if (err || !row) return res.status(500).json({ error: "DB Error" });
      let availability = {};
      if (row.training_availability) {
        try {
          availability = JSON.parse(row.training_availability);
        } catch (e) {}
      }
      const sparkLevelInfo = getRookaLevelInfo(row.total_rooka);
      
      const { getEffectiveTokenLimit, getAMSDateString } = require('../services/utils');
      const currentLimit = getEffectiveTokenLimit(row);
      const todayStr = getAMSDateString();
      const dailyUsage = (row.last_token_reset_date === todayStr) ? (row.daily_token_usage || 0) : 0;

      db.get(
        `SELECT name, date, target_ctl, goal_type, target_mode, target_value, target_weight, target_vo2max FROM milestones WHERE user_id = ? AND is_main = 1 ORDER BY date DESC LIMIT 1`,
        [req.user.id],
        async (mErr, mRow) => {
          let needsZoneSetup = true;
          try {
            const resolved = await athleteZones.resolveZonesForUser(req.user.id, 'default');
            needsZoneSetup = !resolved.hrZones && !resolved.powerZones;
          } catch (_) {}

          res.json({
            needsZoneSetup,
            id: row.id,
            username: row.username,
            email: row.email,
            hasStrava: !!row.strava_refresh_token,
            hasGarmin: !!row.garmin_username,
            garminUsername: row.garmin_username,
            coachTone: row.coach_tone,
            coachName: row.coach_name || 'Rooka',
            coachContext: row.coach_context || '',
            coachAvatarNeutral: row.coach_avatar_neutral || null,
            coachAvatarHype: row.coach_avatar_hype || null,
            coachAvatarDisappointed: row.coach_avatar_disappointed || null,
            athleteContext: row.athlete_context,
            gender: row.gender,
            language: row.language || 'en',
            lastCycleStart: row.last_cycle_start,
            averageCycleLength: row.average_cycle_length || 28,
            searchPrivacy: row.search_privacy === 1,
            profilePictureUrl: row.profile_picture_url,
            trainingAvailability: availability,
            sparkLevel: sparkLevelInfo,
            level: sparkLevelInfo?.level || 1,
            levelInfo: sparkLevelInfo,
            total_rooka: row.total_rooka || 0,
            totalRooka: row.total_rooka || 0,
            dailyTokenUsage: dailyUsage,
            dailyTokenLimit: currentLimit,
            subscriptionTier: row.subscription_tier || 'free',
            subscription_tier: row.subscription_tier || 'free',
            onboardingCompleted: row.onboarding_completed === 1,
            onboarding_completed: row.onboarding_completed === 1,
            target_event: mRow?.name || null,
            event_date: mRow?.date || null,
            target_ctl: mRow?.target_ctl || null,
            targetEvent: mRow?.name || null,
            eventDate: mRow?.date || null,
            targetCtl: mRow?.target_ctl || null,
            goal_type: mRow?.goal_type || 'race',
            goalType: mRow?.goal_type || 'race',
            target_mode: mRow?.target_mode || 'finish',
            targetMode: mRow?.target_mode || 'finish',
            target_value: mRow?.target_value || '',
            targetValue: mRow?.target_value || '',
            target_weight: mRow?.target_weight || null,
            targetWeight: mRow?.target_weight || null,
            target_vo2max: mRow?.target_vo2max || null,
            targetVo2max: mRow?.target_vo2max || null,
          });
        }
      );
    },
  );
});

// --- TRAINING ZONES -------------------------------------------------------

// Every table the athlete has, plus what the defaults were derived from.
router.get("/api/user/zones", authenticateToken, async (req, res) => {
  try {
    const sport = req.query.sport || "default";
    const resolved = await athleteZones.resolveZonesForUser(req.user.id, sport);
    db.all(
      `SELECT sport, kind, zones_json, source, updated_at FROM athlete_zones WHERE user_id = ?`,
      [req.user.id],
      (err, rows) => {
        const tables = (rows || []).map((r) => ({
          sport: r.sport,
          kind: r.kind,
          source: r.source,
          updatedAt: r.updated_at,
          zones: (() => {
            try { return JSON.parse(r.zones_json); } catch (_) { return []; }
          })(),
        }));
        res.json({
          sport,
          hrZones: resolved.hrZones,
          powerZones: resolved.powerZones,
          maxHr: resolved.maxHr,
          ftp: resolved.ftp,
          tables,
        });
      }
    );
  } catch (e) {
    console.error("Failed to load zones:", e);
    res.status(500).json({ error: "Failed to load training zones" });
  }
});

// Save one table. `sport` may be 'default' or any sport name, which is how a
// separate Swim or Bike table gets added without a schema change.
router.put("/api/user/zones", authenticateToken, async (req, res) => {
  const { sport = "default", kind, zones } = req.body || {};
  if (kind !== "hr" && kind !== "power") {
    return res.status(400).json({ error: "kind must be 'hr' or 'power'" });
  }
  if (!Array.isArray(zones) || zones.length === 0) {
    return res.status(400).json({ error: "zones must be a non-empty array" });
  }
  const clean = zones
    .map((z) => ({
      zone: Number(z.zone),
      min: Number(z.min),
      max: z.max == null || z.max === "" ? null : Number(z.max),
    }))
    .filter((z) => z.zone > 0 && !isNaN(z.min));

  if (clean.length === 0) {
    return res.status(400).json({ error: "No valid zone rows supplied" });
  }
  // Boundaries must climb, otherwise zoneOf() would resolve unpredictably.
  clean.sort((a, b) => a.zone - b.zone);
  for (let i = 1; i < clean.length; i++) {
    if (clean[i].min < clean[i - 1].min) {
      return res.status(400).json({ error: "Zone lower bounds must increase" });
    }
  }

  try {
    await athleteZones.saveZones(req.user.id, sport, kind, clean, "manual");
    res.json({ success: true, sport, kind, zones: clean });
  } catch (e) {
    console.error("Failed to save zones:", e);
    res.status(500).json({ error: "Failed to save training zones" });
  }
});

// Drop a sport-specific table and fall back to the default one.
router.delete("/api/user/zones/:sport", authenticateToken, async (req, res) => {
  if (req.params.sport === "default") {
    return res.status(400).json({ error: "The default table cannot be removed" });
  }
  await athleteZones.deleteZones(req.user.id, req.params.sport);
  res.json({ success: true });
});

// Rebuild a table from max HR / FTP, discarding manual edits.
router.post("/api/user/zones/reset", authenticateToken, async (req, res) => {
  const { sport = "default" } = req.body || {};
  try {
    const { maxHr, ftp } = await athleteZones.resolveZonesForUser(req.user.id, sport);
    const hr = zoneModel.buildHrZones(maxHr);
    const power = zoneModel.buildPowerZones(ftp);
    if (hr) await athleteZones.saveZones(req.user.id, sport, "hr", hr, "derived");
    if (power) await athleteZones.saveZones(req.user.id, sport, "power", power, "derived");
    res.json({ success: true, hrZones: hr, powerZones: power, maxHr, ftp });
  } catch (e) {
    console.error("Failed to reset training zones:", e);
    res.status(500).json({ error: "Failed to reset training zones" });
  }
});


router.post("/api/user/settings/account", authenticateToken, (req, res) => {
  const { email } = req.body;
  // Note: we can also add username here later if we want to allow username changes, but that requires checking for uniqueness.
  
  if (email !== undefined) {
    db.run(
      `UPDATE users SET email = ? WHERE id = ?`,
      [email, req.user.id],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: "Email is already in use by another account." });
          }
          return res.status(500).json({ error: "Failed to update account details." });
        }
        res.json({ success: true, message: "Account updated successfully" });
      }
    );
  } else {
    res.status(400).json({ error: "No fields to update." });
  }
});

router.post("/api/user/settings/coach", authenticateToken, (req, res) => {
  db.get(`SELECT * FROM users WHERE id = ?`, [req.user.id], (err, row) => {
    if (err || !row) return res.status(500).json({ error: "Database error." });

    const reqTone = req.body.coachTone !== undefined ? req.body.coachTone : row.coach_tone;
    const reqName = req.body.coachName !== undefined ? req.body.coachName : row.coach_name;
    const reqContext = req.body.coachContext !== undefined ? req.body.coachContext : row.coach_context;
    const athleteContext = req.body.athleteContext !== undefined ? req.body.athleteContext : row.athlete_context;
    const gender = req.body.gender !== undefined ? req.body.gender : row.gender;
    const lastCycleStart = req.body.lastCycleStart !== undefined ? req.body.lastCycleStart : row.last_cycle_start;
    const availabilityStr = req.body.trainingAvailability !== undefined
      ? JSON.stringify(req.body.trainingAvailability)
      : row.training_availability;

    const targetEvent = req.body.targetEvent !== undefined ? req.body.targetEvent : req.body.target_event;
    const eventDate = req.body.eventDate !== undefined ? req.body.eventDate : req.body.event_date;
    const targetCtl = req.body.targetCtl !== undefined ? req.body.targetCtl : req.body.target_ctl;
    const reqGoalType = req.body.goalType !== undefined ? req.body.goalType : req.body.goal_type;
    const reqTargetMode = req.body.targetMode !== undefined ? req.body.targetMode : req.body.target_mode;
    const reqTargetValue = req.body.targetValue !== undefined ? req.body.targetValue : req.body.target_value;
    const reqTargetWeight = req.body.targetWeight !== undefined ? req.body.targetWeight : req.body.target_weight;
    const reqTargetVo2max = req.body.targetVo2max !== undefined ? req.body.targetVo2max : req.body.target_vo2max;

    if (targetEvent !== undefined || eventDate !== undefined || reqGoalType !== undefined) {
      const finalGoalType = reqGoalType || 'race';
      const cleanEventName = (targetEvent && typeof targetEvent === 'string') ? targetEvent.trim() : '';
      const finalWeight = (reqTargetWeight !== undefined && reqTargetWeight !== null && reqTargetWeight !== '') ? parseFloat(reqTargetWeight) : null;
      const finalVo2 = (reqTargetVo2max !== undefined && reqTargetVo2max !== null && reqTargetVo2max !== '') ? parseFloat(reqTargetVo2max) : null;
      const hasRealGoal = Boolean(cleanEventName.length > 0 || (finalWeight && finalWeight > 0) || (finalVo2 && finalVo2 > 0));

      if (hasRealGoal) {
        const finalName = cleanEventName || (finalGoalType === 'physiological' ? 'Physiological Goal' : 'Target Goal');
        const finalDate = eventDate || '';
        const finalCtl = targetCtl ? parseFloat(targetCtl) : 70;
        const finalMode = reqTargetMode || (finalGoalType === 'physiological' ? 'weight' : 'finish');
        const finalValue = reqTargetValue || '';

        db.run(
          `DELETE FROM milestones WHERE user_id = ? AND is_main = 1`,
          [req.user.id],
          () => {
            db.run(
              `INSERT INTO milestones (user_id, name, date, target_ctl, is_main, goal_type, target_mode, target_value, target_weight, target_vo2max) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
              [req.user.id, finalName, finalDate, finalCtl, finalGoalType, finalMode, finalValue, finalWeight, finalVo2],
            );
          }
        );
      } else {
        db.run(`DELETE FROM milestones WHERE user_id = ? AND is_main = 1`, [req.user.id]);
      }
    }

    let finalTone = reqTone;
    let finalName = reqName;
    let finalContext = reqContext;

    // Check premium/admin status
    const isPremium = row.subscription_tier === 'admin' || row.subscription_tier === 'premium' || row.subscription_tier === 'rooka_plus';

    if (!isPremium && finalTone === 'custom') {
      // Revert to defaults if non-premium tries to set custom coach
      finalTone = "Empathetic but demanding elite endurance coach.";
      finalName = "Rooka";
      finalContext = "";
    }

    db.run(
      `UPDATE users SET coach_tone = ?, coach_name = ?, coach_context = ?, athlete_context = ?, gender = ?, last_cycle_start = ?, training_availability = ? WHERE id = ?`,
      [
        finalTone,
        finalName || "Spark",
        finalContext || "",
        athleteContext,
        gender || "Prefer not to say",
        lastCycleStart || null,
        availabilityStr,
        req.user.id,
      ],
      function (err) {
        if (err)
          return res
            .status(500)
            .json({ error: "Failed to update coach settings." });
        res.json({ message: "Coach updated successfully!" });
      },
    );
  });
});

router.post("/api/user/settings/language", authenticateToken, (req, res) => {
  const { language } = req.body;
  if (!language) return res.status(400).json({ error: "Language required" });
  db.run(
    `UPDATE users SET language = ? WHERE id = ?`,
    [language, req.user.id],
    function (err) {
      if (err) return res.status(500).json({ error: "Failed to update language setting." });
      res.json({ success: true, language });
    }
  );
});

router.post('/api/track-spark-plus-click', authenticateToken, (req, res) => {
    db.run(
        `UPDATE users SET spark_plus_clicks = COALESCE(spark_plus_clicks, 0) + 1 WHERE id = ?`,
        [req.user.id],
        function(err) {
            if (err) return res.status(500).json({ error: 'Database error' });
            res.json({ success: true });
        }
    );
});

router.post('/api/request-account-data', authenticateToken, (req, res) => {
    db.run(
        `UPDATE users SET data_request_clicks = COALESCE(data_request_clicks, 0) + 1 WHERE id = ?`,
        [req.user.id],
        function(err) {
            if (err) return res.status(500).json({ error: 'Database error' });
            res.json({ success: true, message: 'Account data request recorded.' });
        }
    );
});

router.delete('/api/user/account', authenticateToken, (req, res) => {
    const userId = req.user.id;
    if (!userId) return res.status(400).json({ error: "Missing user ID" });

    db.get(`SELECT username FROM users WHERE id = ?`, [userId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: "User not found" });

        const username = user.username || "";
        if (username.toLowerCase().includes("rutger") || username.toLowerCase().includes("felixson")) {
            return res.status(403).json({ error: "Admin accounts cannot be deleted directly." });
        }

        const tablesWithUserId = [
            "activities", "micro_plan", "weight_log", "chat_history", 
            "athlete_metrics", "user_daily_metrics", "user_quests", 
            "completed_quests", "user_xp", "nutrition_protocols", 
            "nutrition_intake", "daily_diet_logs", "biometrics",
            "physique_logs", "milestones", "kudos", "public_profile_cache", 
            "completed_micro_steps", "push_subscriptions", "garmin_health_data", 
            "user_titles", "athlete_niggles", "bonus_points", "recurring_trainings",
            "benchmark_tests", "athlete_zones"
        ];

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            
            tablesWithUserId.forEach(table => {
                db.run(`DELETE FROM ${table} WHERE user_id = ?`, [userId], function(err) {
                    if (err && !err.message.includes("no such table")) {
                        console.error(`Error deleting from ${table}:`, err.message);
                    }
                });
            });

            db.run(`DELETE FROM connections WHERE user_id = ? OR friend_id = ?`, [userId, userId], function(err) {
                if (err) console.error("Error deleting connections:", err.message);
            });

            db.run(`DELETE FROM users WHERE id = ?`, [userId], function (err) {
                if (err) {
                    console.error("Error deleting user:", err.message);
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: "Failed to delete account" });
                }
                db.run("COMMIT", function(err) {
                    if (err) return res.status(500).json({ error: "Failed to commit deletion" });
                    res.json({ success: true, message: "Account deleted successfully." });
                });
            });
        });
    });
});

// Sync RevenueCat subscription entitlement status with the backend database
router.post("/api/user/sync-subscription", authenticateToken, (req, res) => {
  const { hasActiveEntitlement, entitlementId } = req.body;
  const userId = req.user.id;

  if (hasActiveEntitlement && (entitlementId === "rooka" || !entitlementId)) {
    db.run(
      `UPDATE users SET subscription_tier = 'rooka_plus', daily_token_limit = 50000 WHERE id = ? AND subscription_tier != 'admin'`,
      [userId],
      function (err) {
        if (err) {
          console.error("Error syncing subscription to rooka_plus:", err);
          return res.status(500).json({ error: "DB_ERROR" });
        }
        console.log(`[Subscription Sync] User ${userId} successfully synced to rooka_plus.`);
        return res.json({ success: true, tier: "rooka_plus" });
      }
    );
  } else {
    db.get(
      `SELECT subscription_tier FROM users WHERE id = ?`,
      [userId],
      (err, row) => {
        if (err || !row) return res.status(500).json({ error: "DB_ERROR" });
        const tier = row.subscription_tier || "free";
        if (tier === "free") {
          db.run(
            `UPDATE user_quests SET status = 'closed' WHERE user_id = ? AND status = 'active'`,
            [userId]
          );
        }
        return res.json({ success: true, tier });
      }
    );
  }
});

// Recurring Trainings (Non-Rooka Activities) Endpoints
router.get("/api/user/recurring-trainings", authenticateToken, (req, res) => {
  db.all(
    `SELECT * FROM recurring_trainings 
     WHERE user_id = ? 
     ORDER BY CASE day_of_week 
       WHEN 'Mon' THEN 1 
       WHEN 'Tue' THEN 2 
       WHEN 'Wed' THEN 3 
       WHEN 'Thu' THEN 4 
       WHEN 'Fri' THEN 5 
       WHEN 'Sat' THEN 6 
       WHEN 'Sun' THEN 7 
       ELSE 8 
     END, start_time ASC`,
    [req.user.id],
    (err, rows) => {
      if (err) {
        console.error("Error fetching recurring trainings:", err);
        return res.status(500).json({ error: "DB_ERROR" });
      }
      res.json(rows || []);
    }
  );
});

router.post("/api/user/recurring-trainings", authenticateToken, (req, res) => {
  const { id, title, day_of_week, dayOfWeek, start_time, startTime, duration_minutes, durationMinutes, sport, intensity, is_active, isActive } = req.body;

  const finalTitle = (title || "").trim();
  const finalDay = day_of_week || dayOfWeek || "Mon";
  const finalStartTime = start_time !== undefined ? start_time : (startTime !== undefined ? startTime : "");
  const finalDuration = duration_minutes !== undefined ? parseInt(duration_minutes, 10) : (durationMinutes !== undefined ? parseInt(durationMinutes, 10) : 60);
  const finalSport = (sport || "Other").trim();
  const finalIntensity = (intensity || "moderate").trim();
  const finalIsActive = is_active !== undefined ? (is_active ? 1 : 0) : (isActive !== undefined ? (isActive ? 1 : 0) : 1);

  if (!finalTitle) {
    return res.status(400).json({ error: "Title is required" });
  }

  if (id) {
    db.run(
      `UPDATE recurring_trainings 
       SET title = ?, day_of_week = ?, start_time = ?, duration_minutes = ?, sport = ?, intensity = ?, is_active = ? 
       WHERE id = ? AND user_id = ?`,
      [finalTitle, finalDay, finalStartTime, finalDuration, finalSport, finalIntensity, finalIsActive, id, req.user.id],
      function (err) {
        if (err) {
          console.error("Error updating recurring training:", err);
          return res.status(500).json({ error: "DB_ERROR" });
        }
        res.json({ success: true, id, message: "Recurring training updated" });
      }
    );
  } else {
    db.run(
      `INSERT INTO recurring_trainings (user_id, title, day_of_week, start_time, duration_minutes, sport, intensity, is_active) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, finalTitle, finalDay, finalStartTime, finalDuration, finalSport, finalIntensity, finalIsActive],
      function (err) {
        if (err) {
          console.error("Error creating recurring training:", err);
          return res.status(500).json({ error: "DB_ERROR" });
        }
        res.json({ success: true, id: this.lastID, message: "Recurring training created" });
      }
    );
  }
});

router.delete("/api/user/recurring-trainings/:id", authenticateToken, (req, res) => {
  db.run(
    `DELETE FROM recurring_trainings WHERE id = ? AND user_id = ?`,
    [req.params.id, req.user.id],
    function (err) {
      if (err) {
        console.error("Error deleting recurring training:", err);
        return res.status(500).json({ error: "DB_ERROR" });
      }
      res.json({ success: true, message: "Recurring training deleted" });
    }
  );
});

module.exports = router;
