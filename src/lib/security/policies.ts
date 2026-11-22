// Rate-limit policies (poultry-auth references/rate-limiting.md §3). Handlers name a policy; numbers live here only.
export type Dimension = "ip" | "subnet" | "phone" | "prefix" | "global" | "user";
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
  fileUpload: [{ dim: "user", limit: 30, windowSec: HOUR }], // up to 5 MB each, into the database (ADR-011)
} satisfies Record<string, Rule[]>;

export type PolicyName = keyof typeof POLICIES;
