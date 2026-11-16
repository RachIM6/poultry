import { expect, test } from "@playwright/test";
import { farmWithBatch, ownerWithFarm, query, scopeRemembered } from "./auth";

// T43 acceptance (browser part): a rodent check recorded offline, then, online, its proof photo uploaded once and
// downloadable (SPEC-m2-compliance BS8, DC2, ADR-011). Types, sizes, roles and isolation: src/app/api/files/files.int.test.ts.
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

test("a rodent check is recorded offline, then gets its proof photo online", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des Nuisibles");
  await scopeRemembered(page);
  await farmWithBatch(page);
  await page.goto("/fr/disposal");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.getByRole("tab", { name: "Nuisibles" }).click();

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.getByLabel("Action").selectOption({ label: "Appâts posés" });
  await page.getByLabel("Produit (facultatif)").fill("Brodifacoum");
  await page.getByRole("button", { name: "Enregistrer la dératisation" }).click();
  const check = page.getByRole("list", { name: "Dernières dératisations" }).getByRole("listitem");
  await expect(check).toContainText("Appâts posés · Brodifacoum");
  await expect(check).toContainText("Preuve à ajouter");

  await context.unroute("**");
  await context.setOffline(false);
  await expect(check.getByText("Ajouter la photo")).toBeVisible({ timeout: 20_000 }); // once the check is on the server
  await check.locator('input[type="file"]').setInputFiles({ name: "appats.png", mimeType: "image/png", buffer: PNG });
  const proof = check.getByRole("link", { name: "Voir la photo" });
  await expect(proof).toBeVisible({ timeout: 20_000 });

  const download = await page.request.get((await proof.getAttribute("href"))!);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toBe("image/png");
  expect(download.headers()["content-disposition"]).toMatch(/^attachment;/);
  expect(Buffer.from(await download.body()).equals(PNG)).toBe(true);

  const server = await query<{ proofs: number }>(
    `SELECT count(*)::int AS proofs FROM "RodentCheck" r JOIN "Membership" m ON m."organizationId" = r."organizationId"
     JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1 AND r."proofFileId" IS NOT NULL`,
    [e164],
  );
  expect(server).toEqual([{ proofs: 1 }]);
});
