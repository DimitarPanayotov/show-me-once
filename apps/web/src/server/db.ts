import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

const globalDb = globalThis as unknown as { showMeOnceDb?: PrismaClient };

export function db(): PrismaClient {
  if (globalDb.showMeOnceDb) return globalDb.showMeOnceDb;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  if (process.env.NODE_ENV !== 'production') globalDb.showMeOnceDb = client;
  return client;
}
