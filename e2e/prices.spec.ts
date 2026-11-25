import { expect, test } from "@playwright/test";
import { controlled, farmDaysAgo, outboxEmpty, ownerWithFarm, query, scopeRemembered } from "./auth";

// T94, T95 (SPEC-m5 MP1, MP2): two prices noted offline on /prices; the latest shows with its change, survives a
// reload and syncs once. Made-up prices.
test("prices noted offline show the latest with its change, survive a reload and sync once", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des Prix");
  await scopeRemembered(page);
  await page.goto("/fr/more");
  await page.getByRole("link", { name: "Prix du marché" }).click();
  await expect(page.getByText("Aucun prix noté pour l’instant.")).toBeVisible();
  await controlled(page);

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  const form = page.getByRole("form", { name: "Noter un prix" });
  const history = page.getByRole("list", { name: "Historique" }).getByRole("listitem");
  let noted = 0;
  for (const [price, daysAgo, seenOn] of [["13,50", 2, "Souk du lundi"], ["14", 0, "Offre du chevillard"]] as const) {
    await form.getByLabel("Produit").selectOption({ label: "Poulet vif (par kg)" });
    await form.getByLabel("Prix (DH)").fill(price);
    await form.getByLabel("Vu le").fill(farmDaysAgo(daysAgo));
    await form.getByLabel("Où ou sur quoi (facultatif)").fill(seenOn);
    await form.getByRole("button", { name: "Enregistrer le prix" }).click();
    await expect(page.getByRole("status")).toHaveText(/^Enregistré sur ce téléphone/);
    await expect(history).toHaveCount(++noted); // the status reads the same after each save: wait for the price itself
  }
  const latest = page.getByRole("list", { name: "Derniers prix" }).getByRole("listitem");
  await expect(latest).toHaveCount(1);
  await expect(latest).toContainText("Poulet vif");
  await expect(latest).toContainText(/14,00\sDH \/ kg/);
  await expect(latest).toContainText(/\+0,50\sDH depuis le précédent/);
  await expect(latest).toContainText("Offre du chevillard");
  await expect(history).toHaveCount(2);

  const reload = await page.reload(); // still offline: kept on the phone
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(latest).toContainText(/14,00\sDH \/ kg/);

  await context.unroute("**");
  await context.setOffline(false);
  await outboxEmpty(page);
  const server = () =>
    query<{ product: string; price: string }>(
      `SELECT p.product, p."priceCentimes"::text AS price FROM "PriceObservation" p
       JOIN "Membership" m ON m."organizationId" = p."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1 ORDER BY p.day`,
      [e164],
    );
  await expect.poll(server).toEqual([
    { product: "liveBroiler", price: "1350" },
    { product: "liveBroiler", price: "1400" },
  ]);
});
