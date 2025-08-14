// src/scheduler.ts
import type { Telegraf } from 'telegraf';
import { Task } from './models/Task.js';
import { UserSettings } from './models/UserSettings.js';
import { escapeHtml } from './utils/escapeHtml.js';
import { formatInTz, shiftDueDate, DISPLAY_FMT } from './utils/time.js';

const TICK_MS = 30 * 1000; // 30 секунд
const LOOKAHEAD_MS = 31 * 24 * 60 * 60 * 1000; // 31 день

export function startScheduler(bot: Telegraf<any>) {
  console.log('⏰ Scheduler started');

  setInterval(async () => {
    const now = Date.now();

    try {
      // Берём только невыполненные задачи; и те, где либо напоминание ещё не отправили, либо due-уведомление ещё не отправили
      const candidates = await Task.find({
        done: false,
        dueDate: { $exists: true, $lte: new Date(now + LOOKAHEAD_MS) },
        $or: [{ reminded: false }, { notifiedAtDue: false }],
      }).exec();

      for (const task of candidates) {
        if (!task.dueDate) continue;

        const remindBefore = task.remindBefore ?? 0;
        const dueAt = task.dueDate.getTime();
        const remindAt = dueAt - remindBefore;

        try {
          const settings = await UserSettings.findOne({ userId: task.userId }).exec();
          const tzName = settings?.timezone || 'UTC';

          // 1) Напоминание ДО due
          if (remindBefore > 0 && !task.reminded && remindAt <= now) {
            const when = formatInTz(task.dueDate, tzName, DISPLAY_FMT);
            const text = `🔔 <b>Напоминание</b>\n` +
              `📝 ${escapeHtml(task.text)}\n` +
              `📅 ${escapeHtml(when)}`;
            await bot.telegram.sendMessage(task.userId, text, { parse_mode: 'HTML' } as any);
            task.reminded = true;
          }

          // 2) Сообщение В МОМЕНТ due
          if (!task.notifiedAtDue && dueAt <= now) {
            const when = formatInTz(task.dueDate, tzName, DISPLAY_FMT);
            const text = `⏰ <b>Наступило время задачи</b>\n` +
              `📝 ${escapeHtml(task.text)}\n` +
              `📅 ${escapeHtml(when)}`;
            await bot.telegram.sendMessage(task.userId, text, { parse_mode: 'HTML' } as any);
            task.notifiedAtDue = true;

            // Для повторяющихся задач создаём следующий экземпляр только в момент due (или при ручном завершении)
            if (task.repeat && !task.spawnedNext) {
              try {
                const nextDue = shiftDueDate(task.dueDate, task.repeat);
                await Task.create({
                  userId: task.userId,
                  text: task.text,
                  dueDate: nextDue,
                  remindBefore: task.remindBefore ?? 0,
                  repeat: task.repeat,
                  category: task.category,
                  done: false,
                  reminded: false,
                  notifiedAtDue: false,
                  spawnedNext: false,
                });
                task.spawnedNext = true;
              } catch (errCreate) {
                console.error('scheduler create next error', errCreate);
              }
            }
          }

          await (task as any).save();
        } catch (errSend: any) {
          console.error('Scheduler send error for task', String(task._id), errSend?.message || errSend);
          const status = errSend?.response?.status;
          if (status === 403 || status === 400) {
            // бот заблокирован или чат удалён — помечаем обе отправки как выполненные, чтобы не зацикливаться
            task.reminded = true;
            task.notifiedAtDue = true;
            await (task as any).save();
          }
        }
      }
    } catch (err) {
      console.error('Scheduler general error:', err);
    }
  }, TICK_MS);
}
