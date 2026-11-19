import { expect, test } from "@playwright/test";
import { ownerWithFarm, query, scopeRemembered } from "./auth";

// T32 acceptance (browser part): a quick expense recorded offline on the phone is posted once after sync, and shows in
// the treasury. Workers are refused on the server (src/modules/finance/treasury.int.test.ts).
test("a quick expense recorded offline is posted once after sync, and shows in the treasury", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des Dépenses");
  await scopeRemembered(page);

  await page.getByRole("link", { name: "Dépense rapide" }).click();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.getByRole("button", { name: "Ajouter une caisse ou un compte" }).click();
  await page.getByLabel("Type").selectOption({ label: "Caisse" });
  await page.getByLabel("Nom").fill("Caisse ferme");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Caisse · Caisse ferme" })).toBeVisible();

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.getByLabel("Nature").selectOption({ label: "Électricité" });
  await page.getByLabel("Montant (DH)").fill("1200");
  await page.getByLabel("Payé avec").selectOption({ label: "Caisse · Caisse ferme" });
  await page.getByRole("button", { name: "Enregistrer la dépense" }).click();
  const recent = page.getByRole("list", { name: "Dernières dépenses" }).getByRole("listitem");
  await expect(recent).toHaveText([/^Électricité : 1.200,00\sDH, le/]);

  const reload = await page.reload(); // still offline: the shell and the data come from the phone
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(recent).toHaveCount(1);

  await context.unroute("**");
  await context.setOffline(false);
  const server = async () =>
    await query<{ expenses: number; entries: number }>(
      `SELECT (SELECT count(*)::int FROM "Expense" x WHERE x."organizationId" = m."organizationId") AS expenses,
              (SELECT count(*)::int FROM "JournalEntry" j WHERE j."organizationId" = m."organizationId" AND j."sourceModule" = 'finance') AS entries
       FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    );
  await expect.poll(server).toEqual([{ expenses: 1, entries: 1 }]);

  await page.goto("/fr/treasury");
  await expect(page.getByRole("list", { name: "Soldes" }).getByRole("listitem").first()).toContainText(/Caisse · Caisse ferme\s*-1.200,00\sDH/);
});
