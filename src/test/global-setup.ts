import { execSync } from "node:child_process";

// Runs once per `pnpm test`: brings the test database to the latest migration (creating it if missing).
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example).");
  if (url === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL: tests truncate it.");
  execSync("pnpm exec prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
}
