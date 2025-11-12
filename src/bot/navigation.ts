// src/bot/navigation.ts
import { Telegraf } from 'telegraf';
import { SessionData } from '../types';
import { safeEditOrReply } from './utils';
import { getCollections, ObjectId } from '../db';
import { listAndShow } from './list';
import { renderTask } from './format';
import { editMenuKb, taskActionKb } from './keyboards';
export function registerNavigationHandlers(bot: Telegraf<any>) {
  bot.action('nav:cancel', async (ctx) => {
    (ctx.session as SessionData).mode = 'idle';
    (ctx.session as SessionData).draft = null;
    (ctx.session as SessionData).steps = [];
    (ctx.session as SessionData).editingTaskId = null;
    (ctx.session as SessionData).timePicker = null;
    (ctx.session as SessionData).originalTask = null;
    (ctx.session as SessionData).returnTo = null;
    await safeEditOrReply(ctx, 'Отменено.');
  });
  bot.action('nav:home', async (ctx) => {
    (ctx.session as SessionData).mode = 'idle';
    (ctx.session as SessionData).draft = null;
    (ctx.session as SessionData).steps = [];
    (ctx.session as SessionData).editingTaskId = null;
    (ctx.session as SessionData).timePicker = null;
    (ctx.session as SessionData).originalTask = null;
    (ctx.session as SessionData).returnTo = null;
    await safeEditOrReply(ctx, 'Главное меню 👇');
  });
  bot.action('nav:back', async (ctx) => {
    const s = ctx.session as SessionData;
    const last = s.steps && s.steps.length ? s.steps.pop() : undefined;
    if (last) {
      const prev = s.steps && s.steps[s.steps.length - 1];
      switch (prev) {
        case 'type':
          await safeEditOrReply(ctx, 'Выбери тип задачи или ✍️ Ввести вручную:', (await import('./keyboards')).presetsKb());
          return;
        case 'title':
          await (await import('./edit')).promptTitle(ctx);
          return;
        case 'date':
          await (await import('./edit')).promptDate(ctx);
          return;
        case 'time':
          await (await import('./edit')).promptTime(ctx);
          return;
        case 'reminder':
          await safeEditOrReply(ctx, '🔔 Напоминание?', (await import('./keyboards')).reminderPresetsKb());
          return;
        case 'reminder-custom-date':
          await (await import('./edit')).promptReminderCustomDate(ctx);
          return;
        case 'reminder-custom-time':
          await (await import('./edit')).promptReminderCustomTime(ctx);
          return;
        case 'repeat':
          await safeEditOrReply(ctx, '🔁 Повтор задачи?', (await import('./keyboards')).repeatKb());
          return;
        case 'confirm':
          await (await import('./edit')).promptConfirm(ctx);
          return;
        default:
          break;
      }
    }
    if (s.mode === 'editing' && s.editingTaskId) {
      const markers = (await import('./edit')).computeMarkers(s);
      await safeEditOrReply(ctx, `Редактирование задачи:\n\n${(await import('./format')).renderDraft(s.draft ?? {}, s.originalTask)}`, editMenuKb(String(s.editingTaskId), markers));
      return;
    }
    if (s.returnTo && typeof s.returnTo === 'string') {
      if (s.returnTo.startsWith('list:')) {
        const parts = s.returnTo.split(':');
        const filter = parts[1] || 'all';
        (ctx.session as any).listFilter = filter;
        await listAndShow(ctx, filter);
        return;
      }
      if (s.returnTo.startsWith('task:')) {
        const parts = s.returnTo.split(':');
        const id = parts[1];
        try {
          const { tasks } = getCollections();
          const t = await tasks.findOne({ _id: new ObjectId(id), userId: ctx.from!.id });
          if (t) {
            await safeEditOrReply(ctx, renderTask(t), taskActionKb(id, t.status === 'done'));
            return;
          }
        } catch {}
      }
    }
    s.mode = 'idle';
    s.draft = null;
    s.returnTo = null;
    await safeEditOrReply(ctx, 'Главное меню 👇');
  });
}
