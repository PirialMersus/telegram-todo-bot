// src/bot/list.ts
import { Telegraf } from 'telegraf';
import { getCollections, ObjectId } from '../db';
import { safeEditOrReply, toLocalDateStr } from './utils';
import {
  tasksListKb,
  filtersRootKb,
  presetsKb,
  taskActionKb,
} from './keyboards';
import { renderTask } from './format';
function safeTitle(t: any): string {
  if (!t) return 'Без названия';
  const candidates = [t.title, t.name, t.text, t.taskTitle, t.label];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length) return c.trim();
  }
  try {
    return `#${String(t._id).slice(0, 6)}`;
  } catch {
    return 'Без названия';
  }
}
export async function listAndShow(ctx: any, filterKey?: string) {
  const userId = ctx.from?.id;
  if (!userId) {
    await safeEditOrReply(ctx, 'Не удалось определить пользователя.');
    return;
  }
  const { tasks } = getCollections();
  const now = new Date();
  let query: any = { userId };
  switch (filterKey) {
    case 'today': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      query.dueAt = { $gte: start, $lt: end };
      break;
    }
    case 'tomorrow': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      query.dueAt = { $gte: start, $lt: end };
      break;
    }
    case 'overdue':
      query = { ...query, dueAt: { $lt: now }, status: 'overdue' };
      break;
    case 'done':
      query = { ...query, status: 'done' };
      break;
    case 'nodate':
      query = { ...query, dueAt: null };
      break;
    case 'repeating':
      query = { ...query, repeat: { $ne: 'none' } };
      break;
    case 'upcoming':
      query = { ...query, dueAt: { $gte: now } };
      break;
    case 'all':
    default:
      break;
  }
  try {
    const found = await tasks.find(query).sort({ dueAt: 1, updatedAt: -1 }).limit(50).toArray();
    if (!found || found.length === 0) {
      await safeEditOrReply(ctx, 'Найдено задач: 0', tasksListKb([], false));
      return;
    }
    const pairs: Array<[string, string]> = found.map((t: any) => {
      const title = safeTitle(t);
      const when = t.dueAt ? ` • ${toLocalDateStr(t.dueAt)}` : '';
      const statusIcon = (t.status === 'done' ? '✅' : t.status === 'overdue' ? '🔴' : '🟢');
      const label = `${statusIcon} ${title}${when}`;
      return [label, String(t._id)];
    });
    await safeEditOrReply(ctx, `Найдено задач: ${pairs.length}`, tasksListKb(pairs, false));
  } catch (err: any) {
    console.error('listAndShow error', err);
    await safeEditOrReply(ctx, 'Ошибка при получении списка задач. Смотри логи.');
  }
}
export function registerListHandlers(bot: Telegraf<any>) {
  bot.hears('🗂 Мои задачи', async (ctx) => {
    (ctx.session as any).listFilter = 'all';
    await listAndShow(ctx, 'all');
  });
  bot.action(/^list:(.+)$/, async (ctx) => {
    const key = ctx.match[1];
    if (key === 'back') {
      (ctx.session as any).listFilter = null;
      await safeEditOrReply(ctx, 'Главное меню 👇');
      return;
    }
    if (key === 'new') {
      try {
        const s = ctx.session as any;
        s.mode = 'creating';
        s.draft = {
          title: undefined,
          type: undefined,
          dueDate: null,
          dueTime: null,
          reminderPreset: 'none',
          reminderDate: null,
          reminderTime: null,
          repeat: 'none',
          repeatEveryMinutes: null,
        };
        s.steps = [];
        s.returnTo = null;
        s.editingTaskId = null;
      } catch (e) {}
      await safeEditOrReply(ctx, 'Выбери тип задачи или ✍️ Ввести вручную:', presetsKb());
      return;
    }
    if (key === 'filters') {
      await safeEditOrReply(ctx, 'Фильтры', filtersRootKb());
      return;
    }
    await listAndShow(ctx, key);
  });
  bot.action(/^tsk:([a-f0-9]{24})$/, async (ctx) => {
    const id = ctx.match[1];
    try {
      const { tasks } = getCollections();
      const t = await tasks.findOne({ _id: new ObjectId(id), userId: ctx.from!.id });
      if (!t) {
        await safeEditOrReply(ctx, 'Задача не найдена.');
        return;
      }
      (ctx.session as any).returnTo = `list:${(ctx.session as any).listFilter || 'all'}`;
      await safeEditOrReply(ctx, renderTask(t), taskActionKb(id, t.status === 'done'));
    } catch (e: any) {
      console.error('tsk open error', e);
      await safeEditOrReply(ctx, 'Ошибка при открытии задачи.');
    }
  });
}
