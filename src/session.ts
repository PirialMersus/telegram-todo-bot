// src/session.ts
import { session } from 'telegraf';
import { SessionData } from './types';

export function defaultSession(): SessionData {
  return {
    mode: 'idle',
    draft: null,
    steps: [],
    lastPrompt: null,
    returnTo: null,
    editingTaskId: null,
    listFilter: null,
    recentTitleCache: null,
    lastLoadedTask: null,
    timePicker: null,
  };
}

export const sessionMiddleware = session({
  defaultSession,
});
