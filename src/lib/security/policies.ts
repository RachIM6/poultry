// Rate-limit policies (poultry-auth references/rate-limiting.md §3). Handlers name a policy; numbers live here only.
export type Dimension = "ip" | "subnet" | "phone" | "prefix" | "global" | "user" | "session";
export type Rule = { dim: Dimension; limit: number; windowSec: number };

const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const POLICIES = {
  requestCode: [
    { dim: "ip", limit: 20, windowSec: 15 * MIN },
    { dim: "subnet", limit: 100, windowSec: HOUR },
    { dim: "phone", limit: 3, windowSec: 15 * MIN }, // SPEC I1
    { dim: "phone", limit: 10, windowSec: DAY },
    { dim: "prefix", limit: 30, windowSec: HOUR },
    { dim: "global", limit: 300, windowSec: HOUR }, // SMS cost cap; warns at 50 %
  ],
  // GET /api/captcha/challenge: one PBKDF2 derivation per call. 1.5x requestCode's IP and subnet limits: every code
  // request needs one challenge, and a failed solve, a refused request or "change number" fetches another.
  captchaChallenge: [
    { dim: "ip", limit: 30, windowSec: 15 * MIN },
    { dim: "subnet", limit: 150, windowSec: HOUR },
  ],
  verifyCode: [
    { dim: "ip", limit: 60, windowSec: HOUR },
    { dim: "subnet", limit: 200, windowSec: HOUR },
    { dim: "phone", limit: 10, windowSec: HOUR },
  ],
  // Consecutive verify failures (rate-limiting.md §4), not a budget: from the 3rd one on, verify-code needs a captcha.
  // Each attempt counts as a failure until it succeeds, and a success resets both dimensions (reset()). Forgotten after 1 h.
  // ponytail: no progressive delay (5–9 failures) or 15-min block (≥ 10): the verify budget (10 / h per number) and
  // the 5 attempts per code already cap them. Add both if failures ever spread across many numbers from one IP.
  verifyFailures: [
    { dim: "ip", limit: 3, windowSec: HOUR },
    { dim: "phone", limit: 3, windowSec: HOUR },
  ],
  inviteMember: [
    { dim: "phone", limit: 10, windowSec: DAY }, // the invited number
    { dim: "user", limit: 50, windowSec: DAY }, // the inviting owner
  ],
  syncPush: [{ dim: "user", limit: 120, windowSec: MIN }],
  syncPull: [{ dim: "user", limit: 120, windowSec: MIN }],
  fileUpload: [{ dim: "user", limit: 30, windowSec: HOUR }], // up to 4 MiB each, into the database (ADR-011)

  // §3 "Authenticated default": session 300 / min (one browser), user 1000 / min (all of a user's devices). A cheap
  // write such as POST /api/notifications/quiet-hours. The costly endpoints below take a fraction of it.
  authenticated: [
    { dim: "session", limit: 300, windowSec: MIN },
    { dim: "user", limit: 1000, windowSec: MIN },
  ],
  // GET /api/finance/export: builds a whole month's zip (or FEC) in memory, receipts up to 4 MiB each. About 1/60 of
  // the default: an accountant still pulls a quarter's months back to back, a loop can't stack zips in memory.
  financeExport: [
    { dim: "session", limit: 5, windowSec: MIN },
    { dim: "user", limit: 10, windowSec: MIN },
  ],
  // GET /api/files/[id]: one stored file (up to 4 MiB) read into memory per call. A fifth of the default per session:
  // one tap per receipt or document, far below that even when going through a month of receipts.
  fileRead: [
    { dim: "session", limit: 60, windowSec: MIN },
    { dim: "user", limit: 120, windowSec: MIN },
  ],
  // POST /api/notifications/test: an inbox row and a push to every device of the user per call. Checking that a phone
  // gets pushes takes a couple of tries, not hundreds: 3 / min per browser, 10 / h for the user.
  notificationTest: [
    { dim: "session", limit: 3, windowSec: MIN },
    { dim: "user", limit: 10, windowSec: HOUR },
  ],
  // POST /api/push/subscribe: once per device when push is allowed, again when the browser rotates its keys. Each new
  // endpoint is a row the dispatcher sends to, so rows can't be piled up: 10 / h per browser, 20 / day for the user.
  pushSubscribe: [
    { dim: "session", limit: 10, windowSec: HOUR },
    { dim: "user", limit: 20, windowSec: DAY },
  ],
} satisfies Record<string, Rule[]>;

export type PolicyName = keyof typeof POLICIES;
