// src/utils/timeButtons.ts
import { Markup } from 'telegraf';

export function generateTimeButtons() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('08:00', 'time_08:00'),
      Markup.button.callback('10:00', 'time_10:00'),
      Markup.button.callback('12:00', 'time_12:00'),
    ],
    [
      Markup.button.callback('14:00', 'time_14:00'),
      Markup.button.callback('16:00', 'time_16:00'),
      Markup.button.callback('18:00', 'time_18:00'),
    ],
    [Markup.button.callback('📝 Ввести своё время', 'custom_time')],
  ]);
}
