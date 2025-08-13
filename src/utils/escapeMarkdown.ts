// src/utils/escapeMarkdown.ts
export function escapeMdV2(s?: unknown): string {
  if (s === undefined || s === null) return '';
  const str = String(s);
  return str.replace(/([_\*\[\]\(\)~`>#+\-=|{}\.!\\])/g, '\\$1');
}
