import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import { push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { sendDocumentReminders } from "@/modules/documents";
import { twoTenants } from "@/test/tenant";

const m = <P,>(type: string, payload: P) => ({ id: uuidv7(), type, payload, createdAt: "2026-10-01T10:00:00+01:00" });
const inbox = (organizationId: string) => db.notification.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } });

// SPEC-m2-compliance DC4: owners and managers hear once when a document comes within DOCUMENT_SOON_DAYS of its
// expiry, and once on the day; the farm's ONSSA authorization (F2) the same way. Workers never.
describe("document expiry reminders (DC4)", () => {
  let a: TenantContext;
  let workerId: string;
  const insurance = uuidv7();

  beforeAll(async () => {
    [a] = await twoTenants();
    const worker = await db.user.create({ data: { phoneNumber: "+212600000099", name: "w", email: "w@phone.invalid" } });
    workerId = worker.id;
    await db.membership.create({ data: { userId: worker.id, organizationId: a.organizationId, role: "worker" } });
    const farm = { region: "R", province: "P", commune: "C", gps: null };
    await push(
      a,
      [
        m("farm-registry.createFarm", { id: uuidv7(), name: "El Kheir", ...farm, onssa: { number: "ONSSA/26/0412", expiresOn: "2026-12-31" } }),
        m("documents.createDocument", { id: insurance, title: "Assurance multirisque élevage", category: "insurance", farmId: null, issuedOn: null, expiresOn: "2026-11-30", notes: null }),
        m("documents.createDocument", { id: uuidv7(), title: "Bail du terrain", category: "land", farmId: null, issuedOn: null, expiresOn: "2030-01-01", notes: null }),
      ],
      registry,
    );
  });

  it("announces what comes within 60 days, once, to the owner and not the worker", async () => {
    expect(await sendDocumentReminders(fixedClock("2026-11-05T08:00:00Z"))).toBe(2); // insurance (30 Nov), authorization (31 Dec)
    expect(await sendDocumentReminders(fixedClock("2026-11-05T09:00:00Z"))).toBe(0); // same day, again: nothing new
    const sent = await inbox(a.organizationId);
    expect(sent.map((n) => [n.userId, n.templateKey, (n.params as Record<string, string>).title])).toEqual([
      [a.userId, "documentExpiring", "Assurance multirisque élevage"],
      [a.userId, "documentExpiring", "ONSSA/26/0412"],
    ]);
    expect(sent.some((n) => n.userId === workerId)).toBe(false);
  });

  it("announces the expiry day once more, then never again for that date", async () => {
    expect(await sendDocumentReminders(fixedClock("2026-11-30T08:00:00Z"))).toBe(1);
    expect(await sendDocumentReminders(fixedClock("2026-12-01T08:00:00Z"))).toBe(0);
    expect((await inbox(a.organizationId)).at(-1)).toMatchObject({ templateKey: "documentExpired", params: { title: "Assurance multirisque élevage", date: "30/11/2026" } });
  });

  it("a renewed expiry date is announced again", async () => {
    await push(a, [m("documents.updateDocument", { id: insurance, changes: { expiresOn: "2027-01-15" } })], registry);
    expect(await sendDocumentReminders(fixedClock("2026-12-01T08:00:00Z"))).toBe(1);
  });
});
