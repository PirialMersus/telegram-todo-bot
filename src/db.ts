// src/db.ts
import { MongoClient, Db, Collection, ObjectId } from 'mongodb';
import { TaskDoc, UserDoc } from './types';

let client: MongoClient | null = null;
let db: Db | null = null;

export interface Collections {
  users: Collection<UserDoc>;
  tasks: Collection<TaskDoc>;
}

export async function connectDB(uri?: string, dbName?: string): Promise<Db> {
  const MONGO_URI =
    uri ||
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    process.env.MONGOURL;

  if (!MONGO_URI || !/^mongodb(\+srv)?:\/\//.test(MONGO_URI)) {
    throw new Error('MONGO_URI не задан или имеет неверный формат');
  }

  const name = dbName || process.env.MONGO_DB || 'telegram_todo_bot';

  client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(name);

  const { users, tasks } = getCollections();
  await users.createIndex({ userId: 1 }, { unique: true });
  await tasks.createIndex({ userId: 1, dueAt: 1 });
  await tasks.createIndex({ userId: 1, reminderAt: 1 });
  await tasks.createIndex({ status: 1 });

  return db;
}

export function getDB(): Db {
  if (!db) throw new Error('DB not initialized. Call connectDB() first.');
  return db;
}

export function getCollections(): Collections {
  const database = getDB();
  return {
    users: database.collection<UserDoc>('users'),
    tasks: database.collection<TaskDoc>('tasks'),
  };
}

export async function ensureUser(user: {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}) {
  const { users } = getCollections();
  const now = new Date();
  await users.updateOne(
    { userId: user.id },
    {
      $setOnInsert: { userId: user.id, createdAt: now },
      $set: {
        firstName: user.first_name ?? null,
        lastName: user.last_name ?? null,
        username: user.username ?? null,
        lastActivityAt: now,
        updatedAt: now,
      },
    },
    { upsert: true }
  );
}

export async function touchUserActivity(userId: number) {
  const { users } = getCollections();
  const now = new Date();
  await users.updateOne(
    { userId },
    { $set: { lastActivityAt: now, updatedAt: now } },
    { upsert: false }
  );
}

export async function pushRecentTitle(userId: number, title: string, maxLen = 10) {
  const { users } = getCollections();
  const u = await users.findOne({ userId }, { projection: { recentTitles: 1 } });
  const cur: string[] = Array.isArray(u?.recentTitles) ? u!.recentTitles! : [];
  const filtered = cur.filter((t) => t !== title);
  filtered.unshift(title);
  const sliced = filtered.slice(0, maxLen);
  await users.updateOne(
    { userId },
    { $set: { recentTitles: sliced, updatedAt: new Date() } },
    { upsert: true }
  );
}

export async function getRecentTitles(userId: number, limit = 10): Promise<string[]> {
  const { users } = getCollections();
  const u = await users.findOne({ userId }, { projection: { recentTitles: 1 } });
  return (u?.recentTitles || []).slice(0, limit);
}

export { ObjectId };
