const express = require('express');
const router = express.Router();
const db = require('../services/db');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { authenticateToken } = require('../services/auth');
const { sseClients, sendSSEEvent } = require('../services/sse');
const { generateWithFallback, generateImage } = require('../services/ai');
const { encrypt, decrypt } = require('../services/crypto');
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
  mapStravaSportToRooka,
  formatStepsForStrava,
  tagStravaActivity,
  getStravaActivity,
  syncAllStravaUsersOnStartup,
  triggerBackgroundSummary,
  updateUserRookaAndCheckLevel,
  checkAndAwardRookaTitles,
  enforceMaxUserTitles,
  triggerLevelUpCoachPrompt,
  evaluateAndProgressQuests,
  calculateQuestProgress,
  generateQuestForUser,
  isQuestMet,
  completeQuest,
  canAccessQuests
} = require('../services/utils');

function getTimeRemainingStr(expiresAt) {
  if (!expiresAt) return null;
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (diffMs <= 0) return "Expired";
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (days > 0) return `${days}d ${remainingHours}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

router.get("/api/milestones", authenticateToken, (req, res) => {
  db.all(
    `SELECT * FROM milestones WHERE user_id = ? ORDER BY date ASC`,
    [req.user.id],
    (err, rows) => {
      res.json(rows || []);
    },
  );
});

router.post("/api/milestones", authenticateToken, (req, res) => {
  const { milestones } = req.body;

  if (!Array.isArray(milestones)) {
    return res.status(400).json({ error: "milestones must be an array" });
  }

  db.serialize(() => {
    db.run(`DELETE FROM milestones WHERE user_id = ?`, [req.user.id]);

    const stmt = db.prepare(
      `INSERT INTO milestones (user_id, name, date, target_ctl, is_main, goal_type, target_mode, target_value, target_weight, target_vo2max) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    milestones.forEach((m) => {
      const goalName = m.name || m.eventName || '';
      const goalDate = m.date || m.eventDate || '';
      const targetCtl = m.target_ctl || m.targetCtl || 70;
      const isMain = (m.is_main || m.isARace) ? 1 : 0;
      const goalType = m.goal_type || m.goalType || 'race';
      const targetMode = m.target_mode || m.targetMode || 'finish';
      const targetValue = m.target_value || m.targetValue || '';
      const targetWeight = (m.target_weight || m.targetWeight) ? parseFloat(m.target_weight || m.targetWeight) : null;
      const targetVo2max = (m.target_vo2max || m.targetVo2max) ? parseFloat(m.target_vo2max || m.targetVo2max) : null;

      stmt.run(
        req.user.id,
        goalName,
        goalDate,
        targetCtl,
        isMain,
        goalType,
        targetMode,
        targetValue,
        targetWeight,
        targetVo2max,
      );
    });
    stmt.finalize();

    res.json({ success: true, message: "Goals and calendar updated!" });
  });
});

router.post("/api/milestones/:id/artwork", authenticateToken, async (req, res) => {
  const milestoneId = req.params.id;
  db.get(
    `SELECT * FROM milestones WHERE id = ? AND user_id = ?`,
    [milestoneId, req.user.id],
    async (err, milestone) => {
      if (err || !milestone) {
        return res.status(404).json({ error: "Milestone not found." });
      }

      try {
        const prompt = `Epic, inspiring, high-quality athletic event poster artwork for an endurance race milestone: "${milestone.name}". Target date: ${milestone.date}. Dramatic cinematic lighting, sleek modern graphic design badge, vibrant neon and metallic accents, athlete silhouette in motion, award-winning concept art, 8k resolution, motivational sports aesthetic`;

        const { base64Data, mimeType } = await generateImage(prompt, { aspectRatio: "1:1" });
        const ext = mimeType.includes("png") ? "png" : "jpg";
        const fileName = `milestone_${req.user.id}_${milestoneId}_${Date.now()}.${ext}`;
        const dir = path.join(__dirname, "../public/uploads/milestones");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, fileName);
        fs.writeFileSync(filePath, base64Data, "base64");

        const artworkUrl = `/uploads/milestones/${fileName}`;
        db.run(
          `UPDATE milestones SET artwork_url = ? WHERE id = ? AND user_id = ?`,
          [artworkUrl, milestoneId, req.user.id],
          (updateErr) => {
            if (updateErr) {
              console.error("DB update error for milestone artwork:", updateErr);
            }
            res.json({ success: true, artworkUrl });
          }
        );
      } catch (genErr) {
        console.error("Failed to generate milestone artwork:", genErr);
        res.status(500).json({ error: "Failed to generate milestone artwork: " + genErr.message });
      }
    }
  );
});

router.get("/api/gamification", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const responseData = { quests: [], titles: [], bonus_points: [] };

  try {
    if (!canAccessQuests(req.user.subscription_tier)) {
      // Free users cannot access quests: close any active quests and return empty array
      await new Promise((resolve) => {
        db.run(
          `UPDATE user_quests SET status = 'closed' WHERE user_id = ? AND status = 'active'`,
          [userId],
          () => resolve(),
        );
      });
      await checkAndAwardRookaTitles(userId);
      responseData.quests = [];
    } else {
      const rawQuests = await evaluateAndProgressQuests(userId);
      await checkAndAwardRookaTitles(userId);

      const processedQuests = await Promise.all(
        (rawQuests || []).map(async (q) => {
          const qObj = { ...q };
          const currentVal = qObj.current_value !== undefined ? qObj.current_value : (qObj.progress || 0);
          const targetVal = qObj.target_value || 1;

          // Extra safety check: if an active quest met its target, ensure it is completed and awarded
          if (qObj.status === "active" && isQuestMet(currentVal, targetVal)) {
            await completeQuest(userId, qObj);
          }

          qObj.current_value = currentVal;
          qObj.progress = currentVal;
          qObj.progress_percent = Math.min(100, Math.round((currentVal / targetVal) * 100));
          qObj.time_remaining_str = qObj.status === "active" ? getTimeRemainingStr(qObj.expires_at) : null;

          // Unit string
          if (qObj.target_metric === "distance_km") qObj.unit = "km";
          else if (qObj.target_metric === "moving_time_min") qObj.unit = "min";
          else if (qObj.target_metric === "rooka_score") qObj.unit = "pts";
          else qObj.unit = "";

          return qObj;
        })
      );

      // If an active quest was completed above and no active quest remains, generate replacement
      const hasActive = processedQuests.some((q) => q.status === "active");
      if (!hasActive) {
        try {
          const refreshed = await evaluateAndProgressQuests(userId);
          const newActive = refreshed.find((q) => q.status === "active");
          if (newActive) {
            newActive.current_value = 0;
            newActive.progress = 0;
            newActive.progress_percent = 0;
            newActive.time_remaining_str = getTimeRemainingStr(newActive.expires_at);
            if (newActive.target_metric === "distance_km") newActive.unit = "km";
            else if (newActive.target_metric === "moving_time_min") newActive.unit = "min";
            else if (newActive.target_metric === "rooka_score") newActive.unit = "pts";
            else newActive.unit = "";
            processedQuests.unshift(newActive);
          }
        } catch (genErr) {
          console.error("Error refreshing active quest in /api/gamification:", genErr);
        }
      }

      responseData.quests = processedQuests;
    }
  } catch (e) {
    console.error("Error evaluating gamification in /api/gamification:", e);
  }

  try {
    const userRow = await new Promise((resolve) => {
      db.get(`SELECT subscription_tier FROM users WHERE id = ?`, [userId], (err, row) => resolve(row));
    });

    const tier = userRow?.subscription_tier;
    const isPaid = tier === 'admin' || tier === 'premium' || tier === 'rooka_plus' || tier === 'subscription';

    if (!isPaid) {
      responseData.titles = [];
      const points = await new Promise((resolve) => {
        db.all(
          `SELECT * FROM bonus_points WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
          [userId],
          (err, rows) => resolve(rows || [])
        );
      });
      responseData.bonus_points = points;
      return res.json(responseData);
    }

    // Evaluate any newly completed milestones or races (e.g. Half Ironman)
    try {
      await checkAndAwardRookaTitles(userId);
      await enforceMaxUserTitles(userId, 5);
    } catch (eTitle) {
      console.error("Error evaluating titles on get gamification:", eTitle);
    }

    const titles = await new Promise((resolve) => {
      db.all(
        `SELECT * FROM user_titles WHERE user_id = ? ORDER BY is_active DESC, created_at DESC`,
        [userId],
        (err, rows) => resolve(rows || [])
      );
    });

    if (titles.length > 0) {
      responseData.titles = titles.map((t) => ({
        ...t,
        title: t.title || t.title_name,
        title_name: t.title || t.title_name,
        is_equipped: t.is_active === 1 ? 1 : 0,
        is_active: t.is_active === 1 ? 1 : 0,
      }));
    } else {
      const defaultTitle = {
        id: 'default_rooka_plus',
        user_id: userId,
        title: 'Rooka+ Athlete',
        title_name: 'Rooka+ Athlete',
        description: 'Official member of the Rooka+ endurance squad.',
        is_active: 1,
        is_equipped: 1,
        milestone_key: 'default_rooka_plus',
      };
      responseData.titles = [defaultTitle];
      db.run(
        `INSERT OR IGNORE INTO user_titles (user_id, title, description, is_active, milestone_key) VALUES (?, ?, ?, 1, 'default_rooka_plus')`,
        [userId, defaultTitle.title, defaultTitle.description]
      );
    }

    const points = await new Promise((resolve) => {
      db.all(
        `SELECT * FROM bonus_points WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
        [userId],
        (err, rows) => resolve(rows || [])
      );
    });
    responseData.bonus_points = points;

    return res.json(responseData);
  } catch (errDb) {
    console.error("Error finalizing gamification response:", errDb);
    return res.json(responseData);
  }
});

router.post(
  "/api/gamification/generate_quest",
  authenticateToken,
  async (req, res) => {
    const userId = req.user.id;
    if (!canAccessQuests(req.user.subscription_tier)) {
      return res.status(403).json({ error: "Quests require a paid subscription." });
    }

    db.get(
      `SELECT count(*) as count FROM user_quests WHERE user_id = ? AND status = 'active'`,
      [userId],
      async (err, row) => {
        if (err) return res.status(500).json({ error: "Database error" });
        if (row && row.count > 0) {
          return res.status(400).json({ error: "You already have an active quest." });
        }
        
        try {
          const questData = await generateQuestForUser(userId, "common");
          if (questData) {
            questData.current_value = 0;
            questData.progress = 0;
            questData.progress_percent = 0;
          }
          res.json({ success: true, quest: questData });
        } catch (e) {
          console.error("Failed to generate quest:", e);
          res.status(500).json({ error: "Failed to generate quest" });
        }
      }
    );
  },
);

router.post(
  "/api/gamification/refresh_quest",
  authenticateToken,
  async (req, res) => {
    const userId = req.user.id;
    if (!canAccessQuests(req.user.subscription_tier)) {
      return res.status(403).json({ error: "Quests require a paid subscription." });
    }
    const { quest_id } = req.body;

    const findQuestQuery = quest_id
      ? `SELECT * FROM user_quests WHERE user_id = ? AND status = 'active' AND id = ? LIMIT 1`
      : `SELECT * FROM user_quests WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`;
    const queryParams = quest_id ? [userId, quest_id] : [userId];

    db.get(findQuestQuery, queryParams, async (err, quest) => {
      if ((err || !quest) && quest_id) {
        // Fallback: search for any active quest for this user if target quest_id was not found
        return db.get(
          `SELECT * FROM user_quests WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
          [userId],
          async (err2, fallbackQuest) => {
            if (err2 || !fallbackQuest) {
              // No active quest to void; generate a new quest directly
              try {
                const newQuest = await generateQuestForUser(userId, "common");
                if (newQuest) {
                  newQuest.current_value = 0;
                  newQuest.progress = 0;
                  newQuest.progress_percent = 0;
                }
                return res.json({ success: true, quest: newQuest });
              } catch (e) {
                return res.status(500).json({ error: "Failed to generate replacement quest" });
              }
            }
            return doSwap(fallbackQuest);
          }
        );
      }

      if (!quest) {
        // No active quest found; generate a new quest directly
        try {
          const newQuest = await generateQuestForUser(userId, "common");
          if (newQuest) {
            newQuest.current_value = 0;
            newQuest.progress = 0;
            newQuest.progress_percent = 0;
          }
          return res.json({ success: true, quest: newQuest });
        } catch (e) {
          return res.status(500).json({ error: "Failed to generate replacement quest" });
        }
      }

      doSwap(quest);

      async function doSwap(targetQuest) {
        try {
          db.run(`UPDATE user_quests SET status = 'void' WHERE id = ?`, [targetQuest.id]);
          const newQuest = await generateQuestForUser(userId, "common", targetQuest);
          if (!newQuest) {
            return res.status(500).json({ error: "Failed to generate replacement quest" });
          }
          newQuest.current_value = 0;
          newQuest.progress = 0;
          newQuest.progress_percent = 0;
          res.json({ success: true, quest: newQuest });
        } catch (e) {
          console.error("Failed to refresh quest:", e);
          res.status(500).json({ error: "Failed to generate replacement quest" });
        }
      }
    });
  },
);

router.post("/api/gamification/evaluate_quests", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  if (!canAccessQuests(req.user.subscription_tier)) {
    return res.json({
      success: true,
      message: "Quests require a paid subscription.",
      quests: [],
    });
  }

  try {
    const allQuests = await evaluateAndProgressQuests(userId);
    const completed = allQuests.filter((q) => q.status === "completed");
    if (completed.length > 0) {
      res.json({
        success: true,
        message: `Evaluated and completed ${completed.length} quests!`,
      });
    } else {
      res.json({
        success: true,
        message: "Evaluated your active quests, but no new targets were reached yet.",
      });
    }
  } catch (e) {
    res.status(500).json({ error: "Failed to evaluate quests." });
  }
});



router.post(
  "/api/gamification/generate_title",
  authenticateToken,
  async (req, res) => {
    const userId = req.user.id;

    db.all(
      `SELECT name, sport_type, distance_km, moving_time_min, rooka_score, start_date FROM activities WHERE user_id = ? ORDER BY start_date DESC LIMIT 10`,
      [userId],
      async (err, recentActivities) => {
        const activitiesStr =
          recentActivities && recentActivities.length > 0
            ? recentActivities
                .map(
                  (a) =>
                    `- ${a.start_date}: ${a.name} (${a.sport_type}) | ${parseFloat(a.distance_km).toFixed(1)}km | ${Math.round(a.moving_time_min)}min`,
                )
                .join("\n")
            : "No recent activities logged.";

        const prompt = `Based on the following recent activities, invent a cool, heroic, or funny custom 'Title' or 'Badge' to award the user. 
        For example: "Titan of the Tarmac", "The Weekend Warrior", "Aquaman Protocol".
        Recent activities:
        ${activitiesStr}
        
        Please respond using this JSON schema:
        {
          "title": "The Title Name",
          "description": "A short, funny, or epic description of why they earned it."
        }`;

        try {
          const aiReply = await generateWithFallback(
            prompt,
            "You are a sports gamification engine.",
            null,
            null,
            userId,
            "common",
            true
          );
          const titleData = JSON.parse(aiReply);

          // Check if user currently has an active title
          db.get(
            `SELECT COUNT(*) as active_count FROM user_titles WHERE user_id = ? AND is_active = 1`,
            [userId],
            (errCount, countRow) => {
              const shouldBeActive = !errCount && countRow && countRow.active_count === 0 ? 1 : 0;

              db.run(
                `INSERT INTO user_titles (user_id, title, description, is_active) VALUES (?, ?, ?, ?)`,
                [userId, titleData.title, titleData.description, shouldBeActive],
                async function (errInsert) {
                  if (errInsert) {
                    return res.status(500).json({ error: "Failed to save title" });
                  }
                  const newTitleId = this.lastID;

                  // Enforce maximum 5 titles: delete oldest unequipped titles if > 5
                  await enforceMaxUserTitles(userId, 5);

                  // Also award 50 bonus points for a new title (only if not already awarded)
                  db.get(
                    `SELECT id FROM bonus_points WHERE user_id = ? AND reason = ? LIMIT 1`,
                    [userId, `Earned Title: ${titleData.title}`],
                    (errBP, existingBP) => {
                      if (!existingBP) {
                        db.run(
                          `INSERT INTO bonus_points (user_id, amount, reason) VALUES (?, ?, ?)`,
                          [userId, 50, `Earned Title: ${titleData.title}`],
                        );
                      }
                    }
                  );

                  // Clear public profile cache so changes reflect on social profile
                  db.run(`DELETE FROM public_profile_cache WHERE user_id = ?`, [userId]);

                  res.json({ success: true, title: { id: newTitleId, ...titleData, is_active: shouldBeActive } });
                }
              );
            }
          );
        } catch (e) {
          console.error("Failed to generate title:", e);
          res.status(500).json({ error: "Failed to generate title" });
        }
      },
    );
  },
);

// Equip / Unequip a title
router.post(
  "/api/titles/:id/equip",
  authenticateToken,
  (req, res) => {
    const userId = req.user.id;
    const titleId = req.params.id;

    db.get(
      `SELECT id, is_active FROM user_titles WHERE (id = ? OR milestone_key = ?) AND user_id = ?`,
      [titleId, titleId, userId],
      (err, titleRow) => {
        if (err || !titleRow) {
          return res.status(404).json({ error: "Title not found" });
        }

        const realId = titleRow.id;
        const currentlyActive = titleRow.is_active === 1;

        // Reset all titles for this user to inactive first
        db.run(
          `UPDATE user_titles SET is_active = 0 WHERE user_id = ?`,
          [userId],
          (errReset) => {
            if (errReset) {
              return res.status(500).json({ error: "Failed to update title status" });
            }

            // If it wasn't active before, set it to active now (toggle behavior)
            if (!currentlyActive) {
              db.run(
                `UPDATE user_titles SET is_active = 1 WHERE id = ? AND user_id = ?`,
                [realId, userId],
                (errEquip) => {
                  db.run(`DELETE FROM public_profile_cache WHERE user_id = ?`, [userId]);
                  res.json({ success: true, equipped: true, activeTitleId: realId });
                }
              );
            } else {
              db.run(`DELETE FROM public_profile_cache WHERE user_id = ?`, [userId]);
              res.json({ success: true, equipped: false, activeTitleId: null });
            }
          }
        );
      }
    );
  }
);

// Delete a title
router.delete(
  "/api/titles/:id",
  authenticateToken,
  (req, res) => {
    const userId = req.user.id;
    const titleId = req.params.id;

    db.run(
      `DELETE FROM user_titles WHERE id = ? AND user_id = ?`,
      [titleId, userId],
      function (err) {
        if (err) {
          return res.status(500).json({ error: "Failed to delete title" });
        }
        db.run(`DELETE FROM public_profile_cache WHERE user_id = ?`, [userId]);
        res.json({ success: true, deletedId: titleId });
      }
    );
  }
);


module.exports = router;
