// src/models/UserSettings.ts
import { Schema, model, Document, Model } from 'mongoose';

export interface IUserSettings {
  userId: number;
  timezone?: string; // IANA tz, напр. "Europe/Kyiv"
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IUserSettingsDocument extends IUserSettings, Document {}

const UserSettingsSchema = new Schema<IUserSettingsDocument>({
  userId: { type: Number, required: true, unique: true },
  timezone: { type: String },
}, { timestamps: true });

// Убираем дублирующий индекс { userId: 1 } — unique уже создаёт индекс

export const UserSettings = model('UserSettings', UserSettingsSchema) as Model<IUserSettingsDocument>;
