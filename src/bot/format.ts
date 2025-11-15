// src/bot/format.ts
import { TaskDoc } from '../types';
import {
  mapTypeLabel,
  mapReminderLabel,
  mapStatusRu,
  mapStatusIcon,
  composeTitle,
  mapRepeatLabelVal,
  toLocalDateStr,
} from './utils';

function humanDateFromParts(
  dateStr?: string | null,
  timeStr?: string | null
): string {
  if (!dateStr && !timeStr) return '—';
  try {
    if (!dateStr && timeStr) {
      return `${timeStr}`;
    }
    const iso = dateStr + 'T' + (timeStr ?? '09:00') + ':00';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const day = d.getDate();
    const months = [
      'янв',
      'фев',
      'мар',
      'апр',
      'май',
      'июн',
      'июл',
      'авг',
      'сен',
      'окт',
      'ноя',
      'дек',
    ];
    const month = months[d.getMonth()] || '';
    const year = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${day} ${month} ${year} г ${hh}:${mm}`;
  } catch {
    return '—';
  }
}

export function renderTask(task: TaskDoc): string {
  const displayTitle = composeTitle((task as any).type, task.title || '');
  const categoryLine = `Категория: ${mapTypeLabel((task as any).type ?? null)}`;
  const titleLine = `Название: ${displayTitle || 'Без названия'}`;

  const whenLine = `📅 ${
    task?.dueAt ? toLocalDateStr(task.dueAt as any) : '—'
  }`;

  const reminderLine = (() => {
    const anyt: any = task as any;
    if (anyt?.reminderAt) {
      return `🔔 ${toLocalDateStr(anyt.reminderAt)}`;
    }
    if (anyt?.reminderPreset) return `🔔 ${mapReminderLabel(anyt)}`;
    return `🔔 —`;
  })();

  const repeatLine = `🔁 ${mapRepeatLabelVal(
    (task as any).repeat,
    (task as any).repeatEveryMinutes
  )}`;

  const statusLine = `${mapStatusIcon(
    (task.status as any) ?? 'active'
  )} ${mapStatusRu((task.status as any) ?? 'active')}`;

  return [
    categoryLine,
    titleLine,
    whenLine,
    reminderLine,
    repeatLine,
    `Статус: ${statusLine}`,
  ].join('\n');
}

export function renderDraft(
  draft:
    | {
    title?: string;
    type?: string;
    dueDate?: string | null;
    dueTime?: string | null;
    reminderPreset?: string | null;
    reminderDate?: string | null;
    reminderTime?: string | null;
    repeat?: string | null;
    repeatEveryMinutes?: number | null;
  }
    | null,
  original?: any | null
) {
  if (!draft) {
    return [
      `Категория: ✍️ Вручную`,
      `Название: —`,
      `📅 —`,
      `🔔 —`,
      `🔁 нет`,
      `Статус: 🟢 Активна`,
    ].join('\n');
  }

  const typeLabel = mapTypeLabel(draft.type as any);
  const reminderLabel =
    draft.reminderPreset === 'custom'
      ? draft.reminderDate || draft.reminderTime
        ? `${draft.reminderDate ?? ''} ${draft.reminderTime ?? ''}`.trim()
        : 'Своя дата/время'
      : mapReminderLabel(draft);

  const repeatLabel = mapRepeatLabelVal(
    draft.repeat,
    draft.repeatEveryMinutes
  );
  const displayTitle = composeTitle(draft.type as any, draft.title || '');

  const whenStr =
    draft.dueDate || draft.dueTime
      ? humanDateFromParts(draft.dueDate ?? null, draft.dueTime ?? null)
      : '—';

  const origTitle = original
    ? composeTitle(original.type, original.title || '')
    : null;
  const origDueDate =
    original && original.dueAt
      ? new Date(original.dueAt).toISOString().slice(0, 10)
      : null;
  const origDueTime =
    original && original.dueAt
      ? `${String(new Date(original.dueAt).getHours()).padStart(
        2,
        '0'
      )}:${String(new Date(original.dueAt).getMinutes()).padStart(2, '0')}`
      : null;
  const origReminderPreset = original
    ? original.reminderAt
      ? 'custom'
      : original.reminderPreset || 'none'
    : null;
  const origReminderDate =
    original && original.reminderAt
      ? new Date(original.reminderAt).toISOString().slice(0, 10)
      : null;
  const origReminderTime =
    original && original.reminderAt
      ? `${String(new Date(original.reminderAt).getHours()).padStart(
        2,
        '0'
      )}:${String(new Date(original.reminderAt).getMinutes()).padStart(
        2,
        '0'
      )}`
      : null;
  const origRepeat = original ? original.repeat || 'none' : null;
  const origRepeatMins = original
    ? (original as any).repeatEveryMinutes || null
    : null;

  const titleChanged =
    origTitle !== null ? displayTitle !== origTitle : false;
  const dateChanged =
    origDueDate !== null || origDueTime !== null
      ? (draft.dueDate ?? null) !== origDueDate ||
      (draft.dueTime ?? null) !== origDueTime
      : false;
  const reminderChanged =
    origReminderPreset !== null
      ? (draft.reminderPreset ?? null) !== origReminderPreset ||
      (draft.reminderDate ?? null) !== origReminderDate ||
      (draft.reminderTime ?? null) !== origReminderTime
      : false;
  const repeatChanged =
    origRepeat !== null
      ? (draft.repeat ?? null) !== origRepeat ||
      (draft.repeatEveryMinutes ?? null) !== origRepeatMins
      : false;

  const typeChanged = original
    ? (draft.type ?? null) !== (original.type ?? null)
    : false;

  const suf = (ch: boolean) => (ch ? ' ✳️' : '');

  return [
    `Категория: ${typeLabel}${suf(typeChanged)}`,
    `Название: ${displayTitle || '—'}${suf(titleChanged)}`,
    `📅 ${whenStr}${suf(dateChanged)}`,
    `🔔 ${reminderLabel}${suf(reminderChanged)}`,
    `🔁 ${repeatLabel}${suf(repeatChanged)}`,
    `Статус: 🟢 Активна`,
  ].join('\n');
}
