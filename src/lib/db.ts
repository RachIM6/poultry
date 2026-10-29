import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

/** The client inside db.$transaction(): cross-module writes take it so they commit or roll back together. */
export type Tx = Prisma.TransactionClient;

// One client per process, kept on globalThis so dev hot reloads don't open a new pool each time.
const globalForDb = globalThis as unknown as { db?: PrismaClient };

export const db =
  globalForDb.db ?? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

if (process.env.NODE_ENV !== "production") globalForDb.db = db;
