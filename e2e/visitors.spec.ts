import { expect, test } from "@playwright/test";
import { controlled, farmWithBatch, ownerWithFarm, query, scopeRemembered } from "./auth";

// T40 acceptance (browser part): a visitor recorded offline on the phone survives a reload and reaches the server
// once after sync (SPEC-m2-compliance BS1–BS3, CX1). The zone rule and isolation: src/modules/biosecurity/*.test.ts.
test("a visitor is recorded offline, kept to the dirty zone, and synced once", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des Visiteurs");
  await scopeRemembered(page);
  await farmWithBatch(page);
  await page.goto("/fr/more");

  await page.getByRole("link", { name: "Registre des visiteurs" }).click();
  await controlled(page);
  await expect(page.getByText("Aucun visiteur aujourd’hui.")).toBeVisible();

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.getByLabel("Nom et société").fill("Livreur · Provende Atlas");
  await page.getByLabel("Motif").selectOption({ label: "Livraison d’aliment" });
  await page.getByLabel("Zone propre").check();
  await page.getByLabel("A visité un autre élevage avicole").check();
  await expect(page.getByText("Accès limité à la zone sale")).toBeVisible();
  await expect(page.getByLabel("Zone propre")).toBeDisabled();
  await expect(page.getByLabel("Zone sale")).toBeChecked();
  await page.getByLabel("Pédiluve et surbottes").check();
  await page.getByRole("button", { name: "Enregistrer l’entrée" }).click();
  const today = page.getByRole("list", { name: "Déjà venus aujourd’hui" }).getByRole("listitem");
  await expect(today).toHaveCount(1);
  await expect(today.getByText(/^Livreur · Provende Atlas · .+ · Zone sale$/)).toBeVisible(); // the record, beside its "Modifier"
  await expect(today.getByRole("button", { name: "Modifier : Livreur · Provende Atlas" })).toBeVisible();

  const reload = await page.reload(); // still offline: the shell and the data come from the phone
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(today).toHaveCount(1);

  await context.unroute("**");
  await context.setOffline(false);
  // The sync screen renders once it has read the outbox: "all sent" means the server applied the visit (a refusal
  // would show under "À vérifier"). Waiting for it first keeps the server check from racing the push.
  await page.goto("/fr/sync"); // the page's own sync link went with its old header (tasks/plan-ui.md "Desktop rules")
  await expect(page.getByText("Tout est envoyé.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "À vérifier" })).toHaveCount(0);
  const server = async () =>
    await query<{ visitor: string; zone: string; footbath: boolean }>(
      `SELECT v.visitor, v.zone, v.footbath FROM "Visit" v JOIN "Membership" m ON m."organizationId" = v."organizationId"
       JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    );
  await expect.poll(server, { timeout: 15_000 }).toEqual([{ visitor: "Livreur · Provende Atlas", zone: "dirty", footbath: true }]);
});
