// src/types.ts
export type TaskStatus = 'active' | 'done' | 'overdue';

export interface UserDoc {
  _id?: any;
  userId: number;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  lastActivityAt: Date;
  cleanupWarnedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  recentTitles?: string[];
}

export interface TaskDoc {
  _id?: any;
  userId: number;
  title: string;
  type?: string;
  dueAt?: Date | null;
  reminderAt?: Date | null;
  reminderPreset?: string | null;
  reminderDate?: string | null;
  reminderTime?: string | null;
  repeat?: string | null;
  repeatEveryMinutes?: number | null;
  status: TaskStatus;
  reminderSentAt?: Date | null;
  atTimeSentAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WizardDraft {
  type?: string;
  title?: string;
  dueDate?: string | null;
  dueTime?: string | null;
  reminderPreset?: string | null;
  reminderDate?: string | null;
  reminderTime?: string | null;
  repeat?: string | null;
  repeatEveryMinutes?: number | null;
}

export type WizardStep =
  | 'type'
  | 'title'
  | 'date'
  | 'time'
  | 'reminder'
  | 'reminder-custom-date'
  | 'reminder-custom-time'
  | 'repeat'
  | 'repeat-custom-mins'
  | 'confirm';

export interface SessionData {
  mode?: 'idle' | 'creating' | 'editing' | 'listing' | 'quick';
  draft?: WizardDraft | null;
  steps?: WizardStep[];
  lastPrompt?: { chatId: number; messageId: number; viaCallback: boolean } | null;
  returnTo?: string | null;
  editingTaskId?: string | null;
  listFilter?: string | null;
  recentTitleCache?: string[] | null;
  lastLoadedTask?: {
    id: string;
    loadedAt: number;
    task: any;
  } | null;
  timePicker?: {
    stage?: 'hour' | 'minute';
    hour?: number | null;
  } | null;

  // оригинальная задача при редактировании (для сравнения с draft)
  originalTask?: any | null;
}
