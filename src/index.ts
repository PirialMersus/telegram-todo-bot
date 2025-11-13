// src/index.ts
import 'dotenv/config';
import http from 'http';
import { Telegraf } from 'telegraf';
import { sessionMiddleware } from './session';
import { mountBot } from './bot/index';
import { startReminderLoop, startInactivityCleanupLoop } from './scheduler';
import { connectDB } from './db';

const token = (process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN) as string;
if (!token) throw new Error('BOT_TOKEN/TELEGRAM_BOT_TOKEN is missing');

let bot: Telegraf | null = null;

function startHttpServer() {
  const port = Number(process.env.PORT || 3000);
  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('ok');
    } else {
      res.statusCode = 404;
      res.end('not found');
    }
  });

  server.listen(port, () => {
    console.log(`HTTP health server listening on ${port}`);
  });
}

async function bootstrap() {
  startHttpServer();
  await connectDB();

  bot = new Telegraf(token);
  bot.use(sessionMiddleware);
  mountBot(bot);

  startReminderLoop(bot);
  startInactivityCleanupLoop(bot);

  await bot.launch();
  console.log('Bot started');
}

bootstrap().catch((e) => {
  console.error('Fatal bootstrap error', e);
  process.exit(1);
});

process.once('SIGINT', () => bot?.stop('SIGINT'));
process.once('SIGTERM', () => bot?.stop('SIGTERM'));
