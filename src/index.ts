// src/index.ts
import 'dotenv/config';
import { connectDB } from './db';
import { startBot } from './bot';
import { startScheduler } from './scheduler';

(async () => {
  await connectDB();
  const bot = startBot();
  startScheduler(bot);

  // Грейсфул-шатдаун
  process.on('SIGINT', () => {
    console.log('👋 SIGINT');
    bot.stop('SIGINT');
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    console.log('👋 SIGTERM');
    bot.stop('SIGTERM');
    process.exit(0);
  });
})();
