import { expect, type Page } from "@playwright/test";
import { v7 as uuidv7 } from "uuid";
import { farmDaysAgo, ownerWithFarm, pushAs, query, scopeRemembered } from "./auth";

// The main screens with realistic data, for the screen-wide checks of SPEC X4 (no-overflow.spec.ts, a11y.spec.ts).

export const orgOf = `(SELECT m."organizationId" FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1)`;

/** The page's widths and, when wider than the screen, the widest element that sticks out and isn't in a scroller. */
export async function overflow(page: Page, width: number) {
  return page.evaluate((vw) => {
    const sizes = { html: document.documentElement.scrollWidth, body: document.body.scrollWidth };
    if (sizes.html <= vw && sizes.body <= vw) return null;
    // Inside a scroller, it scrolls there; fixed to the screen, it stretches with a page that is already too wide.
    const excused = (el: Element) => {
      if (getComputedStyle(el).position === "fixed") return true;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const style = getComputedStyle(p);
        if (style.overflowX !== "visible" || style.position === "fixed") return true;
      }
      return false;
    };
    let worst: Element | null = null;
    let worstWidth = 0;
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if ((r.right > vw + 0.5 || r.left < -0.5) && r.width > worstWidth && !excused(el)) [worst, worstWidth] = [el, r.width];
    }
    const name = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${[...el.classList].slice(0, 4).map((c) => `.${c}`).join("")}`;
    const r = worst?.getBoundingClientRect();
    const culprit = worst && r ? `${name(worst)} [${Math.round(r.left)}..${Math.round(r.right)}] "${(worst.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60)}"` : "none found";
    return `html ${sizes.html} px, body ${sizes.body} px, innerWidth ${window.innerWidth} px; widest: ${culprit}`;
  }, width);
}

/**
 * Arabic: the amounts and weights whose "DH" or "kg" the bidi algorithm moved before the number ("DH 1 234,50").
 * ADR-004 shows "1 234,50 DH": an LTR isolate keeps that order (dir="ltr", <bdi>, or FSI … PDI in a message).
 */
export async function unitsMoved(page: Page) {
  return page.evaluate(() => {
    const found: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement!;
      if (el.closest('[dir="ltr"], bdi, svg[direction="ltr"], .sr-only, option, script, style') || !el.getClientRects().length) continue;
      const text = n.textContent!.replace(/[⁦-⁨][^⁩]*⁩/g, ""); // isolated parts keep their order
      const at = text.search(/\d[\d\s.,]*\s(DH|kg)\b/);
      if (at >= 0 && !/[A-Za-zÀ-ÿ]/.test(text.slice(0, at))) found.push(text.trim().slice(0, 60)); // after a Latin word it stays in order
    }
    return found;
  });
}

/**
 * An owner with realistic data (open, closed and layer batches, sales, expenses, a loan, an asset, a budget, a bank
 * statement, books kept as a ledger), signed in on `page`. Returns the main screens' paths, without the locale.
 */
export async function realisticOwner(page: Page) {
  const e164 = await ownerWithFarm(page, "Élevage Avicole des Hauts Plateaux");
  await query(`UPDATE "LegalEntity" SET books = 'ledger' WHERE "organizationId" = ${orgOf}`, [e164]); // all the books' views
  await scopeRemembered(page);

  const id = () => crypto.randomUUID();
  const ids = { farm: id(), h1: id(), h2: id(), h3: id(), supplier: id(), feed: id(), open: id(), closed: id(), layers: id(), buyer: id(), sale: id(), bank: id(), box: id(), employee: id() };
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: ids.farm, name: "Ferme Atlas", region: "Fès-Meknès", province: "El Hajeb", commune: "Aït Boubidmane", gps: null, onssa: { number: "AV-2024-0123", expiresOn: "2027-12-31" } } },
    { type: "farm-registry.createHouse", payload: { id: ids.h1, farmId: ids.farm, name: "Bâtiment 1", areaM2: 1200, capacity: 12000, type: "closed" } },
    { type: "farm-registry.createHouse", payload: { id: ids.h2, farmId: ids.farm, name: "Bâtiment 2", areaM2: 1000, capacity: 10000, type: "closed" } },
    { type: "farm-registry.createHouse", payload: { id: ids.h3, farmId: ids.farm, name: "Pondeuses", areaM2: 800, capacity: 6000, type: "closed" } },
    { type: "finance.createTreasuryAccount", payload: { id: ids.bank, kind: "bank", name: "Banque Populaire" } },
    { type: "finance.createTreasuryAccount", payload: { id: ids.box, kind: "cash", name: "Caisse ferme" } },
    { type: "finance.recordTransfer", payload: { id: id(), day: farmDaysAgo(3), amountCentimes: "1000000", fromId: ids.box, toId: ids.bank } },
    { type: "inventory.createSupplier", payload: { id: ids.supplier, name: "Alf Sahel Distribution", phone: null } },
    { type: "inventory.createStockItem", payload: { id: ids.feed, farmId: ids.farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null } },
    { type: "inventory.recordPurchase", payload: { id: id(), movementId: uuidv7(), supplierId: ids.supplier, stockItemId: ids.feed, day: farmDaysAgo(40), quantity: 8_000_000, unitPriceCentimes: "450", paidCentimes: "0", dueOn: null } },
    { type: "flock.placeBatch", payload: { id: ids.closed, houseId: ids.h2, strainId: "ross-308", placedOn: farmDaysAgo(40), chicksPlaced: 10000, deadOnArrival: 12, hatchery: "Couvoir Chaouia", deliveryNote: "CC-26-0974", chickUnitPriceCentimes: "450", dayOldWeightGrams: null } },
    { type: "flock.recordDay", payload: { batchId: ids.closed, day: farmDaysAgo(10), changes: { dead: 188, deathCause: "unknown", culled: 0, feed: { stockItemId: ids.feed, grams: 5_000_000 } } } },
    { type: "sales.createBuyer", payload: { id: ids.buyer, name: "Abattoir Doukkala Avicole", phone: "0612345678", type: "abattoir", address: "Zone industrielle, El Jadida" } },
    { type: "sales.recordSale", payload: { id: ids.sale, batchId: ids.closed, buyerId: ids.buyer, day: farmDaysAgo(0), birds: 9800, farmWeightGrams: 24_010_000, buyerWeightGrams: null, pricePerKgCentimes: "1500", paymentMethod: "cash", paidCentimes: "36015000", instrument: null } },
    { type: "flock.placeBatch", payload: { id: ids.open, houseId: ids.h1, strainId: "ross-308", placedOn: farmDaysAgo(20), chicksPlaced: 12000, deadOnArrival: 0, hatchery: "Couvoir Chaouia", deliveryNote: "CC-26-1102", chickUnitPriceCentimes: "450", dayOldWeightGrams: null } },
    { type: "flock.recordDay", payload: { batchId: ids.open, day: farmDaysAgo(1), changes: { dead: 14, deathCause: "leg", culled: 2, feed: { stockItemId: ids.feed, grams: 1_200_000 } } } },
    { type: "flock.recordWeighing", payload: { id: uuidv7(), batchId: ids.open, day: farmDaysAgo(1), sample: { totalGrams: 85_000, count: 100 } } },
    { type: "flock.placeBatch", payload: { id: ids.layers, houseId: ids.h3, species: "layer", strainId: "lohmann-brown", placedOn: farmDaysAgo(5), chicksPlaced: 6000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null, ageAtPlacementDays: 200 } },
    { type: "eggs.recordCollection", payload: { id: uuidv7(), batchId: ids.layers, day: farmDaysAgo(1), counts: { normal: 5242, cracked: 18, dirty: 31, doubleYolk: 6, floor: 12, broken: 4 }, sample: null } },
    { type: "eggs.gradeEggs", payload: { id: uuidv7(), batchId: ids.layers, laidOn: farmDaysAgo(1), grades: { m: 3000, l: 2000 } } },
    { type: "finance.recordExpense", payload: { id: id(), day: farmDaysAgo(2), category: "electricity", amountCentimes: "120000", paidFrom: "bank", treasuryId: ids.bank, note: "Facture ONEE octobre" } },
    { type: "finance.recordExpense", payload: { id: id(), day: farmDaysAgo(1), category: "water", amountCentimes: "30000", paidFrom: "cash", treasuryId: ids.box, note: null } },
    { type: "workforce.createEmployee", payload: { id: ids.employee, farmId: ids.farm, name: "Said Amrani", job: "worker", phone: null, housedOnFarm: true, startedOn: farmDaysAgo(30), leftOn: null, dailyWageCentimes: "13846", cnssNumber: null, houseIds: [ids.h1] } },
    { type: "workforce.saveRoutine", payload: { id: id(), farmId: ids.farm, everyDays: 1, startOn: farmDaysAgo(1), fromAge: null, stopOn: null, houseId: ids.h1, employeeId: null, title: "Contrôle des abreuvoirs", time: "07:30" } },
    { type: "planning.savePlan", payload: { id: id(), houseId: ids.h2, placeOn: farmDaysAgo(-20), chicks: 10000, strainId: "ross-308", hatchery: "Couvoir Chaouia", chickPriceCentimes: "450", saleAge: 35 } },
    { type: "biosecurity.recordRodentCheck", payload: { id: id(), farmId: ids.farm, houseId: null, day: farmDaysAgo(2), action: "baitPlaced", product: "Brodifacoum" } },
    { type: "biosecurity.recordVisit", payload: { id: id(), farmId: ids.farm, enteredAt: new Date().toISOString(), visitor: "Dr Naïma R.", vehicle: "12345-A-6", purpose: "vet", recentFarm: false, wheelsDisinfected: true, footbath: true, farmClothing: true, zone: "clean" } },
    { type: "biosecurity.recordDisposal", payload: { id: id(), farmId: ids.farm, day: farmDaysAgo(1), batchId: ids.open, birds: 16, weightGrams: 13_600, method: "incineration", methodNote: null } },
    { type: "documents.createDocument", payload: { id: id(), title: "Contrat du vétérinaire sanitaire", category: "vetContract", farmId: null, issuedOn: farmDaysAgo(300), expiresOn: farmDaysAgo(-65), notes: null } },
  ]);

  // The forms that are server actions: a loan with its schedule, an asset, a budget and a bank statement.
  await page.goto("/fr/loans");
  await page.getByRole("button", { name: "Ajouter un emprunt" }).click();
  const loan = page.getByRole("dialog", { name: "Ajouter un emprunt" });
  await loan.getByLabel("Prêteur").fill("Crédit Agricole du Maroc");
  await loan.getByLabel("Compte bancaire du déblocage et des échéances").selectOption({ label: "Banque Populaire" });
  await loan.getByLabel("Capital emprunté").fill("100 000");
  await loan.getByLabel("Taux annuel du contrat, en %").fill("5,55");
  await loan.getByLabel("Périodicité").selectOption("quarterly");
  await loan.getByLabel("Nombre d’échéances de capital").fill("6");
  await loan.getByLabel("Date de déblocage").fill("2026-01-15");
  await loan.getByLabel("Date de la première échéance").fill("2026-03-31");
  await loan.getByRole("button", { name: "Calculer l’échéancier" }).click();
  await expect(page.getByRole("table", { name: "Échéancier · Crédit Agricole du Maroc" })).toBeVisible();

  await page.goto("/fr/assets");
  await page.getByRole("button", { name: "Ajouter une immobilisation" }).click();
  const asset = page.getByRole("dialog", { name: "Ajouter une immobilisation" });
  await asset.getByLabel("Désignation").fill("Groupe électrogène 60 kVA");
  await asset.getByLabel("Catégorie").selectOption("equipment");
  await asset.getByLabel("Date d’acquisition").fill("2026-09-18");
  await asset.getByLabel("Date de mise en service").fill("2026-09-18");
  await asset.getByLabel("Coût d’acquisition (montant de la facture, TVA comprise)").fill("47 350");
  await asset.getByLabel("Durée d’utilisation, en mois").fill("84");
  await asset.getByLabel("Paiement").selectOption("cash");
  await asset.getByRole("button", { name: "Enregistrer l’immobilisation" }).click();
  await expect(page.getByRole("region", { name: "Groupe électrogène 60 kVA" })).toBeVisible();

  await expect.poll(async () => (await page.request.get("/fr/budget")).status()).toBe(200);
  await page.goto("/fr/budget");
  await page.getByLabel("Nom du budget").fill("Bande de janvier");
  await page.getByRole("button", { name: "Enregistrer le budget" }).click();
  await expect(page.getByRole("list", { name: "Budgets enregistrés" }).getByRole("listitem")).toHaveCount(1);

  await page.goto("/fr/treasury/bank");
  await page.getByRole("button", { name: "Ajouter un relevé" }).click();
  await page.getByLabel("Date de fin du relevé").fill(farmDaysAgo(0));
  await page.getByLabel("Solde final du relevé (DH)").fill("8 800,00");
  await page.getByRole("button", { name: "Enregistrer le relevé" }).click();
  await expect(page.getByRole("status").filter({ hasText: /rapproché/i })).toBeVisible();

  // The phone holds the pushed records before the screens that read them from its storage open.
  await page.goto(`/fr/batches?tab=ventes#${ids.closed}`);
  await expect(page.getByText("Abattoir Doukkala Avicole").first()).toBeVisible();

  const screens = [
    "/dashboard",
    "/batches",
    `/batches#${ids.open}`,
    `/batches#${ids.closed}`,
    `/batches#${ids.layers}`,
    // tasks/plan-ui-cleanup.md batch 1: each tab of a batch's screen, and the closed batches' list
    "/batches?tab=closed",
    ...["sante", "ventes", "indicateurs", "gestion"].map((tab) => `/batches?tab=${tab}#${ids.open}`),
    `/batches?tab=ventes#${ids.closed}`,
    `/batches?tab=indicateurs#${ids.layers}`,
    "/eggs",
    "/stock",
    "/receivables",
    "/expenses",
    "/treasury",
    "/treasury/bank",
    ...["journals", "ledger", "trial", "cpc", "bilan"].map((v) => `/books?view=${v}`),
    "/closing",
    "/closing/count",
    "/closing/statements",
    "/results",
    "/compare",
    "/budget",
    "/threshold",
    "/prices",
    "/assets",
    "/loans",
    "/planning",
    "/visitors",
    "/disposal",
    "/cleanout",
    "/tasks",
    "/staff",
    "/documents",
    "/farms",
    "/protocol",
    "/climate",
    "/inbox",
    "/more",
    `/register#${ids.closed}`,
    "/inspection",
    `/report?batch=${ids.closed}`,
    `/origin#${ids.sale}`,
    "/settings/accounting",
    "/settings/chart",
    "/settings/posting",
    "/settings/members",
    "/organizations", // the invite-code form (ADR-015)
  ];
  return { e164, screens };
}

/** Opens a main screen and waits until its content is in. */
export async function openScreen(tab: Page, url: string) {
  await tab.goto(url); // "load": the server's streamed sections are in
  await tab.locator("h1").first().waitFor();
  // A batch's details render from the phone's storage after the list's heading.
  if (/\/batches(\?[^#]*)?#/.test(url)) await tab.locator('a[href*="/register#"]').first().waitFor();
}
