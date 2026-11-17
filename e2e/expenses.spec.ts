import { expect, test } from "@playwright/test";
import { farmWithBatch, ownerWithFarm, query, scopeRemembered } from "./auth";

// T32 acceptance (browser part): a quick expense recorded offline on the phone is posted once after sync, and shows in
// the treasury. Workers are refused on the server (src/modules/finance/treasury.int.test.ts).
test("a quick expense recorded offline is posted once after sync, and shows in the treasury", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des Dépenses");
  await scopeRemembered(page);
  await farmWithBatch(page); // one batch, placed today: a shared expense of this month goes to it (FN14)
  await page.goto("/fr/dashboard");

  await page.getByRole("link", { name: "Plus", exact: true }).click(); // tasks/plan-ui.md U2: the "Plus" tab
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

  // T34: shared across this month's batches (the default), it is all this batch's.
  await page.goto("/fr/results");
  await expect(page.getByRole("row").nth(1)).toContainText(/réparti 1.200,00\sDH/);

  // tasks/plan-ui.md U11: the owner's home shows the cash at hand in its "Argent" card.
  await page.goto("/fr/dashboard");
  await expect(page.getByRole("region", { name: "Argent" })).toContainText(/Trésorerie disponible\s*-1.200,00\sDH/);

  // tasks/plan-ui.md U13: on a wide screen the owner's sidebar also lists Ventes, Comptabilité and Membres.
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  await expect(nav.getByRole("link", { name: "Comptabilité" })).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const name of ["Ventes", "Comptabilité", "Membres"]) await expect(nav.getByRole("link", { name })).toBeVisible();
});
