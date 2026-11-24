import { db } from "@/lib/db";
import { markOrganizationLeft } from "@/ops/organization-data";

// `pnpm org:left <organizationId> [--undo]`: the organisation left the platform today (or, with --undo, it stays). Its
// data can be deleted 30 days later (pnpm org:delete). Audited. docs/data-requests.md.

const [id, flag] = process.argv.slice(2);
if (!id || (flag && flag !== "--undo")) {
  console.error("usage: pnpm org:left <organizationId> [--undo]");
  process.exit(2);
}
try {
  const at = flag ? null : new Date();
  await markOrganizationLeft(id, at);
  console.log(at ? `${id} left on ${at.toISOString()}: deletion possible from 30 days on` : `${id} no longer marked as left`);
} finally {
  await db.$disconnect();
}
