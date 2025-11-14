// src/scheduler.ts
import { Telegraf } from 'telegraf';
import https from 'https';
import { getCollections } from './db';
import { toLocalDateStr, addMinutes } from './bot/utils';

function escapeHtml(s?: string) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const HEALTHCHECK_URL =
  process.env.HEALTHCHECK_URL ||
  process.env.HEALTHCHECKS_URL ||
  '';
const SHOULD_PING_HEALTHCHECKS = process.env.NODE_ENV === 'production';

function pingHealthcheck() {
  if (!SHOULD_PING_HEALTHCHECKS || !HEALTHCHECK_URL) return;
  try {
    https.get(HEALTHCHECK_URL).on('error', () => {});
  } catch {}
}

export function startReminderLoop(bot: Telegraf) {
  let running = false;

  const tickBody = async () => {
    const { tasks } = getCollections();
    const now = new Date();

    const dueReminders = await tasks
      .find({
        reminderAt: { $lte: now },
        status: { $ne: 'done' },
        $or: [
          { reminderSentAt: null },
          { reminderSentAt: { $exists: false } },
          { repeat: 'custom-mins' },
        ],
      })
      .limit(200)
      .toArray();

    for (const t of dueReminders) {
      try {
        const chatId =
          typeof t.userId === 'number' ? t.userId : Number(t.userId);
        if (!chatId || Number.isNaN(chatId)) {
          console.error(
            'Invalid chatId for reminder',
            String(t._id),
            t.userId
          );
          continue;
        }

        const title = escapeHtml(t.title || 'Без названия');
        const dueAt: Date | null = t.dueAt ? new Date(t.dueAt) : null;
        const reminderAt: Date | null = t.reminderAt
          ? new Date(t.reminderAt)
          : null;
        const preset: string | null = (t as any).reminderPreset ?? null;
        const nowTime = new Date();
        const isRepeating = t.repeat && t.repeat !== 'none';

        let text: string;

        if (isRepeating) {
          // Повторяющиеся напоминания — каждый раз "сейчас" и текущее время
          const whenLabel = escapeHtml(toLocalDateStr(new Date()));
          text =
            `⏰ <b>Сейчас задача:</b>\n\n` +
            `<b>${title}</b>\n\n` +
            `Когда: ${whenLabel}`;
        } else {
          const dueLabel = dueAt
            ? escapeHtml(toLocalDateStr(dueAt))
            : null;
          const isRelativeMinutes =
            typeof preset === 'string' && /^-?\d+m$/.test(preset);

          if (isRelativeMinutes && dueAt && dueLabel) {
            // Относительные пресеты: -15m, -30m, -120m и т.п.
            const minutes = Number(
              String(preset).replace('-', '').replace('m', '')
            );
            const minutesText =
              minutes >= 60
                ? `${Math.floor(minutes / 60)} ч`
                : `${minutes} мин`;
            text =
              `⚠️ <b>Через ${minutesText} задача:</b>\n\n` +
              `<b>${title}</b>\n\n` +
              `Когда: ${dueLabel}`;
          } else if (dueAt && dueLabel) {
            // Обычное напоминание: смотрим, сколько осталось до dueAt
            const diffMinutes = Math.round(
              (dueAt.getTime() - nowTime.getTime()) / 60000
            );
            if (diffMinutes <= 1) {
              text =
                `⏰ <b>Сейчас задача:</b>\n\n` +
                `<b>${title}</b>\n\n` +
                `Когда: ${dueLabel}`;
            } else {
              text =
                `⚠️ <b>Скоро задача:</b>\n\n` +
                `<b>${title}</b>\n\n` +
                `Когда: ${dueLabel}`;
            }
          } else {
            // На всякий случай, если dueAt нет — показываем время напоминания
            const label = escapeHtml(
              toLocalDateStr(reminderAt || new Date())
            );
            text =
              `⏰ <b>Напоминание:</b>\n\n` +
              `<b>${title}</b>\n\n` +
              `Когда: ${label}`;
          }
        }

        await bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });

        const sentAt = new Date();

        if (
          t.repeat === 'custom-mins' &&
          t.repeatEveryMinutes &&
          Number(t.repeatEveryMinutes) > 0
        ) {
          const interval = Math.max(1, Number(t.repeatEveryMinutes));
          const baseReminder = t.reminderAt
            ? new Date(t.reminderAt)
            : sentAt;

          let next = addMinutes(baseReminder, interval);
          if (next.getTime() <= sentAt.getTime()) {
            next = addMinutes(sentAt, interval);
          }

          const res = await tasks.updateOne(
            { _id: t._id },
            {
              $set: {
                reminderAt: next,
                reminderSentAt: sentAt,
                updatedAt: sentAt,
              },
            }
          );
          if (!res.matchedCount) {
            console.error(
              'Failed to match task for repeating update',
              String(t._id),
              'userId:',
              t.userId
            );
          } else if (!res.modifiedCount) {
            console.error(
              'Task update did not modify document (maybe identical). task:',
              String(t._id)
            );
          } else {
            console.log(
              'Reminder sent (repeating). Next at',
              next.toISOString(),
              'task',
              String(t._id)
            );
          }
        } else {
          const res = await tasks.updateOne(
            { _id: t._id },
            { $set: { reminderSentAt: sentAt, updatedAt: sentAt } }
          );
          if (!res.matchedCount) {
            console.error(
              'Failed to mark one-shot reminder as sent',
              String(t._id),
              'userId:',
              t.userId
            );
          } else {
            console.log(
              'Reminder sent (one-shot). task',
              String(t._id)
            );
          }
        }
      } catch (sendErr) {
        console.error('Reminder send/update error', sendErr);
        try {
          const { tasks } = getCollections();
          await tasks.updateOne(
            { _id: (sendErr && (sendErr as any)._id) || null },
            { $set: { updatedAt: new Date() } }
          );
        } catch (uErr) {
          console.error('Reminder update fallback error', uErr);
        }
      }
    }

    await getCollections().tasks.updateMany(
      { dueAt: { $lt: now }, status: 'active' },
      { $set: { status: 'overdue', updatedAt: new Date() } }
    );
  };

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await tickBody();
      pingHealthcheck();
    } catch (err) {
      console.error('Reminder loop error', err);
    } finally {
      running = false;
    }
  };

  setInterval(tick, 60 * 1000);
  tick();
}

export function startInactivityCleanupLoop(bot: Telegraf) {
  const tick = async () => {
    try {
      const { users, tasks } = getCollections();
      const now = new Date();
      const threeMonthsAgo = new Date(now);
      threeMonthsAgo.setMonth(now.getMonth() - 3);

      const inactive = await users
        .find({
          lastActivityAt: { $lte: threeMonthsAgo },
          $or: [
            { cleanupWarnedAt: null },
            { cleanupWarnedAt: { $exists: false } },
          ],
        })
        .limit(100)
        .toArray();

      for (const u of inactive) {
        try {
          await bot.telegram.sendMessage(
            u.userId,
            'Вы давно не пользуетесь ботом. Сделайте любую активность в течение 3 дней, иначе ваш аккаунт и все задачи будут удалены для экономии места.'
          );
        } catch {}
        await users.updateOne(
          { userId: u.userId },
          {
            $set: {
              cleanupWarnedAt: new Date(),
              updatedAt: new Date(),
            },
          }
        );
      }

      const threeDaysAgo = new Date(
        now.getTime() - 3 * 24 * 60 * 60 * 1000
      );
      const toDelete = await users
        .find({
          cleanupWarnedAt: { $lte: threeDaysAgo },
          lastActivityAt: { $lte: threeMonthsAgo },
        })
        .limit(100)
        .toArray();

      for (const u of toDelete) {
        try {
          await bot.telegram.sendMessage(
            u.userId,
            'Ваши данные были удалены из-за отсутствия активности.'
          );
        } catch {}
        await tasks.deleteMany({ userId: u.userId });
        await users.deleteOne({ userId: u.userId });
      }
    } catch {}
  };

  setInterval(tick, 24 * 60 * 60 * 1000);
  tick();
}

export function startMorningDigestLoop(bot: Telegraf) {
  const sendTodayLists = async () => {
    try {
      const { tasks } = getCollections();
      const now = new Date();
      const start = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        0,
        0,
        0
      );
      const end = new Date(
        start.getTime() + 24 * 60 * 60 * 1000
      );

      const cursor = tasks.aggregate([
        { $match: { dueAt: { $gte: start, $lt: end } } },
        { $group: { _id: '$userId', tasks: { $push: '$$ROOT' } } },
      ]);

      while (await cursor.hasNext()) {
        const group = await cursor.next();
        if (!group || !group._id) continue;
        const userTasks = group.tasks as any[];
        if (!userTasks || userTasks.length === 0) continue;

        const lines = userTasks.map((t) => {
          const when = toLocalDateStr(t.dueAt);
          return `<b>${escapeHtml(t.title)}</b>\n<i>Когда:</i> ${escapeHtml(
            when
          )}`;
        });

        const text =
          `📋 Список задач на сегодня:\n\n` + lines.join('\n\n');
        try {
          await bot.telegram.sendMessage(group._id, text, {
            parse_mode: 'HTML',
            disable_notification: true,
          });
        } catch {}
      }
    } catch {}
  };

  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      6,
      30,
      0,
      0
    );
    if (now >= next) next.setDate(next.getDate() + 1);
    const ms = next.getTime() - now.getTime();
    setTimeout(() => {
      sendTodayLists().catch(() => {});
      setInterval(sendTodayLists, 24 * 60 * 60 * 1000);
    }, ms);
  };

  scheduleNext();
}
