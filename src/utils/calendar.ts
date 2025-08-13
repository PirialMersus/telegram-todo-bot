// src/utils/calendar.ts
import { Markup } from 'telegraf';

export function generateCalendar(year: number, month: number) {
  const monthNames = [
    'Январь','Февраль','Март','Апрель','Май','Июнь',
    'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'
  ];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay() || 7;

  const buttons: any[] = [];
  let row: any[] = [];

  buttons.push([
    Markup.button.callback('◀️', `cal_prev_${year}_${month}`),
    Markup.button.callback(`${monthNames[month]} ${year}`, 'noop'),
    Markup.button.callback('▶️', `cal_next_${year}_${month}`)
  ]);

  for (let i = 1; i < firstDay; i++) row.push(Markup.button.callback(' ', 'noop'));

  for (let day = 1; day <= daysInMonth; day++) {
    row.push(Markup.button.callback(day.toString(), `cal_day_${year}_${month}_${day}`));
    if (row.length === 7) {
      buttons.push(row);
      row = [];
    }
  }
  if (row.length) buttons.push(row);

  return Markup.inlineKeyboard(buttons);
}
