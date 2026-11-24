import { db } from "@/lib/db";
import { exportOrganization } from "@/ops/organization-data";

// `pnpm org:export <organizationId> <out.zip>`: everything an organisation has, as JSON + CSV per table and its files
// (ADR-007, law 09-08). Audited. docs/data-requests.md says when and how.

const [id, out] = process.argv.slice(2);
if (!id || !out) {
  console.error("usage: pnpm org:export <organizationId> <out.zip>");
  process.exit(2);
}
try {
  const s = await exportOrganization(id, out);
  console.log(`export ${id} → ${out}: ${s.tables} tables, ${s.rows} rows, ${s.files} files, ${s.bytes} bytes`);
} finally {
  await db.$disconnect();
}
