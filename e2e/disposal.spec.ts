import { expect, test } from "@playwright/test";
import { controlled, farmDaysAgo, farmWithBatch, outboxEmpty, ownerWithFarm, pushAs, query, scopeRemembered } from "./auth";

// T41 acceptance (browser part): dead birds disposed of and manure taken out, recorded offline, synced once; the
// day's mortality shows next to the birds disposed (SPEC-m2-compliance BS6, BS7, CX1); spreading is declared (CQ4).
test("disposal and manure are recorded offline, synced once, with the day's mortality alongside", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des Sorties");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page, "ross-308", farmDaysAgo(3));
  await pushAs(page, [{ type: "flock.recordDay", payload: { batchId: ids.batch, day: farmDaysAgo(0), changes: { dead: 5, deathCause: "unknown", culled: 1 } } }]);
  await page.goto("/fr/more");

  await page.getByRole("link", { name: "Cadavres, fumier et nuisibles" }).click();
  await controlled(page);
  const gaps = page.getByRole("table", { name: "Morts et éliminés, 14 derniers jours" });
  await expect(gaps.getByRole("row").nth(1)).toContainText(/6\s*0\s*6$/); // 5 dead + 1 culled, nothing disposed yet

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.getByLabel("Nombre de sujets").fill("6");
  await page.getByLabel("Poids total (kg, facultatif)").fill("9,8");
  await page.getByLabel("Méthode d’élimination").selectOption({ label: "Autre (à décrire)" });
  await page.getByLabel("Méthode utilisée").fill("Fosse fermée, chaux vive");
  await page.getByRole("button", { name: "Enregistrer l’élimination" }).click();
  await expect(gaps.getByRole("row").nth(1)).toContainText(/6\s*6\s*0$/);
  await expect(page.getByRole("list", { name: "Dernières éliminations" }).getByRole("listitem")).toHaveText([/6\ssujets,\sFosse fermée, chaux vive\s·\s9,8\skg/]);

  await page.getByRole("link", { name: "Fumier", exact: true }).click(); // a query tab (?tab=manure), offline too
  await expect(page).toHaveURL(/\/fr\/disposal\?tab=manure$/);
  await page.getByLabel("Quantité (kg)").fill("18000");
  await page.getByLabel("Destination").selectOption({ label: "Stocké sur la ferme" });
  await page.getByRole("button", { name: "Enregistrer la sortie de fumier" }).click();
  const manure = page.getByRole("list", { name: "Dernières sorties de fumier" }).getByRole("listitem");
  await expect(manure).toHaveText([/18\s000 kg, Stocké sur la ferme/]);
  // CQ4: spreading asks for the 500 m (or composted) declaration
  await page.getByLabel("Quantité (kg)").fill("2000");
  await page.getByLabel("Destination").selectOption({ label: "Épandu" });
  await page.getByLabel("Épandu à plus de 500 m de tout élevage avicole et couvoir", { exact: false }).check();
  await page.getByRole("button", { name: "Enregistrer la sortie de fumier" }).click();
  await expect(manure).toHaveCount(2);
  await expect(manure.filter({ hasText: /2\s000 kg, Épandu/ })).toHaveCount(1);

  const reload = await page.reload();
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(manure).toHaveCount(2); // the tab is in the URL: the reload keeps it
  await page.getByRole("link", { name: "Cadavres", exact: true }).click();
  await expect(gaps.getByRole("row").nth(1)).toContainText(/6\s*6\s*0$/);

  await context.unroute("**");
  await context.setOffline(false);
  await outboxEmpty(page);
  const server = async () =>
    await query<{ disposals: number; manure: number }>(
      `SELECT (SELECT count(*)::int FROM "Disposal" d WHERE d."organizationId" = m."organizationId") AS disposals,
              (SELECT count(*)::int FROM "ManureRemoval" r WHERE r."organizationId" = m."organizationId") AS manure
       FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    );
  await expect.poll(server).toEqual([{ disposals: 1, manure: 2 }]);
});
