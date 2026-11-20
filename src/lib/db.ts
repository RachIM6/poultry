import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

/** The client inside db.$transaction(): cross-module writes take it so they commit or roll back together. */
export type Tx = Prisma.TransactionClient;

// Prisma's 5 s / 2 s defaults expire on a slow host while a phone pushes its backlog; the phone would retry forever.
export const SYNC_TX = { timeout: 15_000, maxWait: 5_000 };

// One client per process, kept on globalThis so dev hot reloads don't open a new pool each time.
const globalForDb = globalThis as unknown as { db?: PrismaClient };

export const db =
  globalForDb.db ?? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

if (process.env.NODE_ENV !== "production") globalForDb.db = db;
