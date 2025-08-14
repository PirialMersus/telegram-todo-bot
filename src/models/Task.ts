// src/models/Task.ts
import { Schema, model, Document, Model } from 'mongoose';

export type RepeatType = 'daily' | 'weekly' | 'monthly';

export interface ITask {
  userId: number;
  text: string;
  dueDate?: Date;           // хранится в UTC
  remindBefore?: number;    // миллисекунды до dueDate
  repeat?: RepeatType;
  category?: string;
  done: boolean;
  reminded: boolean;        // напоминание ДО due было отправлено
  notifiedAtDue: boolean;   // уведомление В МОМЕНТ due было отправлено
  spawnedNext: boolean;     // чтобы не создавать дубликаты следующего экземпляра
  createdAt: Date;
}

export interface ITaskDocument extends ITask, Document {}

const TaskSchema = new Schema<ITaskDocument>({
  userId: { type: Number, required: true },
  text: { type: String, required: true },
  dueDate: { type: Date },
  remindBefore: { type: Number, default: 0 },
  repeat: { type: String, enum: ['daily', 'weekly', 'monthly'] },
  category: { type: String },
  done: { type: Boolean, default: false },
  reminded: { type: Boolean, default: false },
  notifiedAtDue: { type: Boolean, default: false },
  spawnedNext: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

// Индексы
TaskSchema.index({ reminded: 1, dueDate: 1 });
TaskSchema.index({ notifiedAtDue: 1, dueDate: 1 });
TaskSchema.index({ userId: 1, dueDate: 1 });
TaskSchema.index({ done: 1, dueDate: 1 });

export const Task = model('Task', TaskSchema) as Model<ITaskDocument>;
