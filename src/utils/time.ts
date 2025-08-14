// src/utils/time.ts
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import tz from 'dayjs/plugin/timezone';
import type { RepeatType } from '../models/Task.js';

dayjs.extend(utc);
dayjs.extend(tz);

export const DISPLAY_FMT = 'DD.MM.YYYY HH:mm';

export function formatInTz(date: Date | number, tzName: string, fmt: string = DISPLAY_FMT): string {
  return dayjs(date).tz(tzName).format(fmt);
}

export function buildUtcFromLocalParts(
  tzName: string,
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number
): Date {
  const yyyy = String(y).padStart(4, '0');
  const mmStr = String(m + 1).padStart(2, '0');
  const ddStr = String(d).padStart(2, '0');
  const hhStr = String(hh).padStart(2, '0');
  const minStr = String(mm).padStart(2, '0');

  const localStr = `${yyyy}-${mmStr}-${ddStr} ${hhStr}:${minStr}`;
  const local = dayjs.tz(localStr, 'YYYY-MM-DD HH:mm', tzName);
  return new Date(local.utc().toDate().getTime());
}

export function shiftDueDate(dueUtc: Date, repeat?: RepeatType): Date {
  if (!repeat) return dueUtc;
  const dj = dayjs(dueUtc).utc();
  if (repeat === 'daily') return dj.add(1, 'day').toDate();
  if (repeat === 'weekly') return dj.add(1, 'week').toDate();
  return dj.add(1, 'month').toDate();
}

export const POPULAR_TZ: string[] = [
  'Europe/Kyiv', 'Europe/Warsaw', 'Europe/Berlin',
  'Europe/London', 'Europe/Moscow', 'Asia/Tbilisi',
  'Asia/Almaty', 'Asia/Tashkent', 'Asia/Dubai',
  'Asia/Tokyo', 'America/New_York', 'America/Los_Angeles'
];
