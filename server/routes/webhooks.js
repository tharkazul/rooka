const express = require('express');
const router = express.Router();
const db = require('../services/db');

router.post('/revenuecat', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const secret = process.env.REVENUECAT_WEBHOOK_SECRET;

    // Only enforce authorization if the secret is configured in the environment
    if (secret && authHeader !== secret) {
      console.warn(`[RevenueCat Webhook] Unauthorized attempt. Invalid or missing secret.`);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { event } = req.body;
    if (!event) {
      return res.status(400).json({ error: 'Missing event payload' });
    }

    const appUserId = event.app_user_id;
    const type = event.type;

    if (!appUserId) {
      return res.status(400).json({ error: 'Missing app_user_id' });
    }

    console.log(`[RevenueCat Webhook] Received ${type} for user ID ${appUserId}`);

    if (type === 'INITIAL_PURCHASE' || type === 'RENEWAL' || type === 'UNCANCELLATION') {
      db.run(
        `UPDATE users SET subscription_tier = 'rooka_plus', daily_token_limit = 50000 WHERE id = ?`,
        [appUserId],
        function (err) {
          if (err) {
            console.error(`[RevenueCat Webhook] Error upgrading user ${appUserId}:`, err);
          } else {
            console.log(`[RevenueCat Webhook] User ${appUserId} upgraded to rooka_plus.`);
          }
        }
      );
    } else if (type === 'EXPIRATION') {
      db.run(
        `UPDATE users SET subscription_tier = 'free', daily_token_limit = 5000 WHERE id = ?`,
        [appUserId],
        function (err) {
          if (err) {
            console.error(`[RevenueCat Webhook] Error downgrading user ${appUserId}:`, err);
          } else {
            console.log(`[RevenueCat Webhook] User ${appUserId} downgraded to free.`);
            db.run(
              `UPDATE user_quests SET status = 'closed' WHERE user_id = ? AND status = 'active'`,
              [appUserId],
            );
          }
        }
      );
    }

    res.json({ received: true });
  } catch (error) {
    console.error(`[RevenueCat Webhook] Processing error:`, error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
