import { db } from "@/lib/db";
import { issueResetFor } from "@/modules/identity";

// `pnpm user:reset <phone|email>` (ADR-015): prints a one-time password reset code for this account, owners included.
// Valid 7 days, single use; it replaces any pending one. The person sets a new password with it on /reset, which signs
// out every device. Audited (AuthEvent reset_issued, reason operator). Hand the code over in person or by WhatsApp.

const [identifier] = process.argv.slice(2);
if (!identifier) {
  console.error("usage: pnpm user:reset <phone|email>");
  process.exit(2);
}
try {
  const issued = await issueResetFor(identifier);
  if (!issued.ok) {
    console.error(issued.error === "NOT_FOUND" ? "No account with this phone or email." : "Not a Moroccan mobile number or an email.");
    process.exitCode = 1;
  } else {
    console.log(`Reset code (valid 7 days, single use): ${issued.value.code}`);
  }
} finally {
  await db.$disconnect();
}
