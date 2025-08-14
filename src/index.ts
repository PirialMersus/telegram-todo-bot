// src/index.ts
import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import { connectDB } from './db.js';
import { createBot } from './bot.js';
import { startScheduler } from './scheduler.js';

const PORT = Number(process.env.PORT) || 3000;
const WEBHOOK_BASE = process.env.WEBHOOK_URL;           // например: https://your-service.onrender.com
const SECRET_TOKEN = process.env.WEBHOOK_SECRET || 'dev_secret';

(async () => {
  await connectDB();

  const bot = createBot();

  if (WEBHOOK_BASE) {
    // === WEBHOOK MODE ===
    const app = express();
    app.use(express.json({ limit: '10mb' }));

    const webhookPath = '/webhook';
    const webhookUrl = `${WEBHOOK_BASE}${webhookPath}`;

    await bot.telegram.setWebhook(webhookUrl, {
      secret_token: SECRET_TOKEN,
      drop_pending_updates: true,   // <— отбросить старые апдейты
    });

    app.get('/health', (_req: Request, res: Response) => res.status(200).send('OK'));

    app.post(webhookPath, (req: Request, res: Response) => {
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

    startScheduler(bot);
  } else {
    // === LONG POLLING MODE ===
    await (async () => {
      await (bot as any).launch();
      console.log('🤖 Bot launched in LONG POLLING mode');
    })();

    startScheduler(bot);

    process.once('SIGINT', () => (bot as any).stop('SIGINT'));
    process.once('SIGTERM', () => (bot as any).stop('SIGTERM'));
  }
})();
