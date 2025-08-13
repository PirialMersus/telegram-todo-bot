// src/index.ts
import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import { connectDB } from './db';
import { createBot } from './bot';

const PORT = Number(process.env.PORT) || 3000;
const WEBHOOK_BASE = process.env.WEBHOOK_URL;           // например: https://your-app.onrender.com
const SECRET_TOKEN = process.env.WEBHOOK_SECRET || 'dev_secret';

(async () => {
  await connectDB();

  const bot = createBot();

  if (WEBHOOK_BASE) {
    // === WEBHOOK MODE (Render/production) ===
    const app = express();
    app.use(express.json({ limit: '10mb' }));

    const webhookPath = '/webhook';
    const webhookUrl = `${WEBHOOK_BASE}${webhookPath}`;

    await bot.telegram.setWebhook(webhookUrl, { secret_token: SECRET_TOKEN });

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
  } else {
    // === LONG POLLING MODE (локально/без публичного URL) ===
    await bot.launch();
    console.log('🤖 Bot launched in LONG POLLING mode');
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  }
})();
