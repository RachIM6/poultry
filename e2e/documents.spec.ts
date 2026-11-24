import { expect, test } from "@playwright/test";
import { controlled, farmWithBatch, farmDaysAgo, ownerWithFarm, scopeRemembered } from "./auth";

// T44 acceptance (browser part): a document added offline shows by its expiry state, then gets its PDF online
// (SPEC-m2-compliance DC1–DC3). Roles and isolation: src/modules/documents/documents.int.test.ts.
const PDF = Buffer.from("%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");

test("a document is added offline, shows as due soon, then gets its PDF", async ({ page, context }) => {
  test.setTimeout(120_000);
  await ownerWithFarm(page, "Élevage des Documents");
  await scopeRemembered(page);
  await farmWithBatch(page);
  await page.goto("/fr/more");
  await page.getByRole("link", { name: "Documents et échéances" }).click();
  await controlled(page);

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.getByRole("button", { name: "Ajouter un document" }).click();
  await page.getByLabel("Intitulé").fill("Assurance multirisque élevage");
  await page.getByLabel("Catégorie").selectOption({ label: "Assurance" });
  await page.getByLabel("Date d’échéance (facultatif)").fill(farmDaysAgo(-25)); // in 25 days
  await page.getByRole("button", { name: "Enregistrer le document" }).click();
  const doc = page.getByRole("list", { name: "Coffre-fort, par date d’échéance" }).getByRole("listitem");
  await expect(doc).toContainText("Assurance multirisque élevage");
  await expect(doc).toContainText("à renouveler bientôt");
  await expect(doc).toContainText("Fichier à ajouter");

  await context.unroute("**");
  await context.setOffline(false);
  await expect(doc.getByText("Ajouter le fichier (PDF ou photo)")).toBeVisible({ timeout: 20_000 });
  await doc.locator('input[type="file"]').setInputFiles({ name: "police.pdf", mimeType: "application/pdf", buffer: PDF });
  const file = doc.getByRole("link", { name: "Voir le fichier" });
  await expect(file).toBeVisible({ timeout: 20_000 });
  const download = await page.request.get((await file.getAttribute("href"))!);
  expect(download.headers()["content-type"]).toBe("application/pdf");
});
