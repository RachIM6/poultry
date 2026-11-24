import { parseArgs } from "node:util";
import { db } from "@/lib/db";
import { deleteMember, exportMember } from "@/ops/member-data";

// `pnpm member:export <phone> <out.zip>`: one member's own data, across organisations, as JSON + CSV per table.
// `pnpm member:delete <phone> --confirm`: erases it, keeping what the books need (docs/data-requests.md). Both audited.

const usage = "usage: pnpm member:export <phone> <out.zip> | pnpm member:delete <phone> --confirm";
const { positionals, values } = parseArgs({ allowPositionals: true, options: { confirm: { type: "boolean" } } });
const [command, phone, out] = positionals;
const valid = command === "export" ? phone && out && !values.confirm : command === "delete" && phone && values.confirm && !out;
if (!valid) {
  console.error(usage);
  process.exit(2);
}
try {
  if (command === "export") {
    const r = await exportMember(phone, out!);
    if (!r.ok) {
      console.error(`refused: ${r.error}`); // NOT_FOUND: no user signs in with this number
      process.exitCode = 1;
    } else console.log(`member export → ${out}: ${r.value.tables} tables, ${r.value.rows} rows, ${r.value.bytes} bytes`);
  } else {
    const r = await deleteMember(phone);
    if (!r.ok) {
      // LAST_OWNER: give the organisation another owner first, or mark it as left (pnpm org:left).
      console.error(`refused: ${r.error}${"organizations" in r ? ` (last owner of ${r.organizations.join(", ")})` : ""}`);
      process.exitCode = 1;
    } else {
      const s = r.value;
      console.log(`deleted the user, ${s.memberships} memberships, ${s.invitations} invitations, ${s.notifications} notifications`);
      console.log(`kept for the books, phone and link erased: ${s.employees} employee records; phone masked in ${s.auditEvents} audit events`);
    }
  }
} finally {
  await db.$disconnect();
}
