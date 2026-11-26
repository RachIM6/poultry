import { db } from "@/lib/db";
import { seedDemo } from "@/ops/demo";

// `pnpm db:seed:demo` (T26): a demo full of made-up data (ADR-016), src/ops/demo. Run `pnpm db:seed` first (strains,
// catalogue, charts).
// - Default: a new demo owner, DEMO_PHONE (default +212600000099), with DEMO_PASSWORD or a generated password printed
//   once (ADR-015), and two organisations. Run again: adds nothing (with DEMO_PASSWORD, changes that owner's password).
// - DEMO_INTO_EXISTING=1: fills the organisation of the account that already has DEMO_PHONE (DEMO_ORGANIZATION_ID if it
//   owns several) and adds the SARL. Never reads or changes that account's password. Run again: adds nothing.

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
  });
  for (const line of lines) console.log(line);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
