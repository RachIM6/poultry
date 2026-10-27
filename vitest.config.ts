import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Local .env for TEST_DATABASE_URL; CI sets real env vars instead.
try {
  process.loadEnvFile();
} catch {}

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    testTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["src/**/*.test.ts", "*.test.ts"], exclude: ["**/*.int.test.ts"] },
      },
      {
        // Real Postgres, separate database, reset per file. Files run serially because they share it.
        extends: true,
        test: {
          name: "int",
          include: ["src/**/*.int.test.ts"],
          globalSetup: "src/test/global-setup.ts",
          setupFiles: "src/test/db.ts",
          fileParallelism: false,
          env: { DATABASE_URL: process.env.TEST_DATABASE_URL },
        },
      },
    ],
  },
});
