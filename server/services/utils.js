const db = require('./db');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fuzzysort = require('fuzzysort');
const { sendSSEEvent } = require('./sse');
const zoneModel = require('./zones');
const athleteZones = require('./athleteZones');
const { generateWithFallback } = require('./ai');
const { sendPushToUser } = require('./pushNotificationService');


let garminExercises = [];
try {
  garminExercises = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../garmin_exercises.json"), "utf8"),
  );
  console.log(
    `Loaded ${garminExercises.length} Garmin exercises for fuzzy matching.`,
  );
} catch (e) {
  console.error("Could not load garmin_exercises.json:", e);
}
function matchGarminExercise(name) {
  if (!name || garminExercises.length === 0) return null;
  const results = fuzzysort.go(name, garminExercises, {
    key: "exercise_name",
    limit: 1,
  });
  if (results && results.length > 0) {
    // Only return if it's a reasonably good match
    if (results[0].score > 0.4) {
      return results[0].obj;
    }
  }
  return null;
}

function getAMSDateString(date = new Date()) {
  return new Date(date).toLocaleDateString("en-CA", {
    timeZone: "Europe/Amsterdam",
  });
}

function getAMSWeekday(date = new Date()) {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "Europe/Amsterdam",
  });
}

function getUserGamificationContext(userId) {
  return new Promise((resolve) => {
    db.all(
      `SELECT start_date FROM activities WHERE user_id = ? ORDER BY start_date DESC`,
      [userId],
      (err, rows) => {
        let streak = 0;
        if (!err && rows && rows.length > 0) {
          const todayStr = getAMSDateString();
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayStr = getAMSDateString(yesterday);

          // Group by unique days
          const activityDates = [
            ...new Set(rows.map((r) => r.start_date.split("T")[0])),
          ];

          if (
            activityDates.includes(todayStr) ||
            activityDates.includes(yesterdayStr)
          ) {
            let currentDate = new Date();
            if (!activityDates.includes(todayStr)) {
              currentDate = yesterday;
            }

            while (true) {
              const checkDateStr = getAMSDateString(currentDate);
              if (activityDates.includes(checkDateStr)) {
                streak++;
                currentDate.setDate(currentDate.getDate() - 1);
              } else {
                break;
              }
            }
          }
        }

        db.get(
          `SELECT SUM(amount) as total FROM bonus_points WHERE user_id = ?`,
          [userId],
          (err2, bpRow) => {
            const bonusPoints = !err2 && bpRow && bpRow.total ? bpRow.total : 0;

            db.get(
              `SELECT title FROM user_titles WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
              [userId],
              (err3, titleRow) => {
                const latestTitle =
                  !err3 && titleRow && titleRow.title
                    ? titleRow.title
                    : "None yet";

                resolve({ streak, bonusPoints, latestTitle });
              },
            );
          },
        );
      },
    );
  });
}

function getUserLeaderboardString(userId) {
  return new Promise((resolve) => {
    db.all(
      `
            SELECT u.username, 
                   (COALESCE(SUM(a.rooka_score), 0) + 
                    COALESCE((SELECT SUM(amount) FROM bonus_points WHERE user_id = u.id AND created_at >= datetime('now', '-7 days')), 0)) as total_rooka_score
            FROM users u
            LEFT JOIN activities a ON a.user_id = u.id AND a.start_date >= datetime('now', '-7 days') AND (u.rooka_start_date IS NULL OR substr(a.start_date, 1, 10) >= substr(u.rooka_start_date, 1, 10))
            WHERE (u.id = ? OR u.id IN (SELECT friend_id FROM connections WHERE user_id = ? AND status = 'accepted'))
            GROUP BY u.id
            ORDER BY total_rooka_score DESC
        `,
      [userId, userId],
      (err, rows) => {
        if (err || !rows || rows.length === 0) return resolve("");
        const lb = rows
          .map(
            (r, i) =>
              `${i + 1}. ${r.username} (${Math.round(r.total_rooka_score)} Points)`,
          )
          .join(", ");
        resolve(`\n\nCurrent Leaderboard: ${lb}`);
      },
    );
  });
}

async function getWeatherContext() {
  try {
    const weatherRes = await fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=52.3676&longitude=4.9041&current=temperature_2m,weather_code,wind_speed_10m,precipitation&daily=weather_code,temperature_2m_max,precipitation_sum,wind_speed_10m_max&timezone=Europe%2FBerlin",
    );
    if (!weatherRes.ok) return "";
    const data = await weatherRes.json();

    const currentTemp = data.current.temperature_2m;
    const currentWind = data.current.wind_speed_10m;
    const currentPrecip = data.current.precipitation;
    const dailyPrecip = data.daily.precipitation_sum[0] || 0;

    let weatherContext = `\nWEATHER CONTEXT:\nCurrent Weather: ${currentTemp}°C, Wind: ${currentWind} km/h, Precipitation: ${currentPrecip} mm/h (Daily total: ${dailyPrecip} mm).\n`;

    // Define miserable conditions (e.g. heavy rain or high wind)
    if (currentPrecip > 1.0 || dailyPrecip > 5.0 || currentWind > 25) {
      weatherContext += `WEATHER ALERT: It is currently very miserable outside (heavy rain or high winds).\n`;
    }

    return weatherContext;
  } catch (e) {
    console.error("Failed to fetch weather context:", e);
    return "";
  }
}

async function getUserMacroPhase(userId) {
  return new Promise((resolve) => {
    db.all(
      `SELECT * FROM milestones WHERE user_id = ? AND is_main = 1 ORDER BY date ASC`,
      [userId],
      (err, rows) => {
        let phase = "BASE";
        if (!err && rows && rows.length > 0) {
          const todayStr = getAMSDateString();
          // 1. Check if TODAY is race day
          const raceToday = rows.find((m) => m.date === todayStr);
          if (raceToday) {
            return resolve("RACE DAY");
          }
          // 2. Next upcoming race (strictly in the future)
          let nextRace = rows.find((m) => m.date > todayStr);
          if (nextRace) {
            const todayDate = new Date(todayStr + "T00:00:00Z");
            const raceDate = new Date(nextRace.date.split("T")[0] + "T00:00:00Z");
            let daysUntil = Math.round(
              (raceDate - todayDate) / (1000 * 60 * 60 * 24),
            );
            if (daysUntil <= 7) phase = "RACE WEEK";
            else if (daysUntil <= 14) phase = "TAPER";
            else if (daysUntil <= 28) phase = "PEAK";
            else if (daysUntil <= 70) phase = "BUILD";
          }
        }
        resolve(phase);
      },
    );
  });
}

async function generateAthleteWeeklyDescription(userId) {
  return new Promise((resolve) => {
    db.get(
      `SELECT id, username FROM users WHERE id = ? AND deleted_at IS NULL`,
      [userId],
      async (err, user) => {
        if (err || !user) return resolve(null);

        db.all(
          `SELECT id, name, sport_type, distance_km, moving_time_min, start_date, rooka_score, average_watts
           FROM activities
           WHERE user_id = ? AND start_date >= datetime('now', '-30 days')
           ORDER BY start_date DESC`,
          [user.id],
          async (errActs, acts) => {
            const activities = acts || [];

            // Sport counts and disciplines
            const sportCounts = {};
            let totalKm = 0;
            let totalMins = 0;
            activities.forEach((a) => {
              const sport = (a.sport_type || 'Workout').toLowerCase();
              sportCounts[sport] = (sportCounts[sport] || 0) + 1;
              totalKm += a.distance_km || 0;
              totalMins += a.moving_time_min || 0;
            });

            const topSports = Object.entries(sportCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([s, c]) => `${c} ${s} session${c > 1 ? 's' : ''}`);

            const hasRun = Boolean(sportCounts['run'] || sportCounts['virtualrun']);
            const hasRide = Boolean(sportCounts['ride'] || sportCounts['virtualride'] || sportCounts['gravel'] || sportCounts['mtb'] || sportCounts['bike']);
            const hasSwim = Boolean(sportCounts['swim']);
            const hasStrength = Boolean(sportCounts['strength'] || sportCounts['weighttraining']);

            let archetypeName = 'Multi-Discipline Athlete';
            if (hasRun && (hasRide || hasSwim)) {
              archetypeName = 'Multi-Sport Athlete';
            } else if (hasStrength && (hasRun || hasRide)) {
              archetypeName = 'Hyrox Hybrid';
            } else if (hasRun) {
              archetypeName = 'Endurance Runner';
            } else if (hasRide) {
              archetypeName = 'Rouleur';
            } else if (hasStrength) {
              archetypeName = 'Strength Athlete';
            }

            const fallbackDescriptions = {
              'Multi-Sport Athlete': 'Dedicated multi-sport athlete building consistent weekly volume across endurance and conditioning disciplines. Known for relentless cross-training versatility and strong aerobic stamina on the course.',
              'Hyrox Hybrid': 'Hybrid power athlete blending functional strength conditioning with steady endurance volume. Built for high work capacity, explosive grit, and strong pacing under load.',
              'Endurance Runner': 'Committed endurance runner logging steady mileage and aerobic base work each week. Focused on progressive pacing, threshold durability, and aerobic stamina on the road.',
              'Rouleur': 'Power-focused cyclist logging steady road mileage and driving sustained wattage on the bike. Specializes in aerobic endurance, tempo pacing, and relentless road rhythm.',
              'Strength Athlete': 'Focused strength and conditioning athlete dedicated to progressive overload and functional power. Prioritizes muscular strength, structural integrity, and explosive drive.',
              'Multi-Discipline Athlete': 'Disciplined athlete maintaining a strong habit of weekly training sessions and cross-conditioning. Driven by consistent progression, functional fitness, and multi-modal stamina.',
            };

            const defaultFallback =
              fallbackDescriptions[archetypeName] ||
              fallbackDescriptions['Multi-Discipline Athlete'];

            let finalBio = defaultFallback;

            if (activities.length > 0) {
              try {
                const prompt = `Here is the athletic training summary for athlete ${user.username}:
- Archetype focus: ${archetypeName}
- Past 30 days training: ${activities.length} workouts completed (${Math.round(totalKm)} km total distance, ${Math.round(totalMins / 60)} hours total).
- Disciplines logged: ${topSports.join(', ') || 'Mixed training'}.

Write a snappy, punchy, motivating 2-sentence public athletic bio describing their athletic focus and training discipline.

CRITICAL PRIVACY RULES:
1. Output EXACTLY 2 sentences. High energy, sports-focused, and concise.
2. ABSOLUTELY NO personal life details (no family, kids, jobs, work schedule, medical or private data). Focus strictly on their training consistency, discipline, sport variety, and athletic strengths.
3. Do not use quotes, hashtags, or preamble. Output ONLY the 2 sentences.`;

                const systemPrompt = `You are an elite sports commentator. You write punchy, engaging 2-sentence public athlete bios focusing entirely on training discipline, athletic capabilities, and sport volume. Strictly omit all personal/private life details.`;

                const aiRes = await generateWithFallback(prompt, systemPrompt);
                let text = typeof aiRes === 'string' ? aiRes : aiRes?.text || '';
                text = text.replace(/^["']|["']$/g, '').trim();

                if (text && text.length > 20 && text.length < 320) {
                  finalBio = text;
                }
              } catch (e) {
                console.log(`AI bio generation fallback used for user ${user.id}:`, e?.message);
              }
            }

            db.run(
              `UPDATE users SET public_description = ? WHERE id = ?`,
              [finalBio, user.id],
              (errUp) => {
                if (errUp) console.error('Error updating public_description:', errUp);
                resolve(finalBio);
              }
            );
          }
        );
      }
    );
  });
}

async function generateWeeklyAthleteDescriptionsJob() {
  console.log('🏁 Running Sunday night weekly athlete descriptions job...');
  return new Promise((resolve) => {
    db.all(
      `SELECT id, username FROM users WHERE deleted_at IS NULL`,
      [],
      async (err, users) => {
        if (err || !users || users.length === 0) return resolve();
        for (const u of users) {
          try {
            await generateAthleteWeeklyDescription(u.id);
            // Brief delay to avoid rate-limiting
            await new Promise((r) => setTimeout(r, 400));
          } catch (e) {
            console.error(`Error in weekly bio job for user ${u.id}:`, e);
          }
        }
        console.log('✅ Completed Sunday night weekly athlete descriptions.');
        resolve();
      }
    );
  });
}

function generatePublicProfile(targetUserId, viewerUserId = null) {
  return new Promise((resolve) => {
    db.get(
      `SELECT u.id, u.username, u.public_description, u.profile_picture_url, u.total_rooka, u.rooka_start_date,
              (SELECT status FROM connections WHERE user_id = ? AND friend_id = u.id) as connection_status
       FROM users u
       WHERE (u.id = ? OR u.username = ?) AND u.deleted_at IS NULL`,
      [viewerUserId, targetUserId, targetUserId],
      async (err, user) => {
        if (err || !user) return resolve(null);
        const targetId = user.id;

        let publicBio = user.public_description || 'Dedicated endurance athlete building consistent training volume and aerobic fitness on Rooka.';

        db.get(
          `SELECT ftp, weight_kg, max_hr FROM athlete_metrics WHERE user_id = ?`,
          [targetId],
          (errMetrics, metricsRow) => {
            const athlete_metrics = {
              ftp: metricsRow?.ftp || 0,
              weight_kg: metricsRow?.weight_kg || 75,
              max_hr: metricsRow?.max_hr || 190,
            };

            db.all(
              `SELECT id, name, distance_km, moving_time_min, start_date, sport_type,
                      average_heartrate, average_watts, sets_json,
                      COALESCE(rooka_score, 0) as rooka_score, tss, elevation_m
               FROM activities
               WHERE user_id = ?
               ORDER BY start_date DESC`,
              [targetId],
              async (errActs, allActivities) => {
                const activities = allActivities || [];
                const recentActivities = activities.slice(0, 10);

                db.all(
                  `SELECT date, weight_kg FROM biometrics WHERE user_id = ? AND date >= date('now', '-30 days') ORDER BY date ASC`,
                  [targetId],
                  async (errW, weights) => {
                    const trends = {
                      dates: [],
                      tsb: [],
                      ctl: [],
                      atl: [],
                      weight: [],
                    };

                    const tssMap = {};
                    let earliestDateStr = null;
                    const ascActivities = [...activities].reverse();
                    if (ascActivities.length > 0) {
                      earliestDateStr = (ascActivities[0].start_date || '').substring(0, 10);
                      ascActivities.forEach((r) => {
                        const d = (r.start_date || '').substring(0, 10);
                        if (d) {
                          if (!tssMap[d]) tssMap[d] = 0;
                          tssMap[d] += r.tss || 0;
                        }
                      });
                    }

                    const weightMap = {};
                    if (weights) {
                      weights.forEach(
                        (w) => (weightMap[w.date] = w.weight_kg || null),
                      );
                    }

                    let ctl = 0;
                    let atl = 0;
                    if (earliestDateStr) {
                      let currentDate = new Date(earliestDateStr);
                      const today = new Date();
                      currentDate.setUTCHours(0, 0, 0, 0);
                      today.setUTCHours(0, 0, 0, 0);

                      const totalDays = Math.round(
                        (today - currentDate) / (1000 * 60 * 60 * 24),
                      );
                      const trendStartIdx = totalDays - 29;

                      let currentDayIdx = 0;
                      while (currentDate <= today) {
                        const dateStr = currentDate.toISOString().split("T")[0];

                        const dailyTss = tssMap[dateStr] || 0;
                        ctl = ctl + (dailyTss - ctl) * (1 - Math.exp(-1 / 42));
                        atl = atl + (dailyTss - atl) * (1 - Math.exp(-1 / 7));
                        const tsb = ctl - atl;

                        if (currentDayIdx >= trendStartIdx) {
                          trends.dates.push(dateStr);
                          trends.ctl.push(Math.round(ctl * 10) / 10);
                          trends.atl.push(Math.round(atl * 10) / 10);
                          trends.tsb.push(Math.round(tsb * 10) / 10);
                          trends.weight.push(weightMap[dateStr] || null);
                        }

                        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
                        currentDayIdx++;
                      }
                    }

                    let activeTitle = null;
                    try {
                      activeTitle = await new Promise((res) => {
                        db.get(
                          `SELECT id, title, description FROM user_titles WHERE user_id = ? AND is_active = 1 LIMIT 1`,
                          [targetId],
                          (errT, rowT) => res(!errT && rowT ? rowT : null),
                        );
                      });
                    } catch (e) {}

                    const userStartDate = user.rooka_start_date ? user.rooka_start_date.substring(0, 10) : null;
                    const computedTotalRooka =
                      typeof user.total_rooka === "number" && user.total_rooka > 0
                        ? user.total_rooka
                        : Math.round(
                            activities
                              .filter((a) => !userStartDate || !a.start_date || a.start_date.substring(0, 10) >= userStartDate)
                              .reduce(
                                (sum, a) => sum + (a.rooka_score || 0),
                                0,
                              ),
                          );
                    const levelInfo = getRookaLevelInfo(computedTotalRooka);
                    const isSelf =
                      viewerUserId != null &&
                      String(viewerUserId) === String(user.id);

                    const profileData = {
                      id: user.id,
                      username: user.username,
                      profilePictureUrl: user.profile_picture_url,
                      profile_picture_url: user.profile_picture_url,
                      public_description: publicBio || user.public_description,
                      total_rooka: computedTotalRooka,
                      levelInfo: {
                        level: levelInfo.level,
                        currentXp: Math.round(levelInfo.totalRooka),
                        nextLevelXp: Math.round(levelInfo.nextLevelThreshold),
                        progressPercent: Math.round(levelInfo.progressPercent),
                      },
                      activeTitle: activeTitle,
                      activities: activities,
                      recentActivities: recentActivities,
                      athlete_metrics: athlete_metrics,
                      trends: trends,
                      connectionStatus: isSelf
                        ? "self"
                        : user.connection_status || "none",
                    };

                    resolve(profileData);
                  },
                );
              },
            );
          },
        );
      },
    );
  });
}

async function processTokenRefresh(
  refreshToken,
  internalUserId,
  resolve,
  reject,
) {
  try {
    const tokenRes = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    const tokenData = await tokenRes.json();
    if (tokenData.access_token) {
      if (tokenData.refresh_token && tokenData.refresh_token !== refreshToken) {
        db.run(
          `UPDATE users SET strava_refresh_token = ? WHERE id = ?`,
          [tokenData.refresh_token, internalUserId],
        );
        db.run(
          `UPDATE strava_tokens SET refresh_token = ?, access_token = ?, expires_at = ? WHERE user_id = ?`,
          [
            tokenData.refresh_token,
            tokenData.access_token,
            tokenData.expires_at || 0,
            internalUserId,
          ],
        );
      }
      resolve({
        accessToken: tokenData.access_token,
        internalUserId: internalUserId,
      });
    } else {
      reject("Strava token refresh failed during API payload exchange.");
    }
  } catch (e) {
    reject(e);
  }
}

async function getStravaTokenForUser(userIdOrStravaId) {
  return new Promise((resolve, reject) => {
    const lookupVal = String(userIdOrStravaId).trim();

    db.get(
      `
            SELECT u.strava_refresh_token, u.id 
            FROM users u
            LEFT JOIN strava_tokens t ON u.id = t.user_id
            WHERE u.id = ? OR t.strava_id = ? OR CAST(t.strava_id AS TEXT) = ?
        `,
      [userIdOrStravaId, lookupVal, lookupVal],
      async (err, user) => {
        if (err || !user || !user.strava_refresh_token) {
          console.log(
            `⚠️ Mapping index missing for ${lookupVal}. Attempting profile fallback link...`,
          );

          // Heal a missing athlete -> user mapping ONLY when it is
          // unambiguous. This used to take the first user with any Strava
          // token (`LIMIT 1`) and permanently bind the incoming athlete to
          // them, which imported a stranger's activities into whichever
          // account happened to sort first — and persisted the bad mapping.
          db.all(
            `SELECT u.id, u.strava_refresh_token
               FROM users u
               LEFT JOIN strava_tokens t ON t.user_id = u.id
              WHERE u.strava_refresh_token IS NOT NULL
                AND u.deleted_at IS NULL
                AND t.user_id IS NULL`,
            [],
            async (fallbackErr, candidates) => {
              if (fallbackErr || !candidates || candidates.length === 0) {
                return reject(
                  "No Strava token found anywhere in the system for identifier: " +
                    userIdOrStravaId,
                );
              }

              if (candidates.length > 1) {
                return reject(
                  `Ambiguous Strava mapping for identifier ${lookupVal}: ${candidates.length} unmapped accounts have a Strava connection. Refusing to guess an owner.`,
                );
              }

              const fallbackUser = candidates[0];

              db.run(
                `INSERT OR IGNORE INTO strava_tokens (user_id, access_token, refresh_token, expires_at, strava_id) VALUES (?, ?, ?, ?, ?)`,
                [
                  fallbackUser.id,
                  "temporary",
                  fallbackUser.strava_refresh_token,
                  0,
                  lookupVal,
                ],
                (insertErr) => {
                  if (!insertErr)
                    console.log(
                      `✨ Successfully healed missing index mapping for Strava ID: ${lookupVal}`,
                    );
                },
              );

              processTokenRefresh(
                fallbackUser.strava_refresh_token,
                fallbackUser.id,
                resolve,
                reject,
              );
            },
          );
        } else {
          processTokenRefresh(
            user.strava_refresh_token,
            user.id,
            resolve,
            reject,
          );
        }
      },
    );
  });
}

function getRookaLevelInfo(total_rooka) {
  const rooka = total_rooka || 0;
  const level = Math.floor(8.5 * Math.log10(rooka / 250 + 1)) + 1;
  const currentLevelThreshold = 250 * (Math.pow(10, (level - 1) / 8.5) - 1);
  const nextLevelThreshold = 250 * (Math.pow(10, level / 8.5) - 1);

  let progressPercent = 0;
  if (nextLevelThreshold > currentLevelThreshold) {
    progressPercent =
      ((rooka - currentLevelThreshold) /
        (nextLevelThreshold - currentLevelThreshold)) *
      100;
  }

  return {
    level,
    currentLevelThreshold,
    nextLevelThreshold,
    progressPercent: Math.min(Math.max(progressPercent, 0), 100),
    totalRooka: rooka,
  };
}

/**
 * Legacy signature, kept so existing call sites keep working. The bands here
 * were absolute bpm thresholds identical for every athlete, and ignored power
 * entirely — a power-only ride scored as bare minutes. Prefer
 * `calculateRookaScoreZoned` where the athlete's zone tables are available.
 */
function calculateRookaScore(movingTimeMin, avgHr, fallbackScore = 0) {
  if (!movingTimeMin || movingTimeMin <= 0) return fallbackScore || 0;
  return zoneModel.scoreActivity({ movingMinutes: movingTimeMin, avgHr });
}

/**
 * Score an activity against this athlete's own zone tables.
 * Effort is the harder of the heart-rate and power zones.
 */
async function calculateRookaScoreZoned({ userId, movingTimeMin, avgHr, avgWatts, sport }) {
  if (!movingTimeMin || movingTimeMin <= 0) return 0;
  const { hrZones, powerZones, powerZonesSport } =
    await athleteZones.resolveZonesForUser(userId, sport || "default");

  // Strava reports running power on the same `average_watts` field as cycling
  // power, but the two are nowhere near the same scale: a steady run reads
  // 400-500 W, which against a cycling FTP table is zone 7. Left unguarded,
  // every run pins the multiplier to 1.5 and an easy jog scores as a max
  // effort. Only score power where the table actually describes the sport --
  // the athlete's own table for it, or the FTP default on the bike.
  const powerApplies =
    !sport || sport === "default" || sport === "Bike" || powerZonesSport === sport;

  return zoneModel.scoreActivity({
    movingMinutes: movingTimeMin,
    avgHr,
    avgWatts: powerApplies ? avgWatts : null,
    hrZones,
    powerZones: powerApplies ? powerZones : null,
  });
}

/**
 * The encoded route of a Strava activity, if it has one.
 *
 * Summary activities (the /athlete/activities list) carry `map.summary_polyline`;
 * the detailed single-activity response also carries a full `map.polyline`.
 * Prefer the full one, fall back to the summary, and treat an empty string as
 * absent so an indoor session stores NULL rather than "".
 */
function extractStravaPolyline(data) {
  const map = data && data.map;
  if (!map) return null;
  const line = map.polyline || map.summary_polyline;
  return line && String(line).length > 0 ? String(line) : null;
}

function mapStravaSportToRooka(stravaSport) {
  if (!stravaSport) return "Other";
  if (stravaSport.includes("Run")) return "Run";
  if (stravaSport.includes("Ride") || stravaSport.includes("VirtualRide"))
    return "Bike";
  if (stravaSport.includes("Swim")) return "Swim";
  if (stravaSport.includes("WeightTraining") || stravaSport.includes("Workout"))
    return "Strength";
  return "Other";
}

/**
 * How long a single step lasts, in the unit it was prescribed in.
 *
 * `time_sec` used to fall through to the "reps" branch, so a 90-second rest
 * between sets was published to Strava as "90 reps".
 */
function describeStepDuration(step) {
  const v = step.condition_value;
  if (v == null) return "";
  switch (step.condition_type) {
    case "time":
      return `${v} min`;
    case "time_sec":
      return `${v} s`;
    case "distance":
      return `${v}m`;
    case "distance_km":
      return `${v}km`;
    case "reps":
    default:
      return `${v} reps`;
  }
}

/** The same duration, abbreviated for the one-line summary: 9', 90", 400m. */
function abbreviateStepDuration(step) {
  const v = step.condition_value;
  if (v == null) return "";
  switch (step.condition_type) {
    case "time":
      return `${v}'`;
    case "time_sec":
      return `${v}"`;
    case "distance":
      return `${v}m`;
    case "distance_km":
      return `${v}km`;
    case "reps":
    default:
      return `${v}x`;
  }
}

/** The intensity target of a step: Z3, 250W, 4:15, or nothing at all. */
function describeStepTarget(step) {
  if (step.target_type === "no.target") return "";
  if (step.zone) return `Z${step.zone}`;
  if (step.target_value) {
    if (step.target_type === "power.exact") return `${step.target_value}W`;
    return String(step.target_value);
  }
  if (step.weight) return `${step.weight}kg`;
  return "";
}

/**
 * The shape of a session on one line: `9' Z1 / 27' Z3 / 9' Z1`.
 *
 * This is what an athlete recognises as the workout they just did. The coach's
 * prose paragraph is a different thing and does not belong in a field that is
 * read at a glance next to a lap table.
 */
function summarizeStepsForStrava(stepsJson) {
  if (!stepsJson || stepsJson === "[]" || stepsJson === "null") return null;
  let steps;
  try {
    steps = typeof stepsJson === "string" ? JSON.parse(stepsJson) : stepsJson;
  } catch (e) {
    return null;
  }
  if (!Array.isArray(steps) || steps.length === 0) return null;

  const segment = (step) => {
    const dur = abbreviateStepDuration(step);
    const target = describeStepTarget(step);
    // A named strength movement is more use than its zone: "10x Back Squat 80kg".
    const name = step.exerciseName || step.garmin_exercise_name;
    if (name) {
      const load = step.weight ? ` ${step.weight}kg` : "";
      return `${dur} ${name}${load}`.trim();
    }
    return [dur, target].filter(Boolean).join(" ");
  };

  const parts = [];
  for (const step of steps) {
    if (step.type === "repeat") {
      const inner = (step.steps || []).map(segment).filter(Boolean);
      if (inner.length === 0) continue;
      const iterations = step.iterations || 1;
      parts.push(
        inner.length === 1
          ? `${iterations}x ${inner[0]}`
          : `${iterations}x (${inner.join(" / ")})`,
      );
    } else {
      // A rest step carries no intensity and only adds noise to a summary line.
      if (step.type === "rest") continue;
      const seg = segment(step);
      if (seg) parts.push(seg);
    }
  }

  return parts.length > 0 ? parts.join(" / ") : null;
}

function formatStepsForStrava(stepsJson) {
  if (!stepsJson || stepsJson === "[]" || stepsJson === "null") return null;
  try {
    const steps = JSON.parse(stepsJson);
    if (!steps || steps.length === 0) return null;
    let output = "";
    steps.forEach((s) => {
      if (s.type === "repeat") {
        output += `- Repeat ${s.iterations}x:\n`;
        if (s.steps) {
          s.steps.forEach((sub) => {
            let dur = describeStepDuration(sub);
            let tgt = sub.target_value
              ? sub.target_type === "power.exact"
                ? `${sub.target_value}W`
                : sub.target_value
              : sub.zone
                ? `Zone ${sub.zone}`
                : sub.target_type === "no.target"
                  ? "Open"
                  : sub.target_type.replace(".zone", "");
            let extra = sub.weight
              ? ` @ ${sub.weight}kg`
              : sub.target_type !== "no.target"
                ? ` @ ${tgt}`
                : "";
            let name = sub.exerciseName || sub.type;
            output += `    * ${name}: ${dur}${extra}\n`;
          });
        }
      } else {
        let dur = describeStepDuration(s);
        let tgt = s.target_value
          ? s.target_type === "power.exact"
            ? `${s.target_value}W`
            : s.target_value
          : s.zone
            ? `Zone ${s.zone}`
            : s.target_type === "no.target"
              ? "Open"
              : s.target_type.replace(".zone", "");
        let extra = s.weight
          ? ` @ ${s.weight}kg`
          : s.target_type !== "no.target"
            ? ` @ ${tgt}`
            : "";
        let name = s.exerciseName || s.type;
        output += `- ${name}: ${dur}${extra}\n`;
      }
    });
    return output.trim();
  } catch (e) {
    return null;
  }
}

// Share settings are stored per Rooka sport bucket, not per Strava sport_type:
// one "Run" entry has to cover Run, TrailRun, VirtualRun and the rest of
// Strava's list, which `mapStravaSportToRooka` already collapses for us.
const STRAVA_SHARE_SPORTS = ["Run", "Bike", "Swim", "Strength"];

// `shareStructure` has no toggle in the app - the planned steps always go out
// when there is a plan. It stays in the model because buildStravaUpdatePayload
// reads it, and because normalizeShareSettings defaults absent flags to on.
const STRAVA_SHARE_FLAGS = ["shareName", "shareScore", "shareStructure", "shareLink"];

const ALL_SHARING_ON = { shareName: true, shareScore: true, shareStructure: true, shareLink: true };
const ALL_SHARING_OFF = { shareName: false, shareScore: false, shareStructure: false, shareLink: false };

/**
 * The rooka.io credit is only optional from Rooka+ upwards; free accounts
 * always carry it. Enforced server-side rather than in the UI so neither a
 * stale stored setting nor a hand-rolled request can drop it.
 */
function canHideRookaLink(subscriptionTier) {
  return ["subscription", "rooka_plus", "premium", "admin"].includes(
    String(subscriptionTier || "free"),
  );
}

function canAccessQuests(subscriptionTier) {
  return ["subscription", "rooka_plus", "premium", "admin"].includes(
    String(subscriptionTier || "free"),
  );
}

/**
 * A stored entry only records what the athlete turned *off*. Anything absent -
 * a flag with no toggle in the app, or one added after they last saved - stays
 * on, so adding a flag never silently switches it off for existing athletes.
 */
function normalizeShareSettings(raw) {
  const out = { ...ALL_SHARING_ON };
  if (raw && typeof raw === "object") {
    for (const flag of STRAVA_SHARE_FLAGS) {
      if (flag in raw) out[flag] = !!raw[flag];
    }
  }
  return out;
}

function getStravaShareSettings(userId, sportType) {
  const bucket = mapStravaSportToRooka(sportType);

  return new Promise((resolve) => {
    db.get(
      `SELECT subscription_tier FROM users WHERE id = ?`,
      [userId],
      (userErr, userRow) => {
        const linkIsOptional = canHideRookaLink(userRow && userRow.subscription_tier);
        const finish = (settings) =>
          resolve(linkIsOptional ? settings : { ...settings, shareLink: true });

        db.all(
          "SELECT metric, value FROM athlete_metrics WHERE user_id = ? AND metric IN ('strava_share_settings', 'strava_opt_out_activities')",
          [userId],
          (err, rows) => {
            if (err || !rows || rows.length === 0) return finish({ ...ALL_SHARING_ON });

            const shareRow = rows.find((r) => r.metric === 'strava_share_settings');
            const optOutRow = rows.find((r) => r.metric === 'strava_opt_out_activities');

            if (shareRow && shareRow.value) {
              try {
                const settings = JSON.parse(shareRow.value);
                // `settings[sportType]` is the pre-bucket key the old PWA wrote.
                const forSport = settings[bucket] || settings[sportType];
                if (forSport) return finish(normalizeShareSettings(forSport));
              } catch (e) {}
            }

            if (optOutRow && optOutRow.value) {
              try {
                const optOutList = JSON.parse(optOutRow.value);
                if (Array.isArray(optOutList) && optOutList.includes(sportType)) {
                  // An explicit opt-out means nothing is posted for this sport
                  // at all. Forcing a link onto an activity the athlete asked
                  // Rooka to stay off would be worse than dropping the credit.
                  return resolve({ ...ALL_SHARING_OFF });
                }
              } catch (e) {}
            }

            finish({ ...ALL_SHARING_ON });
          }
        );
      }
    );
  });
}

function buildStravaUpdatePayload(existingDescription, plan, actualRooka, shareSettings) {
  const { shareName, shareScore, shareStructure, shareLink } = shareSettings;
  if (!shareName && !shareScore && !shareStructure && !shareLink) {
    return null;
  }

  const payload = {};

  if (shareName && plan && plan.description && plan.description.trim().length > 0) {
    payload.name = plan.description.trim();
  }

  const descBlocks = [];

  // The structure leads, on its own line, because it is the part an athlete
  // recognises: `9' Z1 / 27' Z3 / 9' Z1`.
  const structureSummary =
    shareStructure && plan ? summarizeStepsForStrava(plan.steps_json) : null;
  if (structureSummary) {
    descBlocks.push(structureSummary);
  }

  if (shareScore) {
    if (plan && plan.target_rooka != null) {
      descBlocks.push(`Rooka Target: ${plan.target_rooka} Rooka\nActual: ${Math.round(actualRooka)} Rooka`);
    } else {
      descBlocks.push(`Actual: ${Math.round(actualRooka)} Rooka`);
    }
  }

  if (shareStructure && plan) {
    // Steps only. This used to fall back to `plan.details` — the coach's prose
    // paragraph — whenever a plan had no steps_json, which is how a pep talk
    // ended up as the description of a set of intervals.
    const stepsContent = formatStepsForStrava(plan.steps_json);
    if (stepsContent) {
      descBlocks.push(`Planned Workout:\n${stepsContent}`);
    }
  }

  if (shareLink) {
    descBlocks.push(`Generated by Rooka:\nrooka.io`);
  }

  if (descBlocks.length > 0) {
    const newDescriptionPart = descBlocks.join("\n\n");
    if (existingDescription && existingDescription.trim().length > 0) {
      if (!existingDescription.includes("Generated by Rooka:") && !existingDescription.includes("Rooka Target:")) {
        payload.description = `${existingDescription.trim()}\n\n---\n${newDescriptionPart}`;
      }
    } else {
      payload.description = newDescriptionPart;
    }
  }

  if (Object.keys(payload).length === 0) {
    return null;
  }
  return payload;
}

async function tagStravaActivity(userId, activity, token) {
  if (activity.description && activity.description.includes("Rooka Target"))
    return;

  const activityType = activity.sport_type || activity.type;
  const shareSettings = await getStravaShareSettings(userId, activityType);
  if (!shareSettings.shareName && !shareSettings.shareScore && !shareSettings.shareStructure && !shareSettings.shareLink) {
    console.log(`🚫 Skipping Strava tag for ${activityType} activity ${activity.id} due to all sharing toggles off.`);
    return;
  }

  const tss =
    activity.suffer_score || Math.round((activity.moving_time / 3600) * 50);
  const activityDate = activity.start_date_local
    ? activity.start_date_local.split("T")[0]
    : activity.start_date.split("T")[0];
  const rookaSport = mapStravaSportToRooka(activityType);

  db.get(
    // Same loose sport match the webhook path uses: an exact-equality match
    // missed plans stored as e.g. "Run - intervals", so a planned session came
    // back untagged depending on which path imported it.
    "SELECT description, target_rooka, details, steps_json FROM micro_plan WHERE user_id = ? AND date = ? AND (LOWER(sport) = LOWER(?) OR LOWER(sport) LIKE '%' || LOWER(?) || '%')",
    [userId, activityDate, rookaSport, rookaSport.slice(0, 5)],
    async (err, plan) => {
      // A missing plan is not a reason to skip: an unplanned activity still
      // gets its score and the Rooka link, which is what the webhook path has
      // always done. This used to `return` here, so an unplanned run synced
      // with the Sync button was never tagged at all.
      const payload = buildStravaUpdatePayload(activity.description, err ? null : plan, tss, shareSettings);
      if (!payload) return;

      try {
        const updateRes = await fetch(
          `https://www.strava.com/api/v3/activities/${activity.id}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
        );
        if (updateRes.ok)
          console.log(
            `✅ Strava activity updated for ${rookaSport} on ${activityDate}`,
          );
      } catch (e) {
        console.error("Failed to tag Strava activity:", e);
      }
    },
  );
}

/**
 * Every live Rooka account connected to a given Strava athlete.
 *
 * Now that an activity is stored per user, one Strava athlete can legitimately
 * back more than one account, and a webhook has to reach all of them.
 */
function getStravaUserIdsForAthlete(stravaAthleteId) {
  const lookupVal = String(stravaAthleteId).trim();
  return new Promise((resolve) => {
    db.all(
      `SELECT t.user_id
         FROM strava_tokens t
         JOIN users u ON u.id = t.user_id
        WHERE CAST(t.strava_id AS TEXT) = ? AND u.deleted_at IS NULL`,
      [lookupVal],
      (err, rows) => resolve(err || !rows ? [] : rows.map((r) => r.user_id)),
    );
  });
}

/**
 * Automatically evaluates an activity, checks quests, runs AI muscle impact,
 * generates a personalized coach reaction in chat_history, and dispatches a
 * push notification (with badge: 1) and WebSocket event to the athlete.
 */
async function processActivityCoachAnalysis(internalUserId, activityData, options = {}) {
  if (!internalUserId || !activityData) return null;

  const activityId = activityData.strava_activity_id || activityData.id;
  const rawSport = activityData.sport_type || activityData.sport || "Workout";
  const rookaSport = mapStravaSportToRooka(rawSport);
  const activityName = activityData.name || `${rookaSport} Session`;

  // Normalize distance (km) and moving time (minutes)
  let distanceKm = 0;
  if (activityData.distance_km !== undefined && activityData.distance_km !== null) {
    distanceKm = Number(activityData.distance_km) || 0;
  } else if (activityData.distance !== undefined && activityData.distance !== null) {
    distanceKm = (Number(activityData.distance) || 0) / 1000;
  }

  let movingTimeMin = 0;
  if (activityData.moving_time_min !== undefined && activityData.moving_time_min !== null) {
    movingTimeMin = Number(activityData.moving_time_min) || 0;
  } else if (activityData.moving_time !== undefined && activityData.moving_time !== null) {
    movingTimeMin = (Number(activityData.moving_time) || 0) / 60;
  }

  const rookaScore = Number(activityData.rooka_score || activityData.rookaScore || 0);

  const rawDate = activityData.start_date_local || activityData.start_date || new Date().toISOString();
  const activityDate = rawDate.includes("T") ? rawDate.split("T")[0] : rawDate.split(" ")[0];

  return new Promise((resolve) => {
    // Check if activity was already analyzed
    db.get(
      `SELECT id, coach_analyzed FROM activities WHERE user_id = ? AND (strava_activity_id = ? OR id = ?)`,
      [internalUserId, String(activityId), String(activityId)],
      async (err, actRow) => {
        if (actRow && actRow.coach_analyzed === 1) {
          console.log(`ℹ️ Activity ${activityId} for user ${internalUserId} already analyzed. Skipping.`);
          return resolve(null);
        }

        // Muscle impact analysis
        try {
          analyzeMuscleImpact(internalUserId, activityData, rookaSport, activityDate);
        } catch (e) {
          console.error("AI Muscle Impact Analysis failed:", e);
        }

        // Invalidate today's nutrition cache if activity happened today
        const todayStr = getAMSDateString();
        if (activityDate === todayStr) {
          db.run(
            `DELETE FROM nutrition_protocols WHERE user_id = ? AND date = ?`,
            [internalUserId, todayStr],
          );
        }

        // Find micro plan for the activity's date and sport
        db.get(
          "SELECT description, target_rooka, details, steps_json FROM micro_plan WHERE user_id = ? AND date = ? AND (LOWER(sport) = LOWER(?) OR LOWER(sport) LIKE '%' || LOWER(?) || '%')",
          [internalUserId, activityDate, rookaSport, rookaSport.slice(0, 5)],
          async (planErr, plan) => {
            // Fetch user context & coach tone
            db.get(
              "SELECT coach_name, coach_tone, coach_context, subscription_tier FROM users WHERE id = ?",
              [internalUserId],
              async (userErr, userRow) => {
                const coachName = userRow?.coach_name || "Rooka";
                let tone = userRow?.coach_tone || "Friendly and motivating";
                if (tone === "custom" || tone === "Configure own coach") {
                  tone = userRow?.coach_context ? `Custom tone: ${userRow.coach_context}` : "Custom coach persona";
                }

                let prompt = `The user just completed a ${rookaSport} activity: "${activityName}". They covered ${distanceKm.toFixed(1)}km in ${Math.round(movingTimeMin)} minutes, generating ${Math.round(rookaScore)} Rooka. `;

                if (plan) {
                  let stepsContent = formatStepsForStrava(plan.steps_json);
                  const workoutContent = stepsContent
                    ? stepsContent
                    : plan.details && plan.details.trim().length > 0
                      ? plan.details
                      : plan.description;
                  prompt += `The planned workout for today was: "${workoutContent}" with a target of ${plan.target_rooka} Rooka. Give a short, 1-2 sentence coach reaction based on your persona tone (${tone}). Praise them if they hit the target or give constructive advice if they missed it.`;
                } else {
                  prompt += `This was an unplanned activity. Give a short, 1-2 sentence coach reaction based on your persona tone (${tone}).`;
                }

                // Quest evaluation (paid tiers only)
                if (canAccessQuests(userRow?.subscription_tier)) {
                  try {
                    const completedQuests = await evaluateQuestsAgainstActivity(
                      internalUserId,
                      {
                        distance_km: distanceKm,
                        moving_time_min: movingTimeMin,
                        rooka_score: rookaScore,
                      },
                    );

                    if (completedQuests && completedQuests.length > 0) {
                      const allQuests = await evaluateAndProgressQuests(internalUserId);
                      const newQuest = allQuests.find((q) => q.status === "active");
                      updateUserRookaAndCheckLevel(internalUserId);

                      prompt += `\n\nCRITICAL INFO: The user ALSO just completed their active quest: "${completedQuests[0].description}" and earned ${completedQuests[0].reward_points} Rooka points! `;
                      if (newQuest) {
                        prompt += `I (the system) have automatically assigned them a NEW quest: "${newQuest.description}" (Target: ${newQuest.target_value} ${newQuest.target_metric}, Reward: ${newQuest.reward_points} Rooka). You MUST enthusiastically celebrate their completed quest AND announce their brand new quest to keep them motivated!`;
                      } else {
                        prompt += `You MUST enthusiastically celebrate their completed quest!`;
                      }
                    }
                  } catch (e) {
                    console.error("Quest evaluation failed during activity analysis:", e);
                  }
                }

                prompt += ` Keep it under 3 sentences. DO NOT wrap it in JSON.`;

                const systemPrompt = `You are ${coachName}, an elite endurance coach. Your tone is: ${tone}. ${userRow?.coach_context ? `Coach Custom Context: ${userRow.coach_context}` : ""} Act like a real human in a continuous text message thread.`;

                try {
                  const aiReply = await generateWithFallback(prompt, systemPrompt);

                  // Insert into chat_history
                  db.run(
                    `INSERT INTO chat_history (user_id, role, content, mood) VALUES (?, 'coach', ?, 'hype')`,
                    [internalUserId, aiReply],
                    (insertErr) => {
                      if (insertErr) {
                        console.error("Error inserting coach activity analysis:", insertErr);
                        return resolve(null);
                      }

                      // Mark activity as coach_analyzed = 1
                      db.run(
                        `UPDATE activities SET coach_analyzed = 1 WHERE user_id = ? AND (strava_activity_id = ? OR id = ?)`,
                        [internalUserId, String(activityId), String(activityId)],
                      );

                      // Send SSE / WebSocket event to frontend
                      sendSSEEvent(internalUserId, "unread_message", {
                        message: aiReply,
                        mood: "hype",
                      });

                      // Send Push Notification with badge count
                      sendPushToUser(internalUserId, {
                        title: `${coachName} analyzed your ${rookaSport}! ⚡️`,
                        body: aiReply,
                        data: { url: "/(tabs)/coach", type: "coach" },
                        badge: 1,
                      });

                      console.log(`🤖 Sent proactive coach analysis for activity ${activityId} to user ${internalUserId}`);
                      resolve(aiReply);
                    }
                  );
                } catch (genErr) {
                  console.error("Coach activity analysis AI generation failed:", genErr);
                  resolve(null);
                }
              }
            );
          }
        );
      }
    );
  });
}

async function getStravaActivity(stravaAthleteId, activityId, explicitUserId) {
  try {
    console.log(
      `🔍 Processing webhook activity ${activityId} for Strava Athlete ${stravaAthleteId}...`,
    );

    let accessToken;
    let internalUserId;

    try {
      // When the caller already knows which account this is for (webhook
      // fan-out), resolve the token for that account rather than whichever
      // account happens to be mapped to the athlete first.
      const result = await getStravaTokenForUser(
        explicitUserId !== undefined ? explicitUserId : stravaAthleteId,
      );
      accessToken = result.accessToken;
      internalUserId = explicitUserId !== undefined ? explicitUserId : result.internalUserId;
    } catch (lookupError) {
      console.warn(
        `⚠️ Token mapping failed (${lookupError.message}). Aborting webhook processing.`,
      );
      return;
    }

    const res = await fetch(
      `https://www.strava.com/api/v3/activities/${activityId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    const data = await res.json();

    if (!data.id) {
      console.error(
        "❌ Failed to pull activity details from Strava payload:",
        data,
      );
      return;
    }

    const tss = data.suffer_score || Math.round((data.moving_time / 3600) * 50);

    db.get(
      `SELECT rooka_start_date FROM users WHERE id = ?`,
      [internalUserId],
      async (err, uRow) => {
        const userStartDateDay = uRow && uRow.rooka_start_date ? uRow.rooka_start_date.substring(0, 10) : null;
        const actStartDateDay = data.start_date ? data.start_date.substring(0, 10) : null;

        let rookaScore = 0;
        if (!userStartDateDay || (actStartDateDay && actStartDateDay >= userStartDateDay)) {
          // The webhook is how activities normally arrive, so scoring it
          // with the legacy helper meant the zone model almost never ran: no
          // tables passed means the fallback multiplier of 1.0, i.e. bare
          // minutes. Score against the athlete's own zones, as Sync does.
          rookaScore = await calculateRookaScoreZoned({
            userId: internalUserId,
            movingTimeMin: data.moving_time / 60,
            avgHr: data.average_heartrate,
            avgWatts: data.weighted_average_watts || data.average_watts,
            sport: mapStravaSportToRooka(data.sport_type),
          });
        }

        let lapsJson = null;
        if (data.laps && Array.isArray(data.laps) && data.laps.length > 0) {
          const minimalLaps = data.laps.map(l => ({
            name: l.name,
            distance: l.distance,
            moving_time: l.moving_time,
            average_speed: l.average_speed,
            average_heartrate: l.average_heartrate,
            split: l.split
          }));
          lapsJson = JSON.stringify(minimalLaps);
        }

        db.run(
          `INSERT INTO activities (user_id, strava_activity_id, name, sport_type, distance_km, elevation_m, moving_time_min, average_heartrate, average_watts, max_heartrate, start_date, tss, rooka_score, laps_json, polyline) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(user_id, strava_activity_id) DO UPDATE SET tss=excluded.tss, rooka_score=excluded.rooka_score, moving_time_min=excluded.moving_time_min, average_heartrate=excluded.average_heartrate, average_watts=excluded.average_watts, max_heartrate=excluded.max_heartrate, laps_json=excluded.laps_json, polyline=COALESCE(excluded.polyline, polyline)`,
          [
            internalUserId,
            String(data.id),
            data.name,
            data.sport_type,
            data.distance / 1000,
            data.total_elevation_gain,
            data.moving_time / 60,
            data.average_heartrate || null,
            data.weighted_average_watts || data.average_watts || null,
            data.max_heartrate || null,
            data.start_date,
            tss,
            rookaScore,
            lapsJson,
            extractStravaPolyline(data),
          ],
          async (err) => {
            if (!err) {
              updateUserRookaAndCheckLevel(internalUserId, { isRealtime: true });
              sendSSEEvent(internalUserId, "sync_complete", {
                provider: "strava",
                activityId: data.id,
              });

              // Update Strava first (title / description if enabled in settings).
              // This used to run after the coach analysis below, which awaits up
              // to three unbounded AI calls - a single stalled Gemini request
              // left the athlete's title and description silently unwritten,
              // with nothing in the logs to say so.
              const activityDate = data.start_date_local
                ? data.start_date_local.split("T")[0]
                : data.start_date.split("T")[0];
              const rookaSport = mapStravaSportToRooka(data.sport_type);

              try {
                const shareSettings = await getStravaShareSettings(internalUserId, data.sport_type);
                const plan = await new Promise((resolve) =>
                  db.get(
                    "SELECT description, target_rooka, details, steps_json FROM micro_plan WHERE user_id = ? AND date = ? AND (LOWER(sport) = LOWER(?) OR LOWER(sport) LIKE '%' || LOWER(?) || '%')",
                    [internalUserId, activityDate, rookaSport, rookaSport.slice(0, 5)],
                    (planErr, row) => resolve(planErr ? null : row),
                  ),
                );

                const updatePayload = buildStravaUpdatePayload(data.description, plan, rookaScore, shareSettings);
                if (updatePayload && accessToken) {
                  const updateRes = await fetch(
                    `https://www.strava.com/api/v3/activities/${activityId}`,
                    {
                      method: "PUT",
                      headers: {
                        Authorization: `Bearer ${accessToken}`,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify(updatePayload),
                    },
                  );

                  if (updateRes.ok) {
                    console.log(
                      `✅ Strava activity updated for activity ${activityId}!`,
                    );
                  } else {
                    const errorData = await updateRes.json().catch(() => ({}));
                    console.error(
                      `❌ Strava Activity Update Failed:`,
                      errorData,
                    );
                  }
                } else if (!updatePayload) {
                  console.log(
                    `ℹ️ Nothing to write back to Strava for activity ${activityId} (sharing off, or already tagged).`,
                  );
                }
              } catch (updateErr) {
                console.error("Strava activity update failed:", updateErr);
              }

              // Run unified post-workout coach analysis, quest checks & push notifications
              await processActivityCoachAnalysis(internalUserId, {
                ...data,
                rooka_score: rookaScore,
              }, { isRealtime: true });
            }
          },
        );
      },
    );
  } catch (e) {
    console.error(
      `❌ Fatal Webhook Processing Error for Strava Athlete ${stravaAthleteId}:`,
      e,
    );
  }
}

async function syncAllStravaUsersOnStartup() {
  const SYNC_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown

  db.get(
    `SELECT value FROM system_state WHERE key = 'last_strava_sync_time'`,
    [],
    (err, row) => {
      if (!err && row && row.value) {
        const lastSync = parseInt(row.value, 10);
        if (Date.now() - lastSync < SYNC_COOLDOWN_MS) {
          console.log(
            "⏳ Skipping initial Strava sync to respect rate limits (ran less than 1 hour ago).",
          );
          return;
        }
      }

      db.run(
        `INSERT OR REPLACE INTO system_state (key, value, last_updated) VALUES ('last_strava_sync_time', ?, datetime('now'))`,
        [Date.now().toString()],
      );

      console.log("🔄 Running initial Strava sync for all connected users...");
      db.all(
        "SELECT id, rooka_start_date FROM users WHERE strava_refresh_token IS NOT NULL AND deleted_at IS NULL",
        [],
        async (err, users) => {
          if (err || !users) return;

          for (const user of users) {
            try {
              const result = await getStravaTokenForUser(user.id);
              const token = result.accessToken;

              const actRes = await fetch(
                "https://www.strava.com/api/v3/athlete/activities?per_page=50",
                {
                  headers: { Authorization: `Bearer ${token}` },
                },
              );

              if (!actRes.ok) {
                console.error(
                  `❌ Strava Sync API Error ${actRes.status} for user ${user.id}`,
                );
                continue;
              }

              const activities = await actRes.json();

              if (Array.isArray(activities)) {
                const userStartDateDay = user.rooka_start_date ? user.rooka_start_date.substring(0, 10) : null;
                for (const act of activities) {
                  const tss =
                    act.suffer_score ||
                    Math.round((act.moving_time / 3600) * 50);
                  const actStartDateDay = act.start_date ? act.start_date.substring(0, 10) : null;
                  let rookaScore = 0;
                  if (!userStartDateDay || (actStartDateDay && actStartDateDay >= userStartDateDay)) {
                    rookaScore = await calculateRookaScoreZoned({
                      userId: user.id,
                      movingTimeMin: act.moving_time / 60,
                      avgHr: act.average_heartrate,
                      avgWatts: act.weighted_average_watts || act.average_watts,
                      sport: mapStravaSportToRooka(act.sport_type),
                    });
                  }
                  db.run(
                    `INSERT INTO activities (user_id, strava_activity_id, name, sport_type, distance_km, elevation_m, moving_time_min, average_heartrate, average_watts, max_heartrate, start_date, tss, rooka_score, polyline) 
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                             ON CONFLICT(user_id, strava_activity_id) DO UPDATE SET tss=excluded.tss, rooka_score=excluded.rooka_score, moving_time_min=excluded.moving_time_min, average_heartrate=excluded.average_heartrate, average_watts=excluded.average_watts, max_heartrate=excluded.max_heartrate, polyline=COALESCE(excluded.polyline, polyline)`,
                    [
                      user.id,
                      String(act.id),
                      act.name,
                      act.sport_type,
                      act.distance / 1000,
                      act.total_elevation_gain,
                      act.moving_time / 60,
                      act.average_heartrate || 0,
                      act.weighted_average_watts || act.average_watts || null,
                      act.max_heartrate || null,
                      act.start_date,
                      tss,
                      rookaScore,
                      extractStravaPolyline(act),
                    ],
                  );
                }
                updateUserRookaAndCheckLevel(user.id, { isRealtime: false });
                console.log(`✅ Startup sync complete for user ${user.id}`);
              } else {
                console.error(
                  `❌ Startup sync failed for user ${user.id}: Response is not an array`,
                );
              }
            } catch (err) {
              console.error(`❌ Startup sync failed for user ${user.id}:`, err);
            }
          }
        },
      );
    },
  );
}

async function triggerBackgroundSummary(userId) {
  console.log(`🤖 Triggering background rolling summary for user ${userId}...`);

  db.get(
    `SELECT long_term_memory, coach_tone FROM users WHERE id = ?`,
    [userId],
    async (err, user) => {
      if (err || !user) return;

      db.all(
        `SELECT body_part, severity, notes, status FROM athlete_niggles WHERE user_id = ?`,
        [userId],
        async (err, niggleRows) => {
          const activeNiggles = (niggleRows || []).filter((n) => n.status === "active");
          const resolvedNiggles = (niggleRows || []).filter((n) => n.status === "resolved");

          const activeText =
            activeNiggles.length > 0
              ? activeNiggles
                  .map(
                    (n) =>
                      `- ${n.body_part}: Severity ${n.severity}/5. ${n.notes || ""}`,
                  )
                  .join("\n")
              : "No active injuries or niggles reported. Athlete is 100% healthy.";

          const resolvedText =
            resolvedNiggles.length > 0
              ? resolvedNiggles
                  .map((n) => `- ${n.body_part}: HEALED / RESOLVED`)
                  .join("\n")
              : "None.";

          db.all(
            `SELECT role, content FROM (SELECT * FROM chat_history WHERE user_id = ? ORDER BY id DESC LIMIT 12) ORDER BY id ASC`,
            [userId],
            async (err, historyRows) => {
              if (err) return;

              const historyText =
                historyRows && historyRows.length > 0
                  ? historyRows
                      .map((r) => `${r.role.toUpperCase()}: ${r.content}`)
                      .join("\n")
                  : "No recent chat.";

              const currentSummary = user.long_term_memory || "No summary yet.";

              const prompt = `You are a background AI assistant for an endurance coach app. Your job is to update the athlete's long-term memory summary based on recent chat history and REAL-TIME injury records.

CURRENT LONG-TERM MEMORY:
${currentSummary}

REAL-TIME ACTIVE INJURIES (REALITY / TRUTH):
${activeText}

REAL-TIME RESOLVED / HEALED INJURIES (REALITY / TRUTH):
${resolvedText}

RECENT CHAT HISTORY:
${historyText}

INSTRUCTIONS & CRITICAL RULES FOR INJURIES:
1. INJURY TRUTH: Refer strictly to the ACTIVE INJURIES list above. If an injury (e.g. heel, knee, ankle, back) is listed under RESOLVED INJURIES or is NOT in ACTIVE INJURIES, REMOVE IT COMPLETELY from current physical issues in the summary! Note it as fully healed or omit it.
2. DO NOT state that a resolved or non-active injury is currently hurting, bothering, or limiting the athlete.
3. Update the long-term memory summary to incorporate any new important facts (new goals, shifts in mood, new baseline numbers).
4. Keep it extremely concise (under 150 words). Do not include pleasantries. Only output the updated summary text.`;

              try {
                const newSummary = await generateWithFallback(prompt);
                db.run(`UPDATE users SET long_term_memory = ? WHERE id = ?`, [
                  newSummary.trim(),
                  userId,
                ]);
                console.log(`✅ Updated long-term memory for user ${userId}`);
              } catch (e) {
                console.error(
                  `❌ Failed to update long-term memory for user ${userId}:`,
                  e,
                );
              }
            },
          );
        },
      );
    },
  );
}

function updateUserRookaAndCheckLevel(userId, options = {}) {
  db.get(
    `SELECT total_rooka, rooka_start_date FROM users WHERE id = ?`,
    [userId],
    (err, userRow) => {
      if (err || !userRow) return;
      const oldRooka = userRow.total_rooka || 0;
      const oldLevelInfo = getRookaLevelInfo(oldRooka);

      const resolveStartDate = (cb) => {
        if (userRow.rooka_start_date) {
          return cb(userRow.rooka_start_date.substring(0, 10));
        }
        db.get(
          `SELECT MIN(start_date) as first_date FROM activities WHERE user_id = ? AND rooka_score > 0`,
          [userId],
          (eDate, dRow) => {
            const dateVal = dRow?.first_date || new Date().toISOString();
            db.run(`UPDATE users SET rooka_start_date = ? WHERE id = ?`, [dateVal, userId]);
            cb(dateVal.substring(0, 10));
          }
        );
      };

      resolveStartDate((rookaStartDateDay) => {
        const actQuery = `SELECT COALESCE(SUM(rooka_score), 0) as act_total FROM activities WHERE user_id = ? AND substr(start_date, 1, 10) >= ?`;
        const queryParams = [userId, rookaStartDateDay];

        db.get(actQuery, queryParams, (err, actRow) => {
          if (err) return;
          const actTotal = actRow ? (actRow.act_total || 0) : 0;

          const bonusQuery = `SELECT COALESCE(SUM(amount), 0) as bonus_total FROM bonus_points WHERE user_id = ? AND substr(created_at, 1, 10) >= ?`;

          db.get(bonusQuery, queryParams, (err, bonusRow) => {
            if (err) return;
            const bonusTotal = bonusRow ? (bonusRow.bonus_total || 0) : 0;
            const newRooka = Math.round((actTotal + bonusTotal) * 10) / 10;

          db.run(
            `UPDATE users SET total_rooka = ? WHERE id = ?`,
            [newRooka, userId],
            (err) => {
              if (err) return;

              const newLevelInfo = getRookaLevelInfo(newRooka);

              // Tell the open app the total moved. Without this the header
              // point count and level only ever changed on a cold reload.
              if (newRooka !== oldRooka) {
                sendSSEEvent(userId, "rooka_updated", {
                  total_rooka: newRooka,
                  rooka: Math.round((newRooka - oldRooka) * 10) / 10,
                  level: newLevelInfo.level,
                });
              }

              if (newLevelInfo.level > oldLevelInfo.level) {
                // Level up!
                sendSSEEvent(userId, "level_up", {
                  level: newLevelInfo.level,
                  new_level: newLevelInfo.level,
                  previous_level: oldLevelInfo.level,
                  total_rooka: newRooka,
                });
                triggerLevelUpCoachPrompt(userId, newLevelInfo.level);
              }

              // Background milestone check: 300+ in day, 2000+ in week, 6000+ in month
              checkAndAwardRookaTitles(userId, options);
            },
          );
        });
      });
      });
    },
  );
}

function parseTargetTimeToMinutes(targetValue, raceName = '') {
  if (!targetValue || typeof targetValue !== 'string') return null;
  const str = targetValue.trim().toLowerCase();

  // Check for "4h 30m" or "4h30" or "4.5h"
  const hMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)/);
  const mMatch = str.match(/(\d+)\s*(?:m|min|mins|minute|minutes)/);
  if (hMatch || mMatch) {
    const hours = hMatch ? parseFloat(hMatch[1]) : 0;
    const mins = mMatch ? parseFloat(mMatch[1]) : 0;
    return hours * 60 + mins;
  }

  // Check for colon format: "04:30:00" (hh:mm:ss) or "4:30"
  if (str.includes(':')) {
    const parts = str.split(':').map((p) => parseFloat(p.trim()) || 0);
    if (parts.length === 3) {
      return parts[0] * 60 + parts[1] + parts[2] / 60;
    } else if (parts.length === 2) {
      const isShortRace = /5k|5\s*km|10k|10\s*km|sprint/i.test(raceName);
      if (isShortRace || parts[0] >= 15) {
        return parts[0] + parts[1] / 60;
      } else {
        return parts[0] * 60 + parts[1];
      }
    }
  }

  const num = parseFloat(str);
  if (!isNaN(num)) {
    if (num > 15) return num;
    return num * 60;
  }

  return null;
}

function parseTargetDistanceKm(targetValue, raceName = '') {
  const combined = `${targetValue || ''} ${raceName || ''}`.toLowerCase();

  if (combined.includes('140.6') || combined.includes('full ironman')) return 226;
  if (combined.includes('70.3') || combined.includes('half ironman') || combined.includes('half-ironman')) return 113;
  if (combined.includes('marathon') && !combined.includes('half')) return 42.195;
  if (combined.includes('half marathon') || combined.includes('half-marathon')) return 21.097;
  if (combined.includes('century')) return 100;
  if (combined.includes('10k') || combined.includes('10 km')) return 10;
  if (combined.includes('5k') || combined.includes('5 km')) return 5;

  if (targetValue && typeof targetValue === 'string') {
    const kmMatch = targetValue.match(/(\d+(?:\.\d+)?)\s*(?:km|k|kilometer|kilometers)/i);
    if (kmMatch) return parseFloat(kmMatch[1]);
  }

  return null;
}

async function checkAndAwardRookaTitles(userId, options = {}) {
  const isRealtime = Boolean(options && options.isRealtime);
  return new Promise((resolve) => {
    // ONLY check & award milestone titles on real-time workout arrivals; never scan historic data
    if (!isRealtime) return resolve();

    // 1. Check user subscription tier - only Rooka+ members earn titles
    db.get(`SELECT subscription_tier FROM users WHERE id = ?`, [userId], async (errUser, userRow) => {
      if (errUser || !userRow) return resolve();
      const tier = userRow.subscription_tier;
      const isPaid = tier === 'admin' || tier === 'premium' || tier === 'rooka_plus' || tier === 'subscription';

      if (!isPaid) return resolve();

      db.all(
        `SELECT milestone_key FROM user_milestone_history WHERE user_id = ? AND milestone_key IS NOT NULL
         UNION
         SELECT milestone_key FROM user_titles WHERE user_id = ? AND milestone_key IS NOT NULL`,
        [userId, userId],
        async (err, titleRows) => {
          if (err) return resolve();
          const awardedKeys = new Set((titleRows || []).map((r) => r.milestone_key));

          const actFilter = isRealtime ? " AND substr(start_date, 1, 10) >= date('now', '-1 day') " : "";
          const weekFilter = isRealtime ? " AND strftime('%Y-W%W', start_date) = strftime('%Y-W%W', 'now') " : "";
          const monthFilter = isRealtime ? " AND substr(start_date, 1, 7) = strftime('%Y-%m', 'now') " : "";

          // 2. Single Day 300+ Rooka Milestones
          const dayRows = await new Promise((res) => {
            db.all(
              `SELECT substr(start_date, 1, 10) as act_date, SUM(rooka_score) as day_rooka, COUNT(id) as count
               FROM activities
               WHERE user_id = ? ${actFilter}
               GROUP BY substr(start_date, 1, 10)
               HAVING SUM(rooka_score) >= 300
               ORDER BY act_date DESC`,
              [userId],
              (err2, rows) => res(rows || [])
            );
          });

          for (const row of dayRows) {
            const key = `day_300_${row.act_date}`;
            if (!awardedKeys.has(key)) {
              awardedKeys.add(key);
              await generateAndSaveMilestoneTitle(
                userId,
                key,
                `Single-Day Endurance Titan (${Math.round(row.day_rooka)} Rooka on ${row.act_date})`,
                `SELECT name, sport_type, distance_km, moving_time_min, rooka_score, start_date FROM activities WHERE user_id = ? AND substr(start_date, 1, 10) = ?`,
                [userId, row.act_date],
                `The athlete achieved a massive single-day milestone by earning ${Math.round(row.day_rooka)} Rooka points on ${row.act_date}!`,
                options
              );
            }
          }

          // 3. Weekly 2,000+ Rooka Milestones
          const weekRows = await new Promise((res) => {
            db.all(
              `SELECT strftime('%Y-W%W', start_date) as act_week, SUM(rooka_score) as week_rooka, COUNT(id) as count
               FROM activities
               WHERE user_id = ? ${weekFilter}
               GROUP BY strftime('%Y-W%W', start_date)
               HAVING SUM(rooka_score) >= 2000
               ORDER BY act_week DESC`,
              [userId],
              (err2, rows) => res(rows || [])
            );
          });

          for (const row of weekRows) {
            const key = `week_2000_${row.act_week}`;
            if (!awardedKeys.has(key)) {
              awardedKeys.add(key);
              await generateAndSaveMilestoneTitle(
                userId,
                key,
                `Weekly Volume Crusher (2,000+ Rooka in Week ${row.act_week}: ${Math.round(row.week_rooka)} pts)`,
                `SELECT name, sport_type, distance_km, moving_time_min, rooka_score, start_date FROM activities WHERE user_id = ? AND strftime('%Y-W%W', start_date) = ?`,
                [userId, row.act_week],
                `The athlete completed a powerhouse training week, accumulating ${Math.round(row.week_rooka)} Rooka points in week ${row.act_week}!`,
                options
              );
            }
          }

          // 4. Monthly 6,000+ Rooka Milestones
          const monthRows = await new Promise((res) => {
            db.all(
              `SELECT substr(start_date, 1, 7) as act_month, SUM(rooka_score) as month_rooka, COUNT(id) as count
               FROM activities
               WHERE user_id = ? ${monthFilter}
               GROUP BY substr(start_date, 1, 7)
               HAVING SUM(rooka_score) >= 6000
               ORDER BY act_month DESC`,
              [userId],
              (err2, rows) => res(rows || [])
            );
          });

          for (const row of monthRows) {
            const key = `month_6000_${row.act_month}`;
            if (!awardedKeys.has(key)) {
              awardedKeys.add(key);
              await generateAndSaveMilestoneTitle(
                userId,
                key,
                `Monthly Legend (6,000+ Rooka in ${row.act_month}: ${Math.round(row.month_rooka)} pts)`,
                `SELECT name, sport_type, distance_km, moving_time_min, rooka_score, start_date FROM activities WHERE user_id = ? AND substr(start_date, 1, 7) = ?`,
                [userId, row.act_month],
                `The athlete achieved legendary monthly consistency, amassing ${Math.round(row.month_rooka)} Rooka points during ${row.act_month}!`,
                options
              );
            }
          }

          // 5. Half Ironman / 70.3 Milestone
          const halfIronmanRows = await new Promise((res) => {
            db.all(
              `SELECT id, name, sport_type, distance_km, moving_time_min, rooka_score, start_date
               FROM activities
               WHERE user_id = ? ${actFilter}
                 AND (
                   lower(name) LIKE '%70.3%'
                   OR lower(name) LIKE '%half iron%'
                   OR lower(name) LIKE '%half-iron%'
                   OR lower(name) LIKE '%half im%'
                   OR lower(name) LIKE '%half-im%'
                   OR lower(name) LIKE '%middle distance%'
                   OR lower(name) LIKE '%half triathlon%'
                   OR (lower(name) LIKE '%triathlon%' AND (distance_km >= 50 OR moving_time_min >= 180))
                   OR (sport_type IN ('Ride', 'Run') AND distance_km >= 85 AND moving_time_min >= 150)
                   OR (moving_time_min >= 240 AND distance_km >= 60)
                 )
               ORDER BY start_date DESC`,
              [userId],
              (err4, rows) => res(rows || [])
            );
          });

          for (const row of halfIronmanRows) {
            const key = `half_ironman_${row.id}`;
            if (!awardedKeys.has(key)) {
              awardedKeys.add(key);
              await generateAndSaveMilestoneTitle(
                userId,
                key,
                `Half Ironman Conqueror`,
                `SELECT name, sport_type, distance_km, moving_time_min, rooka_score, start_date FROM activities WHERE id = ?`,
                [row.id],
                `The athlete completed a tremendous Half Ironman (70.3) triathlon event ("${row.name}")!`,
                options
              );
            }
          }

          // Check for same-day Half Ironman split across multiple activities (e.g. 90k bike + 21k run)
          const sameDayTriathlonRows = await new Promise((res) => {
            db.all(
              `SELECT substr(start_date, 1, 10) as act_date,
                      SUM(distance_km) as total_distance,
                      SUM(moving_time_min) as total_moving_time,
                      COUNT(id) as act_count
               FROM activities
               WHERE user_id = ? ${actFilter}
               GROUP BY substr(start_date, 1, 10)
               HAVING (
                 SUM(CASE WHEN sport_type = 'Ride' AND distance_km >= 75 THEN 1 ELSE 0 END) >= 1
                 AND SUM(CASE WHEN sport_type = 'Run' AND distance_km >= 15 THEN 1 ELSE 0 END) >= 1
               )
               ORDER BY act_date DESC`,
              [userId],
              (errBrick, bRows) => res(bRows || [])
            );
          });

          for (const row of sameDayTriathlonRows) {
            const key = `half_ironman_day_${row.act_date}`;
            if (!awardedKeys.has(key)) {
              awardedKeys.add(key);
              await generateAndSaveMilestoneTitle(
                userId,
                key,
                `Half Ironman Conqueror`,
                `SELECT name, sport_type, distance_km, moving_time_min, rooka_score, start_date FROM activities WHERE user_id = ? AND substr(start_date, 1, 10) = ?`,
                [userId, row.act_date],
                `The athlete completed a full Half Ironman (70.3) distance on ${row.act_date} (${parseFloat(row.total_distance).toFixed(1)}km total across disciplines)!`,
                options
              );
            }
          }

          // 6. Full Ironman / 140.6 Milestone
          const fullIronmanRows = await new Promise((res) => {
            db.all(
              `SELECT id, name, sport_type, distance_km, moving_time_min, rooka_score, start_date
               FROM activities
               WHERE user_id = ? ${actFilter}
                 AND (
                   lower(name) LIKE '%140.6%'
                   OR (lower(name) LIKE '%ironman%' AND lower(name) NOT LIKE '%70.3%' AND lower(name) NOT LIKE '%half%')
                   OR (sport_type = 'Ride' AND distance_km >= 170)
                 )
               ORDER BY start_date DESC`,
              [userId],
              (err5, rows) => res(rows || [])
            );
          });

          for (const row of fullIronmanRows) {
            const key = `full_ironman_${row.id}`;
            if (!awardedKeys.has(key)) {
              awardedKeys.add(key);
              await generateAndSaveMilestoneTitle(
                userId,
                key,
                `Ironman Sovereign`,
                `SELECT name, sport_type, distance_km, moving_time_min, rooka_score, start_date FROM activities WHERE id = ?`,
                [row.id],
                `The athlete conquered an epic full Ironman (140.6) distance triathlon ("${row.name}")!`,
                options
              );
            }
          }

          // 7. Marathon Milestone (42.2k)
          const marathonRows = await new Promise((res) => {
            db.all(
              `SELECT id, name, sport_type, distance_km, moving_time_min, rooka_score, start_date
               FROM activities
               WHERE user_id = ? AND sport_type = 'Run' ${actFilter}
                 AND (distance_km >= 40.0 OR (lower(name) LIKE '%marathon%' AND lower(name) NOT LIKE '%half%'))
               ORDER BY start_date DESC`,
              [userId],
              (err6, rows) => res(rows || [])
            );
          });

          for (const row of marathonRows) {
            const key = `marathon_${row.id}`;
            if (!awardedKeys.has(key)) {
              awardedKeys.add(key);
              await generateAndSaveMilestoneTitle(
                userId,
                key,
                `Marathon Conqueror`,
                `SELECT name, sport_type, distance_km, moving_time_min, rooka_score, start_date FROM activities WHERE id = ?`,
                [row.id],
                `The athlete finished a grueling Marathon distance run ("${row.name}" - ${parseFloat(row.distance_km).toFixed(1)}km)!`,
                options
              );
            }
          }

          // 8. Century Ride Milestone (100km / 100mi)
          const centuryRows = await new Promise((res) => {
            db.all(
              `SELECT id, name, sport_type, distance_km, moving_time_min, rooka_score, start_date
               FROM activities
               WHERE user_id = ? AND sport_type = 'Ride' AND distance_km >= 95.0 ${actFilter}
               ORDER BY start_date DESC`,
              [userId],
              (err7, rows) => res(rows || [])
            );
          });

          for (const row of centuryRows) {
            const key = `century_${row.id}`;
            if (!awardedKeys.has(key)) {
              awardedKeys.add(key);
              await generateAndSaveMilestoneTitle(
                userId,
                key,
                `Century Crusher`,
                `SELECT name, sport_type, distance_km, moving_time_min, rooka_score, start_date FROM activities WHERE id = ?`,
                [row.id],
                `The athlete conquered a Century ride ("${row.name}" - ${parseFloat(row.distance_km).toFixed(1)}km)!`,
                options
              );
            }
          }

          // 9. Single Day 3+ Hours Total Moving Time (>= 180 min across all activities on a single day)
          const threeHourDayRows = await new Promise((res) => {
            db.all(
              `SELECT substr(start_date, 1, 10) as act_date,
                      SUM(moving_time_min) as total_mins,
                      SUM(distance_km) as total_km,
                      COUNT(id) as act_count
               FROM activities
               WHERE user_id = ? ${actFilter}
               GROUP BY substr(start_date, 1, 10)
               HAVING SUM(moving_time_min) >= 180
               ORDER BY act_date DESC`,
              [userId],
              (err3h, rows) => res(rows || [])
            );
          });

          for (const row of threeHourDayRows) {
            const key = `session_3h_${row.act_date}`;
            if (!awardedKeys.has(key)) {
              awardedKeys.add(key);
              const hoursVal = (row.total_mins / 60).toFixed(1);
              await generateAndSaveMilestoneTitle(
                userId,
                key,
                `Triple-Hour Engine (${hoursVal}h on ${row.act_date})`,
                `SELECT name, sport_type, distance_km, moving_time_min, rooka_score, start_date FROM activities WHERE user_id = ? AND substr(start_date, 1, 10) = ?`,
                [userId, row.act_date],
                `The athlete logged a massive ${hoursVal} hours (${Math.round(row.total_mins)} minutes) of total moving time on ${row.act_date} across ${row.act_count} workout(s) (${parseFloat(row.total_km || 0).toFixed(1)}km total)!`,
                options
              );
            }
          }

          // 10. Goal Race Day Completed & Target Met (from milestones or users.target_event)
          const raceGoals = await new Promise((res) => {
            const raceFilter = isRealtime ? " AND (date >= date('now', '-1 day') AND date <= date('now', '+1 day')) " : "";
            db.all(
              `SELECT id, name, date, target_ctl, is_main, goal_type, target_mode, target_value
               FROM milestones
               WHERE user_id = ? AND (goal_type = 'race' OR goal_type IS NULL) AND date IS NOT NULL AND date != '' ${raceFilter}
               ORDER BY date DESC`,
              [userId],
              (errM, mRows) => {
                const list = mRows || [];
                db.get(
                  `SELECT target_event, event_date FROM users WHERE id = ? AND event_date IS NOT NULL AND event_date != ''`,
                  [userId],
                  (errU, uGoal) => {
                    if (uGoal && uGoal.target_event && !list.some((m) => m.name === uGoal.target_event && m.date === uGoal.event_date)) {
                      list.push({
                        id: 'user_target_event',
                        name: uGoal.target_event,
                        date: uGoal.event_date,
                        is_main: 1,
                        goal_type: 'race',
                        target_mode: 'finish',
                        target_value: '',
                      });
                    }
                    res(list);
                  }
                );
              }
            );
          });

          for (const goal of raceGoals) {
            const raceDate = (goal.date || '').substring(0, 10);
            if (!raceDate) continue;

            const goalKey = `race_goal_${goal.id || 'race'}_${raceDate}`;
            if (awardedKeys.has(goalKey)) continue;

            // Fetch activities on that race day (+/- 1 day to account for timezones / weekend race logging)
            const raceActivities = await new Promise((resActs) => {
              db.all(
                `SELECT id, name, sport_type, distance_km, moving_time_min, rooka_score, start_date
                 FROM activities
                 WHERE user_id = ?
                   AND (
                     substr(start_date, 1, 10) = ?
                     OR substr(start_date, 1, 10) = date(?, '-1 day')
                     OR substr(start_date, 1, 10) = date(?, '+1 day')
                   )
                 ORDER BY start_date ASC`,
                [userId, raceDate, raceDate, raceDate],
                (errA, aRows) => resActs(aRows || [])
              );
            });

            if (raceActivities.length === 0) continue;

            let totalMins = 0;
            let totalKm = 0;
            let maxKm = 0;
            for (const a of raceActivities) {
              totalMins += a.moving_time_min || 0;
              totalKm += a.distance_km || 0;
              if ((a.distance_km || 0) > maxKm) maxKm = a.distance_km || 0;
            }

            const targetMode = (goal.target_mode || 'finish').toLowerCase();
            const targetVal = (goal.target_value || '').trim();
            let targetMet = false;
            let successReason = '';

            const expectedKm = parseTargetDistanceKm(targetVal, goal.name);
            const targetMins = parseTargetTimeToMinutes(targetVal, goal.name);

            if (targetMode === 'time' && targetMins) {
              const timeMet = totalMins <= (targetMins * 1.02);
              const distanceFinished = !expectedKm || totalKm >= (expectedKm * 0.85) || maxKm >= (expectedKm * 0.85);

              if (timeMet && distanceFinished) {
                targetMet = true;
                successReason = `Smashed the time goal of ${targetVal} with an official time of ${(totalMins / 60).toFixed(2)}h (${Math.round(totalMins)} min)!`;
              } else if (distanceFinished && totalMins >= 20) {
                targetMet = true;
                successReason = `Conquered the race distance (${totalKm.toFixed(1)}km in ${(totalMins / 60).toFixed(2)}h), completing goal event "${goal.name}"!`;
              }
            } else if (targetMode === 'distance' && expectedKm) {
              if (totalKm >= (expectedKm * 0.85) || maxKm >= (expectedKm * 0.85)) {
                targetMet = true;
                successReason = `Hit the target distance with ${totalKm.toFixed(1)}km completed on race day!`;
              }
            } else {
              // 'finish' target mode (or default)
              if (expectedKm) {
                if (totalKm >= (expectedKm * 0.80) || maxKm >= (expectedKm * 0.80) || totalMins >= 90) {
                  targetMet = true;
                  successReason = `Officially finished the race: ${totalKm.toFixed(1)}km completed in ${(totalMins / 60).toFixed(1)}h on race day!`;
                }
              } else if (totalMins >= 25 || totalKm >= 3.0) {
                targetMet = true;
                successReason = `Officially finished the scheduled goal race on ${raceDate} (${totalKm.toFixed(1)}km, ${Math.round(totalMins)} min)!`;
              }
            }

            if (targetMet) {
              awardedKeys.add(goalKey);
              const fallbackTitle = targetMode === 'time' && targetMins && totalMins <= (targetMins * 1.02)
                ? `${goal.name} Target Smasher`
                : `${goal.name} Finisher`;

              await generateAndSaveMilestoneTitle(
                userId,
                goalKey,
                fallbackTitle,
                `SELECT name, sport_type, distance_km, moving_time_min, rooka_score, start_date
                 FROM activities
                 WHERE user_id = ? AND (
                   substr(start_date, 1, 10) = ?
                   OR substr(start_date, 1, 10) = date(?, '-1 day')
                   OR substr(start_date, 1, 10) = date(?, '+1 day')
                 )`,
                [userId, raceDate, raceDate, raceDate],
                `The athlete accomplished their official scheduled goal race "${goal.name}" on ${raceDate}! Target: ${targetVal || 'Finish the race'}. Result: ${successReason}`,
                options
              );
            }
          }

          // 11. Standard "Rooka+ Athlete" title if user has no titles yet
          const realMilestones = Array.from(awardedKeys).filter((k) => k !== 'default_rooka_plus');
          if (realMilestones.length === 0 && !awardedKeys.has('default_rooka_plus')) {
            await new Promise((resDef) => {
              db.run(
                `INSERT OR IGNORE INTO user_titles (user_id, title, description, is_active, milestone_key) VALUES (?, ?, ?, 1, 'default_rooka_plus')`,
                [userId, 'Rooka+ Athlete', 'Official member of the Rooka+ endurance squad.'],
                () => resDef()
              );
            });
            awardedKeys.add('default_rooka_plus');
          }

          resolve();
        }
      );
    });
  });
}

/**
 * Ensures an athlete has at most maxTitles (default 5) in user_titles.
 * If there are > maxTitles, deletes the oldest unequipped title(s).
 * The equipped title (is_active = 1) is ALWAYS protected and never deleted.
 */
function enforceMaxUserTitles(userId, maxTitles = 5) {
  return new Promise((resolve) => {
    db.all(
      `SELECT id, is_active, datetime(created_at) as created_time 
       FROM user_titles 
       WHERE user_id = ? 
       ORDER BY is_active DESC, datetime(created_at) DESC, id DESC`,
      [userId],
      (err, rows) => {
        if (err || !rows || rows.length <= maxTitles) {
          return resolve();
        }

        const equippedRow = rows.find((r) => r.is_active === 1);
        const unequippedRows = rows.filter((r) => r.is_active !== 1);

        // How many unequipped titles can be retained while keeping the equipped title safe
        const allowedUnequippedCount = equippedRow ? Math.max(0, maxTitles - 1) : maxTitles;

        // unequippedRows are sorted newest to oldest, so excess oldest unequipped are sliced from allowedUnequippedCount
        const toDelete = unequippedRows.slice(allowedUnequippedCount);

        if (toDelete.length === 0) {
          return resolve();
        }

        // Preserve milestone history of all pruned titles so they are never re-evaluated
        for (const r of rows) {
          if (r.milestone_key) {
            db.run(
              `INSERT OR IGNORE INTO user_milestone_history (user_id, milestone_key) VALUES (?, ?)`,
              [userId, r.milestone_key]
            );
          }
        }

        const deleteIds = toDelete.map((r) => r.id);
        const placeholders = deleteIds.map(() => '?').join(',');

        db.run(
          `DELETE FROM user_titles WHERE id IN (${placeholders}) AND user_id = ? AND is_active != 1`,
          [...deleteIds, userId],
          (errDel) => {
            if (errDel) {
              console.error(`Error enforcing max titles for user ${userId}:`, errDel);
            } else {
              console.log(`Cleaned up ${deleteIds.length} old unequipped title(s) for user ${userId} to enforce max ${maxTitles} titles.`);
            }
            resolve();
          }
        );
      }
    );
  });
}

/**
 * Sweeps all users who have > maxTitles in user_titles and cleans them up.
 */
async function enforceMaxTitlesForAllUsers(maxTitles = 5) {
  return new Promise((resolve) => {
    db.all(
      `SELECT user_id, COUNT(*) as cnt FROM user_titles GROUP BY user_id HAVING COUNT(*) > ?`,
      [maxTitles],
      async (err, rows) => {
        if (!err && rows && rows.length > 0) {
          console.log(`🧹 Enforcing max ${maxTitles} titles for ${rows.length} athlete(s)...`);
          for (const row of rows) {
            await enforceMaxUserTitles(row.user_id, maxTitles);
          }
        }
        resolve();
      }
    );
  });
}

function saveMilestoneTitleRecord(userId, milestoneKey, title, description, resolve) {
  db.get(
    `SELECT id, milestone_key FROM user_titles WHERE user_id = ? AND is_active = 1 LIMIT 1`,
    [userId],
    (errActive, activeRow) => {
      // If no active title or only default Rooka+ Athlete is active, equip this new earned title
      const isDefaultActive = activeRow?.milestone_key === 'default_rooka_plus';
      const shouldBeActive = !activeRow || isDefaultActive ? 1 : 0;

      if (isDefaultActive && activeRow?.id) {
        db.run(`UPDATE user_titles SET is_active = 0 WHERE id = ?`, [activeRow.id]);
      }

      db.run(
        `INSERT INTO user_titles (user_id, title, description, is_active, milestone_key) VALUES (?, ?, ?, ?, ?)`,
        [userId, title, description, shouldBeActive, milestoneKey],
        async function (errInsert) {
          if (errInsert) {
            console.error("Error saving earned milestone title:", errInsert);
            return resolve();
          }

          if (milestoneKey) {
            db.run(
              `INSERT OR IGNORE INTO user_milestone_history (user_id, milestone_key) VALUES (?, ?)`,
              [userId, milestoneKey]
            );
          }

          // Enforce maximum 5 titles: delete oldest unequipped titles if > 5
          await enforceMaxUserTitles(userId, 5);

          // Award 50 bonus Rooka points for earning a milestone title (only if not already awarded)
          db.get(
            `SELECT id FROM bonus_points WHERE user_id = ? AND reason = ? LIMIT 1`,
            [userId, `Earned Milestone Title: ${title}`],
            (errBP, bpRow) => {
              if (!bpRow) {
                db.run(
                  `INSERT INTO bonus_points (user_id, amount, reason) VALUES (?, ?, ?)`,
                  [userId, 50, `Earned Milestone Title: ${title}`]
                );
              }
            }
          );

          // Clear public profile cache so changes reflect on social profile
          db.run(`DELETE FROM public_profile_cache WHERE user_id = ?`, [userId]);

          // Send SSE event if user is active
          try {
            const { sendSSEEvent } = require('./sse');
            sendSSEEvent(userId, "title_unlocked", {
              title: title,
              description: description,
              milestone: milestoneKey
            });
          } catch (eSse) {}

          resolve();
        }
      );
    }
  );
}

async function generateAndSaveMilestoneTitle(userId, milestoneKey, milestoneName, activitiesQuery, queryParams, milestoneContext, options = {}) {
  return new Promise((resolve) => {
    const fallbackTitle = milestoneName.split("(")[0].trim();
    const fallbackDescription = milestoneContext;

    // ONLY use AI for realtime achievements. Historic or background checks award titles statically with 0 AI calls
    if (!options || !options.isRealtime) {
      return saveMilestoneTitleRecord(userId, milestoneKey, fallbackTitle, fallbackDescription, resolve);
    }

    db.all(activitiesQuery, queryParams, async (err, activities) => {
      if (err || !activities || activities.length === 0) {
        return saveMilestoneTitleRecord(userId, milestoneKey, fallbackTitle, fallbackDescription, resolve);
      }

      const activitiesStr = activities
        .map(
          (a) =>
            `- ${a.start_date}: ${a.name} (${a.sport_type}) | ${parseFloat(a.distance_km || 0).toFixed(1)}km | ${Math.round(a.moving_time_min || 0)}min | ${Math.round(a.rooka_score || 0)} Rooka`
        )
        .join("\n");

      const prompt = `Based on the following activities contributing to an athlete milestone, invent an earned, badass, heroic, or funny custom Title/Badge (e.g. 'Century Slayer', 'Relentless Engine', 'Iron Sovereign', 'Peak Performance Protocol') and a brief description celebrating what they achieved.
${milestoneContext}

Contributing activities:
${activitiesStr}

Please respond using this JSON schema:
{
  "title": "The Title Name",
  "description": "A short, earned description of why they unlocked this milestone."
}`;

      let titleData = null;
      try {
        const aiReply = await generateWithFallback(
          prompt,
          "You are a sports gamification engine awarding earned athletic titles.",
          null,
          null,
          userId,
          "common",
          true
        );
        titleData = typeof aiReply === 'string' ? JSON.parse(aiReply) : aiReply;
      } catch (eAi) {
        console.error("AI title generation error, using fallback title:", eAi?.message || eAi);
      }

      const finalTitle = (titleData && titleData.title) ? titleData.title : fallbackTitle;
      const finalDesc = (titleData && titleData.description) ? titleData.description : fallbackDescription;

      saveMilestoneTitleRecord(userId, milestoneKey, finalTitle, finalDesc, resolve);
    });
  });
}

function triggerLevelUpCoachPrompt(userId, newLevel) {
  // Stats since the athlete joined Rooka, not all-time.
  //
  // A level is earned from Rooka scored on or after `rooka_start_date`, but this
  // query had no such filter, so it summed the entire imported Strava history.
  // The coach then congratulated a Level 3 — a couple of hundred points — with
  // "over 1,000km on the bike and 82 runs", numbers the athlete never earned a
  // single point for. Same window as the score, or the message describes a
  // different athlete than the one being levelled up.
  db.get(
    `SELECT substr(rooka_start_date, 1, 10) as start_day FROM users WHERE id = ?`,
    [userId],
    (startErr, startRow) => {
      const startDay = startRow && startRow.start_day ? startRow.start_day : null;
      const statsQuery = startDay
        ? `SELECT sport_type, SUM(distance_km) as total_dist, COUNT(id) as count FROM activities WHERE user_id = ? AND substr(start_date, 1, 10) >= ? GROUP BY sport_type`
        : `SELECT sport_type, SUM(distance_km) as total_dist, COUNT(id) as count FROM activities WHERE user_id = ? GROUP BY sport_type`;
      const statsParams = startDay ? [userId, startDay] : [userId];

      db.all(statsQuery, statsParams, (err, rows) => {
      if (err) return;

      let statsStr = (rows || [])
        .map(
          (r) =>
            `${r.sport_type}: ${Math.round(r.total_dist)}km (${r.count} sessions)`,
        )
        .join(", ");
      if (!statsStr) statsStr = "No recorded stats yet.";

      db.get(
        `SELECT coach_tone, coach_name, coach_context FROM users WHERE id = ?`,
        [userId],
        async (err, user) => {
          if (err || !user) return;

          const coachName = user.coach_name || "Rooka";
          let toneText = user.coach_tone || "Empathetic but demanding";
          if (user.coach_tone === "custom" || user.coach_tone === "Configure own coach") {
            toneText = user.coach_context ? `Custom tone: ${user.coach_context}` : "Custom coach persona";
          }
          const systemPrompt = `You are ${coachName}, an elite endurance coach. Your tone is: ${toneText}. ${user.coach_context ? `Coach Custom Context: ${user.coach_context}` : ""} Act like a real human in a continuous text message thread.`;
          const prompt = `The athlete just leveled up to Rooka Level ${newLevel}! Here is everything they have done since joining Rooka: ${statsStr}. Write a short, highly motivating congratulatory message (1-3 sentences). Acknowledge their hard work. Only reference the numbers given above — do not invent distances, counts or achievements, and do not imply they have done more than this.`;

          try {
            const aiReply = await generateWithFallback(
              prompt,
              systemPrompt,
              null,
              null,
              userId,
            );
            if (aiReply) {
              db.run(
                `INSERT INTO chat_history (user_id, role, content, mood) VALUES (?, 'coach', ?, 'hype')`,
                [userId, aiReply],
              );
              sendSSEEvent(userId, "chat_update", {
                role: "coach",
                content: aiReply,
                mood: "hype",
              });
            }
          } catch (e) {
            console.error("Failed to generate level up message", e);
          }
        },
      );
      });
    },
  );
}

async function generateQuestForUser(userId, poolType = "personal", previousQuest = null) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT subscription_tier FROM users WHERE id = ?`,
      [userId],
      (userErr, userRow) => {
        if (!canAccessQuests(userRow && userRow.subscription_tier)) {
          return resolve(null);
        }

        db.all(
          `SELECT name, sport_type, distance_km, moving_time_min, rooka_score, start_date FROM activities WHERE user_id = ? ORDER BY start_date DESC LIMIT 5`,
          [userId],
          async (err, recentActivities) => {
        if (!recentActivities || recentActivities.length === 0) {
          const initialQuest = {
            description: "Log your first activity",
            target_metric: "activity_count",
            target_value: 1,
            target_sport: "Any",
            is_accumulative: false,
            reward_points: 50,
            time_limit_days: 7,
          };
          const nowIso = new Date().toISOString().replace("T", " ").substring(0, 19);
          return db.run(
            `INSERT INTO user_quests (user_id, description, target_metric, target_value, target_sport, is_accumulative, reward_points, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+7 days'))`,
            [
              userId,
              initialQuest.description,
              initialQuest.target_metric,
              initialQuest.target_value,
              initialQuest.target_sport,
              0,
              initialQuest.reward_points,
              nowIso,
            ],
            function (errInsert) {
              if (errInsert) return reject(errInsert);
              resolve({
                id: this.lastID,
                user_id: userId,
                status: 'active',
                current_value: 0,
                created_at: nowIso,
                ...initialQuest,
              });
            }
          );
        }

        const activitiesStr = recentActivities
          .map(
            (a) =>
              `- ${a.start_date}: ${a.name} (${a.sport_type}) | ${parseFloat(a.distance_km).toFixed(1)}km | ${Math.round(a.moving_time_min)}min`,
          )
          .join("\n");

        const prompt = `Based on the following recent activities of the user, generate a personalized, motivating micro-challenge (Quest) for them to complete in the next 1 to 7 days. 
            Recent activities:
            ${activitiesStr}
            
            Please respond using this JSON schema:
            {
            "description": "Short description of the quest (e.g. Run 5k this weekend, or Complete 15km total biking and running over 3 days)",
            "target_metric": "distance_km", // OR "moving_time_min", "rooka_score", or "unique_sports"
            "target_value": 5,
            "target_sport": "Run, Ride", // Comma-separated list of required sports (e.g. Run, Ride, Swim) or 'Any'
            "is_accumulative": false, // Set to true if the goal should sum across multiple activities, false if it must be done in one activity
            "reward_points": 50, // Keep it between 10 and 100
            "time_limit_days": 3 // Number of days to complete the quest (between 1 and 7)
            }`;

        try {
          const aiReply = await generateWithFallback(
            prompt,
            "You are an AI quest generator.",
            null,
            null,
            userId,
            poolType,
            true
          );
          const questData = JSON.parse(aiReply);
          const daysLimit = Math.max(1, Math.min(7, parseInt(questData.time_limit_days) || 3));
          const nowIso = new Date().toISOString().replace("T", " ").substring(0, 19);
          db.run(
            `INSERT INTO user_quests (user_id, description, target_metric, target_value, target_sport, is_accumulative, reward_points, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' days'))`,
            [
              userId,
              questData.description,
              questData.target_metric,
              questData.target_value,
              questData.target_sport || "Any",
              questData.is_accumulative ? 1 : 0,
              questData.reward_points,
              nowIso,
              daysLimit,
            ],
            function (err) {
              if (err) return reject(err);
              resolve({
                id: this.lastID,
                user_id: userId,
                status: 'active',
                current_value: 0,
                created_at: nowIso,
                ...questData,
              });
            },
          );
        } catch (e) {
          console.error("Failed to generate quest via AI, using fallback template:", e);
          const fallbackQuest = {
            description: "Log 10km total distance over the next 3 days",
            target_metric: "distance_km",
            target_value: 10,
            target_sport: "Any",
            is_accumulative: true,
            reward_points: 50,
          };
          const nowIso = new Date().toISOString().replace("T", " ").substring(0, 19);
          db.run(
            `INSERT INTO user_quests (user_id, description, target_metric, target_value, target_sport, is_accumulative, reward_points, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+3 days'))`,
            [
              userId,
              fallbackQuest.description,
              fallbackQuest.target_metric,
              fallbackQuest.target_value,
              fallbackQuest.target_sport,
              1,
              fallbackQuest.reward_points,
              nowIso,
            ],
            function (errInsert) {
              if (errInsert) {
                console.error("Fallback quest DB insert error:", errInsert);
                return resolve(null);
              }
              resolve({
                id: this.lastID,
                user_id: userId,
                status: 'active',
                current_value: 0,
                created_at: nowIso,
                ...fallbackQuest,
              });
            }
          );
        }
      },
    );
      },
    );
  });
}

function matchesSport(activitySport, targetSportStr) {
  if (!targetSportStr || targetSportStr.trim() === "" || targetSportStr.toLowerCase() === "any" || targetSportStr.toLowerCase() === "all") {
    return true;
  }
  if (!activitySport) return false;
  
  const actSport = activitySport.toLowerCase().replace(/[_\s-]/g, "");
  const targetTokens = targetSportStr
    .toLowerCase()
    .split(/[,/|]+/)
    .map((s) => s.trim().replace(/[_\s-]/g, ""))
    .filter(Boolean);
  
  if (targetTokens.includes("any") || targetTokens.includes("all")) {
    return true;
  }

  for (const token of targetTokens) {
    if (token === actSport) return true;
    // Cycling / Ride
    if (["ride", "bike", "cycling", "virtualride", "ebikeride", "mountainbikeride", "gravelride"].includes(token)) {
      if (["ride", "bike", "cycling", "virtualride", "ebikeride", "mountainbikeride", "gravelride", "indoorcycling", "handcycle"].includes(actSport)) return true;
    }
    // Running
    if (["run", "running", "virtualrun", "trailrun", "treadmill"].includes(token)) {
      if (["run", "running", "virtualrun", "trailrun", "treadmill"].includes(actSport)) return true;
    }
    // Swimming
    if (["swim", "swimming", "openwaterswim", "poolswim"].includes(token)) {
      if (["swim", "swimming", "openwaterswim", "poolswim"].includes(actSport)) return true;
    }
    // Strength / Gym / Weights / Workout
    if (["strength", "weights", "weighttraining", "weightlifting", "gym", "workout", "crossfit", "hiit", "barbell"].includes(token)) {
      if (["strength", "weights", "weighttraining", "weightlifting", "gym", "workout", "crossfit", "hiit", "barbell", "pilates", "yoga", "mobility"].includes(actSport)) return true;
    }
    // Walking / Hiking
    if (["walk", "walking", "hike", "hiking"].includes(token)) {
      if (["walk", "walking", "hike", "hiking"].includes(actSport)) return true;
    }
    if (actSport.includes(token) || token.includes(actSport)) return true;
  }
  return false;
}

function parseDateToTimestamp(dateStr) {
  if (!dateStr) return 0;
  const s = String(dateStr).trim();
  const iso = s.includes("T") ? s : s.replace(" ", "T");
  if (!iso.includes("Z") && !iso.includes("+") && !iso.slice(10).includes("-")) {
    return new Date(iso + "Z").getTime();
  }
  return new Date(iso).getTime();
}

function computeQuestProgressValue(quest, activities) {
  if (!quest) return 0;
  const createdTs = parseDateToTimestamp(quest.created_at);
  const cutoff = quest.completed_at || quest.expires_at;
  const cutoffTs = cutoff ? parseDateToTimestamp(cutoff) : null;

  // Filter activities matching time and sport (allow a 5-minute leeway before created_at for sync tolerances)
  const matchingActivities = (activities || []).filter((a) => {
    if (!a.start_date) return false;
    const actTs = parseDateToTimestamp(a.start_date);
    if (createdTs && actTs < (createdTs - 300000)) return false;
    if (cutoffTs && actTs > cutoffTs) return false;
    return matchesSport(a.sport_type, quest.target_sport);
  });

  let val = 0;
  const targetMetric = (quest.target_metric || "").toLowerCase();

  if (targetMetric === "unique_sports") {
    const unique = new Set(
      matchingActivities
        .map((a) => (a.sport_type || "").toLowerCase().trim())
        .filter(Boolean),
    );
    val = unique.size;
  } else if (
    ["activity_count", "workout_count", "sessions", "activities", "workouts"].includes(targetMetric)
  ) {
    val = matchingActivities.length;
  } else {
    const metricCol = ["moving_time_min", "rooka_score", "distance_km"].includes(targetMetric)
      ? targetMetric
      : "distance_km";

    const isAccum = Boolean(quest.is_accumulative) ||
      /\b(total|combined|over\s+\d+|across|accumulate|sum)\b/i.test(quest.description || "");

    if (isAccum) {
      val = matchingActivities.reduce((sum, a) => sum + (parseFloat(a[metricCol]) || 0), 0);
    } else {
      val = matchingActivities.reduce((max, a) => Math.max(max, parseFloat(a[metricCol]) || 0), 0);
    }
  }

  return Math.round(val * 100) / 100;
}

function isQuestMet(currentVal, targetVal) {
  const v = parseFloat(currentVal) || 0;
  const t = parseFloat(targetVal) || 0;
  if (t <= 0) return false;
  if (v >= t) return true;
  // Account for floating point precision, GPS inaccuracy, and UI rounding (Math.round):
  // 1) 99% or more of target reached
  if ((v / t) >= 0.99) return true;
  // 2) UI rounded value matches target and remaining diff is <= 0.25 units
  if (Math.round(v) >= Math.round(t) && (t - v) <= 0.25) return true;
  return false;
}

async function completeQuest(userId, quest, completedAt) {
  const compDate = completedAt || new Date().toISOString().replace("T", " ").substring(0, 19);
  quest.status = "completed";
  quest.completed_at = compDate;
  quest.justCompleted = true;

  // 1. Award bonus points (idempotent check by user_id and description)
  await new Promise((resolve) => {
    db.get(
      `SELECT id FROM bonus_points WHERE user_id = ? AND reason = ? LIMIT 1`,
      [userId, `Quest Completed: ${quest.description}`],
      (err, existing) => {
        if (!existing) {
          db.run(
            `INSERT INTO bonus_points (user_id, amount, reason) VALUES (?, ?, ?)`,
            [userId, quest.reward_points || 50, `Quest Completed: ${quest.description}`],
            () => resolve()
          );
        } else {
          resolve();
        }
      }
    );
  });

  // 2. Update user_quests record
  await new Promise((resolve) => {
    db.run(
      `UPDATE user_quests SET status = 'completed', completed_at = ? WHERE id = ?`,
      [compDate, quest.id],
      () => resolve()
    );
  });

  // 3. Immediately re-sync user's total rooka and level
  try {
    updateUserRookaAndCheckLevel(userId);
  } catch (err) {
    console.error("Error updating user rooka on quest completion:", err);
  }

  // 4. Send SSE events
  sendSSEEvent(userId, "quest_completed", {
    questId: quest.id,
    reward_points: quest.reward_points,
    description: quest.description,
  });
  sendSSEEvent(userId, "quest_updated", {});
}

async function evaluateAndProgressQuests(userId) {
  // Check subscription tier first: free/downgraded users must NEVER have active quests
  const userRow = await new Promise((resolve) => {
    db.get(
      `SELECT subscription_tier FROM users WHERE id = ?`,
      [userId],
      (err, row) => resolve(row),
    );
  });

  if (!canAccessQuests(userRow && userRow.subscription_tier)) {
    // Purge any active quests for this user
    await new Promise((resolve) => {
      db.run(
        `UPDATE user_quests SET status = 'closed' WHERE user_id = ? AND status = 'active'`,
        [userId],
        () => resolve(),
      );
    });
    return [];
  }

  // Ensure existing active quests without expires_at get a default expiration date
  await new Promise((resolve) => {
    db.run(
      `UPDATE user_quests SET expires_at = datetime(created_at, '+3 days') WHERE user_id = ? AND expires_at IS NULL AND status = 'active'`,
      [userId],
      () => resolve(),
    );
  });

  const quests = await new Promise((resolve) => {
    db.all(
      `SELECT * FROM user_quests WHERE user_id = ? ORDER BY created_at DESC`,
      [userId],
      (err, rows) => resolve(rows || []),
    );
  });

  if (quests.length === 0) {
    try {
      const newQuest = await generateQuestForUser(userId, "common");
      if (newQuest) {
        newQuest.current_value = 0;
        newQuest.progress = 0;
        return [newQuest];
      }
    } catch (e) {
      console.error("Error generating first quest in evaluateAndProgressQuests:", e);
    }
    return [];
  }

  const activities = await new Promise((resolve) => {
    db.all(
      `SELECT sport_type, distance_km, moving_time_min, rooka_score, start_date FROM activities WHERE user_id = ? ORDER BY start_date DESC`,
      [userId],
      (err, rows) => resolve(rows || []),
    );
  });

  let activeCount = 0;
  const now = Date.now();

  for (const q of quests) {
    if (q.status === "active") {
      if (activeCount >= 1) {
        // Enforce maximum of 1 active quest by voiding/closing older ones
        q.status = "closed";
        await new Promise((resolve) => {
          db.run(`UPDATE user_quests SET status = 'closed' WHERE id = ?`, [q.id], () => resolve());
        });
        continue;
      }
      
      const expiresTs = q.expires_at ? parseDateToTimestamp(q.expires_at) : null;
      if (expiresTs && now >= expiresTs) {
        q.status = "expired";
        await new Promise((resolve) => {
          db.run(`UPDATE user_quests SET status = 'expired' WHERE id = ?`, [q.id], () => resolve());
        });
        continue;
      }

      const val = computeQuestProgressValue(q, activities);
      q.current_value = val;
      q.progress = val;

      if (isQuestMet(val, q.target_value)) {
        await completeQuest(userId, q);
      } else {
        activeCount++;
      }
    } else {
      if (q.status === "completed") {
        const val = computeQuestProgressValue(q, activities);
        q.current_value = val > 0 ? val : (q.target_value || 0);
        q.progress = q.current_value;
      }
    }
  }

  // Automatically generate a new quest if no active quest remains
  if (activeCount === 0) {
    try {
      const newQuest = await generateQuestForUser(userId, "common");
      if (newQuest) {
        newQuest.current_value = 0;
        newQuest.progress = 0;
        quests.unshift(newQuest);
      }
    } catch (e) {
      console.error("Error generating replacement quest in evaluateAndProgressQuests:", e);
    }
  }

  return quests;
}

/**
 * Quests that crossed their target during *this* evaluation.
 */
async function evaluateQuestsAgainstActivity(userId, activityData) {
  const userRow = await new Promise((resolve) => {
    db.get(
      `SELECT subscription_tier FROM users WHERE id = ?`,
      [userId],
      (err, row) => resolve(row),
    );
  });
  if (!canAccessQuests(userRow && userRow.subscription_tier)) {
    return [];
  }
  const allQuests = await evaluateAndProgressQuests(userId);
  return allQuests.filter((q) => q.justCompleted);
}

async function calculateQuestProgress(userId, quest) {
  const activities = await new Promise((resolve) => {
    db.all(
      `SELECT sport_type, distance_km, moving_time_min, rooka_score, start_date FROM activities WHERE user_id = ? ORDER BY start_date DESC`,
      [userId],
      (err, rows) => resolve(rows || []),
    );
  });
  return computeQuestProgressValue(quest, activities);
}

async function analyzeMuscleImpact(userId, activityData, rookaSport, activityDate) {
  const prompt = `The athlete completed a ${rookaSport} activity: ${activityData.name}. 
  Distance: ${(activityData.distance / 1000).toFixed(1)}km
  Time: ${Math.round(activityData.moving_time / 60)} min.
  Sets: ${activityData.sets_json ? JSON.stringify(activityData.sets_json) : "None"}
  
  Based on this, what is the training impact (stimulus) on the involved muscle groups? Output a JSON array mapping body parts to an impact score (1-100). 
  Use standard naming (e.g. "quads", "calves", "shoulders", "lower-back", "chest", "lats", "glutes", "hamstrings", "core").
  Example format:
  [{"body_part": "quads", "impact_score": 30}, {"body_part": "shoulders", "impact_score": 15}]
  `;

  const systemPrompt = `You are a sports science AI.`;

  try {
    // Import here to avoid circular dependency issues if any, though it's likely already imported
    const { generateWithFallback } = require('./ai'); 
    let result = await generateWithFallback(prompt, systemPrompt, null, null, userId, "personal", true);
    const fatigueArray = JSON.parse(result);
    
    if (Array.isArray(fatigueArray)) {
      const stmt = db.prepare(`
        INSERT INTO athlete_muscle_status (user_id, body_part, fatigue_score, development_score) 
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, body_part) DO UPDATE SET 
          fatigue_score = fatigue_score + excluded.fatigue_score,
          development_score = development_score + excluded.development_score,
          last_updated = CURRENT_TIMESTAMP
      `);
      fatigueArray.forEach(f => {
        // Fallback to f.fatigue_score just in case the AI uses the old format
        const score = f.impact_score || f.fatigue_score;
        if(f.body_part && score) {
          stmt.run(userId, f.body_part, score, score);
        }
      });
      stmt.finalize();
      console.log(`✅ Saved muscle impact for ${activityData.name}`);
    }
  } catch(e) {
    console.error("Failed to parse muscle impact JSON", e);
  }
}

async function runDailyRecoveryJob() {
  console.log("🌙 Running daily recovery & degradation job...");

  // 1. Muscle Status Recovery (Fatigue & Development)
  // Fatigue decays by 40% (x 0.6), Development decays by 10% (x 0.9)
  db.run(`UPDATE athlete_muscle_status SET 
            fatigue_score = fatigue_score * 0.6,
            development_score = development_score * 0.9 
          WHERE fatigue_score > 0 OR development_score > 0`, (err) => {
      if (err) console.error("Muscle status recovery error:", err);
  });

  // Delete status logs that have dropped below 1 for both to keep DB clean
  db.run(`DELETE FROM athlete_muscle_status WHERE fatigue_score < 1 AND development_score < 1`);

  // 2. Niggle Auto-Degradation
  // If an injury has been active for a multiple of 3 days, reduce severity.
  db.all(`SELECT id, user_id, body_part, severity, reported_date FROM athlete_niggles WHERE status = 'active' AND severity > 0`, async (err, niggles) => {
      if (err || !niggles) return;

      const now = new Date();
      for (const niggle of niggles) {
          const reported = new Date(niggle.reported_date);
          const diffTime = Math.abs(now - reported);
          const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

          if (diffDays > 0 && diffDays % 3 === 0) {
              const newSeverity = niggle.severity - 1;
              
              if (newSeverity <= 0) {
                  // Injury Resolved!
                  db.run(`UPDATE athlete_niggles SET severity = 0, status = 'resolved', resolved_date = CURRENT_TIMESTAMP WHERE id = ?`, [niggle.id]);
                  
                  // Notify the user via AI coach
                  db.get(`SELECT coach_tone FROM users WHERE id = ?`, [niggle.user_id], async (err, user) => {
                      const tone = user ? user.coach_tone : "Friendly";
                      const prompt = `The athlete's ${niggle.body_part} injury has automatically fully healed and been marked as resolved after ${diffDays} days. Send a proactive, encouraging message (1-2 sentences) letting them know their ${niggle.body_part} is now cleared for full activity, but they should still listen to their body. DO NOT use JSON.`;
                      const systemPrompt = `You are Rooka, an elite endurance coach. Your tone is: ${tone}. Act like a real human in a continuous text message thread.`;
                      
                      try {
                          const aiReply = await generateWithFallback(prompt, systemPrompt);
                          
                          db.run(
                              `INSERT INTO chat_history (user_id, role, content, mood) VALUES (?, 'coach', ?, 'hype')`,
                              [niggle.user_id, aiReply]
                          );
                          
                          sendSSEEvent(niggle.user_id, "unread_message", {
                              message: aiReply,
                              mood: "hype"
                          });
                      } catch(e) {
                          console.error("AI Coach Recovery message failed:", e);
                      }
                  });

              } else {
                  // Injury recovering but not resolved
                  db.run(`UPDATE athlete_niggles SET severity = ? WHERE id = ?`, [newSeverity, niggle.id]);
              }
          }
      }
  });
}

function resetDailyTokensForAllUsers() {
  const todayStr = getAMSDateString();
  db.run(
    `UPDATE users SET 
       daily_token_usage = 0, 
       common_token_usage = 0, 
       last_token_reset_date = ?, 
       daily_token_limit = CASE WHEN subscription_tier = 'rooka_plus' THEN 50000 ELSE 5000 END
     WHERE last_token_reset_date != ? OR last_token_reset_date IS NULL`,
    [todayStr, todayStr],
    function (err) {
      if (err) {
        console.error("❌ Error running daily token reset:", err);
      } else if (this.changes > 0) {
        console.log(`🪙 Successfully reset tokens for ${this.changes} inactive/due user(s) for date: ${todayStr}`);
      }
    },
  );
}

function resetDailyNutritionForAllUsers() {
  const todayStr = getAMSDateString();
  console.log(`🥗 Daily midnight nutrition reset executed for AMS date: ${todayStr}`);
}

function getEffectiveTokenLimit(user) {
  let expectedLimit = 5000;
  if (user.subscription_tier === 'subscription' || user.subscription_tier === 'rooka_plus') expectedLimit = 50000;
  else if (user.subscription_tier === 'premium') expectedLimit = 100000;
  else if (user.subscription_tier === 'admin') expectedLimit = 500000;

  let dbLimit = user.daily_token_limit || 0;
  if (dbLimit === 50000 && expectedLimit === 5000) dbLimit = 5000; // Handle old logic downgrade
  if (dbLimit < expectedLimit || dbLimit === 5000 || dbLimit === 50000) {
    return expectedLimit;
  }
  return dbLimit;
}

function extractAndCleanFoodItems(data) {
  if (!data) return [];
  let rawList = [];
  if (Array.isArray(data.items)) {
    rawList = data.items.map((item) =>
      typeof item === 'object' && item ? item.name || item.item || item.summary || '' : String(item || '')
    );
  } else if (typeof data.items === 'string' && data.items.trim()) {
    rawList = [data.items];
  } else if (typeof data.summary === 'string' && data.summary.trim()) {
    rawList = [data.summary];
  } else if (typeof data.description === 'string' && data.description.trim()) {
    rawList = [data.description];
  } else if (typeof data.food === 'string' && data.food.trim()) {
    rawList = [data.food];
  } else if (typeof data.item === 'string' && data.item.trim()) {
    rawList = [data.item];
  }

  const splitItems = [];
  for (const raw of rawList) {
    if (!raw || typeof raw !== 'string') continue;
    // Split by comma
    const commaParts = raw.split(/,\s*/);
    for (const part of commaParts) {
      // Split by " and " / " plus " if it separates distinct items (e.g. "pizza and a shake")
      const andParts = part.split(/\s+(?:and|plus)\s+(?:a\s+|an\s+|the\s+|another\s+)?/i);
      for (const p of andParts) {
        splitItems.push(p);
      }
    }
  }

  const cleanedItems = [];
  for (let str of splitItems) {
    str = (str || '').trim();
    if (!str) continue;

    // Strip leading conversational prefixes
    str = str
      .replace(
        /^(and\s+besides\s+that\s+|besides\s+that\s+|and\s+also\s+had\s+|also\s+had\s+|and\s+also\s+|and\s+a\s+|and\s+an\s+|and\s+|also\s+a\s+|also\s+|just\s+had\s+a\s+|just\s+had\s+|ate\s+a\s+|ate\s+|had\s+a\s+|had\s+|plus\s+a\s+|plus\s+)/i,
        ''
      )
      .trim();
    str = str.replace(/[.,;!]+$/, '').trim();

    if (str.length > 0) {
      // Capitalize first letter
      str = str.charAt(0).toUpperCase() + str.slice(1);
      cleanedItems.push(str);
    }
  }

  return cleanedItems;
}

async function getUserGoalsContext(userId) {
  return new Promise((resolve) => {
    const todayStr = getAMSDateString();
    db.all(
      `SELECT name, date, target_ctl, is_main, goal_type, target_mode, target_value, target_weight, target_vo2max 
       FROM milestones WHERE user_id = ? AND (date >= ? OR date IS NULL OR date = '') 
       ORDER BY is_main DESC, date ASC`,
      [userId, todayStr],
      (err, rows) => {
        if (err || !rows || rows.length === 0) {
          db.get(`SELECT target_event, event_date, target_ctl FROM users WHERE id = ?`, [userId], (uErr, user) => {
            if (!uErr && user && user.target_event) {
              resolve(`- PRIMARY GOAL [RACE]: ${user.target_event} on ${user.event_date || 'TBD'} | Target: Finish the race | Target CTL: ${user.target_ctl || 70}`);
            } else {
              resolve("No specific active goals set.");
            }
          });
          return;
        }

        const lines = rows.map((m) => {
          const mainTag = m.is_main ? "PRIMARY GOAL" : "SECONDARY GOAL";
          const typeTag = (m.goal_type || "race").toUpperCase();

          if ((m.goal_type || "race") === "physiological") {
            const targets = [];
            if (m.target_weight) targets.push(`Goal Weight: ${m.target_weight} kg`);
            if (m.target_vo2max) targets.push(`Goal VO2 Max: ${m.target_vo2max} ml/kg/min`);
            if (m.target_value && !m.target_weight && !m.target_vo2max) targets.push(`Target: ${m.target_value}`);
            const targetText = targets.length > 0 ? targets.join(" | ") : "Physiological health goal";
            return `- ${mainTag} [${typeTag}]: ${m.name || "Physiological Goal"} by ${m.date || "Target Date"} | ${targetText}`;
          } else {
            // Race Goal
            let targetDetail = "Target: Finish the race";
            if (m.target_mode === "time" && m.target_value) {
              targetDetail = `Target: Time Goal (${m.target_value})`;
            } else if (m.target_value) {
              targetDetail = `Target: ${m.target_value}`;
            }
            const isToday = m.date === todayStr;
            const raceDayAlert = isToday ? "🔥 [CRITICAL: TODAY IS RACE DAY! High-energy encouragement, wish them luck, confidence boost!] " : "";
            return `- ${raceDayAlert}${mainTag} [${typeTag}]: ${m.name || "Race Event"} on ${m.date || "TBD"} | ${targetDetail} | Target CTL: ${m.target_ctl || 70}`;
          }
        });

        resolve(lines.join("\n                    "));
      }
    );
  });
}

module.exports = {
  getUserGoalsContext,
  extractAndCleanFoodItems,
  resetDailyTokensForAllUsers,
  resetDailyNutritionForAllUsers,
  getStravaShareSettings,
  normalizeShareSettings,
  canHideRookaLink,
  canAccessQuests,
  STRAVA_SHARE_SPORTS,
  STRAVA_SHARE_FLAGS,
  buildStravaUpdatePayload,
  runDailyRecoveryJob,
  calculateRookaScoreZoned,
  analyzeMuscleImpact,
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
  extractStravaPolyline,
  formatStepsForStrava,
  summarizeStepsForStrava,
  tagStravaActivity,
  getStravaActivity,
  getStravaUserIdsForAthlete,
  syncAllStravaUsersOnStartup,
  triggerBackgroundSummary,
  updateUserRookaAndCheckLevel,
  checkAndAwardRookaTitles,
  enforceMaxUserTitles,
  enforceMaxTitlesForAllUsers,
  triggerLevelUpCoachPrompt,
  generateQuestForUser,
  evaluateQuestsAgainstActivity,
  evaluateAndProgressQuests,
  calculateQuestProgress,
  isQuestMet,
  completeQuest,
  getEffectiveTokenLimit,
  generateAthleteWeeklyDescription,
  generateWeeklyAthleteDescriptionsJob,
  processActivityCoachAnalysis,
  sendMorningMessageForUser,
  sendMorningMessage: async () => {
    console.log("🌞 Running scheduled morning message job...");
    db.all(
      `SELECT id FROM users WHERE deleted_at IS NULL AND onboarding_completed = 1`,
      [],
      async (err, rows) => {
        if (err || !rows) return;
        for (const row of rows) {
          try {
            await sendMorningMessageForUser(row.id);
            console.log(`Sent scheduled morning message to user ${row.id}`);
          } catch (e) {
            console.error(`Failed to send morning message to user ${row.id}:`, e);
          }
        }
      }
    );
  }
};

async function sendMorningMessageForUser(userId, { force = false } = {}) {
  const todayStr = getAMSDateString();

  // 1. Check if a morning message was already sent today, if athlete already chatted, or if morning window is invalid
  if (!force) {
    const nowAMS = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }));
    const currentHour = nowAMS.getHours();
    if (currentHour < 8 || currentHour >= 13) {
      return { skipped: true, reason: `Outside morning window (08:00 - 13:00, current hour in Amsterdam: ${currentHour})` };
    }

    const alreadyInteractedToday = await new Promise((resolve) => {
      db.get(
        `SELECT id, role, mood FROM chat_history 
         WHERE user_id = ? 
           AND date(timestamp, 'localtime') = ? 
           AND (
             role = 'user' 
             OR (role = 'coach' AND time(timestamp, 'localtime') >= '04:00:00')
           )
         LIMIT 1`,
        [userId, todayStr],
        (err, row) => resolve(row)
      );
    });
    if (alreadyInteractedToday) {
      return { 
        skipped: true, 
        reason: `Athlete already interacted or received message today (msg #${alreadyInteractedToday.id}, role: ${alreadyInteractedToday.role})` 
      };
    }
  }

  // 2. Load user details
  const user = await new Promise((resolve) => {
    db.get(
      `SELECT u.id, u.coach_tone, u.coach_name, u.coach_context, u.athlete_context, u.gender, u.training_availability 
       FROM users u 
       WHERE u.id = ? AND u.deleted_at IS NULL AND u.onboarding_completed = 1`,
      [userId],
      (err, row) => resolve(err || !row ? null : row)
    );
  });

  if (!user) return { skipped: true, reason: "User not found or not onboarded" };

  // 2b. Load active recurring trainings
  const recurringRows = await new Promise((resolve) => {
    db.all(
      `SELECT title, day_of_week, start_time, duration_minutes, sport, intensity 
       FROM recurring_trainings 
       WHERE user_id = ? AND is_active = 1`,
      [userId],
      (err, rows) => resolve(err || !rows ? [] : rows)
    );
  });

  // 3. Load today's planned workouts (independent of whether user has goals)
  const workouts = await new Promise((resolve) => {
    db.all(
      `SELECT sport, description, details FROM micro_plan WHERE user_id = ? AND date = ?`,
      [userId, todayStr],
      (err, rows) => resolve(err || !rows ? [] : rows)
    );
  });

  // 4. Load milestones & check for race days (today, yesterday, or upcoming)
  const milestones = await new Promise((resolve) => {
    db.all(
      `SELECT name, date, target_ctl, is_main, goal_type, target_mode, target_value 
       FROM milestones 
       WHERE user_id = ? 
       ORDER BY date ASC`,
      [userId],
      (err, rows) => resolve(err || !rows ? [] : rows)
    );
  });

  const raceToday = milestones.find((m) => m.date === todayStr && (m.goal_type || 'race') === 'race');

  const nowAMS = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }));
  nowAMS.setDate(nowAMS.getDate() - 1);
  const yesterdayStr = `${nowAMS.getFullYear()}-${String(nowAMS.getMonth() + 1).padStart(2, '0')}-${String(nowAMS.getDate()).padStart(2, '0')}`;
  const raceYesterday = milestones.find((m) => m.date === yesterdayStr && (m.goal_type || 'race') === 'race');

  const upcomingRace = milestones.find((m) => m.date > todayStr && (m.goal_type || 'race') === 'race');
  let daysUntilRace = null;
  if (upcomingRace) {
    const d1 = new Date(todayStr + "T00:00:00Z");
    const d2 = new Date(upcomingRace.date.split("T")[0] + "T00:00:00Z");
    daysUntilRace = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
  }

  // 5. Recent completed activities
  const recent = await new Promise((resolve) => {
    db.all(
      `SELECT name, sport_type, distance_km, moving_time_min, start_date
       FROM activities
       WHERE user_id = ? AND date(start_date) >= date('now', '-7 days')
       ORDER BY start_date DESC
       LIMIT 10`,
      [userId],
      (actErr, actRows) => resolve(actErr || !actRows ? [] : actRows)
    );
  });

  // Check today's daily exercise limitation & recurring sports
  const currentAMSDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }));
  const amsDayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][currentAMSDate.getDay()];
  const amsDayShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][currentAMSDate.getDay()];

  let todayAvailabilityNote = "";
  if (user.training_availability) {
    try {
      const avail = typeof user.training_availability === 'string'
        ? JSON.parse(user.training_availability)
        : user.training_availability;
      const todayAvail = avail[amsDayShort] || avail[amsDayShort.toLowerCase()] || avail[amsDayName] || avail[amsDayName.toLowerCase()];
      if (todayAvail) {
        const isAvail = todayAvail.available !== false && todayAvail.status !== 'blocked';
        const maxM = todayAvail.maxMinutes !== undefined ? todayAvail.maxMinutes : (todayAvail.max_minutes !== undefined ? todayAvail.max_minutes : 0);
        if (!isAvail || maxM === 0) {
          todayAvailabilityNote = `Athlete's weekly profile designates today (${amsDayName}) as a REST / RECOVERY DAY (0 minutes available).`;
        } else {
          todayAvailabilityNote = `Athlete's weekly profile has a daily training limit of max ${maxM} minutes for today (${amsDayName}).`;
        }
      }
    } catch (_) {}
  }

  const todayRecurring = (recurringRows || []).filter((r) => {
    const rDay = (r.day_of_week || "").trim().toLowerCase();
    return rDay === amsDayName.toLowerCase() || rDay === amsDayShort.toLowerCase() || rDay.startsWith(amsDayShort.toLowerCase());
  });
  let todayRecurringNote = "";
  if (todayRecurring.length > 0) {
    todayRecurringNote = `Athlete has recurring non-Rooka weekly session(s) today: ` +
      todayRecurring.map(r => `"${r.title}" (${r.sport || 'Sport'}, ${r.duration_minutes || 60}m, ${r.intensity || 'moderate'}${r.start_time ? ` at ${r.start_time}` : ''})`).join(", ") +
      `. Cheer them on or factor this into their day!`;
  }

  let prompt = `It is morning (${todayStr}). You are the athlete's coach. Write a short, proactive, energetic morning message. `;
  if (todayAvailabilityNote) {
    prompt += `${todayAvailabilityNote} `;
  }
  if (todayRecurringNote) {
    prompt += `${todayRecurringNote} `;
  }

  if (raceToday) {
    prompt += `🚨 CRITICAL - TODAY IS RACE DAY: "${raceToday.name}"! This is the big target event the athlete has trained for over months! Write an inspiring, electrifying, confident race-day coach message. Wish them good luck, tell them to trust their training, stick to their hydration and pacing strategy, and leave everything on the course! `;
  } else if (raceYesterday) {
    prompt += `🏁 CRITICAL - YESTERDAY WAS RACE DAY: "${raceYesterday.name}"! Greet them warmly and congratulate them on conquering race day. Ask how the race went, how their body feels, and remind them that today is 100% about recovery, good food, and celebrating what they achieved! `;
  } else if (upcomingRace && daysUntilRace !== null && daysUntilRace <= 3) {
    prompt += `Their goal race "${upcomingRace.name}" is in only ${daysUntilRace} day${daysUntilRace === 1 ? '' : 's'}! Keep them calm, confident, and focused on final taper details, rest, and mental readiness. `;
  } else if (workouts.length > 0) {
    prompt += `They have the following workouts planned for today: ${JSON.stringify(workouts)}. Get them pumped up for it! `;
  } else {
    prompt += `They have a REST DAY today (no workouts planned). Encourage them to recover well and enjoy the day. `;
  }

  if (recent.length > 0) {
    prompt += `Here is EVERY session they actually completed in the last 7 days: ${JSON.stringify(recent)}. You may reference these specific sessions. `;
  } else {
    prompt += `IMPORTANT: they have logged NO training at all in the last 7 days. Do NOT congratulate them on recent work, a "great block", or any session — none happened. Do not invent any training. Simply greet them and look ahead. `;
  }
  prompt += `Never mention a workout, distance, or achievement that is not listed above. `;
  prompt += `Keep it under 3 sentences. DO NOT wrap it in JSON.`;

  const coachName = user.coach_name || "Rooka";
  let toneText = user.coach_tone || "Friendly";
  if (user.coach_tone === "custom" || user.coach_tone === "Configure own coach") {
    toneText = user.coach_context ? `Custom tone: ${user.coach_context}` : "Custom coach persona";
  }
  const systemPrompt = `You are ${coachName}, an elite endurance coach. Your tone is: ${toneText}. ${user.coach_context ? `Coach Custom Context: ${user.coach_context}` : ""} Act like a real human in a continuous text message thread.`;

  const aiReply = await generateWithFallback(prompt, systemPrompt);

  await new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO chat_history (user_id, role, content, mood, payload_json) VALUES (?, 'coach', ?, 'hype', ?)`,
      [user.id, aiReply, JSON.stringify({ type: 'morning_message' })],
      (err) => {
        if (err) return reject(err);
        sendSSEEvent(user.id, "unread_message", {
          message: aiReply,
          mood: "hype"
        });
        sendPushToUser(user.id, {
          title: raceToday ? `🔥 RACE DAY: Good luck from ${coachName}!` : `Good morning from ${coachName}! 🌅`,
          body: aiReply,
          data: { url: "/(tabs)/coach", type: "coach" },
          badge: 1,
        });
        resolve();
      }
    );
  });

  return { success: true, message: aiReply };
}
