// src/models/UserSettings.ts
import { Schema, model, Document, Model } from 'mongoose';

export interface IUserSettings {
  userId: number;
  timezone?: string; // IANA tz, напр. "Europe/Kyiv"
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserSettingsDocument extends IUserSettings, Document {}

const UserSettingsSchema = new Schema<IUserSettingsDocument>({
  userId: { type: Number, required: true, unique: true },
  timezone: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

UserSettingsSchema.index({ userId: 1 });

UserSettingsSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

export const UserSettings = model('UserSettings', UserSettingsSchema) as Model<IUserSettingsDocument>;
