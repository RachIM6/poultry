import { addFarmDays } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { changeAccountingChoices, confirmLoan, createFixedAsset, createLoan, payFixedAsset, payLoanInstallment, postManualEntry, postPending, recordAssociateMovement } from "@/modules/finance";
import { ago, apply, dh, id, m, must, place, purchase, raise, sale, today, tonnes, weighings, type Feed } from "./kit";
import { importStatement, loanInstallmentsDue } from "./money";

// ══ The company (SARL): double-entry books, VAT-registered, statements (DEMO ONLY: every figure is made up). ══

export async function fillCompany(B: TenantContext) {
  // FN1, FN9: chosen before the year's first entry, as the owner does on the accounting settings.
  const [entity] = await listLegalEntities(B);
  must("SARL accounting choices", await changeAccountingChoices(B, entity.id, { books: "ledger", pcaOverlay: null, fiscalYearStartMonth: 1, vatRegistered: true }));

  const b = { farm: id(), house: id(), feedCo: id(), starter: id(), grower: id(), finisher: id(), closed: id(), open: id(), bank: id(), cash: id(), abattoir: id(), trader: id() };
  const feedB: Feed = { starter: b.starter, grower: b.grower, finisher: b.finisher };
  const bClosedOn = ago(80);
  const bDay = (age: number) => addFarmDays(bClosedOn, age);
  const bClosed = raise(b.closed, bClosedOn, 6000 - 9, 42, feedB, { 41: 3500 });
  const bOpenOn = ago(12);
  const bOpen = raise(b.open, bOpenOn, 6000 - 9, 11, feedB);
  const vat = (ttc: number, rate: number) => dh(Math.round((ttc * rate) / (100 + rate))); // the VAT inside a total (made-up rates)
  const writes = await apply(B, "company", [
    m("farm-registry.createFarm", { id: b.farm, name: "Ferme Démo Berrechid", region: "Casablanca-Settat", province: "Berrechid", commune: "Had Soualem", gps: null, onssa: { number: "DEMO-ONSSA-0002", expiresOn: addFarmDays(today, 200) } }),
    m("farm-registry.createHouse", { id: b.house, farmId: b.farm, name: "Bâtiment A", areaM2: 900, capacity: 8000, type: "closed" }),
    m("finance.createTreasuryAccount", { id: b.bank, kind: "bank", name: "Banque Démo SARL" }),
    m("finance.createTreasuryAccount", { id: b.cash, kind: "cash", name: "Caisse SARL" }),
    m("inventory.createSupplier", { id: b.feedCo, name: "Provende Démo du Centre", phone: null }),
    ...([["starter", "feed-starter", "Aliment démarrage"], ["grower", "feed-grower", "Aliment croissance"], ["finisher", "feed-finisher", "Aliment finition"]] as const).map(([k, productId, name]) =>
      m("inventory.createStockItem", { id: b[k], farmId: b.farm, productId, kind: "feed", name, unit: "kg", lot: null, expiresOn: null }),
    ),
    m("sales.createBuyer", { id: b.abattoir, name: "Abattoir Démo Berrechid", phone: null, type: "abattoir" }),
    m("sales.createBuyer", { id: b.trader, name: "Marchand Démo Casablanca", phone: null, type: "trader" }),
    purchase(b.feedCo, b.starter, "kg", addFarmDays(bClosedOn, -2), tonnes(bClosed.used[b.starter] + bOpen.used[b.starter]), "560", "all"),
    purchase(b.feedCo, b.grower, "kg", bDay(9), tonnes(bClosed.used[b.grower] + bOpen.used[b.grower]), "540", "all"),
    purchase(b.feedCo, b.finisher, "kg", bDay(23), tonnes(bClosed.used[b.finisher]), "520", "none", "transfer", bDay(70)), // on credit
    place(b.closed, b.house, bClosedOn, 6000, "BL-DEMO-301"),
    ...bClosed.entries,
    ...weighings(b.closed, bClosedOn, [[7, 172], [21, 860], [35, 1_920], [42, 2_460]]),
    sale(b.closed, b.abattoir, bDay(41), 3500, 2_400, 1490, "transfer", "all"),
    sale(b.closed, b.trader, bDay(42), bClosed.alive, 2_470, 1510, "cheque", "all", { number: "CHQ-DEMO-0301", dueOn: addFarmDays(today, 10) }),
    place(b.open, b.house, bOpenOn, 6000, "BL-DEMO-302"),
    ...bOpen.entries,
    ...weighings(b.open, bOpenOn, [[7, 168]]),
    m("inventory.recordSupplierPayment", { id: id(), supplierId: b.feedCo, day: bDay(60), amountCentimes: dh(40_000), method: "transfer", instrument: null }),
    m("finance.recordTransfer", { id: id(), day: ago(70), amountCentimes: dh(10_000), fromId: b.bank, toId: b.cash }),
    m("finance.recordExpense", { id: id(), day: ago(60), category: "electricity", amountCentimes: dh(3_100), vatCentimes: vat(3_100, 14), paidFrom: "bank", treasuryId: b.bank, note: "Facture (démo)" }),
    m("finance.recordExpense", { id: id(), day: ago(30), category: "electricity", amountCentimes: dh(2_900), vatCentimes: vat(2_900, 14), paidFrom: "bank", treasuryId: b.bank, note: "Facture (démo)" }),
    m("finance.recordExpense", { id: id(), day: ago(50), category: "insurance", amountCentimes: dh(4_200), paidFrom: "bank", treasuryId: b.bank, note: "Assurance multirisque (démo)" }),
    m("finance.recordExpense", { id: id(), day: bDay(42), category: "catching", amountCentimes: dh(1_800), vatCentimes: vat(1_800, 20), paidFrom: "cash", treasuryId: b.cash, note: null, batchId: b.closed }),
    m("finance.recordExpense", { id: id(), day: ago(8), category: "vet_fees", amountCentimes: dh(1_200), vatCentimes: vat(1_200, 20), paidFrom: "credit", treasuryId: null, note: "Honoraires vétérinaires, à payer (démo)", batchId: b.open }),
  ]);
  // The share capital, paid in at the bank: the year's opening entry (FCX3), typed by the accountant.
  must("SARL capital", await postManualEntry(B, { id: id(), day: `${today.slice(0, 4)}-01-01`, label: "Capital social libéré (démo)", piece: "STATUTS-DEMO", lines: [{ account: "5141", debit: dh(200_000), credit: "0", treasuryId: b.bank }, { account: "1111", debit: "0", credit: dh(200_000) }] }));
  must("SARL contribution", await recordAssociateMovement(B, { id: id(), day: ago(85), direction: "contribution", amountCentimes: dh(300_000), treasuryId: b.bank, associate: "Associé démo" }));
  must("SARL asset", await createFixedAsset(B, { id: id(), label: "Silo à aliment 12 t (démo)", category: "equipment", farmId: b.farm, houseId: b.house, acquiredOn: ago(75), inServiceOn: ago(74), amountCentimes: dh(54_000), vatCentimes: vat(54_000, 20), lifeMonths: 120, paidWith: "transfer", treasuryId: b.bank }));
  const generator = id(); // on credit, partly paid by cheque
  must("SARL asset", await createFixedAsset(B, { id: generator, label: "Groupe électrogène 40 kVA (démo)", category: "installation", farmId: b.farm, acquiredOn: ago(65), inServiceOn: ago(65), amountCentimes: dh(48_000), vatCentimes: vat(48_000, 20), lifeMonths: 120, paidWith: "credit", lastPaymentOn: addFarmDays(today, 120), treasuryId: null }));
  must("SARL asset payment", await payFixedAsset(B, { id: id(), assetId: generator, day: ago(20), amountCentimes: dh(16_000), paidWith: "cheque", treasuryId: b.bank }));
  const loan = id();
  must("SARL loan", await createLoan(B, { id: loan, lender: "Banque Démo (crédit de campagne)", treasuryId: b.bank, principalCentimes: dh(120_000), disbursedOn: ago(84), rate: 6_000, frequency: "quarterly", installments: 8, deferral: 0, firstDueOn: ago(10) }));
  must("SARL loan confirmed", await confirmLoan(B, { loanId: loan }));
  for (const [number, day] of await loanInstallmentsDue(loan)) must(`SARL installment ${number}`, await payLoanInstallment(B, { loanId: loan, number, day }));
  await postPending(B);
  const statement = await importStatement(B, b.bank, ago(15), 9_000n);
  return { writes, statement };
}
