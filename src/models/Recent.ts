// src/models/Recent.ts
import { Schema, model, Document, Model } from 'mongoose';

export type RecentType = 'call' | 'buy' | 'meet';

export interface IRecent {
  userId: number;
  type: RecentType;
  value: string;
  createdAt: Date;
}

export interface IRecentDocument extends IRecent, Document {}

const RecentSchema = new Schema<IRecentDocument>({
  userId: { type: Number, required: true },
  type: { type: String, enum: ['call', 'buy', 'meet'], required: true },
  value: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

RecentSchema.index({ userId: 1, type: 1, createdAt: -1 });

export const Recent = model('Recent', RecentSchema) as Model<IRecentDocument>;
