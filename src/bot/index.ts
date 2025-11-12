// src/bot/index.ts
import { Telegraf } from 'telegraf';
import { mainKeyboard } from './keyboards';
import { registerListHandlers } from './list';
import { registerEditHandlers } from './edit';
import { registerNavigationHandlers } from './navigation';
import { ensureUser, getCollections } from '../db';

export function mountBot(bot: Telegraf) {
  bot.start(async (ctx) => {
    await ensureUser(ctx.from!);
    await ctx.reply('Главное меню 👇', mainKeyboard());
  });

  bot.use(async (ctx, next) => {
    if (ctx.from?.id) {
      const { users } = getCollections();
      await users.updateOne(
        { userId: ctx.from.id },
        { $set: { lastActivityAt: new Date(), updatedAt: new Date() } },
        { upsert: true }
      );
    }
    return next();
  });

  bot.hears('⚙️ Настройки', async (ctx) => {
    await ctx.reply('Пока тут пусто. Возвращайся позже 🙂', mainKeyboard());
  });

  registerListHandlers(bot);
  registerEditHandlers(bot);
  registerNavigationHandlers(bot);
}
