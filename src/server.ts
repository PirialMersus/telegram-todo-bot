// src/server.ts
import 'dotenv/config';
import express from 'express';
import { connectDB } from './db.js';
import { createBot } from './bot.js';

const PORT = process.env.PORT || 3000;
const WEBHOOK_BASE = process.env.WEBHOOK_URL; // напр., https://your-app.onrender.com
const SECRET_TOKEN = process.env.WEBHOOK_SECRET || 'dev_secret';

(async () => {
  await connectDB();

  const bot = createBot();

  if (!WEBHOOK_BASE) {
    console.error('WEBHOOK_URL is not set');
    process.exit(1);
  }
  const webhookPath = '/webhook';
  const webhookUrl = `${WEBHOOK_BASE}${webhookPath}`;

  await bot.telegram.setWebhook(webhookUrl, {
    secret_token: SECRET_TOKEN,
    drop_pending_updates: true,  // <—
  });

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/health', (_req, res) => res.status(200).send('OK'));

  app.post(webhookPath, (req, res) => {
    const headerSecret = req.get('x-telegram-bot-api-secret-token');
    if (headerSecret !== SECRET_TOKEN) return res.status(401).send('Unauthorized');

    (async () => {
      try {
        await (bot as any).handleUpdate(req.body);
      } catch (err) {
        console.error('handleUpdate error', err);
      }
    })();

    res.status(200).send('OK');
  });

  app.listen(PORT, () => {
    console.log(`✅ Webhook server listening on :${PORT}`);
    console.log(`→ Webhook set to: ${webhookUrl}`);
  });
})();

