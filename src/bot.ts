// src/bot.ts
import { Telegraf, Markup, Context } from 'telegraf';
import dayjs from 'dayjs';
import tz from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

import { Task, RepeatType } from './models/Task.js';
import { Recent, RecentType } from './models/Recent.js';
import { UserSettings } from './models/UserSettings.js';
import { generateCalendar } from './utils/calendar.js';
import { generateTimeButtons } from './utils/timeButtons.js';
import { escapeHtml } from './utils/escapeHtml.js';
import { formatInTz, buildUtcFromLocalParts, POPULAR_TZ, shiftDueDate, DISPLAY_FMT } from './utils/time.js';

dayjs.extend(utc);
dayjs.extend(tz);

type UserStateStep =
  | 'choosing_text'
  | 'awaiting_custom_text'
  | 'ask_reminder'
  | 'choosing_reminder'
  | 'awaiting_custom_reminder'
  | 'choosing_date'
  | 'awaiting_custom_date'
  | 'choosing_time'
  | 'awaiting_custom_time'
  | 'choosing_repeat'
  | 'confirm_task'
  | 'awaiting_timezone_custom';

interface UserState {
  step?: UserStateStep;
  text?: string;
  textPrefix?: 'Позвонить' | 'Купить' | 'Встретиться';
  recentType?: RecentType;
  remindBefore?: number;
  selectedDate?: { y: number; m: number; d: number; hh?: number; mm?: number };
  repeat?: RepeatType | undefined;
  currentYear?: number;
  currentMonth?: number;
  tzName?: string;
}

const userStates = new Map<number, UserState>();
const PAGE_SIZE = 10;

/** Универсальная защита от «протухших» callback’ов */
async function safeAnswerCb(ctx: Context) {
  try { await (ctx as any).answerCbQuery(); } catch { /* ignore 400/expired */ }
}

/** Build options for Telegraf methods. */
function buildOpts(kb?: ReturnType<typeof Markup.inlineKeyboard>) {
  const base: any = { parse_mode: 'HTML' as const };
  if (kb) base.reply_markup = (kb as any).reply_markup;
  return base;
}

async function editOrReply(ctx: Context, text: string, kb?: ReturnType<typeof Markup.inlineKeyboard>) {
  const opts = buildOpts(kb);
  try {
    await (ctx as any).editMessageText(text, opts);
  } catch {
    await (ctx as any).reply(text, opts);
  }
}

async function reply(ctx: Context, text: string, kb?: ReturnType<typeof Markup.inlineKeyboard>) {
  const opts = buildOpts(kb);
  await (ctx as any).reply(text, opts);
}

/* -------------- helpers -------------- */

async function getOrCreateUserTz(userId: number): Promise<string | undefined> {
  let us = await UserSettings.findOne({ userId }).exec();
  if (us?.timezone) return us.timezone;
  if (!us) await UserSettings.create({ userId });
  return undefined;
}

function settingsMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🕒 Часовой пояс', 'settings_tz')],
    [Markup.button.callback('◀️ Назад', 'main_menu')],
  ]);
}

function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ Новая задача', 'new_task')],
    [Markup.button.callback('📋 Мои задачи', 'my_tasks')],
    [Markup.button.callback('📅 Сегодня', 'today'), Markup.button.callback('📊 Статистика', 'stats')],
    [Markup.button.callback('⚙️ Настройки', 'settings')],
    [Markup.button.callback('🧹 Удалить все задачи', 'delete_all_tasks')],
  ]);
}

function reminderButtons() {
  const options = [
    { text: '10 мин', ms: 10 * 60 * 1000 },
    { text: '30 мин', ms: 30 * 60 * 1000 },
    { text: '1 час', ms: 60 * 60 * 1000 },
    { text: '3 часа', ms: 3 * 60 * 60 * 1000 },
    { text: '1 день', ms: 24 * 60 * 60 * 1000 },
    { text: '1 неделя', ms: 7 * 24 * 60 * 60 * 1000 },
    { text: '1 месяц', ms: 30 * 24 * 60 * 60 * 1000 },
  ];
  return Markup.inlineKeyboard([
    ...options.map((o) => [Markup.button.callback(o.text, `remind_${o.ms}`)]),
    [Markup.button.callback('📝 Ввести вручную (мин)', 'custom_reminder')],
    [Markup.button.callback('◀️ Назад', 'new_task')],
  ]);
}

function repeatButtons(selected?: RepeatType | undefined) {
  const mk = (label: string, val?: RepeatType) =>
    Markup.button.callback((selected === val ? '✅ ' : '') + label, `repeat_${val ?? 'none'}`);
  return Markup.inlineKeyboard([
    [mk('Без повтора', undefined)],
    [mk('Ежедневно', 'daily')],
    [mk('Еженедельно', 'weekly')],
    [mk('Ежемесячно', 'monthly')],
    [Markup.button.callback('◀️ Назад', 'repeat_back')],
  ]);
}

function generateTimeButtonsWithCustom() {
  return generateTimeButtons();
}

function generateCalendarWithCustom(year: number, month: number) {
  const cal = generateCalendar(year, month) as any;
  try {
    (cal.reply_markup.inline_keyboard as any).push([Markup.button.callback('📝 Ввести дату вручную', 'custom_date')]);
  } catch { /* noop */ }
  return cal;
}

function truncate(s?: string, n = 40) {
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function formatReminder(ms?: number) {
  if (!ms) return 'нет';
  const map: Record<number, string> = {
    [10 * 60 * 1000]: '10 минут',
    [30 * 60 * 1000]: '30 минут',
    [60 * 60 * 1000]: '1 час',
    [3 * 60 * 60 * 1000]: '3 часа',
    [24 * 60 * 60 * 1000]: '1 день',
    [7 * 24 * 60 * 60 * 1000]: '1 неделя',
    [30 * 24 * 60 * 60 * 1000]: '1 месяц',
  };
  return map[ms] || `${Math.round((ms ?? 0) / 60000)} мин`;
}

function buildTaskDetailText(task: any, tzName?: string) {
  const tz = tzName ?? 'UTC';
  const due = task.dueDate ? formatInTz(new Date(task.dueDate), tz, DISPLAY_FMT) : '—';
  const remind = task.remindBefore ? formatReminder(task.remindBefore) : 'нет';
  const repeatTxt = task.repeat
    ? task.repeat === 'daily'
      ? 'ежедневно'
      : task.repeat === 'weekly'
        ? 'еженедельно'
        : 'ежемесячно'
    : 'нет';
  return `<b>Задача</b>\n\n<b>${escapeHtml(task.text)}</b>\n\n📅 Дата: ${escapeHtml(due)}\n🔔 Напомнить: ${escapeHtml(remind)}\n🔁 Повтор: ${escapeHtml(repeatTxt)}\n✅ Выполнена: ${task.done ? 'Да' : 'Нет'}`;
}

async function renderUserTasks(ctx: Context, notice?: string, page = 0) {
  const userId = (ctx.from as any)!.id;
  const settings = await UserSettings.findOne({ userId }).exec();
  const tzName = settings?.timezone ?? 'UTC';

  const total = await Task.countDocuments({ userId }).exec();
  const tasks = (await Task.find({ userId }).sort({ dueDate: 1 }).skip(page * PAGE_SIZE).limit(PAGE_SIZE).exec()) as any[];

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (!tasks.length) {
    const text = `${notice ? escapeHtml(notice) + '\n\n' : ''}${escapeHtml('📭 У вас нет задач.')}`;
    return editOrReply(ctx, text, mainMenu());
  }

  let text = notice ? escapeHtml(notice) + '\n\n' : '';
  text += `<b>Ваши задачи</b> (стр. ${page + 1}/${pages}):\n\n`;
  tasks.forEach((t, i) => {
    const due = t.dueDate ? formatInTz(new Date(t.dueDate), tzName, DISPLAY_FMT) : '—';
    text += `${i + 1 + page * PAGE_SIZE}. ${escapeHtml(truncate(t.text, 60))} — ${escapeHtml(due)} ${t.done ? '✅' : ''}\n`;
  });

  const kbRows = tasks.map((t: any) => [Markup.button.callback(truncate(t.text, 40), `task_view_${String(t._id)}`)]);
  const navRow: any[] = [];
  if (page > 0) navRow.push(Markup.button.callback('◀️ Назад', `tasks_page_${page - 1}`));
  if (page < pages - 1) navRow.push(Markup.button.callback('Вперёд ▶️', `tasks_page_${page + 1}`));
  if (navRow.length) kbRows.push(navRow);

  kbRows.push([Markup.button.callback('🧹 Удалить все задачи', 'delete_all_tasks')]);
  kbRows.push([Markup.button.callback('◀️ Назад', 'main_menu')]);

  const kb = Markup.inlineKeyboard(kbRows);
  await editOrReply(ctx, text, kb);
}

async function pushRecent(userId: number, type: RecentType, value: string) {
  value = value.trim();
  if (!value) return;
  // Защитимся от дубля
  try {
    await Recent.create({ userId, type, value });
  } catch {
    // если уникальный индекс сработал — просто обновим createdAt
    await Recent.updateOne({ userId, type, value }, { $set: { createdAt: new Date() } }).exec();
  }
  const recents = await Recent.find({ userId, type }).sort({ createdAt: -1 }).exec();
  if (recents.length > 5) {
    const toDelete = recents.slice(5).map((r: any) => r._id);
    await Recent.deleteMany({ _id: { $in: toDelete } }).exec();
  }
}

/* -------------- Bot flow -------------- */

export function createBot(): Telegraf<Context> {
  const bot = new Telegraf<Context>(process.env.BOT_TOKEN!);

  // Гасим «протухшие» callback’и централизованно
  bot.on('callback_query', async (ctx, next) => {
    await safeAnswerCb(ctx);
    return next();
  });

  bot.start(async (ctx) => {
    const userId = (ctx.from as any)!.id;
    const tz = await getOrCreateUserTz(userId);
    if (!tz) {
      const t = '👋 Привет! Я твой Telegram-планировщик задач.\n\nСначала настроим часовой пояс, чтобы время задач и напоминаний совпадало с твоим локальным временем.';
      const kb = Markup.inlineKeyboard([
        ...POPULAR_TZ.slice(0, 6).map((z) => [Markup.button.callback(z, `tz_pick_${z}`)]),
        ...POPULAR_TZ.slice(6, 12).map((z) => [Markup.button.callback(z, `tz_pick_${z}`)]),
        [Markup.button.callback('📝 Ввести вручную (IANA)', 'tz_custom')],
      ]);
      await reply(ctx, escapeHtml(t), kb);
      userStates.set(userId, { step: 'awaiting_timezone_custom' });
      return;
    }

    const startText = escapeHtml('👋 Привет! Я твой Telegram-планировщик задач.\nЧто будем делать?');
    await reply(ctx, startText, mainMenu());
  });

  bot.hears(['🏠 Меню', 'Меню'], async (ctx) => {
    await reply(ctx, escapeHtml('📋 Главное меню:'), mainMenu());
  });

  // Настройки
  bot.action('settings', async (ctx) => {
    await editOrReply(ctx, escapeHtml('⚙️ Настройки'), settingsMenu());
  });

  bot.action('settings_tz', async (ctx) => {
    const kb = Markup.inlineKeyboard([
      ...POPULAR_TZ.slice(0, 6).map((z) => [Markup.button.callback(z, `tz_pick_${z}`)]),
      ...POPULAR_TZ.slice(6, 12).map((z) => [Markup.button.callback(z, `tz_pick_${z}`)]),
      [Markup.button.callback('📝 Ввести вручную (IANA)', 'tz_custom')],
      [Markup.button.callback('◀️ Назад', 'main_menu')],
    ]);
    await editOrReply(ctx, escapeHtml('Выбери часовой пояс:'), kb);
    const s = userStates.get((ctx.from as any)!.id) || {};
    s.step = 'awaiting_timezone_custom';
    userStates.set((ctx.from as any)!.id, s);
  });

  bot.action(/tz_pick_(.+)/, async (ctx) => {
    const tz = String((ctx.match as any)[1]);
    const userId = (ctx.from as any)!.id;
    await UserSettings.updateOne({ userId }, { $set: { timezone: tz } }, { upsert: true }).exec();
    await editOrReply(ctx, escapeHtml(`✅ Часовой пояс установлен: ${tz}`), mainMenu());
  });

  bot.action('tz_custom', async (ctx) => {
    const s = userStates.get((ctx.from as any)!.id) || {};
    s.step = 'awaiting_timezone_custom';
    userStates.set((ctx.from as any)!.id, s);
    await reply(ctx, escapeHtml('Введите IANA идентификатор часового пояса (например: Europe/Kyiv):'));
  });

  bot.on('text', async (ctx) => {
    const userId = (ctx.from as any)!.id;
    const state = userStates.get(userId);

    // Настройка TZ вручную (с валидацией)
    if (state?.step === 'awaiting_timezone_custom' && (ctx as any).callbackQuery == null) {
      const tzInput = (ctx.message as any).text.trim();
      if (!dayjs.tz.zone(tzInput)) {
        return reply(ctx, escapeHtml('⚠️ Неизвестный часовой пояс. Пример: Europe/Kyiv'));
      }
      await UserSettings.updateOne({ userId }, { $set: { timezone: tzInput } }, { upsert: true }).exec();
      state.step = undefined;
      return reply(ctx, escapeHtml(`✅ Часовой пояс установлен: ${tzInput}`), mainMenu());
    }

    if (!state) return;

    // awaiting custom text
    if (state.step === 'awaiting_custom_text') {
      const body = (ctx.message as any).text.trim();
      const finalText = state.textPrefix ? `${state.textPrefix} ${body}` : body;
      state.text = finalText;

      if (state.textPrefix && state.recentType) {
        await pushRecent(userId, state.recentType, body);
      }

      state.textPrefix = undefined;
      state.recentType = undefined;

      state.step = 'ask_reminder';
      const kb = Markup.inlineKeyboard([
        [Markup.button.callback('Да', 'ask_reminder_yes'), Markup.button.callback('Нет', 'ask_reminder_no')],
        [Markup.button.callback('◀️ Отменить', 'cancel_task')],
      ]);
      const text = `<b>📝 ${escapeHtml(state.text)}</b>\n\n${escapeHtml('Хотите, чтобы я прислал(а) вам напоминание перед задачей?')}`;
      return reply(ctx, text, kb);
    }

    // awaiting custom date
    if (state.step === 'awaiting_custom_date') {
      const match = (ctx.message as any).text.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
      if (!match) return reply(ctx, escapeHtml('⚠️ Неверный формат. Пример: 25.12.2025'));
      const d = Number(match[1]), m = Number(match[2]) - 1, y = Number(match[3]);
      state.selectedDate = { y, m, d };
      state.step = 'choosing_time';
      return reply(ctx, escapeHtml('🕒 Выбери время:'), generateTimeButtonsWithCustom());
    }

    // awaiting custom time
    if (state.step === 'awaiting_custom_time') {
      if (!state.selectedDate) return reply(ctx, escapeHtml('⚠️ Сначала выберите дату.'));
      const match = (ctx.message as any).text.trim().match(/^(\d{1,2}):(\d{2})$/);
      if (!match) return reply(ctx, escapeHtml('⚠️ Неверный формат. Пример: 09:15'));
      const h = Number(match[1]), min = Number(match[2]);
      state.selectedDate.hh = h; state.selectedDate.mm = min;

      const settings = await UserSettings.findOne({ userId }).exec();
      const tzName = settings?.timezone || 'UTC';
      const dt = buildUtcFromLocalParts(tzName, state.selectedDate.y, state.selectedDate.m, state.selectedDate.d, h, min);
      if (dt.getTime() < Date.now()) {
        return reply(ctx, escapeHtml('⚠️ Нельзя ставить время в прошлом. Выберите другую дату/время.'));
      }

      state.step = 'choosing_repeat';
      return reply(ctx, escapeHtml('🔁 Повтор задачи?'), repeatButtons(state.repeat));
    }

    // awaiting custom reminder (minutes)
    if (state.step === 'awaiting_custom_reminder') {
      const n = Number((ctx.message as any).text.trim());
      if (!Number.isFinite(n) || n < 0) return reply(ctx, escapeHtml('⚠️ Введите число минут (например: 15)'));
      state.remindBefore = Math.round(n) * 60 * 1000;
      state.step = 'choosing_date';
      const now = new Date();
      state.currentYear = now.getFullYear();
      state.currentMonth = now.getMonth();
      return reply(ctx, escapeHtml('📅 Выберите дату:'), generateCalendarWithCustom(state.currentYear, state.currentMonth));
    }
  });

  // --- New task ---
  bot.action('new_task', async (ctx) => {
    const userId = (ctx.from as any)!.id;

    const settings = await UserSettings.findOne({ userId }).exec();
    if (!settings?.timezone) {
      const kb = Markup.inlineKeyboard([
        ...POPULAR_TZ.slice(0, 6).map((z) => [Markup.button.callback(z, `tz_pick_${z}`)]),
        ...POPULAR_TZ.slice(6, 12).map((z) => [Markup.button.callback(z, `tz_pick_${z}`)]),
        [Markup.button.callback('📝 Ввести вручную (IANA)', 'tz_custom')],
      ]);
      await reply(ctx, escapeHtml('Сначала выберите часовой пояс:'), kb);
      userStates.set(userId, { step: 'awaiting_timezone_custom' });
      return;
    }

    userStates.set(userId, { step: 'choosing_text' });
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('📞 Позвонить', 'text_chip_call'), Markup.button.callback('🛒 Купить', 'text_chip_buy')],
      [Markup.button.callback('🤝 Встретиться', 'text_chip_meet')],
      [Markup.button.callback('✏️ Ввести вручную', 'custom_text')],
    ]);
    await reply(ctx, escapeHtml('📝 Выбери текст задачи или введите вручную:'), kb);
  });

  // chip handlers
  bot.action('text_chip_call', async (ctx) => {
    const s = userStates.get((ctx.from as any)!.id) || {};
    s.step = 'awaiting_custom_text';
    s.textPrefix = 'Позвонить';
    s.recentType = 'call';
    userStates.set((ctx.from as any)!.id, s);

    const recs = await Recent.find({ userId: (ctx.from as any)!.id, type: 'call' }).sort({ createdAt: -1 }).limit(5).exec();
    const kb = (function() {
      if (!recs.length) return Markup.inlineKeyboard([[Markup.button.callback('◀️ Отмена', 'cancel_task')]]);
      const rows = recs.map((r: any) => [Markup.button.callback(r.value, `recent_call_${encodeURIComponent(r.value)}`)]);
      rows.push([Markup.button.callback('📝 Ввести вручную', 'recent_custom')]);
      rows.push([Markup.button.callback('◀️ Отмена', 'cancel_task')]);
      return Markup.inlineKeyboard(rows);
    })();
    await reply(ctx, escapeHtml('Кому позвонить? Выберите из недавних или введите вручную:'), kb);
  });

  bot.action('text_chip_buy', async (ctx) => {
    const s = userStates.get((ctx.from as any)!.id) || {};
    s.step = 'awaiting_custom_text';
    s.textPrefix = 'Купить';
    s.recentType = 'buy';
    userStates.set((ctx.from as any)!.id, s);

    const recs = await Recent.find({ userId: (ctx.from as any)!.id, type: 'buy' }).sort({ createdAt: -1 }).limit(5).exec();
    const kb = (function() {
      if (!recs.length) return Markup.inlineKeyboard([[Markup.button.callback('◀️ Отмена', 'cancel_task')]]);
      const rows = recs.map((r: any) => [Markup.button.callback(r.value, `recent_buy_${encodeURIComponent(r.value)}`)]);
      rows.push([Markup.button.callback('📝 Ввести вручную', 'recent_custom')]);
      rows.push([Markup.button.callback('◀️ Отмена', 'cancel_task')]);
      return Markup.inlineKeyboard(rows);
    })();
    await reply(ctx, escapeHtml('Что купить? Выберите из недавних или введите вручную:'), kb);
  });

  bot.action('text_chip_meet', async (ctx) => {
    const s = userStates.get((ctx.from as any)!.id) || {};
    s.step = 'awaiting_custom_text';
    s.textPrefix = 'Встретиться';
    s.recentType = 'meet';
    userStates.set((ctx.from as any)!.id, s);

    const recs = await Recent.find({ userId: (ctx.from as any)!.id, type: 'meet' }).sort({ createdAt: -1 }).limit(5).exec();
    const kb = (function() {
      if (!recs.length) return Markup.inlineKeyboard([[Markup.button.callback('◀️ Отмена', 'cancel_task')]]);
      const rows = recs.map((r: any) => [Markup.button.callback(r.value, `recent_meet_${encodeURIComponent(r.value)}`)]);
      rows.push([Markup.button.callback('📝 Ввести вручную', 'recent_custom')]);
      rows.push([Markup.button.callback('◀️ Отмена', 'cancel_task')]);
      return Markup.inlineKeyboard(rows);
    })();
    await reply(ctx, escapeHtml('С кем встретиться? Выберите из недавних или введите вручную:'), kb);
  });

  bot.action('custom_text', async (ctx) => {
    const s = userStates.get((ctx.from as any)!.id) || {};
    s.step = 'awaiting_custom_text';
    userStates.set((ctx.from as any)!.id, s);
    await reply(ctx, escapeHtml('✏️ Введи текст задачи:'));
  });

  // recent selection
  bot.action(/recent_(call|buy|meet)_(.+)/, async (ctx) => {
    const [, type, enc] = (ctx.match as any) as string[];
    const val = decodeURIComponent(enc);
    const userId = (ctx.from as any)!.id;
    const s = userStates.get(userId);
    if (!s) return;
    s.text = s.textPrefix ? `${s.textPrefix} ${val}` : val;
    s.step = 'ask_reminder';
    await reply(
      ctx,
      `<b>📝 ${escapeHtml(s.text)}</b>\n\n${escapeHtml('Хотите, чтобы я прислал(а) вам напоминание перед задачей?')}`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Да', 'ask_reminder_yes'), Markup.button.callback('Нет', 'ask_reminder_no')],
        [Markup.button.callback('◀️ Отменить', 'cancel_task')],
      ])
    );
  });

  bot.action('recent_custom', async (ctx) => {
    const s = userStates.get((ctx.from as any)!.id) || {};
    s.step = 'awaiting_custom_text';
    userStates.set((ctx.from as any)!.id, s);
    await reply(ctx, escapeHtml('✏️ Введите значение вручную:'));
  });

  // ask reminder handlers
  bot.action('ask_reminder_yes', async (ctx) => {
    const state = userStates.get((ctx.from as any)!.id);
    if (!state) return;
    state.step = 'choosing_reminder';
    await editOrReply(ctx, escapeHtml('⏰ За сколько до задачи напомнить?'), reminderButtons());
  });

  bot.action('ask_reminder_no', async (ctx) => {
    const state = userStates.get((ctx.from as any)!.id);
    if (!state) return;
    state.remindBefore = 0;
    state.step = 'choosing_date';
    const now = new Date();
    state.currentYear = now.getFullYear();
    state.currentMonth = now.getMonth();
    await editOrReply(ctx, escapeHtml('📅 Выберите дату:'), generateCalendarWithCustom(state.currentYear, state.currentMonth));
  });

  // predefined reminder
  bot.action(/remind_(\d+)/, async (ctx) => {
    const remindMs = parseInt(String((ctx.match as any)[1]));
    const state = userStates.get((ctx.from as any)!.id);
    if (!state) return;
    state.remindBefore = remindMs;
    state.step = 'choosing_date';
    const now = new Date();
    state.currentYear = now.getFullYear();
    state.currentMonth = now.getMonth();
    await editOrReply(ctx, escapeHtml('📅 Выберите дату:'), generateCalendarWithCustom(state.currentYear, state.currentMonth));
  });

  bot.action('custom_reminder', async (ctx) => {
    const state = userStates.get((ctx.from as any)!.id);
    if (!state) return;
    state.step = 'awaiting_custom_reminder';
    await reply(ctx, escapeHtml('📝 Введите, пожалуйста, время до напоминания в минутах (например: 15)'));
  });

  // calendar navigation
  bot.action('custom_date', async (ctx) => {
    const state = userStates.get((ctx.from as any)!.id);
    if (!state) return;
    state.step = 'awaiting_custom_date';
    await reply(ctx, escapeHtml('📅 Введите дату в формате ДД.ММ.ГГГГ (например: 25.12.2025)'));
  });

  bot.action(/cal_(prev|next)_(\d+)_(\d+)/, async (ctx) => {
    const [, dir, yearStr, monthStr] = (ctx.match as any) as string[];
    let year = parseInt(yearStr);
    let month = parseInt(monthStr);
    month = dir === 'prev' ? month - 1 : month + 1;
    if (month < 0) { month = 11; year--; }
    if (month > 11) { month = 0; year++; }
    const state = userStates.get((ctx.from as any)!.id);
    if (!state) return;
    state.currentYear = year;
    state.currentMonth = month;
    try {
      const cal = generateCalendarWithCustom(year, month) as any;
      await (ctx as any).editMessageReplyMarkup((cal as any).reply_markup as any);
    } catch {
      await reply(ctx, escapeHtml('📅'), generateCalendarWithCustom(year, month));
    }
  });

  bot.action(/cal_day_(\d+)_(\d+)_(\d+)/, async (ctx) => {
    const [, yearStr, monthStr, dayStr] = (ctx.match as any) as string[];
    const year = parseInt(yearStr), month = parseInt(monthStr), day = parseInt(dayStr);
    const state = userStates.get((ctx.from as any)!.id);
    if (!state) return;
    state.selectedDate = { y: year, m: month, d: day };
    state.step = 'choosing_time';
    await editOrReply(ctx, escapeHtml('🕒 Выберите время:'), generateTimeButtonsWithCustom());
  });

  // time buttons
  bot.action(/time_(\d{2}:\d{2})/, async (ctx) => {
    const [hours, minutes] = String((ctx.match as any)[1]).split(':').map(Number);
    const state = userStates.get((ctx.from as any)!.id);
    if (!state || !state.selectedDate) return;
    state.selectedDate.hh = hours;
    state.selectedDate.mm = minutes;

    const settings = await UserSettings.findOne({ userId: (ctx.from as any)!.id }).exec();
    const tzName = settings?.timezone || 'UTC';
    const dt = buildUtcFromLocalParts(tzName, state.selectedDate.y, state.selectedDate.m, state.selectedDate.d, hours, minutes);
    if (dt.getTime() < Date.now()) {
      return reply(ctx, escapeHtml('⚠️ Нельзя ставить время в прошлом. Выберите другую дату/время.'));
    }

    state.step = 'choosing_repeat';
    await editOrReply(ctx, escapeHtml('🔁 Повтор задачи?'), repeatButtons(state.repeat));
  });

  bot.action('custom_time', async (ctx) => {
    const state = userStates.get((ctx.from as any)!.id);
    if (!state) return;
    state.step = 'awaiting_custom_time';
    await reply(ctx, escapeHtml('⌨️ Введите время в формате ЧЧ:ММ (например: 09:15)'));
  });

  // repeat handlers
  bot.action(/repeat_(.+)/, async (ctx) => {
    const val = String((ctx.match as any)[1]);
    const state = userStates.get((ctx.from as any)!.id);
    if (!state) return;
    if (val === 'none') state.repeat = undefined; else state.repeat = val as RepeatType;
    state.step = 'confirm_task';

    const settings = await UserSettings.findOne({ userId: (ctx.from as any)!.id }).exec();
    const tzName = settings?.timezone || 'UTC';
    if (!state.selectedDate || state.selectedDate.hh == null || state.selectedDate.mm == null) {
      return reply(ctx, escapeHtml('⚠️ Что-то не так с датой/временем. Начните заново.'), mainMenu());
    }

    const dueUtc = buildUtcFromLocalParts(tzName, state.selectedDate.y, state.selectedDate.m, state.selectedDate.d, state.selectedDate.hh, state.selectedDate.mm);
    const remindText = formatReminder(state.remindBefore);
    const repeatText = state.repeat ? (state.repeat === 'daily' ? 'ежедневно' : state.repeat === 'weekly' ? 'еженедельно' : 'ежемесячно') : 'нет';
    const text = `<b>📝 ${escapeHtml(state.text)}</b>\n📅 ${escapeHtml(formatInTz(dueUtc, tzName, DISPLAY_FMT))}\n🔔 Напоминание: ${escapeHtml(remindText)}\n🔁 Повтор: ${escapeHtml(repeatText)}`;
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('💾 Сохранить', 'save_task')],
      [Markup.button.callback('❌ Отмена', 'cancel_task')],
    ]);
    await reply(ctx, text, kb);
  });

  // save task
  bot.action('save_task', async (ctx) => {
    const state = userStates.get((ctx.from as any)!.id);
    if (!state || !state.text || !state.selectedDate || state.selectedDate.hh == null || state.selectedDate.mm == null) {
      return reply(ctx, escapeHtml('⚠️ Что-то пошло не так — начните создание задачи заново.'));
    }
    const userId = (ctx.from as any)!.id;
    const settings = await UserSettings.findOne({ userId }).exec();
    const tzName = settings?.timezone || 'UTC';
    const dueUtc = buildUtcFromLocalParts(tzName, state.selectedDate.y, state.selectedDate.m, state.selectedDate.d, state.selectedDate.hh, state.selectedDate.mm);
    if (dueUtc.getTime() < Date.now()) {
      return reply(ctx, escapeHtml('⚠️ Нельзя сохранять задачу в прошлом.'));
    }

    const task = new Task({
      userId,
      text: state.text,
      dueDate: dueUtc,
      remindBefore: state.remindBefore ?? 0,
      repeat: state.repeat ?? undefined,
      done: false,
      reminded: false,
      notifiedAtDue: false,
      spawnedNext: false,
    });
    await (task as any).save();

    if (state.textPrefix && state.recentType) {
      const raw = state.text.replace(state.textPrefix, '').trim();
      await pushRecent(userId, state.recentType, raw);
    }

    userStates.delete(userId);
    await editOrReply(ctx, escapeHtml('✅ Задача сохранена!'), mainMenu());
  });

  bot.action('cancel_task', async (ctx) => {
    userStates.delete((ctx.from as any)!.id);
    await editOrReply(ctx, escapeHtml('❌ Создание задачи отменено.'), mainMenu());
  });

  // my tasks
  bot.action('my_tasks', async (ctx) => {
    await renderUserTasks(ctx);
  });

  // pagination
  bot.action(/tasks_page_(\d+)/, async (ctx) => {
    const page = parseInt(String((ctx.match as any)[1]));
    await renderUserTasks(ctx, undefined, page);
  });

  // view task detail
  bot.action(/task_view_(.+)/, async (ctx) => {
    const id = String((ctx.match as any)[1]);
    const task = await Task.findById(id).exec() as any;
    if (!task) return (ctx as any).answerCbQuery?.('Задача не найдена.');
    if (task.userId !== (ctx.from as any)!.id) return (ctx as any).answerCbQuery?.('Недостаточно прав.');

    const settings = await UserSettings.findOne({ userId: (ctx.from as any)!.id }).exec();
    const txt = buildTaskDetailText(task, settings?.timezone);
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback(task.done ? '↩️ Отметить как невыполненную' : '✅ Завершить', `task_done_${String(task._id)}`),
        Markup.button.callback('🗑 Удалить', `task_delete_${String(task._id)}`)],
      [Markup.button.callback('◀️ Назад', 'my_tasks')],
    ]);
    await editOrReply(ctx, txt, kb);
  });

  // toggle done
  bot.action(/task_done_(.+)/, async (ctx) => {
    const id = String((ctx.match as any)[1]);
    const task = await Task.findById(id).exec() as any;
    if (!task) return (ctx as any).answerCbQuery?.('Задача не найдена.');
    if (task.userId !== (ctx.from as any)!.id) return (ctx as any).answerCbQuery?.('Недостаточно прав.');

    // Если отмечаем выполненной и есть repeat — создаем следующую и помечаем spawnedNext
    if (!task.done && task.repeat && !task.spawnedNext) {
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
    }

    task.done = !task.done;
    await (task as any).save();

    const settings = await UserSettings.findOne({ userId: (ctx.from as any)!.id }).exec();
    const txt = buildTaskDetailText(task, settings?.timezone);
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback(task.done ? '↩️ Отметить как невыполненной' : '✅ Завершить', `task_done_${String(task._id)}`),
        Markup.button.callback('🗑 Удалить', `task_delete_${String(task._id)}`)],
      [Markup.button.callback('◀️ Назад', 'my_tasks')],
    ]);
    await editOrReply(ctx, txt, kb);
  });

  // delete single task
  bot.action(/task_delete_(.+)/, async (ctx) => {
    const id = String((ctx.match as any)[1]);
    const task = await Task.findById(id).exec() as any;
    if (!task) return (ctx as any).answerCbQuery?.('Задача не найдена.');
    if (task.userId !== (ctx.from as any)!.id) return (ctx as any).answerCbQuery?.('Недостаточно прав.');

    await Task.deleteOne({ _id: id }).exec();
    await renderUserTasks(ctx, escapeHtml('Задача удалена.'));
  });

  // delete all tasks (confirm)
  bot.action('delete_all_tasks', async (ctx) => {
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('Да, удалить все', 'confirm_delete_all_yes')],
      [Markup.button.callback('Нет, отмена', 'confirm_delete_all_no')],
      [Markup.button.callback('◀️ Назад', 'my_tasks')],
    ]);
    await editOrReply(ctx, escapeHtml('⚠️ Вы уверены, что хотите удалить все ваши задачи? Это действие нельзя отменить.'), kb);
  });

  bot.action('confirm_delete_all_no', async (ctx) => {
    await renderUserTasks(ctx, escapeHtml('Операция отменена.'));
  });

  bot.action('confirm_delete_all_yes', async (ctx) => {
    const userId = (ctx.from as any)!.id;
    await Task.deleteMany({ userId }).exec();
    await editOrReply(ctx, escapeHtml('✅ Все ваши задачи удалены.'), mainMenu());
  });

  // today (в TZ пользователя)
  bot.action('today', async (ctx) => {
    const userId = (ctx.from as any)!.id;
    const settings = await UserSettings.findOne({ userId }).exec();
    const tzName = settings?.timezone || 'UTC';

    const startLocal = dayjs().tz(tzName).startOf('day');
    const endLocal   = startLocal.add(1, 'day');

    const startUtc = startLocal.utc().toDate();
    const endUtc   = endLocal.utc().toDate();

    const tasks = (await Task.find({
      userId,
      dueDate: { $gte: startUtc, $lt: endUtc },
    }).sort({ dueDate: 1 }).exec()) as any[];

    if (!tasks.length) return reply(ctx, escapeHtml('📭 На сегодня задач нет.'), mainMenu());

    let txt = `<b>Задачи на сегодня:</b>\n`;
    tasks.forEach((t, i) => {
      const dueStr = t.dueDate ? formatInTz(new Date(t.dueDate), tzName, DISPLAY_FMT) : '—';
      txt += `\n${i + 1}. ${escapeHtml(t.text)} — ${escapeHtml(dueStr)} ${t.done ? '✅' : ''}`;
    });
    await reply(ctx, txt, mainMenu());
  });

  // stats
  bot.action('stats', async (ctx) => {
    const userId = (ctx.from as any)!.id;
    const total = await Task.countDocuments({ userId }).exec();
    const done = await Task.countDocuments({ userId, done: true }).exec();
    const toRemind = await Task.countDocuments({ userId, reminded: false, dueDate: { $exists: true } }).exec();
    const statText = `<b>📊 Статистика:</b>\nВсего задач: ${total}\nВыполнено: ${done}\nОжидают напоминания: ${toRemind}`;
    await reply(ctx, statText, mainMenu());
  });

  // main menu callback
  bot.action('main_menu', async (ctx) => {
    await editOrReply(ctx, escapeHtml('📋 Главное меню:'), mainMenu());
  });

  return bot;
}

export default createBot;
