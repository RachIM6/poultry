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
  datasource: { url: process.env.DATABASE_URL },
});
