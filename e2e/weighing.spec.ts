import { expect, test } from "@playwright/test";
import { farmWithBatch, ownerWithFarm, query, referenceCached, scopeRemembered } from "./auth";

// T17 acceptance (browser part): a weighing typed offline shows the average, CV% and the gap to the strain standard.
// No breeder table is committed yet (OQ5), so the test brings its own strain with a made-up two-point curve and removes
// it afterwards. The numbers are not a real standard.
test("a weighing offline shows average, uniformity and the gap to the standard", async ({ page, context }) => {
  test.setTimeout(90_000);
  const strain = `e2e-${crypto.randomUUID().slice(0, 8)}`;
  await query(`INSERT INTO "Strain" (id, name) VALUES ($1, 'Souche de test')`, [strain]);
  const [curve] = await query<{ id: string }>(`INSERT INTO "StandardCurve" ("strainId", source, version) VALUES ($1, 'E2E synthetic', '1') RETURNING id`, [strain]);
  await query(`INSERT INTO "StandardPoint" ("curveId", day, "bodyWeightGrams", "cumulativeFeedGrams") VALUES ($1, 0, 40, 0), ($1, 7, 200, 150)`, [curve.id]);
  try {
    const e164 = await ownerWithFarm(page, "Élevage de la Pesée");
    await scopeRemembered(page);
    await farmWithBatch(page, strain);

    await page.goto("/fr/batches");
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await referenceCached(page); // the curve comes with it
    await expect(page.getByRole("link", { name: "Saisir le jour" })).toBeVisible();
    await context.setOffline(true);
    await context.route("**", (route) => route.abort("internetdisconnected"));
    await page.getByRole("link", { name: "Saisir le jour" }).click();

    // 40, 45, 42 g → mean 42,33 → 42 g; sample SD 2,52 g → CV 5,9 %; 42 / 40 → +5,0 % at day 0.
    await page.getByLabel("Poids des oiseaux (kg), séparés par des espaces").fill("0,040 0,045 0,042");
    const result = "Moyenne 0,042 kg (3 oiseaux) · CV 5,9 % · +5,0 % par rapport au standard (0,04 kg)";
    await expect(page.getByText(result)).toBeVisible(); // live, before saving
    await page.getByRole("button", { name: "Enregistrer la pesée" }).click();
    await expect(page.getByRole("list", { name: "Pesées précédentes" })).toContainText(result);

    await page.getByLabel("En groupe").check();
    await page.getByLabel("Poids total (kg)").fill("2,15");
    await page.getByLabel("Nombre d’oiseaux").fill("50");
    await page.getByRole("button", { name: "Enregistrer la pesée" }).click();
    await expect(page.getByRole("list", { name: "Pesées précédentes" })).toContainText("Moyenne 0,043 kg (50 oiseaux) · +7,5 % par rapport au standard");

    await context.unroute("**");
    await context.setOffline(false);
    const server = async () =>
      await query<{ count: number; total: number; weights: number[] }>(
        `SELECT w.count, w."totalGrams" AS total, w."weightsGrams" AS weights FROM "Weighing" w
         JOIN "Membership" m ON m."organizationId" = w."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1 ORDER BY w.count`,
        [e164],
      );
    await expect.poll(server).toEqual([{ count: 3, total: 127, weights: [40, 45, 42] }, { count: 50, total: 2150, weights: [] }]);
  } finally {
    await query(`DELETE FROM "Strain" WHERE id = $1`, [strain]);
  }
});
