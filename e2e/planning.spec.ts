import { expect, test } from "@playwright/test";
import { farmDaysAgo, farmWithBatch, outboxEmpty, ownerWithFarm, query, referenceCached, scopeRemembered } from "./auth";

// T96, T97 (SPEC-m5 PL1, PL2, PL5): batches planned offline on /planning, with the overlap and short-downtime
// warnings; they survive a reload and sync once. Without a rule the official 20 days apply (CQ3); the 30-day rule is a
// test figure, NOT a husbandry one.
test("batches planned offline show overlaps and a short downtime, survive a reload and sync once", async ({ page, context }) => {
  test.setTimeout(150_000);
  const e164 = await ownerWithFarm(page, "Élevage du Planning");
  await scopeRemembered(page);
  await farmWithBatch(page); // the open batch: its sale day is unknown, so nothing is claimed after it
  await page.goto("/fr/planning");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await referenceCached(page);
  await expect(page.getByText("Lot en place depuis le", { exact: false })).toBeVisible();

  await expect(page.getByText("Vide sanitaire minimum : 20 j (source : Arrêté n° 2127-05 du 15 décembre 2005, art. 4)")).toBeVisible();
  await page.getByRole("button", { name: "Saisir le vide sanitaire minimum" }).click();
  const rule = page.getByRole("form", { name: "Saisir le vide sanitaire minimum" });
  await rule.getByLabel("Jours minimum").fill("30");
  await rule.getByLabel("Source (document, date, page)").fill("Test E2E");
  await rule.getByLabel("En vigueur à partir du").fill(farmDaysAgo(0));
  await rule.getByRole("button", { name: "Enregistrer le minimum" }).click();
  await expect(page.getByText("Vide sanitaire minimum : 30 j (source : Test E2E)")).toBeVisible();

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  const form = page.getByRole("form", { name: "Prévoir un lot" });
  const lines = page.getByRole("list", { name: "Lots de Bâtiment 1" }).getByRole("listitem");
  let shown = 1; // the open batch
  // +30 sold at 35 days (+65); +60 placed before that sale; +105 placed 10 days after +60's sale (+95).
  for (const [inDays, chicks, age] of [[30, "10000", "35"], [60, "9000", "35"], [105, "8000", ""]] as const) {
    await form.getByLabel("Mise en place le").fill(farmDaysAgo(-inDays));
    await form.getByLabel("Poussins").fill(chicks);
    await form.getByLabel("Couvoir").fill("Couvoir X");
    await form.getByLabel("Âge de vente prévu (jours, facultatif)").fill(age);
    await form.getByRole("button", { name: "Enregistrer le lot prévu" }).click();
    // the status reads the same after each save: wait for the plan itself, or the next fill races the form's reset
    await expect(lines).toHaveCount(++shown);
  }
  await expect(lines).toHaveCount(4);
  await expect(lines.nth(2)).toContainText("Mis en place avant la vente du lot précédent.");
  await expect(lines.nth(3)).toContainText("10 j de vide sanitaire");
  await expect(lines.nth(3)).toContainText("Vide sanitaire plus court que le minimum (30 j).");
  await expect(lines.nth(3)).toContainText("Âge de vente non décidé");

  const reload = await page.reload(); // still offline: kept on the phone
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(lines).toHaveCount(4);

  await context.unroute("**");
  await context.setOffline(false);
  await outboxEmpty(page);
  const server = () =>
    query<{ chicks: number; age: number | null }>(
      `SELECT p.chicks, p."saleAge" AS age FROM "PlannedBatch" p
       JOIN "Membership" m ON m."organizationId" = p."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1 ORDER BY p."placeOn"`,
      [e164],
    );
  await expect.poll(server).toEqual([
    { chicks: 10_000, age: 35 },
    { chicks: 9_000, age: 35 },
    { chicks: 8_000, age: null },
  ]);
});
