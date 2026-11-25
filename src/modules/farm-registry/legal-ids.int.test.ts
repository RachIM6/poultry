import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { legalIds, listLegalEntities, saveLegalIds } from "@/modules/farm-registry";
import { tenant } from "@/test/tenant";

// The database is reset per file, not per test: each test onboards its own two organisations.
let n = 0;
const twoTenants = () => (n++, Promise.all([tenant(`+21261000${n}001`, "Ferme A"), tenant(`+21261000${n}002`, "Ferme B")]));

const ids = { ice: "001534290000057", fiscalId: "12345678", rcNumber: "98765", rcCourt: "Casablanca", cnssNumber: "1234567" };

describe("F-Profile: the legal entity's ICE, IF, RC and CNSS numbers", () => {
  it("the owner saves them, audited; spaces in the ICE are dropped and an empty field clears its number", async () => {
    const [a] = await twoTenants();
    const [entity] = await listLegalEntities(a);
    expect(await legalIds(a)).toEqual({ ice: null, fiscalId: null, rcNumber: null, rcCourt: null, cnssNumber: null });

    expect(await saveLegalIds(a, entity.id, { ...ids, ice: " 001534290 0000 57 " })).toEqual({ ok: true, value: undefined });
    expect(await legalIds(a)).toEqual(ids);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { organizationId: a.organizationId, entity: "LegalEntity", action: "update" } });
    expect(audit).toMatchObject({ userId: a.userId, entityId: entity.id, after: ids, before: { ice: null, fiscalId: null, rcNumber: null, rcCourt: null, cnssNumber: null } });

    expect(await saveLegalIds(a, entity.id, { ...ids, rcCourt: "", cnssNumber: "  " })).toMatchObject({ ok: true });
    expect(await legalIds(a)).toEqual({ ...ids, rcCourt: null, cnssNumber: null });
  });

  it("refuses an ICE that isn't 15 digits and numbers past their cap, and keeps what was saved", async () => {
    const [a] = await twoTenants();
    const [entity] = await listLegalEntities(a);
    await saveLegalIds(a, entity.id, ids);
    for (const bad of [{ ice: "00153429000005" }, { ice: "0015342900000578" }, { ice: "00153429000005A" }, { fiscalId: "1".repeat(21) }, { rcCourt: "x".repeat(61) }, { cnssNumber: "9".repeat(21) }])
      expect(await saveLegalIds(a, entity.id, { ...ids, ...bad })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await legalIds(a)).toEqual(ids);
  });

  it("only the owner writes; the manager and the accountant read; workers and vets get nothing", async () => {
    const [a] = await twoTenants();
    const [entity] = await listLegalEntities(a);
    await saveLegalIds(a, entity.id, ids);
    for (const role of ["manager", "accountant", "worker", "vet"] as const)
      expect(await saveLegalIds({ ...a, role }, entity.id, { ...ids, ice: null })).toEqual({ ok: false, error: "FORBIDDEN" });
    for (const role of ["manager", "accountant"] as const) expect(await legalIds({ ...a, role })).toEqual(ids);
    for (const role of ["worker", "vet"] as const) expect(await legalIds({ ...a, role })).toBeNull();
  });

  it("never reads nor writes another organisation's entity (ADR-006)", async () => {
    const [a, b] = await twoTenants();
    const [ofB] = await listLegalEntities(b);
    await saveLegalIds(b, ofB.id, ids);
    expect(await saveLegalIds(a, ofB.id, { ice: "999999999999999" })).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await legalIds(a)).toEqual({ ice: null, fiscalId: null, rcNumber: null, rcCourt: null, cnssNumber: null });
    expect(await legalIds(b)).toEqual(ids);
  });
});
