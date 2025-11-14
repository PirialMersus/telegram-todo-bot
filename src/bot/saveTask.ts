// src/bot/saveTask.ts
import { getCollections, ObjectId, pushRecentTitle } from '../db';
import { composeTitle, buildDateFromParts, addMinutes } from './utils';

function resolveReminder(
  preset: string | null | undefined,
  dueAt: Date | null,
  customDate?: string | null,
  customTime?: string | null
): Date | null {
  if (!preset || preset === 'none') return null;
  if (preset === 'custom') return buildDateFromParts(customDate ?? null, customTime ?? null);
  if (preset === 'at') return dueAt ? new Date(dueAt) : null;
  if (preset === 'today0900') {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0);
  }
  if (preset === 'dayBefore1800') {
    if (!dueAt) return null;
    const d = new Date(dueAt);
    d.setDate(d.getDate() - 1);
    d.setHours(18, 0, 0, 0);
    return d;
  }
  if (/^-?\d+m$/.test(preset)) {
    const m = Number(preset.replace('-', '').replace('m', ''));
    if (!dueAt) return null;
    return addMinutes(new Date(dueAt), -m);
  }
  if (/^-?\d+d$/.test(preset)) {
    const days = Number(preset.replace('-', '').replace('d', ''));
    if (!dueAt) return null;
    const d = new Date(dueAt);
    d.setDate(d.getDate() - days);
    return d;
  }
  if (/^-?\d+h$/.test(preset)) {
    const h = Number(preset.replace('-', '').replace('h', ''));
    if (!dueAt) return null;
    return addMinutes(new Date(dueAt), -h * 60);
  }
  return null;
}

function oldStatusAfterDue(oldStatus: string | undefined, due: Date | null): 'active' | 'overdue' | 'done' {
  if (oldStatus === 'done') return 'done';
  if (!due) return 'active';
  return due.getTime() < Date.now() ? 'overdue' : 'active';
}

export async function saveTaskFromDraft(ctx: any) {
  const s = ctx.session;
  if (!s.draft && !s.editingTaskId) throw new Error('Draft missing');
  const d = s.draft!;
  const now = new Date();
  const { tasks } = getCollections();

  if (s.editingTaskId) {
    const _id = new ObjectId(s.editingTaskId);
    const existing = await tasks.findOne({ _id, userId: ctx.from!.id });
    if (!existing) throw new Error('Задача не найдена при сохранении редактирования');

    const rawTitle = (d.title && d.title.trim()) ? d.title.trim() : (existing.title || '');
    const presetToUse = (d.type !== undefined && d.type !== null) ? d.type : existing.type;
    const finalTitle = composeTitle(presetToUse as any, rawTitle || existing.title);

    const due = (d.dueDate !== undefined && d.dueDate !== null)
      ? buildDateFromParts(d.dueDate ?? null, (d.dueTime ?? null) || null)
      : (existing.dueAt ?? null);

    const rem = (d.reminderPreset !== undefined && d.reminderPreset !== null)
      ? resolveReminder(d.reminderPreset, due, d.reminderDate ?? null, d.reminderTime ?? null)
      : (existing.reminderAt ?? null);

    const repeatVal = (d.repeat !== undefined && d.repeat !== null) ? d.repeat : (existing.repeat || 'none');
    const repeatMins = repeatVal === 'custom-mins'
      ? (d.repeatEveryMinutes || (existing as any).repeatEveryMinutes || null)
      : null;

    const newStatus = oldStatusAfterDue(existing.status, due);

    const update: any = {
      $set: {
        title: finalTitle,
        type: presetToUse ?? existing.type ?? 'custom',
        dueAt: due,
        reminderAt: rem,
        reminderPreset: (d.reminderPreset !== undefined && d.reminderPreset !== null) ? d.reminderPreset : (existing.reminderPreset ?? null),
        reminderDate: (d.reminderPreset === 'custom') ? (d.reminderDate ?? null) : null,
        reminderTime: (d.reminderPreset === 'custom') ? (d.reminderTime ?? null) : null,
        repeat: repeatVal,
        repeatEveryMinutes: repeatMins,
        status: newStatus,
        updatedAt: now,
      },
    };

    try {
      const existingRemMs = existing.reminderAt ? new Date(existing.reminderAt).getTime() : null;
      const newRemMs = rem ? new Date(rem).getTime() : null;
      if (existingRemMs !== newRemMs) {
        update.$set.reminderSentAt = null;
      }
    } catch {}

    await tasks.updateOne({ _id, userId: ctx.from!.id }, update);
    s.editingTaskId = null;
    s.originalTask = null;
    if (s.lastLoadedTask && s.lastLoadedTask.id === String(_id)) s.lastLoadedTask = null;
    return String(_id);
  }

  const presetToUse = (d.type !== undefined && d.type !== null) ? d.type : 'custom';
  const finalTitle = composeTitle(presetToUse as any, (d.title || '').trim());
  const due = buildDateFromParts(d.dueDate ?? null, (d.dueTime ?? null) || null);
  const rem = resolveReminder(d.reminderPreset ?? null, due, d.reminderDate ?? null, d.reminderTime ?? null);

  const newTask: any = {
    userId: ctx.from!.id,
    title: finalTitle,
    type: presetToUse ?? 'custom',
    dueAt: due,
    reminderAt: rem,
    reminderPreset: d.reminderPreset ?? null,
    reminderDate: d.reminderPreset === 'custom' ? (d.reminderDate ?? null) : null,
    reminderTime: d.reminderPreset === 'custom' ? (d.reminderTime ?? null) : null,
    repeat: d.repeat || 'none',
    repeatEveryMinutes: d.repeat === 'custom-mins' ? (d.repeatEveryMinutes || null) : null,
    status: oldStatusAfterDue(undefined, due),
    reminderSentAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const same = await tasks.find({ userId: ctx.from!.id, title: newTask.title }).limit(1).toArray();
  if (same.length) {
    if (newTask.dueAt) {
      const dd = newTask.dueAt as Date;
      newTask.title = `${newTask.title} (${String(dd.getDate()).padStart(2, '0')}.${String(dd.getMonth() + 1).padStart(2, '0')} ${String(dd.getHours()).padStart(2, '0')}:${String(dd.getMinutes()).padStart(2, '0')})`;
    } else {
      newTask.title = `${newTask.title} (копия)`;
    }
  }

  const ins = await tasks.insertOne(newTask);
  try { await pushRecentTitle(ctx.from!.id, (d.title || '').trim()); } catch {}
  return ins.insertedId.toString();
}
