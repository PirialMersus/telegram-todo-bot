// src/utils/time.ts
// ---------------------------------
// Путь: src/utils/time.ts
// Утилиты по работе со временем и таймзонами (dayjs + utc + timezone).
// Экспортируем функции форматирования и построения UTC Date из частей в локальной TZ.
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import tz from 'dayjs/plugin/timezone';
import type { RepeatType } from '../models/Task.js';

dayjs.extend(utc);
dayjs.extend(tz);

export const DISPLAY_FMT = 'DD.MM.YYYY HH:mm';

/**
 * Форматирует дату для отображения в таймзоне пользователя.
 * @param date Date | number
 * @param tzName IANA time zone (напр. "Europe/Kyiv")
 * @param fmt формат (по умолчанию DISPLAY_FMT)
 */
export function formatInTz(date: Date | number, tzName: string, fmt: string = DISPLAY_FMT): string {
  return dayjs(date).tz(tzName).format(fmt);
}

/**
 * Строит UTC Date из локальных компонентов (год, месяцIndex, день, часы, минуты)
 * принимая во внимание таймзону пользователя.
 *
 * @param tzName IANA tz
 * @param y год (например 2025)
 * @param m месяц индекс 0..11
 * @param d число 1..31
 * @param hh часы 0..23
 * @param mm минуты 0..59
 */
export function buildUtcFromLocalParts(
  tzName: string,
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number
): Date {
  // month in format string is 1-based, поэтому m+1
  const yyyy = String(y).padStart(4, '0');
  const mmStr = String(m + 1).padStart(2, '0');
  const ddStr = String(d).padStart(2, '0');
  const hhStr = String(hh).padStart(2, '0');
  const minStr = String(mm).padStart(2, '0');

  const localStr = `${yyyy}-${mmStr}-${ddStr} ${hhStr}:${minStr}`;
  const local = dayjs.tz(localStr, 'YYYY-MM-DD HH:mm', tzName);
  return new Date(local.utc().toDate().getTime());
}

/**
 * Сдвигаем dueDate вперёд в UTC в соответствии с repeat.
 * Возвращаем новый Date (UTC).
 */
export function shiftDueDate(dueUtc: Date, repeat?: RepeatType): Date {
  if (!repeat) return dueUtc;
  const dj = dayjs(dueUtc).utc();
  if (repeat === 'daily') return dj.add(1, 'day').toDate();
  if (repeat === 'weekly') return dj.add(1, 'week').toDate();
  return dj.add(1, 'month').toDate();
}

/** Популярные TZ для встроенных кнопок (можно расширить) */
export const POPULAR_TZ: string[] = [
  'Europe/Kyiv', 'Europe/Warsaw', 'Europe/Berlin',
  'Europe/London', 'Europe/Moscow', 'Asia/Tbilisi',
  'Asia/Almaty', 'Asia/Tashkent', 'Asia/Dubai',
  'Asia/Tokyo', 'America/New_York', 'America/Los_Angeles'
];
