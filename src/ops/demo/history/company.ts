import { db } from "@/lib/db";
import { addFarmDays, daysBetween, type FarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities, saveLegalIds } from "@/modules/farm-registry";
import { changeAccountingChoices, closeFiscalYear, confirmLoan, createFixedAsset, createLoan, createSubsidy, payFixedAsset, payLoanInstallment, postManualEntry, recordAssociateMovement, runClose } from "@/modules/finance";
import { at, id } from "../kit";
import { BROILER, cleanout, cold, grow, hot, rounds, treat, vaccinate, type Farmhand, type Needs, type ProtocolLine, type SalePlan } from "./flocks";
import { monthsAfter } from "./farm";
import { price } from "./market";
import { buy, monthStatement, payStatements, receivables, supply, team, treasurer, type Employee, type Supplier } from "./money";
import { play, prng, RANK, Story, type Actor } from "./story";

// ══ The company's long history (SARL, double-entry books, VAT-registered): one farm of two broiler houses, its
// fixed assets, a loan paid monthly, a subsidy, monthly bank statements reconciled, payroll, the first year closed. ══

export const COMPANY_NAME = "SARL Avicole Al Amal";
export const COMPANY_FARM = "Ferme Al Amal";
const ASSOCIATE = "Driss Bennani";

/** Within a VAT-inclusive total, the VAT at `rate` %. */
const vatOf = (total: number, rate: number) => Math.round((total * rate) / (100 + rate));

export async function fillCompanyHistory(owner: TenantContext, vetName: string, from: FarmDay, today: FarmDay) {
  const story = new Story(from, today);
  const rng = prng("al-amal");
  const F = (n: number) => addFarmDays(from, n);
  const needs: Needs = new Map();
  let paperNo = 0;
  const instrument = (kind: "cheque" | "bill") => (kind === "cheque" ? `${7_106_400 + ++paperNo * 3}` : `LCN ${String(81_200 + ++paperNo).padStart(7, "0")}`);
  const [entity] = await listLegalEntities(owner);

  const b = {
    farm: id(), ha: id(), hb: id(), cash: id(), bank: id(), feedCo: id(), vetCo: id(), depot: id(),
    starter: id(), grower: id(), finisher: id(), litter: id(), gas: id(), medicine: id(), nd: id(), ib: id(), ibd: id(),
    abattoir: id(), chevillard: id(), traiteur: id(), plan: id(), said: id(), youssef: id(), khalid: id(),
  };
  const units: Record<string, "kg" | "ml" | "dose" | "unit"> = { [b.starter]: "kg", [b.grower]: "kg", [b.finisher]: "kg", [b.litter]: "kg", [b.gas]: "unit", [b.medicine]: "ml", [b.nd]: "dose", [b.ib]: "dose", [b.ibd]: "dose" };
  const feedCo: Supplier = { id: b.feedCo, credit: true };
  const vetCo: Supplier = { id: b.vetCo, credit: false };
  const depot: Supplier = { id: b.depot, credit: false };

  // FN1, FN9: the books chosen before the first entry, then the capital paid in (FCX3, the first year's opening by hand).
  story.call(from, "accounting choices", () => changeAccountingChoices(owner, entity.id, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1, vatRegistered: true }), undefined, RANK.setup);
  story.call(from, "legal ids", () => saveLegalIds(owner, entity.id, { ice: "002876451000083", fiscalId: "52418763", rcNumber: "18245", rcCourt: "Berrechid", cnssNumber: "9871264" }), undefined, RANK.setup);
  story.call(from, "capital", () => postManualEntry(owner, { id: id(), day: from, label: "Capital social libéré à la constitution", piece: "Statuts du 2 janvier 2025", lines: [{ account: "5141", debit: "100000000", credit: "0", treasuryId: b.bank }, { account: "1111", debit: "0", credit: "100000000" }] }), { bank: 100_000_000 }, RANK.setup + 4);

  const setup: [string, object][] = [
    ["farm-registry.createFarm", { id: b.farm, name: COMPANY_FARM, region: "Casablanca-Settat", province: "Berrechid", commune: "Had Soualem", gps: null, onssa: { number: "AS 11.25.0093", expiresOn: "2029-01-19" }, holder: { name: COMPANY_NAME, address: "Douar Laghlimiyine, Had Soualem, province de Berrechid" }, vet: { name: vetName, address: "Cabinet vétérinaire, avenue Hassan II, Settat", phone: null }, technicianName: "Said Benali", registerKeepers: [{ name: "Said Benali", position: "Chef d'élevage", from, to: null }] }],
    ["farm-registry.createHouse", { id: b.ha, farmId: b.farm, name: "Bâtiment A", areaM2: 1200, capacity: 14000, type: "closed" }],
    ["farm-registry.createHouse", { id: b.hb, farmId: b.farm, name: "Bâtiment B", areaM2: 1200, capacity: 14000, type: "closed" }],
    ["finance.createTreasuryAccount", { id: b.bank, kind: "bank", name: "Compte courant, agence de Berrechid" }],
    ["finance.createTreasuryAccount", { id: b.cash, kind: "cash", name: "Caisse de la ferme" }],
    ["inventory.createSupplier", { id: b.feedCo, name: "Provenderie Sahel Aliments", phone: null }],
    ["inventory.createSupplier", { id: b.vetCo, name: "Pharmacie vétérinaire Ennour, Berrechid", phone: null }],
    ["inventory.createSupplier", { id: b.depot, name: "Dépôt Errahma (paille et gaz), Had Soualem", phone: null }],
    ["inventory.createStockItem", { id: b.starter, farmId: b.farm, productId: "feed-starter", kind: "feed", name: "Aliment démarrage (miettes)", unit: "kg", lot: null, expiresOn: null }],
    ["inventory.createStockItem", { id: b.grower, farmId: b.farm, productId: "feed-grower", kind: "feed", name: "Aliment croissance (granulés)", unit: "kg", lot: null, expiresOn: null }],
    ["inventory.createStockItem", { id: b.finisher, farmId: b.farm, productId: "feed-finisher", kind: "feed", name: "Aliment finition (granulés)", unit: "kg", lot: null, expiresOn: null }],
    ["inventory.createStockItem", { id: b.litter, farmId: b.farm, productId: null, kind: "litter", name: "Paille broyée", unit: "kg", lot: null, expiresOn: null }],
    ["inventory.createStockItem", { id: b.gas, farmId: b.farm, productId: null, kind: "gas", name: "Propane, bouteille de 34 kg", unit: "unit", lot: null, expiresOn: null }],
    ["inventory.createStockItem", { id: b.medicine, farmId: b.farm, productId: null, kind: "medicine", name: "Enrofloxacine 10 %, solution buvable", unit: "ml", lot: "ENR-25-0741", expiresOn: "2027-06-30" }],
    ["inventory.createStockItem", { id: b.nd, farmId: b.farm, productId: "vaccine-newcastle", kind: "vaccine", name: "Vaccin Newcastle souche La Sota", unit: "dose", lot: "LS-2511", expiresOn: "2027-02-28" }],
    ["inventory.createStockItem", { id: b.ib, farmId: b.farm, productId: "vaccine-infectious-bronchitis", kind: "vaccine", name: "Vaccin bronchite infectieuse H120", unit: "dose", lot: "H120-2508", expiresOn: "2027-01-31" }],
    ["inventory.createStockItem", { id: b.ibd, farmId: b.farm, productId: "vaccine-gumboro", kind: "vaccine", name: "Vaccin Gumboro souche intermédiaire", unit: "dose", lot: "IBD-2514", expiresOn: "2027-03-31" }],
    ["sales.createBuyer", { id: b.abattoir, name: "Abattoir avicole Assafa, Had Soualem", phone: null, type: "abattoir", address: "Zone industrielle, Had Soualem" }],
    ["sales.createBuyer", { id: b.chevillard, name: "Mustapha Ennaciri, chevillard", phone: null, type: "trader", address: "Marché de gros des volailles, Casablanca" }],
    ["sales.createBuyer", { id: b.traiteur, name: "Traiteur Dar Diafa, Casablanca", phone: null, type: "other" }],
    ["reference-data.copyProtocol", { id: b.plan, templateId: "broiler-default", name: "Programme poulet de chair, Dr Berrada" }],
  ];
  for (const [type, payload] of setup) story.add(from, RANK.setup + 3, "manager", type, payload);
  const programme: ProtocolLine[] = [
    { dayOfAge: 1, productId: "vaccine-newcastle", method: "spray" },
    { dayOfAge: 1, productId: "vaccine-infectious-bronchitis", method: "spray" },
    { dayOfAge: 12, productId: "vaccine-gumboro", method: "drinkingWater" },
    { dayOfAge: 18, productId: "vaccine-newcastle", method: "drinkingWater" },
    { dayOfAge: 26, productId: "vaccine-gumboro", method: "drinkingWater" },
  ];
  story.add(from, RANK.setup + 3, "manager", "reference-data.updateProtocol", { id: b.plan, changes: { items: programme } });
  story.add(from, RANK.setup + 3, "manager", "planning.saveDowntime", { id: id(), farmId: b.farm, validFrom: from, minDays: 21, source: "Choix de la gérance, au-delà du minimum réglementaire" });
  const lots: Record<string, string> = { "vaccine-newcastle": b.nd, "vaccine-infectious-bronchitis": b.ib, "vaccine-gumboro": b.ibd };
  const f: Farmhand = { story, rng, farmId: b.farm, needs, lots: (p) => lots[p], vetName, hand: "manager", instrument, sales: [], medicine: b.medicine, disinfectant: { product: "Désinfectant à base de glutaraldéhyde et ammonium quaternaire", lot: `GQ-${rng.int(2_700, 2_999)}` } };

  // ── Broilers in houses A and B, staggered; no batch across a year end the books close (FC4: none to value). ──
  const closedYears = Number(today.slice(0, 4)) - 1;
  const crossesYearEnd = (placedOn: FarmDay, lastAge: number) => {
    const end = addFarmDays(placedOn, lastAge);
    return Number(placedOn.slice(0, 4)) <= closedYears && end.slice(0, 4) !== placedOn.slice(0, 4);
  };
  let bandNo = 0;
  for (const [house, startOn] of [[b.ha, F(6)], [b.hb, F(27)]] as const) {
    const cycles: { placedOn: FarmDay; lastAge: number }[] = [];
    let placedOn = startOn;
    while (placedOn <= today) {
      const lastAge = rng.int(39, 43);
      if (crossesYearEnd(placedOn, lastAge)) {
        placedOn = `${Number(placedOn.slice(0, 4)) + 1}-01-${house === b.ha ? "05" : "19"}` as FarmDay;
        continue;
      }
      cycles.push({ placedOn, lastAge });
      placedOn = addFarmDays(placedOn, lastAge + rng.int(22, 27));
    }
    // The next batch, planned: chicks ordered from the hatchery for its day.
    story.add(addFarmDays(today, -2), RANK.late, "manager", "planning.savePlan", { id: id(), houseId: house, placeOn: placedOn, chicks: 13_300, strainId: "ross-308", hatchery: "Couvoir Al Mostakbal, Berrechid", chickPriceCentimes: String(price.chick(today)), saleAge: 41 });
    cycles.forEach(({ placedOn, lastAge }, i) => {
      const closedOn = addFarmDays(placedOn, lastAge);
      const open = closedOn >= today;
      const batchId = id();
      const chicks = Math.round((hot(placedOn) ? 0.86 : 0.95) * 14_000 / 100) * 100;
      const doa = Math.round(chicks * rng.around(0.0018, 0.4));
      const chickPrice = price.chick(placedOn);
      const chickTotal = chicks * chickPrice;
      const salePlans: SalePlan[] = [
        { age: lastAge - 2, share: rng.around(0.45, 0.1), buyerId: b.abattoir, method: "transfer" },
        { age: lastAge - 1, share: rng.around(0.5, 0.1), buyerId: b.chevillard, method: rng.pick(["cheque", "cash", "cheque"] as const) },
        { age: lastAge, share: 1, buyerId: rng.chance(0.5) ? b.traiteur : b.abattoir, method: rng.pick(["credit", "transfer"] as const) },
      ];
      story.add(placedOn, RANK.place, "manager", "flock.placeBatch", {
        id: batchId, houseId: house, species: "broiler", strainId: rng.chance(0.6) ? "ross-308" : "cobb-500", placedOn, chicksPlaced: chicks, deadOnArrival: doa,
        hatchery: rng.pick(["Couvoir Al Mostakbal, Berrechid", "Couvoir Sidi Rahal"]), deliveryNote: `BL ${placedOn.slice(2, 4)}-${String(++bandNo * 41 + 2_000)}`,
        chickUnitPriceCentimes: String(chickPrice), chickVatCentimes: String(vatOf(chickTotal, 20)), dayOldWeightGrams: rng.int(39, 44),
        paidOnDelivery: { cashAccountId: b.cash, amountCentimes: String(chickTotal) },
      }, { cash: -chickTotal });
      story.add(placedOn, RANK.place, "manager", "biosecurity.recordVisit", { id: id(), farmId: b.farm, enteredAt: at(placedOn, "06:30"), visitor: "Livreur du couvoir", vehicle: `${rng.int(10_000, 99_999)}-B-${rng.int(1, 60)}`, purpose: "chickDelivery", recentFarm: false, wheelsDisinfected: true, footbath: true, farmClothing: true, zone: "dirty" });
      buy(story, rng, { item: b.litter, unit: "kg", supplier: depot, farmId: b.farm, day: addFarmDays(placedOn, -4), quantity: 7_200_000, unitPriceCentimes: 120, delivery: false });
      story.add(addFarmDays(placedOn, -2), RANK.close, "manager", "inventory.adjustStock", { id: id(), stockItemId: b.litter, day: addFarmDays(placedOn, -2), quantity: -7_200_000, reason: "Litière étalée dans le bâtiment avant l'arrivée des poussins" });
      const bottles = cold(placedOn) ? 55 : hot(placedOn) ? 14 : 32;
      buy(story, rng, { item: b.gas, unit: "unit", supplier: depot, farmId: b.farm, day: addFarmDays(placedOn, -1), quantity: bottles, unitPriceCentimes: 41_500, vatRate: 10, delivery: false });
      story.add(addFarmDays(placedOn, 14), RANK.close, "manager", "inventory.adjustStock", { id: id(), stockItemId: b.gas, day: addFarmDays(placedOn, 14), quantity: -bottles, reason: "Bouteilles vides : chauffage des poussins terminé" });
      const treated = !open && rng.chance(0.3) ? { start: rng.int(12, 18), days: 5, withdrawal: 6 } : null;
      const lastEntry = open ? daysBetween(placedOn, today) : lastAge;
      grow(f, {
        batchId, houseId: house, placedOn, placed: chicks - doa, lastAge: lastEntry, open,
        feed: (age) => (age <= 10 ? b.starter : age <= 24 ? b.grower : b.finisher), model: BROILER,
        perMille: (age, day) => (age <= 3 ? 2.4 : age <= 7 ? 1.1 : age <= 28 ? 0.42 : 0.6) + (hot(day) && age > 25 && rng.chance(0.15) ? 2.5 : 0),
        perf: rng.around(hot(placedOn) ? 0.96 : 1.01, 0.03), sales: salePlans, pricePerKg: price.broiler, weighEvery: 7, sample: 60,
        catching: (birds) => birds * 25,
      });
      vaccinate(f, batchId, placedOn, b.plan, programme, chicks - doa - Math.round(chicks * 0.01), 0, open ? today : closedOn);
      if (treated) treat(f, batchId, placedOn, treated.start, treated.days, treated.withdrawal, Math.round((chicks / 1000) * 110 * treated.days), rng.pick(["Râles respiratoires", "Entérite, fientes liquides"]), `ORD ${placedOn.slice(2, 4)}/${String(rng.int(100, 999))}`);
      rounds(f, batchId, placedOn, [3, 17, 31].filter((x) => x < lastEntry), () => "Visite de routine : état général bon, registre visé.");
      if (!open) cleanout(f, house, batchId, closedOn, cycles[i + 1]?.placedOn ?? null, Math.round(1200 * 14 * rng.around(1, 0.1)));
    });
  }

  // Feed on credit (statement on the 10th), vaccines and medicine on delivery; all at the company's VAT.
  for (const [key, phase] of [[b.starter, "starter"], [b.grower, "grower"], [b.finisher, "finisher"]] as const)
    supply(story, rng, needs, { item: key, unit: "kg", supplier: feedCo, farmId: b.farm, price: (d) => price.feed(d, phase) - 8, step: 1_000_000, cover: 4, ahead: 14 });
  for (const [key, c] of [[b.nd, 12], [b.ib, 14], [b.ibd, 17]] as const) supply(story, rng, needs, { item: key, unit: "dose", supplier: vetCo, farmId: b.farm, price: () => c, step: 5_000, cover: 14, ahead: 30, vatRate: 7 });
  supply(story, rng, needs, { item: b.medicine, unit: "ml", supplier: vetCo, farmId: b.farm, price: () => 32, step: 5_000, cover: 30, ahead: 120, vatRate: 7 });
  payStatements(story, rng, [feedCo], units, instrument);
  receivables(story, rng, f.sales, []);

  // Monthly bills with their VAT; the bank's fees on the 28th, so each month's statement pairs line for line.
  for (let m = from; m <= today; m = addFarmDays(`${m.slice(0, 7)}-01` as FarmDay, 32)) {
    const month = m.slice(0, 7);
    const day = (d: number) => `${month}-${String(d).padStart(2, "0")}` as FarmDay;
    const monthName = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`));
    const bill = Math.round((6_800_00 * (hot(day(9)) ? 1.4 : cold(day(9)) ? 1.2 : 1) * rng.around(1, 0.08)) / 100) * 100;
    story.add(day(9), RANK.money, "manager", "finance.recordExpense", { id: id(), day: day(9), category: "electricity", amountCentimes: String(bill), vatCentimes: String(vatOf(bill, 14)), paidFrom: "bank", treasuryId: b.bank, note: `Facture ONEE, ${monthName}` }, { bank: -bill });
    const vet = 200_000;
    story.add(day(27), RANK.money, "owner", "finance.recordExpense", { id: id(), day: day(27), category: "vet_fees", amountCentimes: String(vet), vatCentimes: String(vatOf(vet, 20)), paidFrom: "bank", treasuryId: b.bank, note: `Suivi sanitaire mensuel, Dr Berrada, ${monthName}` }, { bank: -vet });
    const fees = 6_600 + rng.int(0, 4) * 550;
    story.add(day(28), RANK.money, "owner", "finance.recordExpense", { id: id(), day: day(28), category: "bank_fees", amountCentimes: String(fees), vatCentimes: String(vatOf(fees, 10)), paidFrom: "bank", treasuryId: b.bank, note: "Frais de tenue de compte et commissions" }, { bank: -fees });
    if (Number(month.slice(5)) % 3 === 0) {
      const water = Math.round(1_150_00 * rng.around(1, 0.1) / 100) * 100;
      story.add(day(16), RANK.money, "manager", "finance.recordExpense", { id: id(), day: day(16), category: "water", amountCentimes: String(water), vatCentimes: String(vatOf(water, 7)), paidFrom: "bank", treasuryId: b.bank, note: "Facture d'eau du trimestre" }, { bank: -water });
    }
    if (month.endsWith("-01")) {
      const premium = 1_860_000;
      story.add(day(20), RANK.money, "owner", "finance.recordExpense", { id: id(), day: day(20), category: "insurance", amountCentimes: String(premium), paidFrom: "bank", treasuryId: b.bank, note: `Assurance multirisque des bâtiments et du cheptel, ${month.slice(0, 4)}` }, { bank: -premium });
    }
    story.add(day(6), RANK.close, "manager", "biosecurity.recordRodentCheck", { id: id(), farmId: b.farm, houseId: b.ha, day: day(6), action: "baitPlaced", product: "Appât raticide en blocs (bromadiolone)" });
    story.add(day(20), RANK.close, "manager", "biosecurity.recordRodentCheck", { id: id(), farmId: b.farm, houseId: b.ha, day: day(20), action: "baitChecked", product: null });
  }

  const staff: Employee[] = [
    { id: b.said, farmId: b.farm, name: "Said Benali", job: "lead", phone: null, housed: true, startedOn: from, wage: 17_000, rest: 0, houseIds: [b.ha, b.hb], cnss: "152 300 418" },
    { id: b.youssef, farmId: b.farm, name: "Youssef Ait Brahim", job: "worker", phone: null, housed: false, startedOn: from, wage: 12_500, rest: 5, houseIds: [b.ha, b.hb], cnss: "158 772 041" },
    { id: b.khalid, farmId: b.farm, name: "Khalid Mernissi", job: "guard", phone: null, housed: true, startedOn: F(31), wage: 10_500, rest: 3, houseIds: [], cnss: "161 045 330" },
  ];
  team(story, rng, staff, { payFrom: () => "bank", advances: [["2025-06-03", b.youssef, 1_000], ["2026-05-21", b.youssef, 1_000], ["2026-05-21", b.khalid, 700]] });
  for (const [title, category, issuedOn, expiresOn, notes] of [
    ["Statuts de la SARL", "company", from, null, "Capital social de 1 000 000 DH, deux associés"],
    ["Certificat d'inscription au registre de commerce", "company", from, null, "RC 18245, tribunal de Berrechid"],
    ["Attestation d'affiliation à la CNSS", "company", F(20), null, "N° d'affiliation 9871264"],
    ["Agrément sanitaire ONSSA, Ferme Al Amal", "authorization", F(18), "2029-01-19", "N° AS 11.25.0093"],
    ["Attestation de régularité fiscale", "tax", "2026-03-24", "2026-09-23", "À redemander pour les marchés"],
    ["Assurance multirisque 2026", "insurance", "2026-01-20", "2027-01-19", "Bâtiments, matériel et cheptel"],
  ] as const) story.add(issuedOn as FarmDay, RANK.late, "manager", "documents.createDocument", { id: id(), title, category, farmId: category === "authorization" || category === "insurance" ? b.farm : null, issuedOn, expiresOn, notes });

  // ── Online, by the owner: the investment (buildings, equipment, generator on credit, van, silo), the loan, the subsidy. ──
  const buildings = id();
  const equipment = id();
  const generator = id();
  const asset = (day: FarmDay, assetId: string, label: string, category: string, total: number, lifeMonths: number, paidWith: "transfer" | "credit", more: object = {}) =>
    story.call(day, label, () => createFixedAsset(owner, { id: assetId, label, category, farmId: b.farm, houseId: null, acquiredOn: day, inServiceOn: addFarmDays(day, 2), amountCentimes: String(total), vatCentimes: String(vatOf(total, 20)), lifeMonths, paidWith, treasuryId: paidWith === "credit" ? null : b.bank, ...more }), paidWith === "credit" ? undefined : { bank: -total });
  asset(F(3), buildings, "Bâtiments d'élevage A et B (2 × 1 200 m²)", "building", 165_000_000, 240, "transfer");
  asset(F(4), equipment, "Matériel d'élevage : mangeoires, abreuvoirs, éleveuses", "equipment", 38_400_000, 84, "transfer");
  asset(F(4), generator, "Groupe électrogène 100 kVA", "installation", 15_600_000, 120, "credit", { lastPaymentOn: F(150) });
  for (const [n, amount] of [[60, 7_800_000], [150, 7_800_000]] as const)
    story.call(F(n), "generator payment", () => payFixedAsset(owner, { id: id(), assetId: generator, day: F(n), amountCentimes: String(amount), paidWith: "transfer", treasuryId: b.bank }), { bank: -amount });
  asset(F(160), id(), "Camionnette de livraison", "transport", 22_800_000, 60, "transfer");
  asset("2026-02-10" as FarmDay, id(), "Silo à aliment 15 t, bâtiment B", "equipment", 6_600_000, 120, "transfer");
  story.call(F(170), "subsidy", () => createSubsidy(owner, { id: id(), label: "Aide à la construction et à l'équipement de bâtiments avicoles", grantor: "Fonds de développement agricole", amountCentimes: "33000000", receivedOn: F(170), treasuryId: b.bank, assetIds: [buildings, equipment] }), { bank: 33_000_000 });
  const loan = id();
  story.call(F(2), "loan", async () => {
    const created = await createLoan(owner, { id: loan, lender: "Banque, crédit d'investissement agricole", treasuryId: b.bank, principalCentimes: "80000000", disbursedOn: F(2), rate: 5_900, frequency: "monthly", installments: 84, deferral: 0, firstDueOn: F(33) });
    return created.ok ? confirmLoan(owner, { loanId: loan }) : created;
  }, { bank: 80_000_000 }, RANK.setup + 4);
  for (let n = 1; n <= 84; n++) {
    const due = monthsAfter(F(33), n - 1);
    story.call(due, `installment ${n}`, () => payLoanInstallment(owner, { loanId: loan, number: n, day: due }), { bank: -1_165_100 });
  }

  // FC9: each month's statement imported on the 6th of the next and reconciled line for line.
  for (let m = from; addFarmDays(`${m.slice(0, 7)}-01` as FarmDay, 31).slice(0, 7) + "-06" <= today; m = addFarmDays(`${m.slice(0, 7)}-01` as FarmDay, 32)) {
    const month = m.slice(0, 7);
    const on = (addFarmDays(`${month}-01` as FarmDay, 31).slice(0, 7) + "-06") as FarmDay;
    story.call(on, `statement ${month}`, (clock) => monthStatement(owner, b.bank, month, clock));
  }
  // FCX4–FCX6: each past year closed in March: the close run (depreciation, subsidy, interest…), then the close,
  // which locks the year and posts the next year's opening.
  for (let year = Number(from.slice(0, 4)); year <= closedYears; year++)
    story.call(`${year + 1}-03-16` as FarmDay, `close ${year}`, async (clock) => {
      const run = await runClose(owner, { year }, clock);
      return run.ok ? closeFiscalYear(owner, { year }, clock) : run;
    });

  treasurer(story, {
    cash: b.cash, bank: b.bank, openingBank: 0, floorCash: 800_000, floorBank: 5_000_000, drawings: 0,
    contribute: (day, amount) => story.call(day, "associate contribution", () => recordAssociateMovement(owner, { id: id(), day, direction: "contribution", amountCentimes: String(amount), treasuryId: b.bank, associate: ASSOCIATE }), undefined, RANK.late),
    withdraw: () => {},
  });

  // The company's team has no account here: the owner types everything.
  const actors: Record<Actor, TenantContext> = { owner, manager: owner, worker: owner, vet: owner };
  const played = await play(actors, story, "company");
  const closes = await db.fiscalYearClose.count({ where: { organizationId: owner.organizationId } });
  return { ...played, farm: b.farm, closes };
}
