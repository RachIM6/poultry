import { db } from "@/lib/db";
import { seedDemo } from "@/ops/demo";

// `pnpm db:seed:demo` (T26): a demo full of made-up data (ADR-016), src/ops/demo. Run `pnpm db:seed` first (strains,
// catalogue, charts).
// - Default: a new demo owner, DEMO_PHONE (default +212600000099), with DEMO_PASSWORD or a generated password printed
//   once (ADR-015), and two organisations. Run again: adds nothing (with DEMO_PASSWORD, changes that owner's password).
// - DEMO_INTO_EXISTING=1: fills the organisation of the account that already has DEMO_PHONE (DEMO_ORGANIZATION_ID if it
//   owns several) and adds the SARL. Never reads or changes that account's password. Run again: adds nothing.
// - With DEMO_HISTORY_FROM=2025-01-01 (and DEMO_INTO_EXISTING=1): the long history from that day to today instead, a
//   company with its books, and four members who sign in by email; DEMO_RESET=1 first empties the demo's own
//   organisations (refused for any other). The members' passwords go to DEMO_MEMBERS_FILE only (default
//   C:\tmp\demo-members.txt), kept on a second run unless DEMO_MEMBERS_ROTATE=1. Run again: adds nothing.
// - DEMO_EXPORT=<file>: on a local copy of the hosted database where the history was just told, its rows to a file;
//   DEMO_IMPORT=<file>: on the hosted database, the same reset and those rows in one transaction (minutes, not hours:
//   docs/deploy-vercel-supabase.md section 2).

// The production image runs with NODE_ENV=production: a demo farm there is a mistake unless asked for explicitly.
if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "1") {
  console.error("demo: refused with NODE_ENV=production; set ALLOW_DEMO_SEED=1 to seed the demo farm anyway");
  process.exit(1);
}

try {
  const { lines } = await seedDemo({
    phone: process.env.DEMO_PHONE || "+212600000099",
    password: process.env.DEMO_PASSWORD || undefined,
    intoExisting: process.env.DEMO_INTO_EXISTING === "1",
    organizationId: process.env.DEMO_ORGANIZATION_ID || undefined,
    exportTo: process.env.DEMO_EXPORT || undefined,
    importFrom: process.env.DEMO_IMPORT || undefined,
    history: process.env.DEMO_HISTORY_FROM
      ? { from: process.env.DEMO_HISTORY_FROM, reset: process.env.DEMO_RESET === "1", membersFile: process.env.DEMO_MEMBERS_FILE || "C:\\tmp\\demo-members.txt", rotate: process.env.DEMO_MEMBERS_ROTATE === "1" }
      : undefined,
  });
  for (const line of lines) console.log(line);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
