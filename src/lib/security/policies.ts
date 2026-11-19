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
  verifyCode: [
    { dim: "ip", limit: 60, windowSec: HOUR },
    { dim: "subnet", limit: 200, windowSec: HOUR },
    { dim: "phone", limit: 10, windowSec: HOUR },
  ],
  inviteMember: [
    { dim: "phone", limit: 10, windowSec: DAY }, // the invited number
    { dim: "user", limit: 50, windowSec: DAY }, // the inviting owner
  ],
} satisfies Record<string, Rule[]>;

export type PolicyName = keyof typeof POLICIES;
