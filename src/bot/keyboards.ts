// src/bot/keyboards.ts
import { Markup } from 'telegraf';

const BACK_BTN = Markup.button.callback('↩ Назад', 'nav:back');
const CANCEL_BTN = Markup.button.callback('❌ Отмена', 'nav:cancel');
const HOME_BTN = Markup.button.callback('🏠 Главное меню', 'nav:home');

export function mainKeyboard() {
  return Markup.keyboard([['➕ Новая задача', '🗂 Мои задачи'], ['⚙️ Настройки']]).resize();
}

export function presetsKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⚡ Быстрое создание', 'preset:quick')],
    [Markup.button.callback('🛒 Купить', 'preset:buy'), Markup.button.callback('📞 Позвонить', 'preset:call')],
    [Markup.button.callback('🤝 Встреча', 'preset:meet'), Markup.button.callback('✍️ Ввести вручную', 'preset:custom')],
    [BACK_BTN, CANCEL_BTN],
  ]);
}

export function titleChoicesKb(items: string[] = []) {
  const rows: any[] = [];
  const slice = items.slice(0, 10);
  for (let i = 0; i < slice.length; i += 2) {
    const left = slice[i];
    const right = slice[i + 1];
    const row: any[] = [];
    row.push(Markup.button.callback(left || '—', `ttl_label:${i}`));
    if (right !== undefined) row.push(Markup.button.callback(right || '—', `ttl_label:${i + 1}`));
    rows.push(row);
  }
  rows.push([Markup.button.callback('✍️ Ввести новое', 'ttl:manual')]);
  rows.push([BACK_BTN, CANCEL_BTN]);
  return Markup.inlineKeyboard(rows);
}

export function dateQuickKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Сегодня', 'date:today'), Markup.button.callback('Завтра', 'date:tomorrow'), Markup.button.callback('Без даты', 'date:none')],
    [Markup.button.callback('📅 Календарь', 'date:cal')],
    [BACK_BTN, CANCEL_BTN],
  ]);
}

export function monthCalendarKb(year: number, month0: number) {
  const first = new Date(year, month0, 1);
  const last = new Date(year, month0 + 1, 0);
  const rows: any[] = [];
  rows.push([Markup.button.callback(`${first.toLocaleString('ru-RU', { month: 'long' })} ${year}`, 'noop')]);
  const wd = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  rows.push(wd.map(d => Markup.button.callback(d, 'noop')));
  let cur = new Date(first);
  const shift = (first.getDay() + 6) % 7;
  if (shift) {
    const empty = Array.from({ length: shift }, () => Markup.button.callback(' ', 'noop'));
    let part: any[] = [...empty];
    while (cur <= last) {
      part.push(Markup.button.callback(String(cur.getDate()), `date:${cur.toISOString().slice(0, 10)}`));
      if (part.length === 7) { rows.push(part); part = []; }
      cur.setDate(cur.getDate() + 1);
    }
    if (part.length) { while (part.length < 7) part.push(Markup.button.callback(' ', 'noop')); rows.push(part); }
  } else {
    let part: any[] = [];
    while (cur <= last) {
      part.push(Markup.button.callback(String(cur.getDate()), `date:${cur.toISOString().slice(0, 10)}`));
      if (part.length === 7) { rows.push(part); part = []; }
      cur.setDate(cur.getDate() + 1);
    }
    if (part.length) { while (part.length < 7) part.push(Markup.button.callback(' ', 'noop')); rows.push(part); }
  }
  rows.push([Markup.button.callback('«', `cal:${year}:${month0 - 1}`), Markup.button.callback('»', `cal:${year}:${month0 + 1}`)]);
  rows.push([BACK_BTN, CANCEL_BTN]);
  return Markup.inlineKeyboard(rows);
}

export function timePresetsKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('09:00', 'time:09:00'), Markup.button.callback('12:00', 'time:12:00')],
    [Markup.button.callback('15:00', 'time:15:00'), Markup.button.callback('18:00', 'time:18:00')],
    [Markup.button.callback('Через 15 мин', 'time:in:15m'), Markup.button.callback('Через 30 мин', 'time:in:30m')],
    [Markup.button.callback('Через 1 час', 'time:in:60m'), Markup.button.callback('Через 2 часа', 'time:in:120m')],
    [Markup.button.callback('⌛ Выбрать время', 'time:picker'), Markup.button.callback('✍️ Ввести вручную', 'time:manual')],
    [BACK_BTN, CANCEL_BTN],
  ]);
}

export function reminderPresetsKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔕 Без напоминания', 'rem:none'), Markup.button.callback('🕐 В момент', 'rem:at')],
    [Markup.button.callback('−5 мин', 'rem:-5m'), Markup.button.callback('−10 мин', 'rem:-10m'), Markup.button.callback('−15 мин', 'rem:-15m')],
    [Markup.button.callback('−30 мин', 'rem:-30m'), Markup.button.callback('−1 ч', 'rem:-60m'), Markup.button.callback('−2 ч', 'rem:-120m')],
    [Markup.button.callback('Сегодня 09:00', 'rem:today0900'), Markup.button.callback('Накануне 18:00', 'rem:dayBefore1800')],
    [Markup.button.callback('📅 Своя дата/время', 'rem:custom')],
    [BACK_BTN, CANCEL_BTN],
  ]);
}

export function repeatKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🚫 Нет', 'rep:none'), Markup.button.callback('⏱ Каждый час', 'rep:hourly')],
    [Markup.button.callback('📅 Каждый день', 'rep:daily'), Markup.button.callback('🗓 Каждую неделю', 'rep:weekly')],
    [Markup.button.callback('📆 Каждый месяц', 'rep:monthly'), Markup.button.callback('🎉 Каждый год', 'rep:yearly')],
    [Markup.button.callback('🔧 Свой интервал (мин)', 'rep:custom')],
    [BACK_BTN, CANCEL_BTN],
  ]);
}

export function filtersRootKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Сегодня', 'list:today'), Markup.button.callback('Завтра', 'list:tomorrow')],
    [Markup.button.callback('Предстоящие', 'list:upcoming'), Markup.button.callback('Просроченные', 'list:overdue')],
    [Markup.button.callback('Повторяющиеся', 'list:repeating'), Markup.button.callback('Без даты', 'list:nodate')],
    [Markup.button.callback('Выполненные', 'list:done'), Markup.button.callback('Все', 'list:all')],
    [BACK_BTN, CANCEL_BTN],
  ]);
}

export function tasksListKb(pairs: Array<[string, string]>, withNew = false) {
  const rows = pairs.map(([label, id]) => [Markup.button.callback(label, `tsk:${id}`)]);
  if (withNew) rows.push([Markup.button.callback('➕ Новая задача', 'list:new')]);
  rows.push([Markup.button.callback('🔎 Фильтры', 'list:filters')]);
  rows.push([HOME_BTN, CANCEL_BTN]);
  return Markup.inlineKeyboard(rows);
}

export function confirmKb(taskId?: string, showSave = true) {
  const rows: any[] = [];
  if (showSave) rows.push([Markup.button.callback('✅ Сохранить', 'confirm:save')]);
  rows.push([Markup.button.callback('✏️ Продолжить редактирование', taskId ? `tsk:edit:${taskId}` : 'confirm:edit')]);
  rows.push([Markup.button.callback('🗂 К задачам', 'list:all')]);
  rows.push([BACK_BTN, CANCEL_BTN]);
  return Markup.inlineKeyboard(rows);
}

export function taskActionKb(taskId: string, done: boolean) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✏️ Редактировать', `tsk:edit:${taskId}`)],
    [Markup.button.callback(done ? '↩ В активные' : '✅ Завершить', `tsk:toggle:${taskId}`), Markup.button.callback('🗑 Удалить', `tsk:del:${taskId}`)],
    [BACK_BTN, HOME_BTN],
  ]);
}

export function editMenuKb(taskId: string, markers?: { title?: boolean; date?: boolean; reminder?: boolean; repeat?: boolean; type?: boolean }) {
  const m = (flag?: boolean) => (flag ? ' ✳️' : '');
  const rows: any[] = [
    [Markup.button.callback(`✏️ Изменить название${m(markers?.title)}`, `edit:title:${taskId}`)],
    [Markup.button.callback(`📅 Изменить дату${m(markers?.date)}`, `edit:date:${taskId}`)],
    [Markup.button.callback(`⏰ Изменить время${m(markers?.date)}`, `edit:time:${taskId}`)],
    [Markup.button.callback(`🔔 Изменить напоминание${m(markers?.reminder)}`, `edit:reminder:${taskId}`)],
    [Markup.button.callback(`🔁 Изменить повтор${m(markers?.repeat)}`, `edit:repeat:${taskId}`)],
    [Markup.button.callback(`🔁 Сменить статус`, `tsk:status:${taskId}`)],
  ];
  const anyChanged = markers && (markers.title || markers.date || markers.reminder || markers.repeat || markers.type);
  if (anyChanged) {
    rows.push([Markup.button.callback(`✅ Сохранить изменения`, `edit:save:${taskId}`)]);
  }
  rows.push([BACK_BTN, CANCEL_BTN]);
  return Markup.inlineKeyboard(rows);
}

export function deleteConfirmKb(taskId: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('❗ Да, удалить', `tsk:del2:${taskId}`)],
    [BACK_BTN, CANCEL_BTN],
  ]);
}
