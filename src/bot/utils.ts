// src/bot/utils.ts
import type { Context } from 'telegraf';

export function isCallback(ctx: Context): boolean {
  return Boolean((ctx as any).update?.callback_query);
}

export async function safeEditOrReply(
  ctx: Context,
  text: string,
  extra?: any
): Promise<{ messageId: number; viaCallback: boolean }> {
  if (isCallback(ctx)) {
    try {
      const res: any = await (ctx as any).editMessageText(text, extra);
      const mid =
        res?.message_id ??
        (ctx as any).callbackQuery?.message?.message_id ??
        0;
      return { messageId: mid, viaCallback: true };
    } catch {
      const sent = await ctx.reply(text, extra);
      return { messageId: (sent as any).message_id, viaCallback: false };
    }
  }
  const sent = await ctx.reply(text, extra);
  return { messageId: (sent as any).message_id, viaCallback: false };
}

export function toLocalDateStr(d?: Date | string | null): string {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Kiev',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '';

  const day = get('day');
  const month = get('month');
  const year = get('year');
  const hour = get('hour');
  const minute = get('minute');

  if (!day || !month || !year || !hour || !minute) return '—';
  return `${day}.${month}.${year} ${hour}:${minute}`;
}

export function todayISO(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Kiev',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '';

  const year = get('year');
  const month = get('month');
  const day = get('day');

  if (!year || !month || !day) {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  return `${year}-${month}-${day}`;
}

export function timeISO(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Kiev',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '';

  const hour = get('hour') || '00';
  const minute = get('minute') || '00';

  return `${hour}:${minute}`;
}

export function buildDateFromParts(date?: string | null, time?: string | null): Date | null {
  if (!date && !time) return null;

  let base: Date;
  if (date) {
    const parts = date.split('-').map((p) => Number(p));
    if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
      const [y, m, d] = parts;
      base = new Date(y, m - 1, d, 0, 0, 0, 0);
    } else {
      base = new Date(`${date}T00:00:00`);
      if (Number.isNaN(base.getTime())) base = new Date();
    }
  } else {
    base = new Date();
  }

  if (time) {
    const [h, mm] = (time || '').split(':').map(Number);
    base.setHours(
      Number.isFinite(h) ? h : 0,
      Number.isFinite(mm) ? mm : 0,
      0,
      0
    );
  } else {
    base.setHours(9, 0, 0, 0);
  }
  return base;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000);
}

export function composeTitle(type: string | undefined | null, rawTitle: string | undefined | null): string {
  const t = (rawTitle ?? '').trim();
  if (!type || type === 'custom') return t || '';
  if (type === 'buy') return `Купить ${t}`.trim();
  if (type === 'call') return `Позвонить ${t}`.trim();
  if (type === 'meet') return `Встреча ${t}`.trim();
  return `${t}`.trim();
}

export function mapTypeLabel(type?: string | null): string {
  if (!type) return '✍️ Вручную';
  switch (type) {
    case 'buy':
      return '🛒 Купить';
    case 'call':
      return '📞 Позвонить';
    case 'meet':
      return '🤝 Встреча';
    default:
      return '✍️ Вручную';
  }
}

export function mapStatusRu(status: 'active' | 'done' | 'overdue' | string): string {
  if (!status) return 'Активна';
  if (status === 'done') return 'Выполнена';
  if (status === 'overdue') return 'Просрочена';
  return 'Активна';
}

export function mapStatusIcon(status: 'active' | 'done' | 'overdue' | string): string {
  if (status === 'done') return '✅';
  if (status === 'overdue') return '🔴';
  return '🟢';
}

export function mapRepeatLabelVal(repeat?: string | null, mins?: number | null): string {
  if (!repeat || repeat === 'none') return 'нет';
  switch (repeat) {
    case 'hourly':
      return 'Каждый час';
    case 'daily':
      return 'Каждый день';
    case 'weekly':
      return 'Каждую неделю';
    case 'monthly':
      return 'Каждый месяц';
    case 'yearly':
      return 'Каждый год';
    case 'custom-mins':
      return mins ? `${mins} мин` : 'Свой интервал';
    default:
      return String(repeat);
  }
}

export function mapReminderLabel(obj: any): string {
  const preset = obj?.reminderPreset;
  if (!preset || preset === 'none') return '—';
  if (preset === 'custom') {
    if (obj?.reminderDate || obj?.reminderTime) {
      return `${obj.reminderDate ?? ''} ${obj.reminderTime ?? ''}`.trim();
    }
    return 'Своя дата/время';
  }
  if (preset === 'at' || preset === 'at-time') return 'В момент';
  if (preset === 'today0900') return 'Сегодня 09:00';
  if (preset === 'dayBefore1800') return 'Накануне 18:00';
  if (/^-?\d+m$/.test(preset)) {
    const minutes = Number(preset.replace('-', '').replace('m', ''));
    if (minutes >= 60) return `За ${Math.floor(minutes / 60)} ч`;
    return `За ${minutes} мин`;
  }
  if (/^-?\d+d$/.test(preset)) {
    const days = Number(preset.replace('-', '').replace('d', ''));
    if (days === 1) return 'За 1 день';
    return `За ${days} дней`;
  }
  return String(preset);
}
