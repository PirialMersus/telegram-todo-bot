// src/scheduler.ts
import type { Telegraf } from 'telegraf';
import { Task } from './models/Task';
import { escapeMdV2 } from './utils/escapeMarkdown';
import { shiftDueDate } from './utils/time';

const SCHED_INTERVAL_MS = 60 * 1000; // 1 минута
const LOOKAHEAD_MS = 31 * 24 * 60 * 60 * 1000; // 31 день

export const startScheduler = (bot: Telegraf<any>) => {
  console.log('⏰ Scheduler started');

  setInterval(async () => {
    const now = Date.now();
    try {
      const candidates = await Task.find({
        reminded: false,
        dueDate: { $exists: true, $lte: new Date(now + LOOKAHEAD_MS) },
      }).exec();

      for (const task of candidates) {
        if (!task.dueDate) continue;
        const remindBefore = task.remindBefore ?? 0;
        const remindAt = task.dueDate.getTime() - remindBefore;

        if (remindAt <= now) {
          try {
            const text = `🔔 ${escapeMdV2('Напоминание')}: ${escapeMdV2(task.text)}\n📅 ${escapeMdV2(new Date(task.dueDate).toLocaleString())}`;
            await bot.telegram.sendMessage(task.userId, text, { parse_mode: 'MarkdownV2' } as any);

            task.reminded = true;

            // Создаём следующий экземпляр, если повтор и ещё не создавали
            if (task.repeat && !task.spawnedNext) {
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
                spawnedNext: false,
              });
              task.spawnedNext = true;
            }

            await task.save();
          } catch (err: any) {
            console.error('Scheduler send error for task', String(task._id), err?.message || err);
            const status = err?.response?.status;
            if (status === 403 || status === 400) {
              task.reminded = true;
              await task.save();
            }
          }
        }
      }
    } catch (err) {
      console.error('Scheduler general error:', err);
    }
  }, SCHED_INTERVAL_MS);
};
