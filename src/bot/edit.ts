// src/bot/edit.ts
import { Telegraf, Markup } from 'telegraf';
import { SessionData, WizardStep } from '../types';
import {
  presetsKb,
  titleChoicesKb,
  dateQuickKb,
  monthCalendarKb,
  timePresetsKb,
  reminderPresetsKb,
  repeatKb,
  confirmKb,
  editMenuKb,
} from './keyboards';
import {
  safeEditOrReply,
  todayISO,
  timeISO,
  buildDateFromParts,
  addMinutes,
  composeTitle,
  mapReminderLabel,
  mapRepeatLabelVal,
} from './utils';
import { getCollections, ObjectId, pushRecentTitle, getRecentTitles } from '../db';
import { renderDraft, renderTask } from './format';
import { saveTaskFromDraft } from './saveTask';

export function computeMarkers(s: SessionData | null | undefined) {
  const out = { title: false, date: false, time: false, reminder: false, repeat: false, type: false };
  if (!s) return out;
  const d = s.draft;
  const orig = (s as any).originalTask ?? null;
  if (!d || !orig) return out;

  const displayTitle = composeTitle(d.type as any, d.title || '');
  const origTitle = composeTitle(orig.type, orig.title || '');
  const titleChanged = displayTitle !== origTitle;

  const origDueAt = orig.dueAt ? new Date(orig.dueAt) : null;
  const origDueDate = origDueAt ? origDueAt.toISOString().slice(0, 10) : null;
  const origDueTime = origDueAt
    ? `${String(origDueAt.getHours()).padStart(2, '0')}:${String(origDueAt.getMinutes()).padStart(2, '0')}`
    : null;

  const dateChanged = (d.dueDate ?? null) !== origDueDate;
  const timeChanged = (d.dueTime ?? null) !== origDueTime;

  const origReminderPreset = orig.reminderAt ? 'custom' : (orig.reminderPreset || 'none');
  const origReminderAt = orig.reminderAt ? new Date(orig.reminderAt) : null;
  const origReminderDate = origReminderAt ? origReminderAt.toISOString().slice(0, 10) : null;
  const origReminderTime = origReminderAt
    ? `${String(origReminderAt.getHours()).padStart(2, '0')}:${String(origReminderAt.getMinutes()).padStart(2, '0')}`
    : null;

  const reminderChanged =
    (d.reminderPreset ?? null) !== origReminderPreset ||
    (d.reminderPreset === 'custom' &&
      ((d.reminderDate ?? null) !== origReminderDate || (d.reminderTime ?? null) !== origReminderTime));

  const origRepeat = orig.repeat || 'none';
  const origRepeatMins = (orig as any).repeatEveryMinutes ?? null;
  const repeatChanged =
    (d.repeat ?? null) !== origRepeat || (d.repeatEveryMinutes ?? null) !== origRepeatMins;

  const typeChanged = (d.type ?? null) !== (orig.type ?? null);

  out.title = titleChanged;
  out.date = dateChanged;
  out.time = timeChanged;
  out.reminder = reminderChanged;
  out.repeat = repeatChanged;
  out.type = typeChanged;

  return out;
}

function pushStep(ctx: any, step: WizardStep) {
  const s = ctx.session as SessionData;
  if (!s.steps) s.steps = [];
  s.steps.push(step);
}

function popStep(ctx: any): WizardStep | undefined {
  const s = ctx.session as SessionData;
  if (!s.steps) return undefined;
  return s.steps.pop();
}

function ensureDraft(ctx: any) {
  const s = ctx.session as SessionData;
  if (!s.draft) {
    s.draft = {
      title: undefined,
      type: undefined,
      dueDate: todayISO(),
      dueTime: timeISO(),
      reminderPreset: 'none',
      reminderDate: null,
      reminderTime: null,
      repeat: 'none',
      repeatEveryMinutes: null,
    } as any;
  }
  return s.draft!;
}

async function getTaskCached(ctx: any, id: string) {
  const s = ctx.session as SessionData;
  const now = Date.now();
  if (s.lastLoadedTask && s.lastLoadedTask.id === id && (now - s.lastLoadedTask.loadedAt) < 5 * 60 * 1000) {
    return s.lastLoadedTask.task;
  }
  const { tasks } = getCollections();
  const t = await tasks.findOne({ _id: new ObjectId(id), userId: ctx.from!.id });
  if (t) {
    s.lastLoadedTask = { id, loadedAt: now, task: t };
  } else {
    s.lastLoadedTask = null;
  }
  return t;
}

async function promptPreset(ctx: any) {
  pushStep(ctx, 'type');
  ensureDraft(ctx);
  const res = await safeEditOrReply(ctx, 'Выбери тип задачи или ✍️ Ввести вручную:', presetsKb());
  (ctx.session as SessionData).lastPrompt = { chatId: ctx.chat!.id, messageId: res.messageId, viaCallback: res.viaCallback };
}

export async function promptTitle(ctx: any, emphasis?: string) {
  pushStep(ctx, 'title');
  const s = ctx.session as SessionData;
  const recent = s.recentTitleCache || (await getRecentTitles(ctx.from!.id));
  s.recentTitleCache = recent;
  const emphasisLine = emphasis ? `${emphasis}` : '';
  const res = await safeEditOrReply(ctx, `${emphasisLine}\n\nВведи название задачи (или выбери кнопкой):`, titleChoicesKb(recent));
  (ctx.session as SessionData).lastPrompt = { chatId: ctx.chat!.id, messageId: res.messageId, viaCallback: res.viaCallback };
}

export async function promptDate(ctx: any) {
  pushStep(ctx, 'date');
  const res = await safeEditOrReply(ctx, 'Выбери дату на календаре (или без даты):', dateQuickKb());
  (ctx.session as SessionData).lastPrompt = { chatId: ctx.chat!.id, messageId: res.messageId, viaCallback: res.viaCallback };
}

export async function promptCalendar(ctx: any, base?: Date) {
  const d = base || new Date();
  const res = await safeEditOrReply(ctx, '📅 Выбери дату:', monthCalendarKb(d.getFullYear(), d.getMonth()));
  (ctx.session as SessionData).lastPrompt = { chatId: ctx.chat!.id, messageId: res.messageId, viaCallback: res.viaCallback };
}

export async function promptTime(ctx: any) {
  pushStep(ctx, 'time');
  const res = await safeEditOrReply(ctx, 'Выбери время или введи вручную в формате HH:mm:', timePresetsKb());
  (ctx.session as SessionData).lastPrompt = { chatId: ctx.chat!.id, messageId: res.messageId, viaCallback: res.viaCallback };
}

export async function promptReminder(ctx: any) {
  pushStep(ctx, 'reminder');
  const res = await safeEditOrReply(ctx, '🔔 Напоминание?', reminderPresetsKb());
  (ctx.session as SessionData).lastPrompt = { chatId: ctx.chat!.id, messageId: res.messageId, viaCallback: res.viaCallback };
}

export async function promptReminderCustomDate(ctx: any) {
  pushStep(ctx, 'reminder-custom-date');
  const res = await safeEditOrReply(ctx, 'Укажи дату напоминания (YYYY-MM-DD)', Markup.inlineKeyboard([[Markup.button.callback('↩ Назад', 'nav:back'), Markup.button.callback('❌ Отмена', 'nav:cancel')]]));
  (ctx.session as SessionData).lastPrompt = { chatId: ctx.chat!.id, messageId: res.messageId, viaCallback: res.viaCallback };
}

export async function promptReminderCustomTime(ctx: any) {
  pushStep(ctx, 'reminder-custom-time');
  const res = await safeEditOrReply(ctx, 'Укажи время напоминания (HH:mm)', Markup.inlineKeyboard([[Markup.button.callback('↩ Назад', 'nav:back'), Markup.button.callback('❌ Отмена', 'nav:cancel')]]));
  (ctx.session as SessionData).lastPrompt = { chatId: ctx.chat!.id, messageId: res.messageId, viaCallback: res.viaCallback };
}

export async function promptRepeat(ctx: any) {
  pushStep(ctx, 'repeat');
  const res = await safeEditOrReply(ctx, '🔁 Повтор задачи?', repeatKb());
  (ctx.session as SessionData).lastPrompt = { chatId: ctx.chat!.id, messageId: res.messageId, viaCallback: res.viaCallback };
}

export async function promptConfirm(ctx: any) {
  pushStep(ctx, 'confirm');

  const s = ctx.session as SessionData;
  if (!s.draft && s.editingTaskId) {
    try {
      const t = await getTaskCached(ctx, s.editingTaskId);
      if (t) {
        s.draft = {
          title: t.title ? String(t.title) : undefined,
          type: t.type === 'custom' ? undefined : t.type,
          dueDate: t.dueAt ? new Date(t.dueAt).toISOString().slice(0, 10) : null,
          dueTime: t.dueAt ? `${String(new Date(t.dueAt).getHours()).padStart(2, '0')}:${String(new Date(t.dueAt).getMinutes()).padStart(2,'0')}` : null,
          reminderPreset: t.reminderAt ? 'custom' : 'none',
          reminderDate: t.reminderAt ? new Date(t.reminderAt).toISOString().slice(0, 10) : null,
          reminderTime: t.reminderAt ? `${String(new Date(t.reminderAt).getHours()).padStart(2,'0')}:${String(new Date(t.reminderAt).getMinutes()).padStart(2,'0')}` : null,
          repeat: t.repeat || 'none',
          repeatEveryMinutes: (t as any).repeatEveryMinutes || null,
        } as any;
        s.originalTask = t;
      } else {
        ensureDraft(ctx);
      }
    } catch (e) {
      ensureDraft(ctx);
    }
  } else {
    ensureDraft(ctx);
  }
  const markers = computeMarkers(s);
  const res = await safeEditOrReply(ctx, `Проверь данные:\n\n${renderDraft((ctx.session as SessionData).draft ?? null, (ctx.session as SessionData).originalTask ?? null)}`, confirmKb());
  (ctx.session as SessionData).lastPrompt = { chatId: ctx.chat!.id, messageId: res.messageId, viaCallback: res.viaCallback };
}

export function registerEditHandlers(bot: Telegraf<any>) {
  bot.hears('➕ Новая задача', async (ctx) => {
    const s = ctx.session as SessionData;
    s.mode = 'creating';
    s.draft = {
      title: undefined,
      type: undefined,
      dueDate: todayISO(),
      dueTime: timeISO(),
      reminderPreset: 'none',
      reminderDate: null,
      reminderTime: null,
      repeat: 'none',
      repeatEveryMinutes: null,
    } as any;
    s.steps = [];
    s.returnTo = null;
    s.editingTaskId = null;
    s.timePicker = null;
    s.originalTask = null;
    await promptPreset(ctx);
  });

  bot.hears('⚙️ Настройки', async (ctx) => {
    await ctx.reply('Пока тут пусто. Возвращайся позже 🙂');
  });

  bot.hears(/.*/s, async (ctx, next) => {
    const s = ctx.session as SessionData;
    const text = ctx.message?.text;
    if (!text || text.startsWith('/')) return next();
    const menuCommands = ['➕ Новая задача', '🗂 Мои задачи', '⚙️ Настройки', '🏠 Главное меню'];
    if (menuCommands.includes(text.trim())) return next();
    if (s.mode === 'idle') {
      const now = new Date();
      const { tasks } = getCollections();
      await tasks.insertOne({
        userId: ctx.from!.id,
        title: text.trim(),
        type: 'custom',
        dueAt: null,
        reminderAt: null,
        reminderPreset: null,
        reminderDate: null,
        reminderTime: null,
        repeat: 'none',
        repeatEveryMinutes: null,
        status: 'active',
        reminderSentAt: null,
        createdAt: now,
        updatedAt: now,
      });
      try { await pushRecentTitle(ctx.from!.id, text.trim()); } catch {}
      await ctx.reply('Задача создана (быстрое создание). Открой «🗂 Мои задачи», чтобы отредактировать.');
      return;
    }
    return next();
  });

  bot.action(/^preset:(.+)$/, async (ctx) => {
    const preset = ctx.match[1];
    const s = ctx.session as SessionData;
    ensureDraft(ctx);
    if (preset === 'quick') {
      s.mode = 'quick';
      const res = await safeEditOrReply(ctx, '⚡ Быстрое создание. Введи название задачи:', Markup.inlineKeyboard([[Markup.button.callback('↩ Назад', 'nav:back'), Markup.button.callback('❌ Отмена', 'nav:cancel')]]));
      (ctx.session as SessionData).lastPrompt = { chatId: ctx.chat!.id, messageId: res.messageId, viaCallback: res.viaCallback };
      return;
    }
    s.draft!.type = preset === 'custom' ? undefined : preset;
    const label = preset === 'buy' ? 'Купить' : preset === 'call' ? 'Позвонить' : preset === 'meet' ? 'Встреча' : 'Ввести вручную';
    await promptTitle(ctx, label);
  });

  bot.on('text', async (ctx, next) => {
    const s = ctx.session as SessionData;
    if (s.mode !== 'creating' && s.mode !== 'editing' && s.mode !== 'quick') return next();
    const last = s.steps && s.steps[s.steps.length - 1];
    const text = ctx.message?.text?.trim();
    if (!text) return next();

    if (s.mode === 'quick') {
      const now = new Date();
      const { tasks } = getCollections();
      await tasks.insertOne({
        userId: ctx.from!.id,
        title: text,
        type: 'custom',
        dueAt: null, reminderAt: null, reminderPreset: null, reminderDate: null, reminderTime: null, repeat: 'none', repeatEveryMinutes: null,
        status: 'active', reminderSentAt: null, createdAt: now, updatedAt: now,
      });
      try { await pushRecentTitle(ctx.from!.id, text); } catch {}
      await safeEditOrReply(ctx, 'Задача создана. Открой «🗂 Мои задачи», чтобы отредактировать.', Markup.inlineKeyboard([[Markup.button.callback('🏠 Главное меню', 'nav:home')]]));
      s.mode = 'idle';
      return;
    }

    if (last === 'title') {
      s.draft!.title = text;
      try { await pushRecentTitle(ctx.from!.id, text); } catch {}
      if (s.mode === 'editing') {
        const markers = computeMarkers(s);
        await safeEditOrReply(ctx, 'Название обновлено.', editMenuKb(String(s.editingTaskId!), markers));
      } else {
        await promptDate(ctx);
      }
      return;
    }

    if (last === 'time') {
      if (text === '-' || /^\d{2}:\d{2}$/.test(text)) {
        s.draft!.dueTime = text === '-' ? null : text;
        if (s.mode === 'editing') {
          if (!s.draft!.reminderPreset || s.draft!.reminderPreset === 'none') {
            s.draft!.reminderPreset = 'at';
          }
          const markers = computeMarkers(s);
          await safeEditOrReply(ctx, 'Время обновлено.', editMenuKb(String(s.editingTaskId!), markers));
        } else {
          await promptReminder(ctx);
        }
      } else {
        await ctx.reply('Неверный формат времени. Пример: 15:30 или "-"');
      }
      return;
    }

    if (last === 'reminder-custom-date') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        s.draft!.reminderDate = text;
        await promptReminderCustomTime(ctx);
      } else {
        await ctx.reply('Неверный формат даты. Пример: 2025-08-21');
      }
      return;
    }

    if (last === 'reminder-custom-time') {
      if (/^\d{2}:\d{2}$/.test(text)) {
        s.draft!.reminderTime = text;
        if (s.mode === 'editing') {
          const markers = computeMarkers(s);
          await safeEditOrReply(ctx, 'Напоминание обновлено.', editMenuKb(String(s.editingTaskId!), markers));
        } else {
          await promptRepeat(ctx);
        }
      } else {
        await ctx.reply('Неверный формат времени. Пример: 09:00');
      }
      return;
    }

    if (last === 'repeat-custom-mins') {
      const n = Number(text);
      if (!Number.isNaN(n) && n >= 1 && n <= 100000) {
        s.draft!.repeat = 'custom-mins';
        s.draft!.repeatEveryMinutes = Math.floor(n);
        if (s.mode === 'editing') {
          const markers = computeMarkers(s);
          await safeEditOrReply(ctx, 'Интервал обновлён.', editMenuKb(String(s.editingTaskId!), markers));
        } else {
          await promptConfirm(ctx);
        }
      } else {
        await ctx.reply('Введи число минут (1..100000)');
      }
      return;
    }

    return next();
  });

  bot.action(/^ttl_label:(\d+)$/, async (ctx) => {
    const idx = Number(ctx.match[1]);
    const s = ctx.session as SessionData;
    const recent = s.recentTitleCache || (await getRecentTitles(ctx.from!.id));
    const item = recent[idx];
    ensureDraft(ctx);
    s.draft!.title = item || s.draft!.title || '';
    if (s.mode === 'editing') {
      const markers = computeMarkers(s);
      await safeEditOrReply(ctx, 'Название выбрано.', editMenuKb(String(s.editingTaskId!), markers));
    } else {
      await promptDate(ctx);
    }
  });

  bot.action('ttl:manual', async (ctx) => {
    pushStep(ctx, 'title');
    await safeEditOrReply(ctx, '⬇️ Введи текст', Markup.inlineKeyboard([[Markup.button.callback('↩ Назад', 'nav:back'), Markup.button.callback('❌ Отмена', 'nav:cancel')]]));
  });

  bot.action('date:today', async (ctx) => {
    ensureDraft(ctx);
    (ctx.session as SessionData).draft!.dueDate = todayISO();
    const s = ctx.session as SessionData;
    if (s.mode === 'editing') {
      if (!s.draft!.reminderPreset || s.draft!.reminderPreset === 'none') {
        s.draft!.reminderPreset = 'at';
      }
      const markers = computeMarkers(s);
      await safeEditOrReply(ctx, 'Дата обновлена.', editMenuKb(String((ctx.session as SessionData).editingTaskId!), markers));
    } else {
      await promptTime(ctx);
    }
  });

  bot.action('date:tomorrow', async (ctx) => {
    ensureDraft(ctx);
    const t = new Date();
    t.setDate(t.getDate() + 1);
    (ctx.session as SessionData).draft!.dueDate = t.toISOString().slice(0, 10);
    const s = ctx.session as SessionData;
    if (s.mode === 'editing') {
      if (!s.draft!.reminderPreset || s.draft!.reminderPreset === 'none') {
        s.draft!.reminderPreset = 'at';
      }
      const markers = computeMarkers(s);
      await safeEditOrReply(ctx, 'Дата обновлена.', editMenuKb(String((ctx.session as SessionData).editingTaskId!), markers));
    } else {
      await promptTime(ctx);
    }
  });

  bot.action('date:none', async (ctx) => {
    ensureDraft(ctx);
    (ctx.session as SessionData).draft!.dueDate = null;
    (ctx.session as SessionData).draft!.dueTime = null;
    if ((ctx.session as SessionData).mode === 'editing') {
      const markers = computeMarkers(ctx.session as SessionData);
      await safeEditOrReply(ctx, 'Дата удалена.', editMenuKb(String((ctx.session as SessionData).editingTaskId!), markers));
    } else {
      await promptReminder(ctx);
    }
  });

  bot.action('date:cal', async (ctx) => promptCalendar(ctx));

  bot.action(/^cal:(-?\d+):(-?\d+)$/, async (ctx) => {
    const y = Number(ctx.match[1]); let m = Number(ctx.match[2]);
    while (m < 0) m += 12;
    while (m > 11) m -= 12;
    await promptCalendar(ctx, new Date(y, m, 1));
  });

  bot.action(/^date:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
    ensureDraft(ctx);
    (ctx.session as SessionData).draft!.dueDate = ctx.match[1];
    const s = ctx.session as SessionData;
    if (s.mode === 'editing') {
      if (!s.draft!.reminderPreset || s.draft!.reminderPreset === 'none') {
        s.draft!.reminderPreset = 'at';
      }
      const markers = computeMarkers(s);
      await safeEditOrReply(ctx, 'Дата обновлена.', editMenuKb(String((ctx.session as SessionData).editingTaskId!), markers));
    } else {
      await promptTime(ctx);
    }
  });

  bot.action(/^time:(\d{2}:\d{2}|manual|picker|in:\d+m)$/, async (ctx) => {
    const v = ctx.match[1];
    const s = ctx.session as SessionData;
    const pad = (n: number) => String(n).padStart(2, '0');

    if (v === 'manual') {
      pushStep(ctx, 'time');
      await safeEditOrReply(ctx, 'Укажи время (HH:mm) или "-"', Markup.inlineKeyboard([[Markup.button.callback('↩ Назад', 'nav:back'), Markup.button.callback('❌ Отмена', 'nav:cancel')]]));
      return;
    }

    if (v === 'picker') {
      pushStep(ctx, 'time');
      ensureDraft(ctx);
      const rows: any[] = [];
      let row: any[] = [];
      for (let h = 0; h < 24; h++) {
        row.push(Markup.button.callback(pad(h), `tp:h:${h}`));
        if (row.length === 6) {
          rows.push(row);
          row = [];
        }
      }
      if (row.length) rows.push(row);
      rows.push([Markup.button.callback('↩ Назад', 'nav:back'), Markup.button.callback('❌ Отмена', 'nav:cancel')]);
      const res = await safeEditOrReply(ctx, 'Выберите час:', Markup.inlineKeyboard(rows));
      (ctx.session as SessionData).lastPrompt = { chatId: ctx.chat!.id, messageId: res.messageId, viaCallback: res.viaCallback };
      return;
    }

    if (/^\d{2}:\d{2}$/.test(v)) {
      ensureDraft(ctx);
      (ctx.session as SessionData).draft!.dueTime = v;
      if ((ctx.session as SessionData).mode === 'editing') {
        const s2 = ctx.session as SessionData;
        if (!s2.draft!.reminderPreset || s2.draft!.reminderPreset === 'none') {
          s2.draft!.reminderPreset = 'at';
        }
        const markers = computeMarkers(s2);
        await safeEditOrReply(ctx, 'Время обновлено.', editMenuKb(String((ctx.session as SessionData).editingTaskId!), markers));
      } else {
        await promptReminder(ctx);
      }
      return;
    }

    if (/^in:(\d+)m$/.test(v)) {
      const m = Number(v.replace('in:', '').replace('m', ''));
      const dt = addMinutes(new Date(), m);
      ensureDraft(ctx);
      (ctx.session as SessionData).draft!.dueDate = dt.toISOString().slice(0,10);
      (ctx.session as SessionData).draft!.dueTime = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
      const s2 = ctx.session as SessionData;
      if (s2.mode === 'editing') {
        if (!s2.draft!.reminderPreset || s2.draft!.reminderPreset === 'none') {
          s2.draft!.reminderPreset = 'at';
        }
        const markers = computeMarkers(s2);
        await safeEditOrReply(ctx, 'Время обновлено.', editMenuKb(String((ctx.session as SessionData).editingTaskId!), markers));
      } else {
        await promptReminder(ctx);
      }
      return;
    }

    await ctx.answerCbQuery();
  });

  bot.action(/^tp:h:(\d{1,2})$/, async (ctx) => {
    const h = Number(ctx.match[1]);
    const s = ctx.session as SessionData;
    s.timePicker = { stage: 'minute', hour: h };
    const pad = (n: number) => String(n).padStart(2, '0');
    const mins = Array.from({ length: 12 }, (_, i) => i * 5);
    const rows: any[] = [];
    let row: any[] = [];
    for (const m of mins) {
      row.push(Markup.button.callback(pad(m), `tp:m:${pad(m)}`));
      if (row.length === 4) { rows.push(row); row = []; }
    }
    if (row.length) rows.push(row);
    rows.push([Markup.button.callback('↩ Назад', 'nav:back'), Markup.button.callback('❌ Отмена', 'nav:cancel')]);
    const res = await safeEditOrReply(ctx, `Выбран час: ${pad(h)}. Теперь выберите минуты:`, Markup.inlineKeyboard(rows));
    (ctx.session as SessionData).lastPrompt = { chatId: ctx.chat!.id, messageId: res.messageId, viaCallback: res.viaCallback };
  });

  bot.action(/^tp:m:(\d{2})$/, async (ctx) => {
    const mm = Number(ctx.match[1]);
    const s = ctx.session as SessionData;
    const pad = (n: number) => String(n).padStart(2, '0');
    const hour = s.timePicker?.hour ?? 0;
    ensureDraft(ctx);
    (ctx.session as SessionData).draft!.dueTime = `${pad(hour)}:${pad(mm)}`;
    if (!(ctx.session as SessionData).draft!.dueDate) {
      (ctx.session as SessionData).draft!.dueDate = new Date().toISOString().slice(0,10);
    }
    s.timePicker = null;
    if ((ctx.session as SessionData).mode === 'editing') {
      const s2 = ctx.session as SessionData;
      if (!s2.draft!.reminderPreset || s2.draft!.reminderPreset === 'none') {
        s2.draft!.reminderPreset = 'at';
      }
      const markers = computeMarkers(s2);
      await safeEditOrReply(ctx, 'Время обновлено.', editMenuKb(String((ctx.session as SessionData).editingTaskId!), markers));
    } else {
      await promptReminder(ctx);
    }
  });

  bot.action(/^rem:(.+)$/, async (ctx) => {
    const val = ctx.match[1];
    const s = ctx.session as SessionData;
    ensureDraft(ctx);
    s.draft!.reminderPreset = val;
    if (val === 'custom') {
      await promptReminderCustomDate(ctx);
    } else {
      if (s.mode === 'editing') {
        const markers = computeMarkers(s);
        await safeEditOrReply(ctx, 'Напоминание обновлено.', editMenuKb(String(s.editingTaskId!), markers));
      } else {
        await promptRepeat(ctx);
      }
    }
  });

  bot.action(/^rep:(.+)$/, async (ctx) => {
    const key = ctx.match[1];
    const s = ctx.session as SessionData;
    ensureDraft(ctx);
    if (key === 'custom') {
      s.draft!.repeat = 'custom-mins';
      pushStep(ctx, 'repeat-custom-mins');
      await safeEditOrReply(ctx, 'Введи интервал в минутах:', Markup.inlineKeyboard([[Markup.button.callback('↩ Назад', 'nav:back'), Markup.button.callback('❌ Отмена', 'nav:cancel')]]));
      return;
    }
    s.draft!.repeat = key;
    if (s.mode === 'editing') {
      const markers = computeMarkers(s);
      await safeEditOrReply(ctx, 'Повтор обновлён.', editMenuKb(String(s.editingTaskId!), markers));
    } else {
      await promptConfirm(ctx);
    }
  });

  bot.action('confirm:save', async (ctx) => {
    try {
      const id = await saveTaskFromDraft(ctx);
      const { tasks } = getCollections();
      const t = await tasks.findOne({ _id: new ObjectId(id) });
      await safeEditOrReply(
        ctx,
        `Сохранено ✅\n\n${renderTask(t!)}`,
        Markup.inlineKeyboard([
          [Markup.button.callback('✏️ Редактировать', `tsk:edit:${id}`)],
          [Markup.button.callback('🗂 К задачам', 'list:all')],
          [Markup.button.callback('🏠 Главное меню', 'nav:home')],
        ])
      );
      const s = ctx.session as SessionData;
      s.mode = 'idle';
      s.draft = null;
      s.steps = [];
      s.editingTaskId = null;
      s.timePicker = null;
      s.lastLoadedTask = null;
      s.originalTask = null;
    } catch (e: any) {
      await ctx.reply('Ошибка при сохранении: ' + (e.message || String(e)));
    }
  });

  bot.action(/^tsk:edit:([a-f0-9]{24})$/, async (ctx) => {
    const id = ctx.match[1];
    const t = await getTaskCached(ctx, id);
    if (!t) {
      await safeEditOrReply(ctx, 'Задача не найдена.');
      return;
    }
    const s = ctx.session as SessionData;
    s.mode = 'editing';
    s.editingTaskId = id;
    s.returnTo = s.returnTo || `task:${id}`;
    const fullTitle = (t.title || '');
    s.draft = {
      type: t.type === 'custom' ? undefined : (t.type as any),
      title: fullTitle,
      dueDate: t.dueAt ? new Date(t.dueAt).toISOString().slice(0, 10) : null,
      dueTime: t.dueAt ? `${String(new Date(t.dueAt).getHours()).padStart(2, '0')}:${String(new Date(t.dueAt).getMinutes()).padStart(2,'0')}` : null,
      reminderPreset: t.reminderAt ? 'custom' : 'none',
      reminderDate: t.reminderAt ? new Date(t.reminderAt).toISOString().slice(0, 10) : null,
      reminderTime: t.reminderAt ? `${String(new Date(t.reminderAt).getHours()).padStart(2,'0')}:${String(new Date(t.reminderAt).getMinutes()).padStart(2,'0')}` : null,
      repeat: t.repeat || 'none',
      repeatEveryMinutes: (t as any).repeatEveryMinutes || null,
    } as any;
    s.steps = [];
    s.timePicker = null;
    s.originalTask = t;
    const markers = computeMarkers(s);
    await safeEditOrReply(ctx, `Редактирование задачи:\n\n${renderDraft(s.draft ?? {}, t)}`, editMenuKb(id, markers));
  });

  bot.action(/^tsk:status:([a-f0-9]{24})$/, async (ctx) => {
    const id = ctx.match[1];
    await safeEditOrReply(ctx, 'Выбери новый статус:', Markup.inlineKeyboard([
      [Markup.button.callback('🟢 Активна', `tsk:setstatus:${id}:active`)],
      [Markup.button.callback('✅ Выполнена', `tsk:setstatus:${id}:done`)],
      [Markup.button.callback('🔴 Просрочена', `tsk:setstatus:${id}:overdue`)],
      [Markup.button.callback('↩ Назад', 'nav:back')],
    ]));
  });

  bot.action(/^tsk:setstatus:([a-f0-9]{24}):(active|done|overdue)$/, async (ctx) => {
    const id = ctx.match[1];
    const newStatus = ctx.match[2] as 'active' | 'done' | 'overdue';
    const { tasks } = getCollections();
    const t = await tasks.findOne({ _id: new ObjectId(id), userId: ctx.from!.id });
    if (!t) return ctx.answerCbQuery('Задача не найдена');

    if (newStatus === 'active' && t.dueAt && new Date(t.dueAt).getTime() < Date.now()) {
      await tasks.updateOne({ _id: t._id }, { $set: { status: 'active', updatedAt: new Date() } });
      await safeEditOrReply(ctx, 'Задача переведена в Активна, но её время в прошлом. Хотите изменить дату/времени?', Markup.inlineKeyboard([
        [Markup.button.callback('📅 Изменить дату', `edit:date:${id}`)],
        [Markup.button.callback('⏰ Изменить время', `edit:time:${id}`)],
        [Markup.button.callback('Оставить как есть', `tsk:okleave:${id}`)],
        [Markup.button.callback('↩ Назад', 'nav:back')],
      ]));
      return;
    }

    await tasks.updateOne({ _id: t._id }, { $set: { status: newStatus, updatedAt: new Date() } });
    const refreshed = await tasks.findOne({ _id: t._id });
    await safeEditOrReply(ctx, renderTask(refreshed as any), editMenuKb(String(t._id), computeMarkers((ctx.session as SessionData))));
  });

  bot.action(/^tsk:okleave:([a-f0-9]{24})$/, async (ctx) => {
    const id = ctx.match[1];
    await safeEditOrReply(ctx, 'Оставлено без изменений.', editMenuKb(id, computeMarkers((ctx.session as SessionData))));
  });

  bot.action(/^tsk:toggle:([a-f0-9]{24})$/, async (ctx) => {
    const id = ctx.match[1];
    const { tasks } = getCollections();
    const t = await tasks.findOne({ _id: new ObjectId(id), userId: ctx.from!.id });
    if (!t) return ctx.answerCbQuery('Не найдено');
    const newStatus = t.status === 'done' ? 'active' : 'done';
    await tasks.updateOne({ _id: t._id }, { $set: { status: newStatus, updatedAt: new Date() } });
    const refreshed = await tasks.findOne({ _id: t._id });
    await safeEditOrReply(ctx, renderTask(refreshed as any), editMenuKb(String(t._id), computeMarkers((ctx.session as SessionData))));
  });

  bot.action(/^tsk:del:([a-f0-9]{24})$/, async (ctx) => {
    const id = ctx.match[1];
    await safeEditOrReply(ctx, 'Вы уверены, что хотите удалить задачу?', Markup.inlineKeyboard([
      [Markup.button.callback('❗ Да, удалить', `tsk:del2:${id}`)],
      [Markup.button.callback('↩ Назад', 'nav:back')],
    ]));
  });

  bot.action(/^tsk:del2:([a-f0-9]{24})$/, async (ctx) => {
    const id = ctx.match[1];
    const { tasks } = getCollections();
    await tasks.deleteOne({ _id: new ObjectId(id), userId: ctx.from!.id });
    await safeEditOrReply(ctx, 'Задача удалена.', Markup.inlineKeyboard([[Markup.button.callback('🗂 К задачам', 'list:all'), Markup.button.callback('🏠 Главное меню', 'nav:home')]]));
  });

  bot.action(/^edit:(title|type|date|time|reminder|repeat|save):([a-f0-9]{24})$/, async (ctx) => {
    const field = ctx.match[1];
    const id = ctx.match[2];
    const s = ctx.session as SessionData;
    s.mode = 'editing';
    if (!s.editingTaskId) s.editingTaskId = id;

    try {
      const t = await getTaskCached(ctx, id);
      if (t) {
        const fullTitle = (t.title || '');
        s.draft = {
          type: s.draft?.type ?? (t.type === 'custom' ? undefined : (t.type as any)),
          title: s.draft?.title ?? fullTitle,
          dueDate: s.draft?.dueDate ?? (t.dueAt ? new Date(t.dueAt).toISOString().slice(0, 10) : null),
          dueTime: s.draft?.dueTime ?? (t.dueAt ? `${String(new Date(t.dueAt).getHours()).padStart(2, '0')}:${String(new Date(t.dueAt).getMinutes()).padStart(2,'0')}` : null),
          reminderPreset: s.draft?.reminderPreset ?? (t.reminderAt ? 'custom' : 'none'),
          reminderDate: s.draft?.reminderDate ?? (t.reminderAt ? new Date(t.reminderAt).toISOString().slice(0, 10) : null),
          reminderTime: s.draft?.reminderTime ?? (t.reminderAt ? `${String(new Date(t.reminderAt).getHours()).padStart(2,'0')}:${String(new Date(t.reminderAt).getMinutes()).padStart(2,'0')}` : null),
          repeat: s.draft?.repeat ?? (t.repeat || 'none'),
          repeatEveryMinutes: s.draft?.repeatEveryMinutes ?? ((t as any).repeatEveryMinutes || null),
        } as any;
        s.originalTask = t;
      } else {
        ensureDraft(ctx);
      }
    } catch {
      ensureDraft(ctx);
    }

    if (field === 'title') {
      pushStep(ctx, 'title');
      const oldTitle = (s.draft && s.draft.title) ? s.draft.title : '';
      const hint = oldTitle ? `Текущее название: ${oldTitle}\n\n` : '';
      await safeEditOrReply(ctx, `${hint}Введи новое название:`, Markup.inlineKeyboard([[Markup.button.callback('↩ Назад', 'nav:back'), Markup.button.callback('❌ Отмена', 'nav:cancel')]]));
      return;
    }

    if (field === 'type') {
      await safeEditOrReply(ctx, 'Изменение категории отключено.', editMenuKb(String(s.editingTaskId!), computeMarkers(s)));
      return;
    }

    if (field === 'date') {
      pushStep(ctx, 'date');
      const curDate = s.draft?.dueDate ?? null;
      const hint = curDate ? `Текущая дата: ${curDate}\n\n` : '';
      const res = await safeEditOrReply(ctx, `${hint}Выбери дату на календаре (или без даты):`, dateQuickKb());
      (ctx.session as SessionData).lastPrompt = { chatId: ctx.chat!.id, messageId: res.messageId, viaCallback: res.viaCallback };
      return;
    }

    if (field === 'time') {
      pushStep(ctx, 'time');
      const curTime = s.draft?.dueTime ?? null;
      const hint = curTime ? `Текущее время: ${curTime}\n\n` : '';
      const res = await safeEditOrReply(ctx, `${hint}Выбери время или введи вручную в формате HH:mm:`, timePresetsKb());
      (ctx.session as SessionData).lastPrompt = { chatId: ctx.chat!.id, messageId: res.messageId, viaCallback: res.viaCallback };
      return;
    }

    if (field === 'reminder') {
      pushStep(ctx, 'reminder');
      const reminderLabel = s.draft ? mapReminderLabel(s.draft) : '—';
      const hint = reminderLabel ? `Текущее напоминание: ${reminderLabel}\n\n` : '';
      const res = await safeEditOrReply(ctx, `${hint}🔔 Напоминание?`, reminderPresetsKb());
      (ctx.session as SessionData).lastPrompt = { chatId: ctx.chat!.id, messageId: res.messageId, viaCallback: res.viaCallback };
      return;
    }

    if (field === 'repeat') {
      pushStep(ctx, 'repeat');
      const repeatLabel = mapRepeatLabelVal(s.draft?.repeat ?? null, s.draft?.repeatEveryMinutes ?? null);
      const hint = repeatLabel ? `Текущий повтор: ${repeatLabel}\n\n` : '';
      const res = await safeEditOrReply(ctx, `${hint}🔁 Повтор задачи?`, repeatKb());
      (ctx.session as SessionData).lastPrompt = { chatId: ctx.chat!.id, messageId: res.messageId, viaCallback: res.viaCallback };
      return;
    }

    if (field === 'save') {
      try {
        const id = await saveTaskFromDraft(ctx);
        const { tasks } = getCollections();
        const t = await tasks.findOne({ _id: new ObjectId(id) });
        await safeEditOrReply(
          ctx,
          `Сохранено ✅\n\n${renderTask(t!)}`,
          Markup.inlineKeyboard([
            [Markup.button.callback('✏️ Редактировать', `tsk:edit:${id}`)],
            [Markup.button.callback('🗂 К задачам', 'list:all')],
            [Markup.button.callback('🏠 Главное меню', 'nav:home')],
          ])
        );
        const s2 = ctx.session as SessionData;
        s2.mode = 'idle';
        s2.draft = null;
        s2.steps = [];
        s2.editingTaskId = null;
        s2.timePicker = null;
        s2.lastLoadedTask = null;
        s2.originalTask = null;
      } catch (e: any) {
        await ctx.reply('Ошибка при сохранении: ' + (e.message || String(e)));
      }
      return;
    }
  });
}
