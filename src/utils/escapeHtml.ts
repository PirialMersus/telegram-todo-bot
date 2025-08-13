// src/utils/escapeHtml.ts
export function escapeHtml(value?: unknown): string {
  if (value === undefined || value === null) return '';
  const s = String(value);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
