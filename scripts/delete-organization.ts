import { parseArgs } from "node:util";
import { db } from "@/lib/db";
import { deleteOrganization } from "@/ops/organization-data";

// `pnpm org:delete <organizationId> --confirm "<organisation name>"`: deletes its data 30 days or more after it left,
// keeping the books read-only for their retention period (docs/data-requests.md). Audited. Export it first.

const { positionals, values } = parseArgs({ allowPositionals: true, options: { confirm: { type: "string" } } });
if (positionals.length !== 1 || !values.confirm) {
  console.error('usage: pnpm org:delete <organizationId> --confirm "<organisation name>"');
  process.exit(2);
}
try {
  const r = await deleteOrganization(positionals[0], values.confirm);
  if (!r.ok) {
    console.error(`refused: ${r.error}`); // NOT_FOUND | NOT_LEFT | TOO_SOON (under 30 days) | WRONG_NAME
    process.exitCode = 1;
  } else {
    const { deleted, scrubbed, users, kept } = r.value;
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    console.log(`deleted ${sum(deleted)} rows in ${Object.keys(deleted).length} tables, ${users} users; phones erased on ${sum(scrubbed)} rows`);
    console.log(`kept (books, read-only): ${Object.entries(kept).filter(([, n]) => n > 0).map(([t, n]) => `${t} ${n}`).join(", ") || "nothing"}`);
  }
} finally {
  await db.$disconnect();
}
