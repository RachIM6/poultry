import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { listLegalEntities, saveLegalIds } from "@/modules/farm-registry";
import { accountingSettings, officialStatements } from "@/modules/finance";
import { twoTenants } from "@/test/tenant";

// F-Profile: the registration numbers farm-registry keeps (farm-registry/legal-ids.int.test.ts) reach the owner's
// settings screen and head the official statements, which the accountant reads too.
it("the settings screen and the statements' header carry the entity's ICE, IF, RC and CNSS", async () => {
  const [a] = await twoTenants();
  const [entity] = await listLegalEntities(a);
  await db.legalEntity.update({ where: { id: entity.id }, data: { books: "ledger" } }); // statements need full books
  const ids = { ice: "001534290000057", fiscalId: "12345678", rcNumber: "98765", rcCourt: "Casablanca", cnssNumber: "1234567" };
  await saveLegalIds(a, entity.id, ids);

  expect(await accountingSettings(a)).toMatchObject({ ok: true, value: { ids } });
  expect(await officialStatements({ ...a, role: "accountant" }, 2026)).toMatchObject({ ok: true, value: { books: "ledger", entity: { name: "Ferme A", form: "individual", ids } } });
  expect(await officialStatements({ ...a, role: "worker" }, 2026)).toEqual({ ok: false, error: "FORBIDDEN" });
});
