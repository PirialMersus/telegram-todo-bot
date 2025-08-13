// src/utils/time.ts
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import tz from 'dayjs/plugin/timezone';
import { RepeatType } from '../models/Task';

dayjs.extend(utc);
dayjs.extend(tz);

/** Возвращает список популярных IANA таймзон для кнопок */
export const POPULAR_TZ = [
  'Europe/Kyiv', 'Europe/Warsaw', 'Europe/Berlin', 'Europe/London',
  'Europe/Moscow', 'Asia/Almaty', 'Asia/Tbilisi', 'Asia/Tashkent',
  'Asia/Dubai', 'Asia/Tokyo', 'Asia/Singapore', 'America/New_York',
  'America/Los_Angeles'
];

/** Форматирует дату для показа пользователю в его таймзоне */
export function formatInTz(date: Date | number, tzName: string) {
  return dayjs(date).tz(tzName).format('DD.MM.YYYY HH:mm');
}

/** Строит UTC Date из локальных компонентов (год, месяц, день, часы, минуты) в заданной таймзоне */
export function buildUtcFromLocalParts(
  tzName: string,
  y: number, m: number, d: number,
  hh: number, mm: number
): Date {
  const local = dayjs.tz(`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')} ${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`, 'YYYY-MM-DD HH:mm', tzName);
  return new Date(local.utc().toDate());
}

/** Сдвиг dueDate на период repeat (результат — новый UTC Date) */
export function shiftDueDate(dueUtc: Date, repeat?: RepeatType): Date {
  if (!repeat) return dueUtc;
  const dj = dayjs(dueUtc).utc();
  if (repeat === 'daily') return dj.add(1, 'day').toDate();
  if (repeat === 'weekly') return dj.add(1, 'week').toDate();
  return dj.add(1, 'month').toDate();
}
