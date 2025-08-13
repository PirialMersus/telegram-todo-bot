// src/scheduler.ts
// ---------------------------------
// Путь: src/scheduler.ts
// Планировщик, который каждые TICK_MS ищет задачи, которым пора послать напоминание,
// формирует сообщение в таймзоне пользователя и отправляет через Telegram API.
//
// Важно: чтобы не терять напоминания, scheduler помечает task.reminded = true.
// Для повторяющихся задач создаёт следующий экземпляр (и помечает spawnedNext).
import type { Telegraf } from 'telegraf';
import { Task } from './models/Task.js';
import { UserSettings } from './models/UserSettings.js';
import { escapeHtml } from './utils/escapeHtml.js';
import { formatInTz, shiftDueDate } from './utils/time.js';

const TICK_MS = 30 * 1000; // 30 секунд
const LOOKAHEAD_MS = 31 * 24 * 60 * 60 * 1000; // 31 день (ограничение поиска)

// Экспортируем стартовую функцию
export function startScheduler(bot: Telegraf<any>) {
  console.log('⏰ Scheduler started');

  setInterval(async () => {
    const now = Date.now();

    try {
      // Берём кандидаты: у которых есть dueDate, не помечены reminded=true,
      // и dueDate в пределах LOOKAHEAD (чтобы не сканировать слишком далеко)
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
            // найдем TZ пользователя, по умолчанию UTC
            const settings = await UserSettings.findOne({ userId: task.userId }).exec();
            const tzName = settings?.timezone || 'UTC';

            // формируем удобный текст даты в TZ пользователя
            const when = formatInTz(task.dueDate, tzName);

            const text = `🔔 <b>Напоминание</b>\n` +
              `📝 ${escapeHtml(task.text)}\n` +
              `📅 ${escapeHtml(when)}`;

            await bot.telegram.sendMessage(task.userId, text, { parse_mode: 'HTML' } as any);

            // помечаем как отправленное
            task.reminded = true;

            // если задача повторяющаяся и следующий экземпляр ещё не создан — создаём
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
                  spawnedNext: false,
                });
                task.spawnedNext = true;
              } catch (errCreate) {
                console.error('scheduler create next error', errCreate);
              }
            }

            await (task as any).save();
          } catch (errSend: any) {
            console.error('Scheduler send error for task', String(task._id), errSend?.message || errSend);
            const status = errSend?.response?.status;
            // если бот заблокирован или чат удалён — помечаем как reminded, чтобы не пытаться снова
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
  }, TICK_MS);
}
