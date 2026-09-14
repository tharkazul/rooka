const express = require('express');
const router = express.Router();
const db = require('../services/db');
const { authenticateToken } = require('../services/auth');
const { generateWithFallback } = require('../services/ai');
const { generateQuestForUser } = require('../services/utils');
const { detectAthleteGoalDiscipline, getGoalDependentPromptContext } = require('../services/goalPromptContext');

// Helper to determine benchmark test name & sport based on user context
function getBenchmarkInfoForUser(athleteContext, targetEvent) {
  const event = (targetEvent || '').toLowerCase().trim();
  // Strip metrics bracket so [Metrics: FTP (Watts): 250...] doesn't override running/marathon goals
  const textContext = (athleteContext || '')
    .replace(/\[Metrics:.*?\]/gi, '')
    .toLowerCase()
    .trim();

  // 1. Check Target Event Ground Truth First
  if (event) {
    if (
      event.includes('marathon') ||
      event.includes('half') ||
      event.includes('21k') ||
      event.includes('42k') ||
      event.includes('10k') ||
      event.includes('5k') ||
      event.includes('run') ||
      event.includes('trail') ||
      event.includes('ultra')
    ) {
      return {
        sport: 'Run',
        testName: '5k Pace & HR Baseline Test',
        desc: '🎯 Benchmark Assessment: 5k Pace & HR Test',
        details: 'Warm-up 10 mins easy jog + 4 dynamic strides. Main Set: 5k (or 20 mins) at race-pace / maximum sustained effort. Cool-down 8 mins.',
        targetRooka: 50,
        targetSpark: 50
      };
    }

    if (
      event.includes('fondo') ||
      event.includes('cycling') ||
      event.includes('cyclist') ||
      event.includes('bike') ||
      event.includes('tour') ||
      event.includes('gravel') ||
      event.includes('crit')
    ) {
      return {
        sport: 'Bike',
        testName: '20-Min FTP Baseline Test',
        desc: '🎯 Benchmark Assessment: 20-Min FTP Baseline Test',
        details: 'Warm-up 15 mins with 3x1-min high cadence efforts. Main Set: 20-minute maximum sustainable effort. Keep cadence steady (85-95 rpm). Cool-down 10 mins.',
        targetRooka: 60,
        targetSpark: 60
      };
    }

    if (
      event.includes('hyrox') ||
      event.includes('functional') ||
      event.includes('crossfit') ||
      event.includes('deka')
    ) {
      return {
        sport: 'Strength',
        testName: 'Hyrox Functional Fitness Test',
        desc: '🎯 Benchmark Assessment: Hyrox Functional Fitness Test',
        details: 'Warm-up 8 mins light row/jog. Main Set: 1000m Row/Ski-Erg + 50 Wallballs (6/9kg) + 40 Burpee Broad Jumps + 200m Farmers Carry. Record total completion time.',
        targetRooka: 55,
        targetSpark: 55
      };
    }

    if (
      event.includes('swim') ||
      event.includes('swimmer') ||
      event.includes('ocean') ||
      event.includes('css')
    ) {
      return {
        sport: 'Swim',
        testName: '400m CSS Swim Test',
        desc: '🎯 Benchmark Assessment: 400m CSS Swim Test',
        details: 'Warm-up 200m easy. Main Set: 400m TT (record time), 100m easy recovery, 50m TT (record time). Cool-down 150m easy.',
        targetRooka: 45,
        targetSpark: 45
      };
    }

    if (
      event.includes('triathlon') ||
      event.includes('ironman') ||
      event.includes('70.3')
    ) {
      return {
        sport: 'Run',
        testName: '5k Pace & HR Baseline Test',
        desc: '🎯 Benchmark Assessment: 5k Pace & HR Test',
        details: 'Warm-up 10 mins easy jog + 4 dynamic strides. Main Set: 5k (or 20 mins) at race-pace / maximum sustained effort. Cool-down 8 mins.',
        targetRooka: 50,
        targetSpark: 50
      };
    }
  }

  // 2. Check Core Athlete Background (excluding metrics metadata)
  const combined = (textContext + ' ' + event).trim();

  if (
    combined.includes('marathon') ||
    combined.includes('half marathon') ||
    combined.includes('running') ||
    combined.includes('runner') ||
    combined.includes('jog') ||
    combined.includes('5k') ||
    combined.includes('10k') ||
    combined.includes('trail run') ||
    combined.includes('ultra')
  ) {
    return {
      sport: 'Run',
      testName: '5k Pace & HR Baseline Test',
      desc: '🎯 Benchmark Assessment: 5k Pace & HR Test',
      details: 'Warm-up 10 mins easy jog + 4 dynamic strides. Main Set: 5k (or 20 mins) at race-pace / maximum sustained effort. Cool-down 8 mins.',
      targetRooka: 50,
      targetSpark: 50
    };
  }

  if (
    combined.includes('bike') ||
    combined.includes('cycling') ||
    combined.includes('cyclist') ||
    combined.includes('gran fondo') ||
    combined.includes('biking') ||
    combined.includes('road ride') ||
    combined.includes('gravel')
  ) {
    return {
      sport: 'Bike',
      testName: '20-Min FTP Baseline Test',
      desc: '🎯 Benchmark Assessment: 20-Min FTP Baseline Test',
      details: 'Warm-up 15 mins with 3x1-min high cadence efforts. Main Set: 20-minute maximum sustainable effort. Keep cadence steady (85-95 rpm). Cool-down 10 mins.',
      targetRooka: 60,
      targetSpark: 60
    };
  }

  if (
    combined.includes('hyrox') ||
    combined.includes('functional') ||
    combined.includes('crossfit') ||
    combined.includes('erg') ||
    combined.includes('sled') ||
    combined.includes('rower')
  ) {
    return {
      sport: 'Strength',
      testName: 'Hyrox Functional Fitness Test',
      desc: '🎯 Benchmark Assessment: Hyrox Functional Fitness Test',
      details: 'Warm-up 8 mins light row/jog. Main Set: 1000m Row/Ski-Erg + 50 Wallballs (6/9kg) + 40 Burpee Broad Jumps + 200m Farmers Carry. Record total completion time.',
      targetRooka: 55,
      targetSpark: 55
    };
  }

  if (
    combined.includes('swim') ||
    combined.includes('swimmer') ||
    combined.includes('500m') ||
    combined.includes('css')
  ) {
    return {
      sport: 'Swim',
      testName: '400m CSS Swim Test',
      desc: '🎯 Benchmark Assessment: 400m CSS Swim Test',
      details: 'Warm-up 200m easy. Main Set: 400m TT (record time), 100m easy recovery, 50m TT (record time). Cool-down 150m easy.',
      targetRooka: 45,
      targetSpark: 45
    };
  }

  // Default: Running / General Endurance
  return {
    sport: 'Run',
    testName: '5k Pace & HR Baseline Test',
    desc: '🎯 Benchmark Assessment: 5k Pace & HR Test',
    details: 'Warm-up 10 mins easy jog + 4 dynamic strides. Main Set: 5k (or 20 mins) at race-pace / maximum sustained effort. Cool-down 8 mins.',
    targetRooka: 50,
    targetSpark: 50
  };
}

// POST /finalize or POST /api/onboarding/finalize
router.post('/finalize', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const {
    coachTone,
    athleteContext,
    trainingAvailability,
    targetEvent,
    eventDate,
    targetCtl,
    gender,
    language,
    age,
    dateOfBirth
  } = req.body;

  // Seed training zones FIRST, before the "already onboarded" guard below.
  // Zones are what every Rooka score is weighted by, and existing athletes have
  // none — so a returning user must be able to acquire them without their plan
  // being rebuilt. Running this after the guard meant the very users who needed
  // zones were the ones who never got them.
  async function seedZonesFor(userId) {
    try {
      const zoneModel = require('../services/zones');
      const athleteZones = require('../services/athleteZones');

      if (dateOfBirth) {
        await new Promise((resolve) =>
          db.run(`UPDATE users SET date_of_birth = ? WHERE id = ?`, [dateOfBirth, userId], () => resolve())
        );
      }

      const resolvedAge = age ? Number(age) : zoneModel.ageFromDateOfBirth(dateOfBirth);
      const maxHr = zoneModel.maxHrFromAge(resolvedAge);
      if (maxHr) {
        await new Promise((resolve) =>
          db.run(
            `INSERT INTO athlete_metrics (user_id, metric, value) VALUES (?, 'max_hr', ?)
             ON CONFLICT(user_id, metric) DO UPDATE SET value = excluded.value`,
            [userId, String(maxHr)],
            () => resolve()
          )
        );
      }
      return await athleteZones.seedDefaultZones(userId);
    } catch (errZones) {
      console.warn('Zone seeding warning:', errZones && errZones.message);
      return null;
    }
  }

  try {
    await seedZonesFor(userId);

    // Onboarding must only ever build one starting plan. Re-running it (the
    // wizard reappearing after a failed profile fetch, a retried request, a
    // second device) otherwise stacks a fresh 7-day block starting "today" on
    // top of the existing one and registers another pending baseline test, so
    // yesterday's benchmark looks like it moved and the old planning is buried.
    const existing = await new Promise((resolve) =>
      db.get(
        `SELECT u.onboarding_completed,
                (SELECT COUNT(*) FROM micro_plan WHERE user_id = u.id) AS plan_count
           FROM users u WHERE u.id = ?`,
        [userId],
        (err, row) => resolve(err ? null : row),
      ),
    );

    // An existing plan is on its own sufficient evidence that this is not a
    // first run — an account can carry a full plan while `onboarding_completed`
    // is still 0 (older rows, a restored database), and requiring both flags
    // let that account rebuild its plan from scratch. Repair the flag so the
    // athlete also stops being sent back into the wizard on every launch.
    if (existing && existing.plan_count > 0 && !req.body.force) {
      if (existing.onboarding_completed !== 1) {
        await new Promise((resolve) =>
          db.run(`UPDATE users SET onboarding_completed = 1 WHERE id = ?`, [userId], () => resolve()),
        );
      }
      // The athlete may well have adjusted their tone, context, availability or
      // language while walking back through the wizard. Keeping the plan must
      // not mean silently discarding what they just typed.
      await new Promise((resolve) =>
        db.run(
          `UPDATE users SET
             coach_tone = COALESCE(?, coach_tone),
             athlete_context = COALESCE(?, athlete_context),
             training_availability = COALESCE(?, training_availability),
             gender = COALESCE(?, gender),
             language = COALESCE(?, language)
           WHERE id = ?`,
          [
            coachTone || null,
            athleteContext || null,
            typeof trainingAvailability === 'object'
              ? JSON.stringify(trainingAvailability)
              : trainingAvailability || null,
            gender || null,
            language || null,
            userId,
          ],
          () => resolve()
        )
      );

      return res.json({
        success: true,
        alreadyCompleted: true,
        zonesSeeded: true,
        message: 'Training zones updated; your existing plan was kept.',
      });
    }

    const langNames = {
      nl: 'Dutch (Nederlands)',
      de: 'German (Deutsch)',
      es: 'Spanish (Español)',
      fr: 'French (Français)',
      en: 'English'
    };
    const selectedLang = language || 'en';
    const targetLanguageName = langNames[selectedLang] || 'English';

    const isRookaPlus = req.body.subscriptionTier === 'rooka_plus' || req.body.subscription_tier === 'rooka_plus';
    const subTier = isRookaPlus ? 'rooka_plus' : 'free';
    const tokenLimit = isRookaPlus ? 50000 : 5000;

    // 1. Update user profile & mark onboarding completed (with fallback if column missing)
    await new Promise((resolve) => {
      db.run(
        `UPDATE users SET coach_tone = ?, athlete_context = ?, training_availability = ?, gender = ?, language = ?, onboarding_completed = 1, subscription_tier = ?, daily_token_limit = ? WHERE id = ?`,
        [
          coachTone || 'Empathetic but demanding elite endurance coach.',
          athleteContext || 'Endurance athlete.',
          typeof trainingAvailability === 'object' ? JSON.stringify(trainingAvailability) : (trainingAvailability || null),
          gender || 'Prefer not to say',
          selectedLang,
          subTier,
          tokenLimit,
          userId
        ],
        (err) => {
          if (err) {
            console.warn('onboarding_completed update fallback:', err.message);
            db.run(
              `UPDATE users SET coach_tone = ?, athlete_context = ?, training_availability = ?, gender = ?, language = ?, subscription_tier = ?, daily_token_limit = ? WHERE id = ?`,
              [
                coachTone || 'Empathetic but demanding elite endurance coach.',
                athleteContext || 'Endurance athlete.',
                typeof trainingAvailability === 'object' ? JSON.stringify(trainingAvailability) : (trainingAvailability || null),
                gender || 'Prefer not to say',
                selectedLang,
                subTier,
                tokenLimit,
                userId
              ],
              () => resolve()
            );
          } else {
            resolve();
          }
        }
      );
    });

    // 2. Save milestone if provided
    const reqGoalType = req.body.goalType || req.body.goal_type || 'race';
    const reqTargetMode = req.body.targetMode || req.body.target_mode || 'finish';
    const reqTargetValue = req.body.targetValue || req.body.target_value || null;
    const reqTargetWeight = (req.body.targetWeight !== undefined && req.body.targetWeight !== null && req.body.targetWeight !== '')
      ? parseFloat(req.body.targetWeight)
      : (req.body.target_weight !== undefined && req.body.target_weight !== null && req.body.target_weight !== '')
        ? parseFloat(req.body.target_weight)
        : null;
    const cleanEventName = (targetEvent && typeof targetEvent === 'string') ? targetEvent.trim() : '';
    const hasRealGoal = Boolean(cleanEventName.length > 0 || (reqTargetWeight && reqTargetWeight > 0));

    if (hasRealGoal) {
      const finalEventName = cleanEventName || (reqGoalType === 'physiological' ? 'Physiological Goal' : 'Target Goal');
      await new Promise((resolve) => {
        db.run(
          `DELETE FROM milestones WHERE user_id = ? AND is_main = 1`,
          [userId],
          () => {
            db.run(
              `INSERT INTO milestones (user_id, name, date, target_ctl, is_main, goal_type, target_mode, target_value, target_weight) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
              [
                userId,
                finalEventName,
                eventDate || '',
                parseFloat(targetCtl || (reqGoalType === 'physiological' ? 70 : 90)),
                reqGoalType,
                reqTargetMode,
                reqTargetValue,
                reqTargetWeight,
              ],
              () => resolve()
            );
          }
        );
      });
    } else {
      await new Promise((resolve) => {
        db.run(`DELETE FROM milestones WHERE user_id = ? AND is_main = 1`, [userId], () => resolve());
      });
    }

    // 3. Register baseline test entry into benchmark_tests table.
    // Clear any earlier still-pending onboarding baseline first so a user never
    // ends up with two competing "do your baseline test" assessments.
    const benchmarkInfo = getBenchmarkInfoForUser(athleteContext, targetEvent);
    await new Promise((resolve) => {
      db.run(
        `DELETE FROM benchmark_tests WHERE user_id = ? AND coach_notes = 'Initial Onboarding Baseline Assessment' AND completed_at IS NULL`,
        [userId],
        () => resolve()
      );
    });
    await new Promise((resolve) => {
      db.run(
        `INSERT INTO benchmark_tests (user_id, sport_type, test_name, metrics_json, coach_notes) VALUES (?, ?, ?, ?, ?)`,
        [
          userId,
          benchmarkInfo.sport,
          benchmarkInfo.testName,
          JSON.stringify({ status: 'Pending Completion', test: benchmarkInfo.testName }),
          'Initial Onboarding Baseline Assessment'
        ],
        () => resolve()
      );
    });

    // 4. Generate 7-day initial training schedule via LLM
    const todayStr = new Date().toLocaleDateString('en-CA');
    let availabilityText = 'No specific schedule boundaries set.';
    if (trainingAvailability) {
      try {
        const availObj = typeof trainingAvailability === 'string' ? JSON.parse(trainingAvailability) : trainingAvailability;
        availabilityText = Object.entries(availObj)
          .map(([day, data]) => `- ${day.charAt(0).toUpperCase() + day.slice(1)}: ${data.status} (Max minutes: ${data.max_minutes})`)
          .join('\n            ');
      } catch (e) {}
    }

    const discipline = detectAthleteGoalDiscipline({ target_event: targetEvent, athlete_context: athleteContext }, []);
    const goalPrompt = getGoalDependentPromptContext(discipline);

    const systemPrompt = `You are Coach Rooka, an elite endurance AI coach.
Tone: ${coachTone || 'Empathetic but demanding elite endurance coach.'}
Athlete Context: ${athleteContext || 'Endurance athlete.'}
Gender: ${gender || 'Prefer not to say'}
Target Event: ${targetEvent || 'General Fitness'} (Date: ${eventDate || 'TBD'})
Schedule Boundaries:
${availabilityText}

${goalPrompt}

CRITICAL RULES:
0. LANGUAGE DIRECTIVE: All natural language workout descriptions and details MUST be written fluently in ${targetLanguageName}.
1. SPORT TYPE: 'sport' must be exactly one of: 'Run', 'Bike', 'Swim', 'Strength', 'Rest'.
2. You are generating an initial 7-day onboarding training plan starting on ${todayStr} (exactly 7 distinct consecutive days).
3. BENCHMARK ASSESSMENT: Day 1 or Day 2 MUST contain the following Benchmark Assessment workout:
   - Sport: "${benchmarkInfo.sport}"
   - Description: "${benchmarkInfo.desc}"
   - Details: "${benchmarkInfo.details}"
   - is_benchmark: true
4. WORKOUT DETAILS & STEP PARITY (CRITICAL): Every workout's 'details' field must be rich and specific. NEVER write vague one-liners like "intervals" or "easy run". Include concrete technique cues (e.g. "focus on high heels / rapid heel recovery", "pull buoy", "single-leg cadence", or Hyrox station mechanics), dynamic warm-up drills, and session focus. Every exercise or station described in 'details' MUST have its matching structured step in 'steps_json'!
5. Format output as a valid JSON array of 7 items at the very end of your response inside a \`\`\`json code block.
Example format:
\`\`\`json
[
  {
    "date": "${todayStr}",
    "sport": "${benchmarkInfo.sport}",
    "description": "${benchmarkInfo.desc}",
    "target_rooka": ${benchmarkInfo.targetRooka},
    "details": "${benchmarkInfo.details}",
    "steps_json": "[{\\"type\\": \\"warmup\\", \\"exerciseName\\": \\"Dynamic Mobility\\", \\"condition_type\\": \\"time\\", \\"condition_value\\": 10, \\"target_type\\": \\"heart.rate.zone\\", \\"zone\\": 2}, {\\"type\\": \\"interval\\", \\"exerciseName\\": \\"Benchmark Assessment\\", \\"condition_type\\": \\"distance\\", \\"condition_value\\": 5000, \\"target_type\\": \\"no.target\\"}, {\\"type\\": \\"cooldown\\", \\"exerciseName\\": \\"Easy Recovery\\", \\"condition_type\\": \\"time\\", \\"condition_value\\": 5, \\"target_type\\": \\"heart.rate.zone\\", \\"zone\\": 2}]",
    "is_benchmark": true
  }
]
\`\`\``;

    const userPrompt = `I just completed my onboarding! Please generate my initial 7-day training schedule starting today (${todayStr}) in ${targetLanguageName}. Make sure Day 1 or Day 2 includes my ${benchmarkInfo.testName} benchmark test!`;

    let aiReply = '';
    try {
      aiReply = await generateWithFallback(userPrompt, systemPrompt, null, null, userId, 'common');
    } catch (errAi) {
      console.warn('AI initial plan generation warning:', errAi);
    }

    let planData = [];
    const jsonMatch = aiReply ? aiReply.match(/```json([\s\S]*?)```/) : null;
    if (jsonMatch) {
      try {
        planData = JSON.parse(jsonMatch[1]);
      } catch (e) {}
    }

    // Fallback if LLM parsing didn't return a full array
    if (!Array.isArray(planData) || planData.length === 0) {
      const dates = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        dates.push(d.toLocaleDateString('en-CA'));
      }
      planData = [
        {
          date: dates[0],
          sport: benchmarkInfo.sport,
          description: benchmarkInfo.desc,
          target_rooka: benchmarkInfo.targetRooka,
          details: benchmarkInfo.details,
          is_benchmark: true
        },
        {
          date: dates[1],
          sport: 'Rest',
          description: selectedLang === 'nl' ? 'Actief Herstel & Mobiliteit' : selectedLang === 'de' ? 'Aktive Regeneration & Mobility' : selectedLang === 'es' ? 'Recuperación Activa y Movilidad' : selectedLang === 'fr' ? 'Récupération Active & Mobilité' : 'Active Recovery & Mobility',
          target_rooka: 0,
          details: selectedLang === 'nl' ? 'Lichte wandeling of stretching na je benchmark test.' : selectedLang === 'de' ? 'Leichter Spaziergang oder Dehnen nach deinem Baseline-Test.' : selectedLang === 'es' ? 'Caminata ligera o estiramientos tras tu prueba de referencia.' : selectedLang === 'fr' ? 'Marche légère ou étirements après votre test de référence.' : 'Light walk or stretching after your baseline assessment.'
        },
        {
          date: dates[2],
          sport: benchmarkInfo.sport,
          description: selectedLang === 'nl' ? 'Zone 2 Aerobe Duur' : selectedLang === 'de' ? 'Zone 2 Grundlagenlauf' : selectedLang === 'es' ? 'Resistencia Aeróbica Zona 2' : selectedLang === 'fr' ? 'Endurance Aérobie Zone 2' : 'Zone 2 Aerobic Base',
          target_rooka: 40,
          details: selectedLang === 'nl' ? 'Rustig aerobe duurtraining op praattempo.' : selectedLang === 'de' ? 'Ruhige Ausdauereinheit im Gesprächstempo.' : selectedLang === 'es' ? 'Sesión aeróbica controlada a ritmo de conversación.' : selectedLang === 'fr' ? 'Séance aérobie contrôlée à allure de conversation.' : 'Controlled conversational pace endurance session.'
        },
        {
          date: dates[3],
          sport: 'Strength',
          description: selectedLang === 'nl' ? 'Core & Atletische Kracht' : selectedLang === 'de' ? 'Core & Rumpfkraft' : selectedLang === 'es' ? 'Fuerza Funcional y Core' : selectedLang === 'fr' ? 'Renforcement Core & Postural' : 'Core & Foundation Strength',
          target_rooka: 35,
          details: selectedLang === 'nl' ? 'Planks, lunges, heupstabiliteit en glute bridges (30 min).' : selectedLang === 'de' ? 'Planks, Ausfallschritte und Rumpfstabilität (30 Min).' : selectedLang === 'es' ? 'Planchas, zancadas y estabilidad de cadera (30 min).' : selectedLang === 'fr' ? 'Gainage, fentes et renforcement des hanches (30 min).' : 'Planks, lunges, hip stability and glute activation (30 min).'
        },
        {
          date: dates[4],
          sport: 'Rest',
          description: selectedLang === 'nl' ? 'Rustdag' : selectedLang === 'de' ? 'Ruhetag' : selectedLang === 'es' ? 'Día de Descanso' : selectedLang === 'fr' ? 'Jour de Repos' : 'Rest & Recharge',
          target_rooka: 0,
          details: selectedLang === 'nl' ? 'Volledige rust om spierherstel en adaptatie te stimuleren.' : selectedLang === 'de' ? 'Vollständige Erholung zur Förderung der Muskelregeneration.' : selectedLang === 'es' ? 'Descanso completo para asimilar la carga de entrenamiento.' : selectedLang === 'fr' ? 'Repos complet pour optimiser la récupération et l\'adaptation.' : 'Full rest to promote cellular repair and adaptation.'
        },
        {
          date: dates[5],
          sport: benchmarkInfo.sport,
          description: selectedLang === 'nl' ? 'Langere Aerobe Duur' : selectedLang === 'de' ? 'Langer Grundlagen-Dauerlauf' : selectedLang === 'es' ? 'Tirada Larga Aeróbica' : selectedLang === 'fr' ? 'Sortie Longue Fondamentale' : 'Long Aerobic Progression',
          target_rooka: 60,
          details: selectedLang === 'nl' ? 'Gestage duurtraining met focus op cadans en hydratatie.' : selectedLang === 'de' ? 'Gleichmäßige Grundlagenausdauer mit Fokus auf Tritt-/Schrittfrequenz.' : selectedLang === 'es' ? 'Sesión de volumen aeróbico constante con hidratación controlada.' : selectedLang === 'fr' ? 'Endurance fondamentale régulière avec gestion de l\'hydratation.' : 'Steady aerobic endurance focusing on rhythm and fueling.'
        },
        {
          date: dates[6],
          sport: 'Rest',
          description: selectedLang === 'nl' ? 'Herstel & Weekevaluatie' : selectedLang === 'de' ? 'Regeneration & Wochenrückblick' : selectedLang === 'es' ? 'Recuperación y Resumen Semanal' : selectedLang === 'fr' ? 'Récupération & Bilan Semaine' : 'Recovery & Weekly Reflection',
          target_rooka: 0,
          details: selectedLang === 'nl' ? 'Lichte wandeling, foam rolling en voorbereiding op week 2.' : selectedLang === 'de' ? 'Leichter Spaziergang, Faszienrolle und Vorbereitung auf Woche 2.' : selectedLang === 'es' ? 'Caminata suave, foam roller y preparación para la semana 2.' : selectedLang === 'fr' ? 'Marche douce, rouleau de massage et préparation pour la semaine 2.' : 'Easy walk, foam rolling, and reviewing week 1 progress.'
        }
      ];
    }

    // Save initial plan to micro_plan. Clear the dates we are about to write so
    // a forced regeneration replaces that day rather than doubling it up.
    const targetDates = [...new Set(planData.map((day) => day.date).filter(Boolean))];
    if (targetDates.length > 0) {
      await new Promise((resolve) =>
        db.run(
          `DELETE FROM micro_plan WHERE user_id = ? AND date IN (${targetDates.map(() => '?').join(',')})`,
          [userId, ...targetDates],
          () => resolve(),
        ),
      );
    }

    const stmt = db.prepare(`
      INSERT INTO micro_plan (user_id, date, sport, description, target_rooka, details, steps_json, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'coach')
    `);
    planData.forEach((day) => {
      stmt.run(
        userId,
        day.date,
        day.sport || 'Run',
        day.description || 'Workout',
        require('../services/zones').planDayTargetRooka(day) || 40,
        day.details || '',
        Array.isArray(day.steps) ? JSON.stringify(day.steps) : typeof day.steps_json === 'object' ? JSON.stringify(day.steps_json) : (day.steps_json || '[]')
      );
    });
    stmt.finalize();

    // 5. Generate First Quest
    try {
      await generateQuestForUser(userId, 'common');
    } catch (errQuest) {
      console.warn('Quest generation warning:', errQuest);
    }

    // 6. Post initial Coach Welcome message in chat_history
    const welcomeMessages = {
      nl: `Welkom bij je gepersonaliseerde trainingsprogramma! ⚡️ Ik heb je profiel en doelen verwerkt en je eerste 7-daagse schema direct klaargezet.

🎯 **Je Eerste Stap: De Benchmark Test (${benchmarkInfo.testName})**
Voordat we gerichte trainingsintensiteiten kunnen programmeren, moeten we je huidige fysieke basislijn vastleggen. Deze test kalibreert je hartslag- en tempozones zodat elke toekomstige workout exact op het juiste inspanningsniveau plaatsvindt.

📅 **Wat staat er deze eerste week op het programma?**
- **Dag 1–2**: 🏁 **${benchmarkInfo.testName}** — Uitvoeren op geplande wedstrijdinspanning om je nulmeting te bepalen.
- **Vervolg van de week**: Actief herstel, gecontroleerde Zone 2 aerobe opbouw en een langere duurtraining afgestemd op jouw weekbeschikbaarheid.

🧭 **Wat moet je nu doen?**
1. Ga naar het **Vandaag** / **Schema** tabblad om de opwarmings- en kerninstructies van je benchmark test te bekijken.
2. Koppel je sporthorloge of hartslagmeter voor vertrek.
3. Voer de test uit zoals beschreven. Zodra je workout binnenkomt, analyseer ik je data en bereken ik je persoonlijke trainingszones!`,

      de: `Willkommen bei deinem maßgeschneiderten Trainingsprogramm! ⚡️ Ich habe dein Profil und deine Ziele analysiert und deinen ersten 7-Tage-Trainingsplan erstellt.

🎯 **Dein Erster Schritt: Der Baseline-Test (${benchmarkInfo.testName})**
Bevor wir gezielte Intensitätsbereiche festlegen können, müssen wir dein aktuelles Leistungsniveau ermitteln. Dieser Test kalibriert deine Herzfrequenz- und Leistungszonen, damit jedes Workout optimal auf dich abgestimmt ist.

📅 **Dein Überblick für die erste Woche:**
- **Tag 1–2**: 🏁 **${benchmarkInfo.testName}** — Durchführung im angestrebten Wettkampftempo zur Ermittlung deiner Ausgangswerte.
- **Rest der Woche**: Aktive Regeneration, kontrollierter Zone-2-Grundlagenaufbau und ein längerer Dauerlauf/Ausdauereinheit gemäß deinen Zeitfenstern.

🧭 **Deine nächsten Schritte:**
1. Öffne den Tab **Heute** / **Trainingsplan**, um die genauen Aufwärm- und Hauptteil-Schritte deines Baseline-Tests einzusehen.
2. Verbinde deine Sportuhr bzw. deinen Pulsgurt vor Beginn.
3. Absolviere den Test wie beschrieben. Sobald die Aktivität synchronisiert ist, berechne ich deine individuellen Trainingszonen!`,

      es: `¡Bienvenido a tu programa de entrenamiento personalizado! ⚡️ He analizado tu perfil y objetivos, y he programado tu plan inicial de 7 días.

🎯 **Tu Primer Paso: Prueba de Referencia (${benchmarkInfo.testName})**
Antes de comenzar con entrenamientos intensivos, necesitamos medir tu estado físico actual. Esta prueba calibrará tus zonas de frecuencia cardíaca y ritmo para que cada sesión futura tenga la intensidad exacta.

📅 **Resumen de tu primera semana:**
- **Días 1–2**: 🏁 **${benchmarkInfo.testName}** — Realízala al esfuerzo objetivo para establecer tus marcas base.
- **Resto de la semana**: Recuperación activa, desarrollo aeróbico en Zona 2 y una sesión de resistencia adaptada a tu disponibilidad.

🧭 **Instrucciones para comenzar:**
1. Ve a la pestaña **Hoy** / **Plan** para ver las instrucciones exactas de calentamiento y esfuerzo de tu prueba.
2. Conecta tu pulsómetro o reloj GPS antes de empezar.
3. Completa la prueba según lo indicado. ¡En cuanto se sincronice, analizaré tus métricas y calibraré tus zonas de entrenamiento!`,

      fr: `Bienvenue dans votre programme d'entraînement personnalisé ! ⚡️ J'ai analysé votre profil et vos objectifs, et j'ai programmé votre semaine initiale de 7 jours.

🎯 **Votre Première Étape : Le Test de Référence (${benchmarkInfo.testName})**
Avant de programmer des intensités précises, nous devons évaluer votre niveau de forme actuel. Ce test étalonnera vos zones de fréquence cardiaque et d'allure pour garantir l'efficacité de vos futures séances.

📅 **Aperçu de votre première semaine :**
- **Jours 1–2** : 🏁 **${benchmarkInfo.testName}** — À réaliser à l'allure cible pour établir votre référence initiale.
- **Reste de la semaine** : Récupération active, développement aérobie en Zone 2 et sortie longue adaptée à vos disponibilités.

🧭 **Que faire maintenant ?**
1. Rendez-vous sur l'onglet **Aujourd'hui** / **Programme** pour consulter les détails et l'échauffement de votre test.
2. Associez votre montre GPS ou ceinture cardiaque avant de partir.
3. Réalisez le test comme prescrit. Dès synchronisation, j'analyserai vos données pour calculer vos zones d'entraînement personnalisées !`,

      en: `Welcome to your personalized training program! ⚡️ I've analyzed your profile and goals, and created your initial 7-day training schedule.

🎯 **Your First Step: The Baseline Assessment (${benchmarkInfo.testName})**
Before we dial in structured training loads, we need to measure your current fitness benchmarks. This test calibrates your heart rate, power, and pace zones so that every future workout is tuned to the exact right physiological intensity.

📅 **What your first week looks like:**
- **Days 1–2**: 🏁 **${benchmarkInfo.testName}** — Execute at your target effort to lock in your baseline.
- **Rest of the week**: Active recovery, controlled Zone 2 aerobic base building, and foundational endurance tailored to your weekly availability.

🧭 **Next Steps (What to do right now):**
1. Check your **Today** / **Schedule** tab to review the exact warm-up, main set, and cool-down intervals for your benchmark test.
2. Connect your heart rate monitor or GPS watch (Garmin, Strava, Apple Watch) before heading out.
3. Complete the assessment effort as prescribed. Once synced, I will analyze your data and compute your personalized training zones!`
    };
    const welcomeMsg = welcomeMessages[selectedLang] || welcomeMessages.en;

    await new Promise((resolve) => {
      db.run(
        `INSERT INTO chat_history (user_id, role, content, mood) VALUES (?, 'coach', ?, 'motivated')`,
        [userId, welcomeMsg],
        () => resolve()
      );
    });

    res.json({
      success: true,
      message: 'Onboarding finalized, initial plan, baseline test, and first quest created!',
      benchmark: benchmarkInfo
    });
  } catch (err) {
    console.error('Error finalizing onboarding:', err);
    res.status(500).json({ error: 'Failed to finalize onboarding setup.' });
  }
});

module.exports = router;
