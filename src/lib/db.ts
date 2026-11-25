import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

/** The client inside db.$transaction(): cross-module writes take it so they commit or roll back together. */
export type Tx = Prisma.TransactionClient;

// Prisma's 5 s / 2 s defaults expire on a slow host while a phone pushes its backlog; the phone would retry forever.
// Page reads take no interactive transaction: one holds a pooled connection for its whole run (P2028 under load).
export const SYNC_TX = { timeout: 15_000, maxWait: 5_000 };

// The pg Pool behind the adapter, per server process (.env.example): DATABASE_POOL_MAX connections (pg's default, 10)
// and DATABASE_CONNECTION_TIMEOUT_MS to wait for one before the query fails (pg's default waits forever).
// Safe behind a transaction-mode pooler (Supabase's Supavisor on 6543, docs/deploy-vercel-supabase.md): pg sends
// unnamed statements, and the code holds no session state (only pg_advisory_xact_lock, no SET, no LISTEN).
const pool = {
  max: Number(process.env.DATABASE_POOL_MAX) || 10,
  connectionTimeoutMillis: Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS) || 10_000,
};

/**
 * TLS verified against DATABASE_CA_CERT (PEM) when it is set: Supabase signs its certificates with its own CA, and
 * pg 8 reads sslmode=require as verify-full, which then fails. pg lets the URL's ssl* parameters override the ssl
 * option, so they are dropped. Without it, the URL alone decides.
 */
export function pgConnection(url = process.env.DATABASE_URL, ca = process.env.DATABASE_CA_CERT) {
  if (!url || !ca) return { connectionString: url };
  const u = new URL(url);
  for (const key of [...u.searchParams.keys()]) if (key.startsWith("ssl") || key === "uselibpqcompat") u.searchParams.delete(key);
  return { connectionString: u.href, ssl: { ca: ca.replaceAll("\\n", "\n") } }; // a one-line paste keeps \n escaped
}

// One client per process, kept on globalThis so dev hot reloads don't open a new pool each time.
const globalForDb = globalThis as unknown as { db?: PrismaClient };

export const db = globalForDb.db ?? new PrismaClient({ adapter: new PrismaPg({ ...pgConnection(), ...pool }) });

if (process.env.NODE_ENV !== "production") globalForDb.db = db;
