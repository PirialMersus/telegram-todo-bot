// src/scheduler.ts
import { Telegraf } from 'telegraf';
import https from 'https';
import { getCollections } from './db';
import { toLocalDateStr } from './bot/utils';

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

function getRepeatIntervalMs(task: any): number | null {
  const repeat: string | null = task.repeat ?? null;
  const mins: number | null = task.repeatEveryMinutes ?? null;

  if (!repeat || repeat === 'none') return null;

  if (repeat === 'custom-mins') {
    if (!mins || !Number.isFinite(mins) || mins <= 0) return null;
    return Math.floor(mins) * 60_000;
  }

  if (repeat === 'hourly') return 60 * 60_000;
  if (repeat === 'daily') return 24 * 60 * 60_000;
  if (repeat === 'weekly') return 7 * 24 * 60 * 60_000;
  if (repeat === 'monthly') return 30 * 24 * 60 * 60_000;
  if (repeat === 'yearly') return 365 * 24 * 60 * 60_000;

  return null;
}

export function startReminderLoop(bot: Telegraf) {
  let running = false;

  const tickBody = async () => {
    const { tasks } = getCollections();
    const now = new Date();

    const preReminders = await tasks
      .find({
        reminderAt: { $lte: now },
        status: { $ne: 'done' },
        $or: [
          { reminderSentAt: null },
          { reminderSentAt: { $exists: false } },
        ],
      })
      .limit(200)
      .toArray();

    for (const t of preReminders) {
      try {
        const chatId =
          typeof t.userId === 'number' ? t.userId : Number(t.userId);
        if (!chatId || Number.isNaN(chatId)) continue;

        const title = escapeHtml(t.title || 'Без названия');
        const dueAt: Date | null = t.dueAt ? new Date(t.dueAt) : null;
        const reminderAt: Date | null = t.reminderAt
          ? new Date(t.reminderAt)
          : null;

        if (!reminderAt) continue;

        if (dueAt && reminderAt.getTime() >= dueAt.getTime()) {
          continue;
        }

        let text: string;

        if (dueAt) {
          const diffMinutes = Math.max(
            1,
            Math.round((dueAt.getTime() - now.getTime()) / 60000)
          );
          let spanText: string;
          if (diffMinutes >= 60) {
            const hours = Math.floor(diffMinutes / 60);
            spanText = `${hours} ч`;
          } else {
            spanText = `${diffMinutes} мин`;
          }
          const dueLabel = escapeHtml(toLocalDateStr(dueAt));
          text =
            `⚠️ <b>Через ${spanText} задача:</b>\n\n` +
            `<b>${title}</b>\n\n` +
            `Когда: ${dueLabel}`;
        } else {
          const label = escapeHtml(toLocalDateStr(reminderAt));
          text =
            `🔔 <b>Напоминание:</b>\n\n` +
            `<b>${title}</b>\n\n` +
            `Когда: ${label}`;
        }

        await bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });

        await tasks.updateOne(
          { _id: t._id },
          {
            $set: {
              reminderSentAt: now,
              reminderAt: null,
              updatedAt: now,
            },
          }
        );
      } catch (err) {
        console.error('Pre-reminder send error', err);
      }
    }

    const startTasks = await tasks
      .find({
        dueAt: { $lte: now },
        status: { $ne: 'done' },
        $or: [
          { startNotifiedAt: null },
          { startNotifiedAt: { $exists: false } },
        ],
      })
      .limit(200)
      .toArray();

    for (const t of startTasks) {
      try {
        const chatId =
          typeof t.userId === 'number' ? t.userId : Number(t.userId);
        if (!chatId || Number.isNaN(chatId)) continue;

        const dueAt: Date | null = t.dueAt ? new Date(t.dueAt) : null;
        const title = escapeHtml(t.title || 'Без названия');
        const label = dueAt
          ? escapeHtml(toLocalDateStr(dueAt))
          : escapeHtml(toLocalDateStr(now));

        const text =
          `⏰ <b>Сейчас задача:</b>\n\n` +
          `<b>${title}</b>\n\n` +
          `Когда: ${label}`;

        await bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });

        await tasks.updateOne(
          { _id: t._id },
          {
            $set: {
              startNotifiedAt: now,
              updatedAt: now,
            },
          }
        );
      } catch (err) {
        console.error('Start notification send error', err);
      }
    }

    const repeating = await tasks
      .find({
        status: { $ne: 'done' },
        repeat: { $ne: 'none' },
        $or: [
          { startNotifiedAt: { $exists: true } },
          { startNotifiedAt: { $ne: null } },
        ],
      })
      .limit(300)
      .toArray();

    for (const t of repeating) {
      try {
        const intervalMs = getRepeatIntervalMs(t);
        if (!intervalMs) continue;

        const chatId =
          typeof t.userId === 'number' ? t.userId : Number(t.userId);
        if (!chatId || Number.isNaN(chatId)) continue;

        const startRaw = (t as any).startNotifiedAt;
        const startAt: Date | null = startRaw ? new Date(startRaw) : null;
        if (!startAt) continue;

        const lastRaw = (t as any).lastRepeatSentAt;
        const lastRepeat: Date | null = lastRaw ? new Date(lastRaw) : null;
        const base = lastRepeat || startAt;

        if (base.getTime() + intervalMs > now.getTime()) continue;

        const repeatMode: string = (t as any).repeat || 'none';
        const repeatEveryMinutes: number | null =
          (t as any).repeatEveryMinutes ?? null;

        // “частые” повторы: каждый час или кастом до 60 минут
        const isShortInterval =
          repeatMode === 'hourly' ||
          (repeatMode === 'custom-mins' &&
            repeatEveryMinutes !== null &&
            repeatEveryMinutes <= 60);

        const title = escapeHtml(t.title || 'Без названия');
        const label = escapeHtml(toLocalDateStr(now));

        const text = isShortInterval
          ? `🔁 <b>Повтор задачи:</b>\n\n` +
          `<b>${title}</b>\n\n` +
          `Статус: повтор\n` +
          `Время: ${label}\n\n` +
          `<i>Это напоминание исчезнет через 10 секунд</i>`
          : `⏰ <b>Сейчас задача:</b>\n\n` +
          `<b>${title}</b>\n\n` +
          `Когда: ${label}`;

        const msg = await bot.telegram.sendMessage(chatId, text, {
          parse_mode: 'HTML',
        });

        if (isShortInterval) {
          setTimeout(() => {
            bot.telegram
              .deleteMessage(chatId, (msg as any).message_id)
              .catch(() => {});
          }, 10_000);
        }

        await tasks.updateOne(
          { _id: t._id },
          {
            $set: {
              lastRepeatSentAt: now,
              updatedAt: now,
            },
          }
        );
      } catch (err) {
        console.error('Repeat notification send error', err);
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
