import { describe, expect, it } from "vitest";
import { wholeRegister } from "./register-access";
import type { Role } from "@/lib/tenant";

const as = (role: Role) => ({ userId: "u", organizationId: "o", role });

describe("wholeRegister", () => {
  it("is the owner's and the manager's: workers get no document, partners miss whole entities", () => {
    expect(["owner", "manager", "worker", "vet", "accountant"].filter((r) => wholeRegister(as(r as Role)))).toEqual(["owner", "manager"]);
  });
});
