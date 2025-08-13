// src/server.ts
import 'dotenv/config';
import express, { Request, Response } from 'express';
import { connectDB } from './db';
import bot from './bot'; // <- импорт default (bot), а не createBot

const PORT = process.env.PORT || 3000;
const WEBHOOK_BASE = process.env.WEBHOOK_URL; // напр., https://your-app.onrender.com
const SECRET_TOKEN = process.env.WEBHOOK_SECRET || 'dev_secret';

(async () => {
  await connectDB();

  // Используем уже созданный bot (default экспорт из ./bot)
  // В вебхук режиме мы НЕ запускаем bot.launch() — это должно быть либо в local.ts, либо условно в bot.ts

  // Настраиваем вебхук (Telegram будет слать апдейты сюда)
  if (!WEBHOOK_BASE) {
    console.error('WEBHOOK_URL is not set');
    process.exit(1);
  }
  const webhookPath = '/webhook';
  const webhookUrl = `${WEBHOOK_BASE}${webhookPath}`;

  await bot.telegram.setWebhook(webhookUrl, {
    secret_token: SECRET_TOKEN,
    // можно добавить IP ограничения/сертификат если нужно
  });

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/health', (_req: Request, res: Response) => res.status(200).send('OK'));

  // Вебхук: проверяем секрет и передаём апдейт в telegraf
  app.post(webhookPath, (req: Request, res: Response) => {
    const headerSecret = req.get('x-telegram-bot-api-secret-token');
    if (headerSecret !== SECRET_TOKEN) {
      return res.status(401).send('Unauthorized');
    }
    // Передаём апдейт в Telegraf (не ждём завершения обработчика)
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
