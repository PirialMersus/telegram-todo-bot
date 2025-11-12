// src/index.ts
import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { sessionMiddleware } from './session';
import { mountBot } from './bot/index';
import { startReminderLoop, startInactivityCleanupLoop } from './scheduler';
import { connectDB } from './db';

const token = (process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN) as string;
if (!token) throw new Error('BOT_TOKEN/TELEGRAM_BOT_TOKEN is missing');

let bot: Telegraf | null = null;

async function bootstrap() {
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
