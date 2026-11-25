import { defineConfig } from "prisma/config";

// Prisma 7 no longer reads .env itself. CI passes real env vars, so a missing file is fine.
try {
  process.loadEnvFile();
} catch {}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.ts",
  },
  // Not env(): that throws during `prisma generate` (postinstall) on a fresh clone without .env.
  // DIRECT_URL: migrations through a session connection when DATABASE_URL is a transaction pooler (Supabase's 6543,
  // docs/deploy-vercel-supabase.md). Unset: DATABASE_URL.
  datasource: { url: process.env.DIRECT_URL || process.env.DATABASE_URL },
});
