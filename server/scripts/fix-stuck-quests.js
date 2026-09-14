#!/usr/bin/env node
/**
 * fix-stuck-quests.js
 *
 * Inspects active quests for athletes, checks if any active quest meets or exceeds its target
 * (accounting for floating point, GPS precision, and UI rounding), marks them completed,
 * awards the reward points in bonus_points, updates total_rooka, and generates a fresh replacement quest.
 *
 * Usage:
 *   node server/scripts/fix-stuck-quests.js
 *   node server/scripts/fix-stuck-quests.js --user "Rutger"
 *   node server/scripts/fix-stuck-quests.js --user "rutgervandenberg@live.nl"
 *   node server/scripts/fix-stuck-quests.js --dry-run
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
const db = require("../services/db");
const {
  evaluateAndProgressQuests,
  calculateQuestProgress,
  isQuestMet,
  completeQuest,
  generateQuestForUser,
  updateUserRookaAndCheckLevel,
  getRookaLevelInfo,
} = require("../services/utils");

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const userIdx = args.findIndex((a) => a === "--user");
const targetUserQuery = userIdx !== -1 && args[userIdx + 1] ? args[userIdx + 1].trim() : null;

function all(sql, params = []) {
  return new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
  );
}

function get(sql, params = []) {
  return new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))
  );
}

async function runRepair() {
  console.log("==================================================");
  console.log("🏅 ROOKA QUEST REPAIR & EVALUATION TOOL");
  console.log(`Mode: ${isDryRun ? "DRY RUN (no database changes)" : "LIVE REPAIR"}`);
  if (targetUserQuery) {
    console.log(`Filter: Targeting user matching "${targetUserQuery}"`);
  }
  console.log("==================================================\n");

  let users = [];
  if (targetUserQuery) {
    users = await all(
      `SELECT id, username, email, total_rooka, subscription_tier 
       FROM users 
       WHERE (LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)) 
         AND deleted_at IS NULL`,
      [targetUserQuery, targetUserQuery]
    );
    if (users.length === 0) {
      users = await all(
        `SELECT id, username, email, total_rooka, subscription_tier 
         FROM users 
         WHERE (LOWER(username) LIKE LOWER(?) OR LOWER(email) LIKE LOWER(?)) 
           AND deleted_at IS NULL`,
        [`%${targetUserQuery}%`, `%${targetUserQuery}%`]
      );
    }
  } else {
    users = await all(
      `SELECT id, username, email, total_rooka, subscription_tier 
       FROM users 
       WHERE deleted_at IS NULL 
       ORDER BY id ASC`
    );
  }

  if (users.length === 0) {
    console.log("❌ No matching athletes found.");
    process.exit(0);
  }

  console.log(`Found ${users.length} athlete(s) to inspect.\n`);

  let totalRepaired = 0;

  for (const user of users) {
    const activeQuests = await all(
      `SELECT * FROM user_quests WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC`,
      [user.id]
    );

    if (activeQuests.length === 0) {
      continue;
    }

    console.log(`\n--------------------------------------------------`);
    console.log(`Athlete: "${user.username}" (ID: ${user.id})`);
    console.log(`Active Quests Found: ${activeQuests.length}`);

    for (const quest of activeQuests) {
      const currentVal = await calculateQuestProgress(user.id, quest);
      const targetVal = quest.target_value || 1;
      const met = isQuestMet(currentVal, targetVal);

      console.log(` - Quest ID: ${quest.id}`);
      console.log(`   Description: "${quest.description}"`);
      console.log(`   Metric: ${quest.target_metric} | Sport: ${quest.target_sport || "Any"}`);
      console.log(`   Progress: ${currentVal} / ${targetVal} (${Math.round((currentVal / targetVal) * 100)}%)`);
      console.log(`   Target Met? -> ${met ? "YES ✅ (Ready for completion)" : "NO (In Progress)"}`);

      if (met) {
        totalRepaired++;
        if (isDryRun) {
          console.log(`   [DRY RUN] Would mark quest #${quest.id} as completed, award +${quest.reward_points} bonus points, and generate a new quest.`);
        } else {
          console.log(`   🚀 Completing quest #${quest.id} and awarding +${quest.reward_points} rooka...`);
          await completeQuest(user.id, quest);

          // Check if new active quest exists or generate one
          const remainingActive = await all(
            `SELECT id FROM user_quests WHERE user_id = ? AND status = 'active'`,
            [user.id]
          );

          if (remainingActive.length === 0) {
            console.log(`   ✨ Generating fresh replacement quest...`);
            try {
              const newQ = await generateQuestForUser(user.id, "common");
              if (newQ) {
                console.log(`   ✅ New Quest Generated: "${newQ.description}" (Target: ${newQ.target_value} ${newQ.target_metric}, Reward: +${newQ.reward_points})`);
              }
            } catch (errGen) {
              console.error(`   ⚠️ Failed to generate new quest via AI:`, errGen.message);
            }
          }

          // Re-calculate user total rooka
          updateUserRookaAndCheckLevel(user.id);

          const updatedUser = await get(`SELECT total_rooka FROM users WHERE id = ?`, [user.id]);
          const levelInfo = getRookaLevelInfo(updatedUser?.total_rooka || 0);
          console.log(`   🎉 Updated Total Rooka: ${updatedUser?.total_rooka} pts (Level ${levelInfo.level} - ${levelInfo.title})`);
        }
      }
    }
  }

  console.log("\n==================================================");
  console.log(`Summary: ${totalRepaired} quest(s) ${isDryRun ? "identified for completion" : "successfully completed and renewed"}!`);
  console.log("==================================================\n");
  process.exit(0);
}

runRepair().catch((err) => {
  console.error("Fatal error during quest repair:", err);
  process.exit(1);
});
