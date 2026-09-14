const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../services/db");
const {
  FEATURES_REGISTRY,
  hasAccess,
  evaluateUserFeatureUsage,
  getNextUnusedFeatureForUser,
  runWeeklyFeatureOnboardingJob
} = require("../services/onboarding");

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const shouldTrigger = args.includes("--trigger") || args.includes("-t");
  const targetUserArg = args.find((a, i) => (args[i - 1] === "--user" || args[i - 1] === "-u"));

  console.log("==================================================");
  console.log("     Rooka Feature Checklist & Onboarding Status  ");
  console.log("==================================================");

  let userFilter = "WHERE u.deleted_at IS NULL";
  let userParams = [];
  if (targetUserArg) {
    if (!isNaN(parseInt(targetUserArg, 10))) {
      userFilter += " AND u.id = ?";
      userParams.push(parseInt(targetUserArg, 10));
    } else {
      userFilter += " AND LOWER(u.username) = LOWER(?)";
      userParams.push(targetUserArg);
    }
  }

  const users = await all(
    `SELECT u.id, u.username, u.subscription_tier, u.coach_tone, u.gender,
            u.garmin_username, u.garmin_oauth1_token,
            (SELECT COUNT(*) FROM push_tokens WHERE user_id = u.id AND device_type = 'ios') as is_ios
     FROM users u ${userFilter} ORDER BY u.id ASC`,
    userParams
  );

  if (users.length === 0) {
    console.log("No matching active users found.");
    process.exit(0);
  }

  console.log(`\n📋 Evaluating ${users.length} user(s) across ${FEATURES_REGISTRY.length} registered features...\n`);

  // 1. Evaluate all users to sync user_feature_onboarding
  for (const u of users) {
    await evaluateUserFeatureUsage(u.id);
  }

  // Load all onboarding records
  const onboardingRecords = await all(
    `SELECT user_id, feature_key, status, introduced_at, first_used_at FROM user_feature_onboarding`
  );
  const statusMap = new Map();
  for (const r of onboardingRecords) {
    statusMap.set(`${r.user_id}:${r.feature_key}`, r);
  }

  // 2. Detailed per-user summary
  for (const u of users) {
    console.log(`----------------------------------------------------------------------`);
    console.log(`👤 User #${u.id} - ${u.username} (Tier: ${u.subscription_tier || "free"})`);
    console.log(`   Hardware: ${u.garmin_username || u.garmin_oauth1_token ? "Garmin Connected ✓" : "No Garmin ✗"} | ${u.is_ios > 0 ? "iOS/Apple Watch ✓" : "Non-iOS ✗"}`);
    console.log(`----------------------------------------------------------------------`);

    let usedCount = 0;
    const tableData = [];

    for (const f of FEATURES_REGISTRY) {
      const record = statusMap.get(`${u.id}:${f.key}`);
      const isUsed = record && record.status === "used";
      const isIntroduced = record && record.status === "introduced";
      const userUnlocked = hasAccess(u.subscription_tier, f.minTier);
      if (isUsed) usedCount++;

      let applicable = true;
      if (typeof f.isApplicable === "function") {
        applicable = await f.isApplicable(u.id, u);
      }

      let statusBadge = "⏳ Ready to Try";
      if (!applicable) {
        statusBadge = "🚫 N/A (Hardware/Gender)";
      } else if (isUsed) {
        statusBadge = "✅ Used";
      } else if (isIntroduced) {
        statusBadge = userUnlocked ? "📣 Introduced (Direct)" : "📣 Introduced (Upgrade Teaser)";
      } else if (!userUnlocked) {
        statusBadge = `🔒 Locked (${f.minTier === 'premium' ? 'Premium' : 'Rooka+'})`;
      }

      tableData.push({
        "Feature Name": f.name,
        "Key": f.key,
        "Tier": f.minTier || "free",
        "Status": statusBadge,
        "Activity": isUsed
          ? (record.first_used_at || "Used")
          : isIntroduced
          ? (record.introduced_at || "Introduced")
          : "-"
      });
    }

    console.table(tableData);

    const nextFeature = await getNextUnusedFeatureForUser(u.id, u);
    const pct = Math.round((usedCount / FEATURES_REGISTRY.length) * 100);
    console.log(`📊 Adoption Score: ${usedCount}/${FEATURES_REGISTRY.length} features used (${pct}%)`);
    if (nextFeature) {
      const nextUnlocked = hasAccess(u.subscription_tier, nextFeature.minTier);
      console.log(`👉 Next in queue: "${nextFeature.name}" (${nextFeature.key})`);
      console.log(`   Message Type:  ${nextUnlocked ? "🚀 Direct feature action prompt" : `💎 Upgrade teaser for ${nextFeature.minTier === 'premium' ? 'Rooka Premium' : 'Rooka+'}`}`);
    } else {
      console.log(`🎉 All applicable features have been introduced or used!`);
    }
    console.log("");
  }

  // 3. Global Feature Popularity Table
  console.log("======================================================================");
  console.log("                 Overall Feature Adoption Statistics                  ");
  console.log("======================================================================");

  const globalFeatureStats = FEATURES_REGISTRY.map((f) => {
    let usedBy = 0;
    let introducedTo = 0;
    for (const u of users) {
      const record = statusMap.get(`${u.id}:${f.key}`);
      if (record && record.status === "used") usedBy++;
      else if (record && record.status === "introduced") introducedTo++;
    }
    return {
      "Feature": f.name,
      "Key": f.key,
      "Tier": f.minTier || "free",
      "Used By": `${usedBy} / ${users.length} (${Math.round((usedBy / users.length) * 100)}%)`,
      "Introduced In Chat": `${introducedTo} user(s)`
    };
  });

  console.table(globalFeatureStats);

  // 4. Optional: Trigger feature onboarding chat message right now
  if (shouldTrigger) {
    console.log("\n🚀 Triggering feature onboarding job now...");
    await runWeeklyFeatureOnboardingJob();
    console.log("\n✅ Done! Check the app chat to view the new message.");
  } else {
    console.log("\n💡 Tips:");
    console.log("   - To trigger the onboarding chat message right now for all users, run:");
    console.log("     node server/scripts/check-feature-onboarding.js --trigger");
    console.log("   - To inspect a specific user:");
    console.log("     node server/scripts/check-feature-onboarding.js --user Rutger");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Error in check-feature-onboarding:", err);
  process.exit(1);
});
