const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const dbPath = process.env.DB_PATH 
  ? path.resolve(__dirname, "..", process.env.DB_PATH) 
  : path.join(__dirname, "..", "rooka_native.db");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        username TEXT UNIQUE, 
        password_hash TEXT, 
        strava_refresh_token TEXT, 
        garmin_username TEXT, 
        garmin_password TEXT, 
        coach_tone TEXT DEFAULT 'Empathetic but demanding elite endurance coach.', 
        athlete_context TEXT DEFAULT 'No context provided yet.',
        long_term_memory TEXT DEFAULT '',
        daily_token_usage INTEGER DEFAULT 0,
        last_token_reset_date TEXT,
        search_privacy INTEGER DEFAULT 0,
        profile_picture_url TEXT,
        common_token_usage INTEGER DEFAULT 0,
        daily_token_limit INTEGER DEFAULT 5000,
        subscription_tier TEXT DEFAULT 'free',
        rooka_plus_clicks INTEGER DEFAULT 0,
        data_request_clicks INTEGER DEFAULT 0
    )`);
  // Add columns if they don't exist (fails silently if they do)
  db.run(
    `ALTER TABLE users ADD COLUMN long_term_memory TEXT DEFAULT ''`,
    (err) => {},
  );
  db.run(
    `ALTER TABLE users ADD COLUMN daily_token_usage INTEGER DEFAULT 0`,
    (err) => {},
  );
  db.run(
    `ALTER TABLE users ADD COLUMN common_token_usage INTEGER DEFAULT 0`,
    (err) => {},
  );
  db.run(
    `ALTER TABLE users ADD COLUMN daily_token_limit INTEGER DEFAULT 50000`,
    (err) => {},
  );
  db.run(
    `ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'`,
    (err) => {},
  );
  db.run(
    `ALTER TABLE users ADD COLUMN daily_image_count INTEGER DEFAULT 0`,
    (err) => {},
  );
  db.run(
    `ALTER TABLE users ADD COLUMN last_image_reset_date TEXT`,
    (err) => {},
  );
  db.run(
    `ALTER TABLE chat_history ADD COLUMN payload_json TEXT`,
    (err) => {},
  );
  db.run(
    `ALTER TABLE chat_history ADD COLUMN image_path TEXT`,
    (err) => {},
  );
  db.run(
    `ALTER TABLE chat_history ADD COLUMN mood TEXT`,
    (err) => {},
  );
  db.run(
    `ALTER TABLE users ADD COLUMN subscription_tier TEXT DEFAULT 'free'`,
    (err) => {},
  );
  db.run(
    `ALTER TABLE users ADD COLUMN rooka_plus_clicks INTEGER DEFAULT 0`,
    (err) => {},
  );
  db.run(
    `ALTER TABLE users ADD COLUMN data_request_clicks INTEGER DEFAULT 0`,
    (err) => {},
  );
  db.run(
    `ALTER TABLE users ADD COLUMN last_token_reset_date TEXT`,
    (err) => {},
  );
  db.run(
    `ALTER TABLE users ADD COLUMN login_count INTEGER DEFAULT 0`,
    (err) => {},
  );
  db.run(
    `ALTER TABLE users ADD COLUMN chat_count INTEGER DEFAULT 0`,
    (err) => {},
  );
  db.run(
    `ALTER TABLE users ADD COLUMN search_privacy INTEGER DEFAULT 0`,
    (err) => {},
  );
  db.run(`ALTER TABLE users ADD COLUMN profile_picture_url TEXT`, (err) => {});
  db.run(
    `ALTER TABLE users ADD COLUMN training_availability TEXT`,
    (err) => {},
  );
  db.run(
    `ALTER TABLE users ADD COLUMN gender TEXT DEFAULT 'Prefer not to say'`,
    (err) => {},
  );
  db.run(`ALTER TABLE users ADD COLUMN last_cycle_start TEXT`, (err) => {});
  db.run(
    `ALTER TABLE users ADD COLUMN average_cycle_length INTEGER DEFAULT 28`,
    (err) => {},
  );
  db.run(`ALTER TABLE users RENAME COLUMN total_spark TO total_rooka`, (err) => {});
  db.run(`ALTER TABLE users ADD COLUMN total_rooka REAL DEFAULT 0`, (err) => {});
  db.run(`ALTER TABLE users RENAME COLUMN spark_start_date TO rooka_start_date`, (err) => {});
  db.run(`ALTER TABLE users ADD COLUMN rooka_start_date TEXT`, (err) => {});
  db.run(`ALTER TABLE users RENAME COLUMN spark_plus_clicks TO rooka_plus_clicks`, (err) => {});
  db.run(`ALTER TABLE users ADD COLUMN rooka_plus_clicks INTEGER DEFAULT 0`, (err) => {});
  db.run(`ALTER TABLE activities RENAME COLUMN spark_score TO rooka_score`, (err) => {});
  db.run(`ALTER TABLE users ADD COLUMN coach_name TEXT DEFAULT 'Rooka'`, (err) => {});
  db.run(`ALTER TABLE users ADD COLUMN apple_id TEXT`, (err) => {});
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_apple_id ON users(apple_id)`, (err) => {});
  db.run(`ALTER TABLE users ADD COLUMN google_id TEXT`, (err) => {});
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)`, (err) => {});
  // Databases created before the Spark -> Rooka rename still carry
  // `coach_name TEXT DEFAULT 'Spark'` on the column itself. ALTER TABLE ADD
  // COLUMN above is a no-op there, so the stale default survives and every new
  // account is greeted by "Spark". Rewrite the leftovers to the current brand.
  db.run(
    `UPDATE users SET coach_name = 'Rooka' WHERE coach_name IS NULL OR coach_name = '' OR coach_name = 'Spark'`,
    (err) => {},
  );
  // Ensure every athlete has a rooka_start_date so historical activities are not counted as Rooka XP
  db.run(
    `UPDATE users 
     SET rooka_start_date = COALESCE(
       (SELECT MIN(start_date) FROM activities WHERE user_id = users.id AND rooka_score > 0),
       CURRENT_TIMESTAMP
     ) 
     WHERE rooka_start_date IS NULL OR rooka_start_date = ''`,
    (err) => {},
  );
  // Activities prior to joining Rooka must score 0
  db.run(
    `UPDATE activities
     SET rooka_score = 0
     WHERE EXISTS (
       SELECT 1 FROM users u
       WHERE u.id = activities.user_id
         AND u.rooka_start_date IS NOT NULL
         AND substr(activities.start_date, 1, 10) < substr(u.rooka_start_date, 1, 10)
     ) AND rooka_score > 0`,
    (err) => {},
  );
  db.run(`ALTER TABLE users ADD COLUMN coach_context TEXT DEFAULT ''`, (err) => {});
  db.run(`ALTER TABLE users ADD COLUMN coach_avatar_neutral TEXT`, (err) => {});
  db.run(`ALTER TABLE users ADD COLUMN coach_avatar_hype TEXT`, (err) => {});
  db.run(`ALTER TABLE users ADD COLUMN coach_avatar_disappointed TEXT`, (err) => {});
  db.run(`ALTER TABLE users ADD COLUMN onboarding_completed INTEGER DEFAULT 0`, (err) => {});
  db.run(`ALTER TABLE users ADD COLUMN deleted_at TEXT`, (err) => {});
  db.run(`ALTER TABLE users ADD COLUMN language TEXT DEFAULT 'en'`, (err) => {});
  db.run(`ALTER TABLE users ADD COLUMN email TEXT`, (err) => {});
  db.run(`ALTER TABLE users ADD COLUMN public_description TEXT`, (err) => {});
  db.run(`ALTER TABLE users ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`, (err) => {});
  db.run(
    `UPDATE users SET created_at = rooka_start_date WHERE (created_at IS NULL OR created_at = '') AND rooka_start_date IS NOT NULL`,
    (err) => {},
  );
  // Date of birth drives max HR (220 - age) and therefore the heart-rate zone
  // table. Stored as a date rather than an age so it never goes stale.
  db.run(`ALTER TABLE users ADD COLUMN date_of_birth TEXT`, (err) => {});
  // Average power was discarded on sync, so a power-only ride had no intensity
  // signal at all and scored as bare minutes.
  db.run(`ALTER TABLE activities ADD COLUMN average_watts REAL`, (err) => {});
  db.run(`ALTER TABLE activities ADD COLUMN max_heartrate REAL`, (err) => {});
  // The client has decoded polylines since the map was built, but the route was
  // thrown away on the way in: Strava returns `map.summary_polyline` on every
  // synced activity and nothing here kept it. Same class of bug as
  // average_watts above.
  db.run(`ALTER TABLE activities ADD COLUMN polyline TEXT`, (err) => {});
  // Per-athlete, per-sport zone tables. `sport` is 'default' or a sport name,
  // `kind` is 'hr' or 'power'; the boundaries live in zones_json so adding a
  // sport needs no schema change.
  db.run(`CREATE TABLE IF NOT EXISTS athlete_zones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        sport TEXT NOT NULL DEFAULT 'default',
        kind TEXT NOT NULL,
        zones_json TEXT NOT NULL,
        source TEXT DEFAULT 'derived',
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, sport, kind),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`, (err) => {});
  // Cached Garmin Connect session (OAuth1/OAuth2 tokens), encrypted at rest.
  // Lets /api/sync-garmin reuse a session instead of logging in with
  // username/password on every sync, which Garmin rate-limits aggressively.
  db.run(`ALTER TABLE users ADD COLUMN garmin_oauth1_token TEXT`, (err) => {});
  db.run(`ALTER TABLE users ADD COLUMN garmin_oauth2_token TEXT`, (err) => {});
  db.run(`CREATE TABLE IF NOT EXISTS push_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token TEXT NOT NULL UNIQUE,
        device_type TEXT DEFAULT 'ios',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
  db.run(`CREATE TABLE IF NOT EXISTS waitlist (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        email TEXT UNIQUE, 
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, 
        notes TEXT
    )`);
  db.run(`CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        admin_username TEXT, 
        action TEXT, 
        target_username TEXT, 
        details TEXT, 
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
  db.run(`CREATE TABLE IF NOT EXISTS strava_tokens (
        user_id INTEGER PRIMARY KEY,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        strava_id TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
  db.run(
    `CREATE TABLE IF NOT EXISTS activities (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, sport_type TEXT, distance_km REAL, elevation_m INTEGER, moving_time_min REAL, average_heartrate REAL, start_date TEXT, tss REAL)`,
  );
  db.run(`ALTER TABLE activities ADD COLUMN rooka_score REAL`, (err) => {
    // Automatically backfill any activities that have a NULL rooka_score, then sync total_rooka
    db.all(
      `SELECT a.id, a.user_id, a.start_date, a.moving_time_min, a.average_heartrate, a.tss, u.rooka_start_date FROM activities a LEFT JOIN users u ON a.user_id = u.id WHERE a.rooka_score IS NULL`,
      (err, rows) => {
        const syncUserRooka = () => {
          db.all(
            `SELECT u.id as user_id, 
                    COALESCE(SUM(a.rooka_score), 0) + COALESCE((SELECT SUM(amount) FROM bonus_points WHERE user_id = u.id AND (u.rooka_start_date IS NULL OR substr(created_at, 1, 10) >= substr(u.rooka_start_date, 1, 10))), 0) as total 
             FROM users u 
             LEFT JOIN activities a ON a.user_id = u.id AND (u.rooka_start_date IS NULL OR substr(a.start_date, 1, 10) >= substr(u.rooka_start_date, 1, 10)) 
             GROUP BY u.id`,
            (err, userRows) => {
              if (!err && userRows) {
                const uStmt = db.prepare(
                  `UPDATE users SET total_rooka = ? WHERE id = ?`,
                );
                userRows.forEach((r) => uStmt.run(Math.round((r.total || 0) * 10) / 10, r.user_id));
                uStmt.finalize(() => {
                  console.log("total_rooka synchronization complete.");
                  db.run(`DELETE FROM public_profile_cache`, () => {});
                });
              }
            },
          );
        };

        if (!err && rows && rows.length > 0) {
          console.log(
            `Backfilling rooka_score for ${rows.length} activities...`,
          );
          const stmt = db.prepare(
            `UPDATE activities SET rooka_score = ? WHERE id = ?`,
          );
          rows.forEach((row) => {
            const userStartDateDay = row.rooka_start_date ? row.rooka_start_date.substring(0, 10) : null;
            const actStartDateDay = row.start_date ? row.start_date.substring(0, 10) : null;
            let score = 0;
            if (!userStartDateDay || (actStartDateDay && actStartDateDay >= userStartDateDay)) {
              let bonus = 0;
              if (row.average_heartrate) {
                if (row.average_heartrate >= 180) bonus = 1.0;
                else if (row.average_heartrate >= 160) bonus = 0.4;
                else if (row.average_heartrate >= 140) bonus = 0.3;
                else if (row.average_heartrate >= 120) bonus = 0.2;
                else if (row.average_heartrate >= 100) bonus = 0.0;
                else if (row.average_heartrate >= 80) bonus = -0.2;
                else bonus = -0.5;
              }
              const baseScore = row.moving_time_min || row.tss || 0;
              score = baseScore > 0 ? baseScore + baseScore * bonus : (row.tss || 0);
            }
            stmt.run(score, row.id);
          });
          stmt.finalize(() => {
            console.log("Rooka Score backfill complete.");
            syncUserRooka();
          });
        } else {
          syncUserRooka();
        }
      },
    );
  });
  db.run(`ALTER TABLE activities ADD COLUMN sets_json TEXT`, (err) => {
    if (!err) console.log("Added sets_json column to activities table.");
  });
  db.run(`ALTER TABLE activities ADD COLUMN laps_json TEXT`, (err) => {
    if (!err) console.log("Added laps_json column to activities table.");
  });

  // --- Activity identity migration -----------------------------------------
  // `activities.id` used to BE the Strava activity id, which is unique across
  // all of Strava. That made an activity ownable by exactly one Rooka account:
  // when a second account synced the same Strava athlete, its rows collided on
  // the primary key, the upsert quietly updated the first account's rows, and
  // the second athlete saw an empty history.
  //
  // `id` now stays a plain unique key of our own (so kudos, comments and every
  // `WHERE id = ?` lookup keep working untouched), and the Strava id moves to
  // its own column, unique *per user*.
  //
  // Existing rows keep their current id, so kudos/comments already pointing at
  // them still resolve. Manually logged activities use a negative id and carry
  // no Strava id; NULLs repeat freely in a SQLite unique index, so they cannot
  // collide with each other.
  db.run(`ALTER TABLE activities ADD COLUMN strava_activity_id TEXT`, (err) => {
    if (!err) console.log("Added strava_activity_id column to activities table.");

    db.run(
      `UPDATE activities SET strava_activity_id = CAST(id AS TEXT)
        WHERE strava_activity_id IS NULL AND id > 0`,
      function (backfillErr) {
        if (backfillErr) {
          console.error("strava_activity_id backfill failed:", backfillErr.message);
          return;
        }
        if (this.changes > 0) {
          console.log(`Backfilled strava_activity_id for ${this.changes} activities.`);
        }

        // Required for `ON CONFLICT(user_id, strava_activity_id)` upserts.
        db.run(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_user_strava
             ON activities(user_id, strava_activity_id)`,
          (idxErr) => {
            if (idxErr) {
              console.error(
                "Could not create idx_activities_user_strava:",
                idxErr.message,
              );
            }
          },
        );
      },
    );
  });
  db.run(`ALTER TABLE activities ADD COLUMN coach_analyzed INTEGER DEFAULT 0`, (err) => {
    if (!err) console.log("Added coach_analyzed column to activities table.");
  });
  db.run(
    `CREATE TABLE IF NOT EXISTS micro_plan (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, date TEXT, sport TEXT, description TEXT, target_rooka REAL, details TEXT, steps_json TEXT, source TEXT DEFAULT 'coach', FOREIGN KEY(user_id) REFERENCES users(id))`,
  );
  db.run(
    `ALTER TABLE micro_plan RENAME COLUMN target_spark TO target_rooka`,
    (err) => {},
  );
  db.run(
    `ALTER TABLE micro_plan RENAME COLUMN target_tss TO target_rooka`,
    (err) => {},
  );
  db.run(
    `ALTER TABLE micro_plan ADD COLUMN target_rooka REAL`,
    (err) => {},
  );

  // Ensure steps_json exists for legacy DBs (if table has id but no steps_json)
  db.run(
    `ALTER TABLE micro_plan ADD COLUMN steps_json TEXT DEFAULT '[]'`,
    (err) => {
      if (err && !err.message.includes("duplicate column name")) {
        console.error("Error adding steps_json column:", err.message);
      }
    },
  );

  // Who prescribed this session. The coach's `details` prose is shown in the
  // app as a note from the coach, which only makes sense on sessions the coach
  // actually wrote — a workout the athlete built themselves has no coach to
  // quote. Every row that existed before this column came from plan
  // generation, so 'coach' is the right default for the backfill; the
  // app-facing write routes set 'user' explicitly.
  db.run(
    `ALTER TABLE micro_plan ADD COLUMN source TEXT DEFAULT 'coach'`,
    (err) => {
      if (err && !err.message.includes("duplicate column name")) {
        console.error("Error adding micro_plan source column:", err.message);
      }
    },
  );

  // Migration: check if micro_plan is missing the 'id' column. If so, rebuild it.
  // This also implicitly drops the legacy UNIQUE(user_id, date, sport) constraint so users can have 2 runs in a day.
  db.all(`PRAGMA table_info(micro_plan);`, (err, rows) => {
    if (!err && rows && rows.length > 0) {
      const hasId = rows.some((r) => r.name === "id");
      if (!hasId) {
        console.log(
          "Migrating micro_plan table to include id column and drop unique constraints...",
        );
        db.serialize(() => {
          db.run(
            `CREATE TABLE IF NOT EXISTS micro_plan_new (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, date TEXT, sport TEXT, description TEXT, target_rooka REAL, details TEXT, steps_json TEXT, source TEXT DEFAULT 'coach', FOREIGN KEY(user_id) REFERENCES users(id))`,
          );
          db.run(
            `INSERT INTO micro_plan_new (user_id, date, sport, description, target_rooka, details, steps_json) SELECT user_id, date, sport, description, target_tss as target_rooka, details, steps_json FROM micro_plan`,
          );
          db.run(`DROP TABLE micro_plan`);
          db.run(`ALTER TABLE micro_plan_new RENAME TO micro_plan`);
        });
      }
    }
  });

  db.run(
    `CREATE TABLE IF NOT EXISTS weight_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, date TEXT, weight_kg REAL, body_fat_percent REAL, bmi REAL, lean_mass_kg REAL, UNIQUE(user_id, date))`,
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS chat_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, role TEXT, content TEXT, mood TEXT, image_path TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`,
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS athlete_metrics (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, metric TEXT, value TEXT, UNIQUE(user_id, metric))`,
  );
  db.run(`CREATE TABLE IF NOT EXISTS biometrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        date TEXT,
        weight_kg REAL,
        body_fat_percent REAL,
        bmi REAL,
        lean_mass_kg REAL,
        UNIQUE(user_id, date),
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
  db.run(`CREATE TABLE IF NOT EXISTS physique_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        date TEXT,
        weight_kg REAL,
        sleep_quality INTEGER,
        fatigue_level INTEGER,
        notes TEXT,
        photo_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
  db.run(`CREATE TABLE IF NOT EXISTS nutrition_intake (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    date TEXT,
    carbs REAL DEFAULT 0,
    protein REAL DEFAULT 0,
    fat REAL DEFAULT 0,
    UNIQUE(user_id, date),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS milestones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT,
        date TEXT,
        target_ctl REAL,
        is_main INTEGER DEFAULT 0,
        artwork_url TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
  db.run(`ALTER TABLE milestones ADD COLUMN artwork_url TEXT`, (err) => {});
  db.run(`ALTER TABLE milestones ADD COLUMN goal_type TEXT DEFAULT 'race'`, (err) => {});
  db.run(`ALTER TABLE milestones ADD COLUMN target_mode TEXT DEFAULT 'finish'`, (err) => {});
  db.run(`ALTER TABLE milestones ADD COLUMN target_value TEXT`, (err) => {});
  db.run(`ALTER TABLE milestones ADD COLUMN target_weight REAL`, (err) => {});
  db.run(`ALTER TABLE milestones ADD COLUMN target_vo2max REAL`, (err) => {});
  db.run(`CREATE TABLE IF NOT EXISTS nutrition_protocols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        date TEXT,
        protocol_json TEXT,
        UNIQUE(user_id, date)
    )`);
  db.run(`CREATE TABLE IF NOT EXISTS nutrition_intake (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        date TEXT,
        carbs REAL DEFAULT 0,
        protein REAL DEFAULT 0,
        fat REAL DEFAULT 0,
        UNIQUE(user_id, date),
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
  db.run(`CREATE TABLE IF NOT EXISTS daily_diet_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        date TEXT,
        logged_carbs REAL DEFAULT 0,
        logged_protein REAL DEFAULT 0,
        logged_fat REAL DEFAULT 0,
        items_summary TEXT DEFAULT '',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, date),
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
  db.run(`CREATE TABLE IF NOT EXISTS connections (
        user_id INTEGER,
        friend_id INTEGER,
        status TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, friend_id),
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(friend_id) REFERENCES users(id)
    )`);
  db.run(`CREATE TABLE IF NOT EXISTS kudos (
        activity_id INTEGER,
        user_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(activity_id, user_id),
        FOREIGN KEY(activity_id) REFERENCES activities(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

  db.run(`CREATE TABLE IF NOT EXISTS event_invitations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        inviter_id INTEGER NOT NULL,
        invitee_id INTEGER NOT NULL,
        micro_plan_id INTEGER NOT NULL,
        location TEXT,
        time TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(inviter_id) REFERENCES users(id),
        FOREIGN KEY(invitee_id) REFERENCES users(id),
        FOREIGN KEY(micro_plan_id) REFERENCES micro_plan(id)
    )`);

  db.run(`CREATE TABLE IF NOT EXISTS recurring_trainings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        day_of_week TEXT NOT NULL,
        start_time TEXT DEFAULT '',
        duration_minutes INTEGER DEFAULT 60,
        sport TEXT DEFAULT 'Other',
        intensity TEXT DEFAULT 'moderate',
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

  db.run(`CREATE TABLE IF NOT EXISTS public_profile_cache (
        user_id INTEGER PRIMARY KEY,
        data TEXT,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

  // Gamification tables
  db.run(`CREATE TABLE IF NOT EXISTS bonus_points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        amount REAL,
        reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_milestone_history (
        user_id INTEGER,
        milestone_key TEXT,
        awarded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, milestone_key),
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_quests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        description TEXT,
        target_metric TEXT,
        target_value REAL,
        reward_points REAL,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        expires_at DATETIME,
        refresh_count INTEGER DEFAULT 0,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

  db.run(
    `ALTER TABLE user_quests ADD COLUMN target_sport TEXT DEFAULT 'Any'`,
    (err) => {},
  );
  db.run(
    `ALTER TABLE user_quests ADD COLUMN is_accumulative INTEGER DEFAULT 0`,
    (err) => {},
  );
  db.run(
    `ALTER TABLE user_quests ADD COLUMN expires_at DATETIME`,
    (err) => {},
  );
  db.run(
    `ALTER TABLE user_quests ADD COLUMN refresh_count INTEGER DEFAULT 0`,
    (err) => {},
  );
  db.run(
    `UPDATE user_quests SET expires_at = datetime(created_at, '+3 days') WHERE expires_at IS NULL AND status = 'active'`,
    (err) => {},
  );
  // Ensure free and downgraded users never retain active quests
  db.run(
    `UPDATE user_quests SET status = 'closed' 
     WHERE status = 'active' 
     AND user_id IN (SELECT id FROM users WHERE subscription_tier IS NULL OR subscription_tier = 'free')`,
    (err) => {},
  );

  db.run(`CREATE TABLE IF NOT EXISTS user_titles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        title TEXT,
        description TEXT,
        is_active INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
  db.run(
    `ALTER TABLE user_titles ADD COLUMN is_active INTEGER DEFAULT 0`,
    (err) => {},
  );
  db.run(
    `ALTER TABLE user_titles ADD COLUMN milestone_key TEXT`,
    (err) => {},
  );

  db.run(`CREATE TABLE IF NOT EXISTS system_state (
        key TEXT PRIMARY KEY,
        value TEXT,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

  db.run(`CREATE TABLE IF NOT EXISTS activity_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        activity_id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        comment TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

  db.run(`CREATE TABLE IF NOT EXISTS athlete_niggles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        body_part TEXT,
        severity INTEGER,
        notes TEXT,
        status TEXT,
        reported_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

  db.run(`ALTER TABLE athlete_niggles ADD COLUMN resolved_date DATETIME`, (err) => {});

  db.run(`CREATE TABLE IF NOT EXISTS athlete_muscle_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        body_part TEXT,
        fatigue_score REAL DEFAULT 0,
        development_score REAL DEFAULT 0,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, body_part),
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

  // Migration from old athlete_fatigue_log if it exists
  db.all(`PRAGMA table_info(athlete_fatigue_log);`, (err, rows) => {
    if (!err && rows && rows.length > 0) {
      console.log("Migrating athlete_fatigue_log to athlete_muscle_status...");
      db.serialize(() => {
        // We sum existing fatigue to populate both fatigue and development initially
        db.run(`INSERT INTO athlete_muscle_status (user_id, body_part, fatigue_score, development_score)
                SELECT user_id, body_part, SUM(fatigue_score), SUM(fatigue_score)
                FROM athlete_fatigue_log
                GROUP BY user_id, body_part
                ON CONFLICT(user_id, body_part) DO UPDATE SET 
                  fatigue_score = fatigue_score + excluded.fatigue_score,
                  development_score = development_score + excluded.development_score`);
        db.run(`DROP TABLE athlete_fatigue_log`);
      });
    }
  });
  db.run(`CREATE TABLE IF NOT EXISTS user_feature_onboarding (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        feature_key TEXT NOT NULL,
        introduced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        first_used_at DATETIME,
        status TEXT DEFAULT 'introduced',
        UNIQUE(user_id, feature_key),
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

  db.run(`CREATE TABLE IF NOT EXISTS benchmark_tests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        sport_type TEXT NOT NULL,
        test_name TEXT NOT NULL,
        metrics_json TEXT,
        coach_notes TEXT,
        completed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

  // Discount codes. The three axes an admin sets are independent: what the code
  // does to the price (discount_type), how long it keeps doing it
  // (duration_months), and how many athletes may ever redeem it
  // (redemption_type/max_redemptions). Codes are stored normalised (uppercase,
  // no spaces) so UNIQUE is a case-insensitive match in practice.
  db.run(`CREATE TABLE IF NOT EXISTS discount_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        description TEXT,
        discount_type TEXT NOT NULL,
        percent_off REAL,
        fixed_monthly_price REAL,
        fixed_yearly_price REAL,
        duration_months INTEGER,
        redemption_type TEXT NOT NULL DEFAULT 'unlimited',
        max_redemptions INTEGER,
        valid_from TEXT,
        valid_until TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

  // Permanent redemption ledger, separate from user_discounts on purpose.
  // Usage caps are counted here, so removing your own code and re-applying it
  // does not consume a second slot, while a single-use code still cannot be
  // handed round between athletes.
  db.run(`CREATE TABLE IF NOT EXISTS discount_redemptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        first_redeemed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(code_id, user_id),
        FOREIGN KEY(code_id) REFERENCES discount_codes(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

  // The code an athlete currently holds. user_id is the primary key: one active
  // discount each, which is what the account screen lets them edit or remove.
  // expires_at is materialised at apply time from duration_months so that
  // changing a code's duration later cannot retroactively move somebody's
  // already-running discount window.
  db.run(`CREATE TABLE IF NOT EXISTS user_discounts (
        user_id INTEGER PRIMARY KEY,
        code_id INTEGER NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT,
        FOREIGN KEY(code_id) REFERENCES discount_codes(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

  db.run(`CREATE TABLE IF NOT EXISTS password_resets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        code_hash TEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        attempts INTEGER DEFAULT 0,
        used_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
});

/**
 * Take a turn at a write transaction.
 *
 * SQLite gives this process a single connection, so transactions cannot
 * overlap. When a second request issues BEGIN while another is still open, that
 * BEGIN fails, the second COMMIT then commits the FIRST request's half-written
 * work, and the first COMMIT errors with "cannot commit - no transaction is
 * active". Chat requests are long enough to overlap routinely, so the
 * transactional sections queue here instead of racing.
 *
 * Returns a release function: call it exactly once, after COMMIT or ROLLBACK.
 * A watchdog releases anyway if a caller never does, because a wedged lock
 * would silently stall every later write rather than failing loudly.
 */
const TX_WATCHDOG_MS = 60000;
let txQueue = Promise.resolve();

async function beginSerializedTransaction(label = "tx") {
  const previous = txQueue;
  let markFinished;
  const finished = new Promise((resolve) => {
    markFinished = resolve;
  });
  // Whoever comes next waits for us, whether we succeed or fail.
  txQueue = previous.then(() => finished, () => finished);

  await previous.catch(() => {});

  try {
    await new Promise((resolve, reject) =>
      db.run("BEGIN TRANSACTION", (err) => (err ? reject(err) : resolve())),
    );
  } catch (err) {
    markFinished();
    throw err;
  }

  let released = false;
  const watchdog = setTimeout(() => {
    if (released) return;
    released = true;
    console.error(
      `Transaction watchdog fired for "${label}" after ${TX_WATCHDOG_MS}ms - releasing the lock.`,
    );
    markFinished();
  }, TX_WATCHDOG_MS);
  if (watchdog.unref) watchdog.unref();

  return function release() {
    if (released) return;
    released = true;
    clearTimeout(watchdog);
    markFinished();
  };
}

db.beginSerializedTransaction = beginSerializedTransaction;

module.exports = db;
