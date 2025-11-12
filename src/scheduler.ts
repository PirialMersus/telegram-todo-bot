// src/bot/scheduler.ts
import { Telegraf } from 'telegraf';
import { getCollections } from '../db';
import { toLocalDateStr, addMinutes } from './utils';

function escapeHtml(s?: string) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
          { repeat: { $exists: true, $ne: 'none' } },
        ],
      })
      .limit(200)
      .toArray();

    for (const t of dueReminders) {
      try {
        const chatId = typeof t.userId === 'number' ? t.userId : Number(t.userId);
        if (!chatId || Number.isNaN(chatId)) {
          console.error('Invalid chatId for reminder', String(t._id), t.userId);
          continue;
        }

        const title = escapeHtml(t.title || 'Без названия');
        const when = escapeHtml(toLocalDateStr(t.dueAt));
        const nowTime = new Date();

        let text: string;
        if (t.dueAt && new Date(t.dueAt).getTime() <= nowTime.getTime()) {
          text = `⏰ <b>Сейчас задача:</b>\n\n<b>${title}</b>\n\nКогда: ${when}`;
        } else {
          text = `⚠️ <b>Скоро задача:</b>\n\n<b>${title}</b>\n\nКогда: ${when}`;
        }

        await bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });

        const sentAt = new Date();

        const repeat = t.repeat || 'none';
        if (repeat && repeat !== 'none') {
          let interval: number | null = null;
          if (repeat === 'custom-mins' && t.repeatEveryMinutes && Number(t.repeatEveryMinutes) > 0) {
            interval = Math.max(1, Number(t.repeatEveryMinutes));
          } else if (repeat === 'hourly') {
            interval = 60;
          } else if (repeat === 'daily') {
            interval = 24 * 60;
          } else if (repeat === 'weekly') {
            interval = 7 * 24 * 60;
          } else if (repeat === 'monthly') {
            interval = 30 * 24 * 60;
          } else if (repeat === 'yearly') {
            interval = 365 * 24 * 60;
          }

          if (interval) {
            const baseReminder = t.reminderAt ? new Date(t.reminderAt) : sentAt;
            let next = addMinutes(baseReminder, interval);
            if (next.getTime() <= sentAt.getTime()) {
              next = addMinutes(sentAt, interval);
            }
            const res = await tasks.updateOne(
              { _id: t._id },
              { $set: { reminderAt: next, reminderSentAt: sentAt, updatedAt: sentAt } }
            );
            if (!res.matchedCount) {
              console.error('Failed to match task for repeating update', String(t._id), 'userId:', t.userId);
            } else {
              console.log('Reminder sent (repeating). Next at', next.toISOString(), 'task', String(t._id));
            }
            continue;
          }
        }

        const res = await tasks.updateOne(
          { _id: t._id },
          { $set: { reminderSentAt: sentAt, updatedAt: sentAt } }
        );
        if (!res.matchedCount) {
          console.error('Failed to mark one-shot reminder as sent', String(t._id), 'userId:', t.userId);
        } else {
          console.log('Reminder sent (one-shot). task', String(t._id));
        }
      } catch (sendErr) {
        console.error('Reminder send/update error', sendErr);
        try {
          const { tasks } = getCollections();
          await tasks.updateOne({ _id: (sendErr && (sendErr as any)._id) || null }, { $set: { updatedAt: new Date() } });
        } catch (uErr) {
          console.error('Reminder update fallback error', uErr);
        }
      }
    }

    await (getCollections().tasks).updateMany(
      { dueAt: { $lt: now }, status: 'active' },
      { $set: { status: 'overdue', updatedAt: new Date() } }
    );
  };

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await tickBody();
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
          $or: [{ cleanupWarnedAt: null }, { cleanupWarnedAt: { $exists: false } }],
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
          { $set: { cleanupWarnedAt: new Date(), updatedAt: new Date() } }
        );
      }

      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      const toDelete = await users
        .find({
          cleanupWarnedAt: { $lte: threeDaysAgo },
          lastActivityAt: { $lte: threeMonthsAgo },
        })
        .limit(100)
        .toArray();

      for (const u of toDelete) {
        try {
          await bot.telegram.sendMessage(u.userId, 'Ваши данные были удалены из-за отсутствия активности.');
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
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

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
          return `<b>${escapeHtml(t.title)}</b>\n<i>Когда:</i> ${escapeHtml(when)}`;
        });

        const text = `📋 Список задач на сегодня:\n\n${lines.join('\n\n')}`;
        try {
          await bot.telegram.sendMessage(group._id, text, { parse_mode: 'HTML', disable_notification: true });
        } catch {}
      }
    } catch {}
  };

  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 6, 30, 0, 0);
    if (now >= next) next.setDate(next.getDate() + 1);
    const ms = next.getTime() - now.getTime();
    setTimeout(() => {
      sendTodayLists().catch(() => {});
      setInterval(sendTodayLists, 24 * 60 * 60 * 1000);
    }, ms);
  };

  scheduleNext();
}
