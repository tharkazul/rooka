const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../services/db");

// Register a new friend
router.post("/register", async (req, res) => {
  const { username, email, password, context } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const nowIso = new Date().toISOString();
    const cleanUsername = (username || email || "").trim();
    const cleanEmail = (email || (cleanUsername.includes("@") ? cleanUsername : "")).trim().toLowerCase() || null;

    db.run(
      // coach_name is set explicitly: older databases still default this column
      // to the pre-rename value 'Spark'.
      `INSERT INTO users (username, email, password_hash, athlete_context, rooka_start_date, coach_name) VALUES (?, ?, ?, ?, ?, ?)`,
      [cleanUsername, cleanEmail, hashedPassword, context || "New athlete.", nowIso, "Rooka"],
      function (err) {
        if (err)
          return res
            .status(400)
            .json({ error: "Username or email might already exist." });
        res
          .status(201)
          .json({
            message: "Athlete registered successfully!",
            userId: this.lastID,
          });
      },
    );
  } catch (error) {
    res.status(500).json({ error: "Registration failed." });
  }
});

// Login and get a token
router.post("/login", (req, res) => {
  const { username, password } = req.body;
  const identifier = (username || "").trim().toLowerCase();

  if (!identifier || !password) {
    return res.status(400).json({ error: "Please enter your username/email and password." });
  }

  db.get(
    `SELECT * FROM users 
     WHERE (LOWER(username) = ? OR (email IS NOT NULL AND LOWER(email) = ?)) 
       AND deleted_at IS NULL 
     LIMIT 1`,
    [identifier, identifier],
    async (err, user) => {
      if (err || !user)
        return res.status(400).json({
          error: "No account found with that email or username.",
          code: "ACCOUNT_NOT_FOUND",
        });

      if (await bcrypt.compare(password, user.password_hash)) {
        const token = jwt.sign(
          { id: user.id, username: user.username },
          process.env.JWT_SECRET,
          { expiresIn: "30d" },
        );
        db.run(`UPDATE users SET login_count = login_count + 1 WHERE id = ?`, [
          user.id,
        ]);
        res.json({ token, message: "Welcome to Rooka HQ" });
      } else {
        res.status(401).json({ error: "Incorrect password." });
      }
    },
  );
});

// Sign In with Apple
router.post("/apple", async (req, res) => {
  const { identityToken, user: appleUserId, email, fullName } = req.body;

  if (!identityToken) {
    return res.status(400).json({ error: "Apple identity token is required." });
  }

  try {
    const decoded = jwt.decode(identityToken, { complete: true });
    if (!decoded || !decoded.payload) {
      return res.status(400).json({ error: "Invalid Apple identity token." });
    }

    const { payload } = decoded;

    // Validate Apple token claims
    if (payload.iss !== "https://appleid.apple.com") {
      return res.status(400).json({ error: "Untrusted token issuer." });
    }

    if (payload.exp && payload.exp * 1000 < Date.now() - 60000) {
      return res.status(401).json({ error: "Apple session has expired. Please sign in again." });
    }

    const sub = payload.sub || appleUserId;
    if (!sub) {
      return res.status(400).json({ error: "Unable to identify Apple user identifier." });
    }

    const cleanEmail = (payload.email || email || "").trim().toLowerCase() || null;

    // Check if user already exists by apple_id or email
    db.get(
      `SELECT * FROM users 
       WHERE (apple_id = ? OR (email IS NOT NULL AND LOWER(email) = ?)) 
         AND deleted_at IS NULL 
       LIMIT 1`,
      [sub, cleanEmail],
      async (err, existingUser) => {
        if (err) {
          console.error("Apple auth lookup error:", err);
          return res.status(500).json({ error: "Database error during Apple authentication." });
        }

        if (existingUser) {
          // Link apple_id or email if not previously populated
          if (!existingUser.apple_id) {
            db.run(`UPDATE users SET apple_id = ? WHERE id = ?`, [sub, existingUser.id]);
          }
          if (!existingUser.email && cleanEmail) {
            db.run(`UPDATE users SET email = ? WHERE id = ?`, [cleanEmail, existingUser.id]);
          }

          db.run(`UPDATE users SET login_count = login_count + 1 WHERE id = ?`, [
            existingUser.id,
          ]);

          const token = jwt.sign(
            { id: existingUser.id, username: existingUser.username },
            process.env.JWT_SECRET,
            { expiresIn: "30d" }
          );

          console.log(`🍏 Apple login successful for user: ${existingUser.username} (ID: ${existingUser.id})`);
          return res.json({
            token,
            isNewUser: false,
            message: "Welcome back to Rooka HQ",
          });
        }

        // New User: Create account
        let preferredName = "";
        if (fullName) {
          const given = (fullName.givenName || "").trim();
          const family = (fullName.familyName || "").trim();
          preferredName = [given, family].filter(Boolean).join(" ");
        }

        if (!preferredName && cleanEmail) {
          preferredName = cleanEmail.split("@")[0];
        }

        if (!preferredName) {
          preferredName = "Athlete";
        }

        // Sanitize username
        preferredName = preferredName.replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "Athlete";

        // Check if username is already taken, if so, append random suffix
        db.get(
          `SELECT id FROM users WHERE LOWER(username) = ?`,
          [preferredName.toLowerCase()],
          async (nameErr, nameRow) => {
            let finalUsername = preferredName;
            if (nameRow) {
              const suffix = Math.floor(100 + Math.random() * 900);
              finalUsername = `${preferredName}${suffix}`;
            }

            try {
              // Generate secure random unguessable password hash for oauth account
              const randomPass = crypto.randomBytes(32).toString("hex");
              const hashedPassword = await bcrypt.hash(randomPass, 10);
              const nowIso = new Date().toISOString();

              db.run(
                `INSERT INTO users (username, email, apple_id, password_hash, athlete_context, rooka_start_date, coach_name, onboarding_completed)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
                [
                  finalUsername,
                  cleanEmail,
                  sub,
                  hashedPassword,
                  "New athlete joined via Apple Sign-In.",
                  nowIso,
                  "Rooka",
                ],
                function (insertErr) {
                  if (insertErr) {
                    console.error("Apple registration error:", insertErr);
                    return res.status(500).json({ error: "Failed to create account with Apple." });
                  }

                  const newUserId = this.lastID;
                  const token = jwt.sign(
                    { id: newUserId, username: finalUsername },
                    process.env.JWT_SECRET,
                    { expiresIn: "30d" }
                  );

                  console.log(`🍏 New athlete registered via Apple: ${finalUsername} (ID: ${newUserId}, Email: ${cleanEmail})`);
                  res.status(201).json({
                    token,
                    isNewUser: true,
                    message: "Account created with Apple successfully!",
                  });
                }
              );
            } catch (createErr) {
              console.error("Error creating Apple user:", createErr);
              res.status(500).json({ error: "Failed to finalize Apple registration." });
            }
          }
        );
      }
    );
  } catch (error) {
    console.error("Apple authentication error:", error);
    res.status(500).json({ error: "Apple authentication failed." });
  }
});

// Sign In with Google
router.post("/google", async (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ error: "Google ID token is required." });
  }

  try {
    // Verify token with Google TokenInfo API
    const googleRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    );
    const payload = await googleRes.json();

    if (payload.error || !payload.sub) {
      console.warn("Invalid Google ID token:", payload.error_description || payload.error);
      return res.status(400).json({ error: "Invalid or expired Google identity token." });
    }

    // Verify token audience if configured
    const allowedClientIds = (process.env.GOOGLE_CLIENT_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (allowedClientIds.length > 0 && !allowedClientIds.includes(payload.aud)) {
      console.warn(`Google token audience mismatch. Received: ${payload.aud}`);
      return res.status(400).json({ error: "Untrusted Google token audience." });
    }

    const sub = payload.sub;
    const cleanEmail = (payload.email || "").trim().toLowerCase() || null;
    const googleName = (payload.name || payload.given_name || "").trim();
    const pictureUrl = payload.picture || null;

    // Check if user already exists by google_id or email
    db.get(
      `SELECT * FROM users 
       WHERE (google_id = ? OR (email IS NOT NULL AND LOWER(email) = ?)) 
         AND deleted_at IS NULL 
       LIMIT 1`,
      [sub, cleanEmail],
      async (err, existingUser) => {
        if (err) {
          console.error("Google auth lookup error:", err);
          return res.status(500).json({ error: "Database error during Google authentication." });
        }

        if (existingUser) {
          // Link google_id or profile picture if not previously populated
          if (!existingUser.google_id) {
            db.run(`UPDATE users SET google_id = ? WHERE id = ?`, [sub, existingUser.id]);
          }
          if (!existingUser.email && cleanEmail) {
            db.run(`UPDATE users SET email = ? WHERE id = ?`, [cleanEmail, existingUser.id]);
          }
          if (!existingUser.profile_picture_url && pictureUrl) {
            db.run(`UPDATE users SET profile_picture_url = ? WHERE id = ?`, [pictureUrl, existingUser.id]);
          }

          db.run(`UPDATE users SET login_count = login_count + 1 WHERE id = ?`, [
            existingUser.id,
          ]);

          const token = jwt.sign(
            { id: existingUser.id, username: existingUser.username },
            process.env.JWT_SECRET,
            { expiresIn: "30d" }
          );

          console.log(`🌐 Google login successful for user: ${existingUser.username} (ID: ${existingUser.id})`);
          return res.json({
            token,
            isNewUser: false,
            message: "Welcome back to Rooka HQ",
          });
        }

        // New User: Create account
        let preferredName = googleName;
        if (!preferredName && cleanEmail) {
          preferredName = cleanEmail.split("@")[0];
        }
        if (!preferredName) {
          preferredName = "Athlete";
        }

        // Sanitize username
        preferredName = preferredName.replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "Athlete";

        // Check if username is already taken, if so, append random suffix
        db.get(
          `SELECT id FROM users WHERE LOWER(username) = ?`,
          [preferredName.toLowerCase()],
          async (nameErr, nameRow) => {
            let finalUsername = preferredName;
            if (nameRow) {
              const suffix = Math.floor(100 + Math.random() * 900);
              finalUsername = `${preferredName}${suffix}`;
            }

            try {
              // Generate secure random unguessable password hash for oauth account
              const randomPass = crypto.randomBytes(32).toString("hex");
              const hashedPassword = await bcrypt.hash(randomPass, 10);
              const nowIso = new Date().toISOString();

              db.run(
                `INSERT INTO users (username, email, google_id, profile_picture_url, password_hash, athlete_context, rooka_start_date, coach_name, onboarding_completed)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
                [
                  finalUsername,
                  cleanEmail,
                  sub,
                  pictureUrl,
                  hashedPassword,
                  "New athlete joined via Google Sign-In.",
                  nowIso,
                  "Rooka",
                ],
                function (insertErr) {
                  if (insertErr) {
                    console.error("Google registration error:", insertErr);
                    return res.status(500).json({ error: "Failed to create account with Google." });
                  }

                  const newUserId = this.lastID;
                  const token = jwt.sign(
                    { id: newUserId, username: finalUsername },
                    process.env.JWT_SECRET,
                    { expiresIn: "30d" }
                  );

                  console.log(`🌐 New athlete registered via Google: ${finalUsername} (ID: ${newUserId}, Email: ${cleanEmail})`);
                  res.status(201).json({
                    token,
                    isNewUser: true,
                    message: "Account created with Google successfully!",
                  });
                }
              );
            } catch (createErr) {
              console.error("Error creating Google user:", createErr);
              res.status(500).json({ error: "Failed to finalize Google registration." });
            }
          }
        );
      }
    );
  } catch (error) {
    console.error("Google authentication error:", error);
    res.status(500).json({ error: "Google authentication failed." });
  }
});

const { sendPasswordResetEmail } = require("../services/emailService");

// Waitlist / Beta Signup endpoint
router.post("/waitlist", (req, res) => {
  const { email, notes } = req.body;
  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "A valid email address is required." });
  }

  const cleanEmail = email.trim().toLowerCase();
  db.run(
    `INSERT INTO waitlist (email, notes) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET notes = excluded.notes`,
    [cleanEmail, notes || "Web TestFlight signup"],
    function (err) {
      if (err) {
        console.error("Waitlist DB error:", err);
        return res.status(500).json({ error: "Failed to record waitlist entry." });
      }
      console.log(`✉️ New TestFlight waitlist signup: ${cleanEmail}`);
      res.json({ success: true, message: "Added to TestFlight waitlist successfully." });
    }
  );
});

// Forgot Password - Send 6-digit OTP to user's email
router.post("/forgot-password", (req, res) => {
  const { email, username } = req.body;
  const rawIdentifier = (email || username || "").trim().toLowerCase();

  if (!rawIdentifier) {
    return res.status(400).json({ error: "Please enter your email address or username." });
  }

  db.get(
    `SELECT * FROM users 
     WHERE (LOWER(email) = ? OR LOWER(username) = ?) 
       AND deleted_at IS NULL 
     LIMIT 1`,
    [rawIdentifier, rawIdentifier],
    async (err, user) => {
      if (err) {
        console.error("Forgot-password lookup error:", err);
        return res.status(500).json({ error: "Unable to process request right now." });
      }

      // Generic response message to prevent email enumeration
      const genericSuccess = {
        success: true,
        message: "If an account exists with that email address, a verification code has been sent.",
      };

      if (!user) {
        return res.json(genericSuccess);
      }

      // Determine recipient email address
      const targetEmail = (user.email || (rawIdentifier.includes("@") ? rawIdentifier : null));
      if (!targetEmail) {
        console.warn(`User ${user.username} has no email address configured for password reset.`);
        return res.json(genericSuccess);
      }

      try {
        // Generate a 6-digit cryptographic random OTP
        const resetCode = crypto.randomInt(100000, 1000000).toString();
        const codeHash = await bcrypt.hash(resetCode, 10);

        // Invalidate older unused reset codes for this user
        db.run(
          `UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL`,
          [user.id],
          (updateErr) => {
            if (updateErr) {
              console.error("Error clearing old reset codes:", updateErr);
            }

            // Insert new reset record valid for 15 minutes
            db.run(
              `INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES (?, ?, datetime('now', '+15 minutes'))`,
              [user.id, codeHash],
              async function (insertErr) {
                if (insertErr) {
                  console.error("Error inserting password reset record:", insertErr);
                  return res.status(500).json({ error: "Unable to process request." });
                }

                try {
                  await sendPasswordResetEmail({
                    toEmail: targetEmail,
                    username: user.username,
                    resetCode,
                  });
                  console.log(`✉️ Password reset OTP sent to ${targetEmail} (user: ${user.username})`);
                  return res.json(genericSuccess);
                } catch (emailErr) {
                  console.error("Failed to send password reset email:", emailErr);
                  return res.status(500).json({
                    error: "Failed to send email. Please check your email configuration or try again later.",
                  });
                }
              }
            );
          }
        );
      } catch (genErr) {
        console.error("Error generating reset code:", genErr);
        res.status(500).json({ error: "An unexpected error occurred." });
      }
    }
  );
});

// Reset Password - Verify OTP & update password
router.post("/reset-password", (req, res) => {
  const { email, username, code, newPassword } = req.body;
  const rawIdentifier = (email || username || "").trim().toLowerCase();
  const cleanCode = (code || "").trim();

  if (!rawIdentifier || !cleanCode || !newPassword) {
    return res.status(400).json({ error: "Email, reset code, and new password are required." });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: "New password must be at least 6 characters." });
  }

  db.get(
    `SELECT * FROM users 
     WHERE (LOWER(email) = ? OR LOWER(username) = ?) 
       AND deleted_at IS NULL 
     LIMIT 1`,
    [rawIdentifier, rawIdentifier],
    (err, user) => {
      if (err || !user) {
        return res.status(400).json({ error: "Invalid or expired verification code." });
      }

      // Find the latest active, non-expired reset code for this user
      db.get(
        `SELECT * FROM password_resets 
         WHERE user_id = ? 
           AND used_at IS NULL 
           AND datetime(expires_at) > datetime('now') 
         ORDER BY id DESC 
         LIMIT 1`,
        [user.id],
        async (resetErr, resetRecord) => {
          if (resetErr || !resetRecord) {
            return res.status(400).json({
              error: "Verification code has expired or is invalid. Please request a new code.",
            });
          }

          if (resetRecord.attempts >= 5) {
            return res.status(400).json({
              error: "Too many failed attempts with this code. Please request a new code.",
            });
          }

          try {
            const isMatch = await bcrypt.compare(cleanCode, resetRecord.code_hash);
            if (!isMatch) {
              db.run(`UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?`, [
                resetRecord.id,
              ]);
              return res.status(400).json({ error: "Incorrect verification code." });
            }

            // Code is valid! Hash new password and update user record
            const newPasswordHash = await bcrypt.hash(newPassword, 10);

            db.serialize(() => {
              db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [
                newPasswordHash,
                user.id,
              ]);
              db.run(`UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?`, [
                resetRecord.id,
              ]);
            });

            // Generate fresh JWT token for seamless auto-login
            const token = jwt.sign(
              { id: user.id, username: user.username },
              process.env.JWT_SECRET,
              { expiresIn: "30d" }
            );

            console.log(`🔑 Password successfully reset for user: ${user.username}`);
            res.json({
              success: true,
              token,
              message: "Password reset successfully!",
            });
          } catch (compErr) {
            console.error("Password reset error:", compErr);
            res.status(500).json({ error: "Failed to reset password." });
          }
        }
      );
    }
  );
});

module.exports = router;

