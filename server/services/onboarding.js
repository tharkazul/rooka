const db = require("./db");
const { generateWithFallback } = require("./ai");
const { sendSSEEvent } = require("./sse");

const TIER_LEVELS = {
  free: 0,
  rooka_plus: 1,
  subscription: 1,
  plus: 1,
  premium: 2,
  admin: 3,
};

function hasAccess(userTier, minTier) {
  const userLevel = TIER_LEVELS[String(userTier || "free").toLowerCase()] || 0;
  const requiredLevel = TIER_LEVELS[String(minTier || "free").toLowerCase()] || 0;
  return userLevel >= requiredLevel;
}

/**
 * Feature Registry: Complete list of trackable Rooka features.
 * Extensible array supporting tier gating and hardware prerequisites.
 */
const FEATURES_REGISTRY = [
  {
    key: "food_logging",
    name: "Food Log & Macro Intake",
    description: "Track meals and daily macro intake directly by talking to your coach in chat or logging meals.",
    minTier: "free",
    coachPrompt: "Did you know you can chat with me about what you ate today? You can just tell me your meals in chat, or log your food, and I'll calculate your daily macro intake (carbs, protein, fat) to keep your energy high for training!",
    checkUsage: (userId) => {
      return new Promise((resolve) => {
        db.get(
          `SELECT ((SELECT COUNT(*) FROM daily_diet_logs WHERE user_id = ?) + (SELECT COUNT(*) FROM nutrition_intake WHERE user_id = ?)) as cnt`,
          [userId, userId],
          (err, row) => resolve(row ? row.cnt > 0 : false)
        );
      });
    }
  },
  {
    key: "food_photo_ai",
    name: "AI Food Photo Recognition",
    description: "Snap or upload a photo of your meal directly in chat for automated AI macro analysis.",
    minTier: "free",
    coachPrompt: "Did you know you don't even have to type what you eat? Just snap or upload a photo of your plate right here in our chat! I'll scan the ingredients and calculate your macros and calories automatically.",
    checkUsage: (userId) => {
      return new Promise((resolve) => {
        db.get(
          `SELECT COUNT(*) as cnt FROM chat_history WHERE user_id = ? AND image_path IS NOT NULL`,
          [userId],
          (err, row) => resolve(row ? row.cnt > 0 : false)
        );
      });
    }
  },
  {
    key: "niggle_tracking",
    name: "Niggle & Injury Tracking",
    description: "Log muscle tightness, niggles, or minor pain so your coach can adapt your training workload.",
    minTier: "free",
    coachPrompt: "Keep your body healthy by logging any niggles or tightness you feel! Whenever you report a niggle or pain, I'll take it into consideration and adjust your upcoming workouts to keep you injury-free.",
    checkUsage: (userId) => {
      return new Promise((resolve) => {
        db.get(
          `SELECT COUNT(*) as cnt FROM athlete_niggles WHERE user_id = ?`,
          [userId],
          (err, row) => resolve(row ? row.cnt > 0 : false)
        );
      });
    }
  },
  {
    key: "daily_availability",
    name: "Daily Training Availability",
    description: "Set how many hours or which days you can train each week in settings.",
    minTier: "free",
    coachPrompt: "Make sure your training fits your busy schedule! You can set your daily availability in your settings (how many hours you can train on specific days), and I will build your weekly plan around your available time slots.",
    checkUsage: (userId) => {
      return new Promise((resolve) => {
        db.get(
          `SELECT training_availability FROM users WHERE id = ?`,
          [userId],
          (err, row) => resolve(row && row.training_availability && row.training_availability.trim() !== '' && row.training_availability !== '{}')
        );
      });
    }
  },
  {
    key: "plan_adaptation",
    name: "Plan Adaptation (Life Happens)",
    description: "Tell your coach when life gets in the way or you miss a workout, and get your plan adapted on the fly.",
    minTier: "free",
    coachPrompt: "Life happens! If you get sick, super busy, or miss a workout, just let me know in chat or request an adaptation. I'll automatically re-balance your week so you stay on target without getting burnt out.",
    checkUsage: (userId) => {
      return new Promise((resolve) => {
        db.get(
          `SELECT COUNT(*) as cnt FROM chat_history WHERE user_id = ? AND role = 'user' AND (LOWER(content) LIKE '%adapt%' OR LOWER(content) LIKE '%sick%' OR LOWER(content) LIKE '%missed%' OR LOWER(content) LIKE '%busy%')`,
          [userId],
          (err, row) => resolve(row ? row.cnt > 0 : false)
        );
      });
    }
  },
  {
    key: "auto_generate_week",
    name: "Auto-Generate Weekly Micro-Plan",
    description: "Auto-generate your workouts for the week structured around your CTL and target fitness.",
    minTier: "free",
    coachPrompt: "Want a structured plan for the week ahead? You can auto-generate your upcoming training week with one click or ask me in chat, and I'll craft specific workout sessions optimized for your fitness goals.",
    checkUsage: (userId) => {
      return new Promise((resolve) => {
        db.get(
          `SELECT COUNT(*) as cnt FROM micro_plan WHERE user_id = ?`,
          [userId],
          (err, row) => resolve(row ? row.cnt > 0 : false)
        );
      });
    }
  },
  {
    key: "structured_step_builder",
    name: "Custom Workout Step Builder",
    description: "Build custom workouts with specific warm-ups, intervals, pace/HR zone targets, and cool-downs.",
    minTier: "free",
    coachPrompt: "Want to design your own custom intervals? When adding or editing a workout, use the Workout Step Builder to set up exact warm-ups, heart rate or power intervals, reps, and recovery intervals.",
    checkUsage: (userId) => {
      return new Promise((resolve) => {
        db.get(
          `SELECT COUNT(*) as cnt FROM micro_plan WHERE user_id = ? AND steps_json IS NOT NULL AND steps_json != '[]' AND steps_json != ''`,
          [userId],
          (err, row) => resolve(row ? row.cnt > 0 : false)
        );
      });
    }
  },
  {
    key: "goal_race",
    name: "Goal Race & Target Milestones",
    description: "Enter your target race date and fitness targets to align your long-term season progression.",
    minTier: "free",
    coachPrompt: "Have an upcoming event or goal race? You can add your target race and date under Milestones. Having a target race helps us structure your periodization peak for race day!",
    checkUsage: (userId) => {
      return new Promise((resolve) => {
        db.get(
          `SELECT COUNT(*) as cnt FROM milestones WHERE user_id = ?`,
          [userId],
          (err, row) => resolve(row ? row.cnt > 0 : false)
        );
      });
    }
  },
  {
    key: "benchmark_assessment",
    name: "Benchmark Fitness Assessments",
    description: "Complete a baseline benchmark assessment (e.g. 5k Pace Test, 20-min FTP Test) to calibrate training zones.",
    minTier: "free",
    coachPrompt: "Track your true fitness gains by completing a Benchmark Assessment workout! Whether it's a 5k Pace Test, 20-minute FTP Test, or 400m Swim Test, your benchmark calibrates your personal zones so every workout hits the right intensity.",
    checkUsage: (userId) => {
      return new Promise((resolve) => {
        db.get(
          `SELECT COUNT(*) as cnt FROM benchmark_tests WHERE user_id = ? AND completed_at IS NOT NULL`,
          [userId],
          (err, row) => resolve(row ? row.cnt > 0 : false)
        );
      });
    }
  },
  {
    key: "training_zones",
    name: "Custom HR & Power Training Zones",
    description: "View and customize your Zone 1 to Zone 5 thresholds, FTP, and Max Heart Rate in your profile.",
    minTier: "free",
    coachPrompt: "Dial in your exact training intensities! Head over to your Profile tab to check your Heart Rate and Power zones. You can customize your thresholds so every workout target matches your exact physiology.",
    checkUsage: (userId) => {
      return new Promise((resolve) => {
        db.get(
          `SELECT COUNT(*) as cnt FROM athlete_zones WHERE user_id = ? AND source = 'custom'`,
          [userId],
          (err, row) => resolve(row ? row.cnt > 0 : false)
        );
      });
    }
  },
  {
    key: "activity_sync",
    name: "Garmin & Strava Activity Sync",
    description: "Connect your Garmin Connect or Strava account for automatic activity import and Rooka scoring.",
    minTier: "free",
    coachPrompt: "Did you know you can connect your Garmin or Strava account? Once connected, your runs and rides automatically sync to Rooka, giving you instant Rooka points and training stress analysis.",
    checkUsage: (userId) => {
      return new Promise((resolve) => {
        db.get(
          `SELECT ((SELECT COUNT(*) FROM strava_tokens WHERE user_id = ?) + (SELECT COUNT(*) FROM users WHERE id = ? AND garmin_username IS NOT NULL AND garmin_username != '')) as cnt`,
          [userId, userId],
          (err, row) => resolve(row ? row.cnt > 0 : false)
        );
      });
    }
  },
  {
    key: "garmin_watch_push",
    name: "Garmin Watch Calendar Push",
    description: "Sync scheduled workouts directly to your Garmin Connect Calendar so your watch guides your intervals.",
    minTier: "free",
    isApplicable: async (userId, user) => {
      return Boolean(user && (user.garmin_username || user.garmin_oauth1_token));
    },
    coachPrompt: "Take your workouts outdoors with zero guesswork! Because your Garmin is connected, you can push your scheduled workouts straight to your Garmin watch calendar so your watch guides your intervals, steps, and pace targets on the move.",
    checkUsage: (userId) => {
      return new Promise((resolve) => {
        db.get(
          `SELECT COUNT(*) as cnt FROM users WHERE id = ? AND (garmin_oauth1_token IS NOT NULL OR garmin_oauth2_token IS NOT NULL)`,
          [userId],
          (err, row) => resolve(row ? row.cnt > 0 : false)
        );
      });
    }
  },
  {
    key: "apple_watch_push",
    name: "Apple Watch WorkoutKit Push",
    description: "Push planned workouts directly into the native Workout app on your Apple Watch via WorkoutKit.",
    minTier: "free",
    isApplicable: async (userId, user) => {
      return Boolean(user && user.is_ios > 0);
    },
    coachPrompt: "Take your training straight to your wrist! You can push your planned workouts directly into the native Workout app on your Apple Watch via WorkoutKit, giving you haptic interval beeps and live target guidance.",
    checkUsage: (userId) => {
      return new Promise((resolve) => {
        db.get(
          `SELECT COUNT(*) as cnt FROM push_tokens WHERE user_id = ? AND device_type = 'ios'`,
          [userId],
          (err, row) => resolve(row ? row.cnt > 0 : false)
        );
      });
    }
  },
  {
    key: "physique_log",
    name: "Physique & Biometrics Log",
    description: "Log weight, fatigue, sleep quality, or progress photos to monitor body composition and recovery.",
    minTier: "free",
    coachPrompt: "Track how your body is transforming! You can log your weight, sleep quality, fatigue, or physique photos in the physique tab to help monitor your recovery and body composition changes.",
    checkUsage: (userId) => {
      return new Promise((resolve) => {
        db.get(
          `SELECT ((SELECT COUNT(*) FROM physique_logs WHERE user_id = ?) + (SELECT COUNT(*) FROM weight_log WHERE user_id = ?) + (SELECT COUNT(*) FROM biometrics WHERE user_id = ?)) as cnt`,
          [userId, userId, userId],
          (err, row) => resolve(row ? row.cnt > 0 : false)
        );
      });
    }
  },
  {
    key: "social_kudos",
    name: "Social Connections & Sparks",
    description: "Connect with friends on Rooka, view recent friend workouts, and send sparks to motivate each other.",
    minTier: "free",
    coachPrompt: "Training is better together! Connect with training partners on Rooka and send sparks to motivate each other on recent activities.",
    checkUsage: (userId) => {
      return new Promise((resolve) => {
        db.get(
          `SELECT ((SELECT COUNT(*) FROM connections WHERE user_id = ? OR friend_id = ?) + (SELECT COUNT(*) FROM kudos WHERE user_id = ?)) as cnt`,
          [userId, userId, userId],
          (err, row) => resolve(row ? row.cnt > 0 : false)
        );
      });
    }
  },
  {
    key: "social_comments",
    name: "Activity Comments & Social Discussions",
    description: "Comment on your friends' workouts in the Social feed to discuss pacing or celebrate achievements.",
    minTier: "free",
    coachPrompt: "Cheer on your training partners! You can leave comments on your friends' workouts in the Social feed to discuss pacing, celebrate PBs, or share route tips.",
    checkUsage: (userId) => {
      return new Promise((resolve) => {
        db.get(
          `SELECT COUNT(*) as cnt FROM activity_comments WHERE user_id = ?`,
          [userId],
          (err, row) => resolve(row ? row.cnt > 0 : false)
        );
      });
    }
  },
  {
    key: "cycle_tracking",
    name: "Cycle Tracking & Phase-Adapted Training",
    description: "Track your menstrual cycle phases so your coach adapts intensity and recovery to your physiology.",
    minTier: "free",
    isApplicable: async (userId, user) => {
      const gender = String(user.gender || "").toLowerCase();
      return gender !== "male";
    },
    coachPrompt: "Optimize your training with your natural rhythm! In the Progress tab, you can track your cycle phases so I can tailor high-intensity vs recovery sessions to match your hormonal peak performance windows.",
    checkUsage: (userId) => {
      return new Promise((resolve) => {
        db.get(
          `SELECT COUNT(*) as cnt FROM users WHERE id = ? AND last_cycle_start IS NOT NULL AND last_cycle_start != ''`,
          [userId],
          (err, row) => resolve(row ? row.cnt > 0 : false)
        );
      });
    }
  },
  {
    key: "quests_gamification",
    name: "Quests & Rooka Points",
    description: "Complete active weekly training quests, earn bonus Rooka points, and unlock unique athlete titles.",
    minTier: "rooka_plus",
    upgradePrompt: "Level up your training motivation! Upgrading to Rooka+ unlocks weekly Quests, active training challenges, and bonus Rooka points to push your fitness further.",
    coachPrompt: "Stay motivated with weekly Quests! Check your active quests to earn extra Rooka points, track your streak, and unlock special titles as you crush your training milestones.",
    checkUsage: (userId) => {
      return new Promise((resolve) => {
        db.get(
          `SELECT COUNT(*) as cnt FROM user_quests WHERE user_id = ?`,
          [userId],
          (err, row) => resolve(row ? row.cnt > 0 : false)
        );
      });
    }
  },
  {
    key: "leaderboard_access",
    name: "Community Leaderboard",
    description: "Compare your weekly training volume, elevation, and Rooka XP against friends and community.",
    minTier: "rooka_plus",
    upgradePrompt: "Curious how your training compares to other athletes? Upgrading to Rooka+ unlocks the full Community Leaderboard so you can see weekly mileage, elevation, and Rooka scores across the community.",
    coachPrompt: "Check out the weekly Community Leaderboard! See where you rank among other athletes this week in total Rooka points, mileage, and training consistency.",
    checkUsage: (userId) => {
      return new Promise((resolve) => {
        db.get(
          `SELECT COUNT(*) as cnt FROM connections WHERE user_id = ?`,
          [userId],
          (err, row) => resolve(row ? row.cnt > 0 : false)
        );
      });
    }
  },
  {
    key: "athlete_titles",
    name: "Athlete Titles & Profile Flair",
    description: "Equip unlocked achievements and athletic badges (like 'Century Crusher') on your profile.",
    minTier: "rooka_plus",
    upgradePrompt: "Earn bragging rights! Upgrading to Rooka+ allows you to unlock and equip unique athlete titles like 'Century Crusher' or 'Iron Will' on your public profile as you hit major training milestones.",
    coachPrompt: "Show off your achievements! You've unlocked titles from your training quests. Head to your Profile tab to equip your favorite title and display your athletic flair.",
    checkUsage: (userId) => {
      return new Promise((resolve) => {
        db.get(
          `SELECT COUNT(*) as cnt FROM user_titles WHERE user_id = ?`,
          [userId],
          (err, row) => resolve(row ? row.cnt > 0 : false)
        );
      });
    }
  },
  {
    key: "coach_persona",
    name: "Custom Coach Persona, Tone & Name",
    description: "Customize your coach's personality from empathetic to witty or brutal drill sergeant style.",
    minTier: "premium",
    upgradePrompt: "Want a customized coaching voice? Upgrading to Premium unlocks custom Coach Personas—allowing you to change my personality from supportive to a witty, data-driven pro or a relentless drill sergeant, and even give me a custom name.",
    coachPrompt: "Make me sound exactly how you want! As a Premium athlete, you can head into Settings to fine-tune my coaching style—from encouraging and empathetic to a witty British pro or a relentless drill sergeant—and even rename me.",
    checkUsage: (userId) => {
      return new Promise((resolve) => {
        db.get(
          `SELECT COUNT(*) as cnt FROM users WHERE id = ? AND (coach_name != 'Rooka' OR (coach_tone IS NOT NULL AND coach_tone != 'Empathetic but demanding elite endurance coach.'))`,
          [userId],
          (err, row) => resolve(row ? row.cnt > 0 : false)
        );
      });
    }
  },
  {
    key: "nutrition_protocols",
    name: "Race Fueling & Carb-Loading Protocols",
    description: "Calculate exact pre-race carb loading targets and hourly carbohydrate intake for long sessions.",
    minTier: "premium",
    upgradePrompt: "Dial in your race-day fueling! Upgrading to Premium unlocks personalized Nutrition Protocols, giving you exact pre-race carb loading targets and hourly carbohydrate fueling strategies so you never bonk.",
    coachPrompt: "Never bonk on race day! Check out your Nutrition Protocol card to view your personalized carb-loading schedule and hourly carbohydrate intake targets for long endurance efforts.",
    checkUsage: (userId) => {
      return new Promise((resolve) => {
        db.get(
          `SELECT COUNT(*) as cnt FROM nutrition_protocols WHERE user_id = ?`,
          [userId],
          (err, row) => resolve(row ? row.cnt > 0 : false)
        );
      });
    }
  }
];

/**
 * Checks all features in registry for a user. If used and unlocked by tier, updates user_feature_onboarding.
 */
async function evaluateUserFeatureUsage(userId, cachedUser = null) {
  const user = cachedUser || (await new Promise((resolve) => {
    db.get(
      `SELECT id, subscription_tier FROM users WHERE id = ?`,
      [userId],
      (err, row) => resolve(row)
    );
  }));
  if (!user) return;

  for (const feature of FEATURES_REGISTRY) {
    // A user cannot have active usage of a tier-gated feature if they are not on that tier
    if (feature.minTier && !hasAccess(user.subscription_tier, feature.minTier)) {
      continue;
    }

    const isUsed = await feature.checkUsage(userId);
    if (isUsed) {
      await new Promise((resolve) => {
        db.run(
          `INSERT INTO user_feature_onboarding (user_id, feature_key, status, first_used_at) 
           VALUES (?, ?, 'used', CURRENT_TIMESTAMP)
           ON CONFLICT(user_id, feature_key) DO UPDATE SET 
             status = 'used',
             first_used_at = COALESCE(first_used_at, CURRENT_TIMESTAMP)`,
          [userId, feature.key],
          () => resolve()
        );
      });
    }
  }
}

/**
 * Finds the next feature in registry that the user has NEVER used AND has NOT been introduced to yet.
 * Respects hardware applicability (e.g. Garmin connected, iOS device) and subscription tier status.
 */
async function getNextUnusedFeatureForUser(userId, cachedUser = null) {
  await evaluateUserFeatureUsage(userId);

  const user = cachedUser || (await new Promise((resolve) => {
    db.get(
      `SELECT u.id, u.username, u.coach_tone, u.coach_name, u.subscription_tier, u.gender,
              u.garmin_username, u.garmin_oauth1_token,
              (SELECT COUNT(*) FROM push_tokens WHERE user_id = u.id AND device_type = 'ios') as is_ios
       FROM users u WHERE u.id = ?`,
      [userId],
      (err, row) => resolve(row)
    );
  }));

  if (!user) return null;

  return new Promise((resolve) => {
    db.all(
      `SELECT feature_key, status FROM user_feature_onboarding WHERE user_id = ?`,
      [userId],
      async (err, rows) => {
        const onboardingMap = new Map();
        if (!err && rows) {
          rows.forEach((r) => onboardingMap.set(r.feature_key, r.status));
        }

        for (const feature of FEATURES_REGISTRY) {
          const status = onboardingMap.get(feature.key);
          if (status === 'used' || status === 'introduced') {
            continue;
          }

          // Check hardware or prerequisite applicability (e.g., Garmin connected, Apple Watch)
          if (typeof feature.isApplicable === "function") {
            const applicable = await feature.isApplicable(userId, user);
            if (!applicable) {
              continue;
            }
          }

          return resolve(feature);
        }
        resolve(null);
      }
    );
  });
}

/**
 * Weekly Scheduled Job:
 * Evaluates all active users and introduces 1 new feature per week per user.
 * - Upgraded users who have access are instructed how to use the feature.
 * - Users without the feature tier are introduced to the capability and reminded how upgrading unlocks it.
 */
async function runWeeklyFeatureOnboardingJob() {
  console.log("🚀 Starting weekly feature onboarding drip check...");

  const users = await new Promise((resolve, reject) => {
    db.all(
      `SELECT u.id, u.username, u.coach_tone, u.coach_name, u.subscription_tier, u.gender,
              u.garmin_username, u.garmin_oauth1_token,
              (SELECT COUNT(*) FROM push_tokens WHERE user_id = u.id AND device_type = 'ios') as is_ios
       FROM users u WHERE u.deleted_at IS NULL`,
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });

  for (const user of users) {
    try {
      const nextFeature = await getNextUnusedFeatureForUser(user.id, user);
      if (!nextFeature) {
        console.log(`[Onboarding Job] User ${user.username} (ID: ${user.id}) has no new features to introduce.`);
        continue;
      }

      const userHasAccess = hasAccess(user.subscription_tier, nextFeature.minTier);
      const isUpgradeTeaser = !userHasAccess;
      const requiredTierName = nextFeature.minTier === 'premium' ? 'Rooka Premium' : 'Rooka+';

      console.log(`[Onboarding Job] Introducing "${nextFeature.name}" (${nextFeature.key}) to ${user.username} (ID: ${user.id}) [Access: ${userHasAccess ? 'UNLOCKED' : 'UPGRADE_REQUIRED'}]`);

      let prompt;
      let guidance;

      if (isUpgradeTeaser) {
        guidance = nextFeature.upgradePrompt || nextFeature.coachPrompt;
        prompt = `You are the athlete's personal endurance coach. Write a friendly, motivating, non-pushy chat message introducing an advanced capability in Rooka that can be unlocked by upgrading to ${requiredTierName}.
Feature: ${nextFeature.name}
Core Guidance: ${guidance}
Instructions:
- The athlete is on the Free tier. DO NOT instruct them to configure or perform this feature right now, because it is locked for their tier.
- Instead, highlight why this feature is valuable for endurance training and remind them that upgrading to ${requiredTierName} unlocks it for their account.
- Keep it under 3 sentences.
- Speak directly as their coach in chat.
- Sound enthusiastic, encouraging, and natural (NOT spammy or marketing-heavy).
- DO NOT wrap in JSON.`;
      } else {
        guidance = nextFeature.coachPrompt;
        prompt = `You are the athlete's personal endurance coach. Write a natural, friendly, non-overwhelming chat message introducing a useful feature in Rooka that they haven't tried yet.
Feature: ${nextFeature.name}
Core Guidance: ${guidance}
Instructions:
- The athlete already has this feature unlocked on their account. Encourage them to try it out or configure it.
- Keep it under 3 sentences.
- Speak directly as their coach in chat.
- Sound enthusiastic, encouraging, and natural (NOT robotic or marketing-heavy).
- DO NOT wrap in JSON.`;
      }

      const systemPrompt = `You are Rooka, an elite endurance coach. Your tone is: ${user.coach_tone || "Empathetic but demanding elite endurance coach."}. Act like a real human coach in a text thread.`;

      let aiReply;
      try {
        aiReply = await generateWithFallback(prompt, systemPrompt, null, null, user.id, "common");
      } catch (aiErr) {
        console.warn(`[Onboarding Job] AI generation fallback used for feature ${nextFeature.key}:`, aiErr.message);
        aiReply = isUpgradeTeaser ? (nextFeature.upgradePrompt || nextFeature.coachPrompt) : nextFeature.coachPrompt;
      }

      // Save coach message in chat history
      await new Promise((resolve) => {
        db.run(
          `INSERT INTO chat_history (user_id, role, content, mood) VALUES (?, 'coach', ?, 'informative')`,
          [user.id, aiReply],
          (err) => {
            if (err) {
              console.error(`Failed to insert chat history for user ${user.id}:`, err);
              return resolve();
            }

            // Push notification bubble to frontend via SSE
            sendSSEEvent(user.id, "unread_message", {
              message: aiReply,
              mood: "informative"
            });

            // Mark feature as introduced in onboarding table
            db.run(
              `INSERT INTO user_feature_onboarding (user_id, feature_key, status, introduced_at) 
               VALUES (?, ?, 'introduced', CURRENT_TIMESTAMP)
               ON CONFLICT(user_id, feature_key) DO UPDATE SET 
                 status = CASE WHEN status = 'used' THEN 'used' ELSE 'introduced' END,
                 introduced_at = CURRENT_TIMESTAMP`,
              [user.id, nextFeature.key],
              () => resolve()
            );

            console.log(`✅ Successfully delivered onboarding feature "${nextFeature.key}" to user ${user.username}`);
          }
        );
      });
    } catch (e) {
      console.error(`Error processing onboarding for user ${user.id}:`, e);
    }
  }
}

module.exports = {
  FEATURES_REGISTRY,
  TIER_LEVELS,
  hasAccess,
  evaluateUserFeatureUsage,
  getNextUnusedFeatureForUser,
  runWeeklyFeatureOnboardingJob
};
