import type { FarmDay } from "@/lib/kernel/farm-day";
import type { DisposalDto } from "@/modules/biosecurity/shared";
import type { DocumentDto } from "@/modules/documents/shared";
import { ageOfBatch, birdsOnHand, birdsStarted, EMPTY_DAY, type BatchDto, type DailyEntryDto, type SoldBirdsDto } from "@/modules/flock/shared";
import type { TreatmentDto, VaccinationDto, VetVisitDto } from "@/modules/health/shared";
import { originNumber, type SaleDto } from "@/modules/sales/shared";

// SPEC-m2-compliance RP1: the "registre de suivi sanitaire" of one batch, built to arrêté n° 2126-05 du 15 décembre
// 2005 (décret n° 2-04-684, art. 8; docs/sources/onssa/), from the records the phone already holds (SPEC H6). Pure: the
// page lays it out in art. 2's order (cover art. 3, supervision sheet, chronological data art. 4, vet visas art. 7,
// annexes art. 5). What the app doesn't record is left for the keeper to fill by hand, never invented (CQ1). No money
// field is ever read into the output.

/** Art. 3, 4: the farm's register fields as farm-registry's FarmDto carries them; absent from a farm stored before them. */
type FarmRegisterFields = {
  holder?: { name: string; address: string | null } | null;
  vet?: { name: string; address: string | null; phone: string | null } | null;
  technicianName?: string | null;
  chickImportApproval?: string | null;
  registerKeepers?: { name: string; position: string; from: string; to: string | null }[];
};

/** What the register needs, in the DTO shapes the phone stores. Farm, house, catalogue and egg figures come from
 * modules `reporting` doesn't depend on, so they are plain fields here. */
export type RegisterInput = {
  today: string; // farm day: how far an open batch's months of visas run
  farm: { name: string; commune: string; province: string; region: string; onssa: { number: string; expiresOn: string } | null } & FarmRegisterFields;
  house: { name: string; areaM2: number } | null;
  strainName: string;
  batch: BatchDto;
  dailyEntries: DailyEntryDto[];
  eggsLaid: { batchId: string; day: string; eggs: number }[]; // art. 4: laying batches
  vaccinations: VaccinationDto[];
  treatments: TreatmentDto[];
  vetVisits: VetVisitDto[];
  soldBirds: SoldBirdsDto[];
  sales: SaleDto[]; // none on a worker's phone
  buyers: { id: string; name: string; address?: string | null }[];
  disposals: DisposalDto[];
  documents: DocumentDto[]; // the vault: lab reports and the vet contract (owners' and managers' phones only)
  products: { id: string; name: string }[]; // catalogue names in the page's language
  stockItems: { id: string; name: string; lot: string | null }[];
};

/** Art. 2, 5: the copies the keeper files in the register. */
export const ANNEXES = ["chickDelivery", "feedDelivery", "labReports", "vetReports", "prescriptions"] as const;

const byDay = <T extends { day: string }>(x: T, y: T) => x.day.localeCompare(y.day);

/** The calendar months (YYYY-MM) from `from`'s to `to`'s, both included. */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const last = to.slice(0, 7);
  for (let key = from.slice(0, 7); key <= last; key = `${y}-${String(m).padStart(2, "0")}`) {
    months.push(key);
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
  return months;
}

/** The months of a batch's life: placement to closing, or to today while open. */
export const batchMonths = (batch: Pick<BatchDto, "placedOn" | "closedOn">, today: string) => monthsBetween(batch.placedOn, batch.closedOn ?? today);

export function buildRegister(i: RegisterInput) {
  const { batch } = i;
  const of = (b: { batchId: string }) => b.batchId === batch.id;
  const age = (day: string) => ageOfBatch(batch, day as FarmDay); // SPEC-m3 B7: birds placed older than a day
  const item = (id: string) => i.stockItems.find((s) => s.id === id);
  const product = (id: string) => i.products.find((p) => p.id === id)?.name ?? id;
  const treatments = i.treatments.filter(of).sort((x, y) => x.startOn.localeCompare(y.startOn));
  const sold = i.soldBirds.filter(of).sort(byDay);
  const vetVisits = i.vetVisits.filter(of).sort((x, y) => x.on.localeCompare(y.on));
  const vaccinations = i.vaccinations.filter(of).sort((x, y) => x.dueOn.localeCompare(y.dueOn));
  const end = batch.closedOn ?? "9999-12-31";
  const docs = i.documents.filter((d) => d.farmId === null || d.farmId === batch.farmId);
  const labReports = docs
    .filter((d) => d.category === "labReport" && d.issuedOn !== null && batch.placedOn <= d.issuedOn && d.issuedOn <= end)
    .map((d) => ({ title: d.title, issuedOn: d.issuedOn as string, fileId: d.fileId }))
    .sort((x, y) => x.issuedOn.localeCompare(y.issuedOn));
  const entries = i.dailyEntries.filter(of).sort(byDay);

  // Art. 4: one column per feed type, by the stock item's name, in the order the batch first ate them.
  const feedName = (id: string) => item(id)?.name ?? "—";
  const feedTypes = [...new Set(entries.flatMap((e) => (e.feed ? [feedName(e.feed.stockItemId)] : [])))];
  const laying = batch.species === "layer";

  // One row per day with an entry or birds out: a sale on a day nobody entered still leaves the birds on hand (B5).
  const started = birdsStarted(batch); // SPEC-m3 B10: free chicks included
  const dayList = [...new Set([...entries, ...sold].map((x) => x.day))].sort();
  let cumulativeDead = 0;
  const days = dayList.map((d) => {
    const e = entries.find((x) => x.day === d) ?? { ...EMPTY_DAY, day: d };
    const out = sold.filter((s) => s.day === d).reduce((n, s) => n + s.birds, 0);
    cumulativeDead += e.dead + e.culled;
    const eggs = i.eggsLaid.filter((x) => of(x) && x.day === e.day);
    return {
      day: e.day,
      age: age(e.day),
      onHand: birdsOnHand(started, entries.filter((x) => x.day <= d), sold.filter((s) => s.day <= d)),
      dead: e.dead,
      culled: e.culled,
      cumulativeDead,
      cause: e.deathCause,
      feedGrams: feedTypes.map((name) => (e.feed && feedName(e.feed.stockItemId) === name ? e.feed.grams : null)),
      waterMl: e.waterMl,
      eggs: laying && eggs.length > 0 ? eggs.reduce((n, x) => n + x.eggs, 0) : null,
      note: e.note,
      out,
      treatments: treatments.filter((t) => t.startOn <= e.day && e.day <= t.endOn).map((t) => item(t.stockItemId)?.name ?? "—"),
      withdrawal: treatments.some((t) => t.startOn <= e.day && e.day <= t.withdrawalEndsOn),
      vaccinations: vaccinations.filter((v) => v.done?.on === e.day).map((v) => item(v.done!.stockItemId)?.name ?? product(v.productId)),
      vetVisits: vetVisits.filter((v) => v.on === e.day).map((v) => v.vetName),
      labReports: labReports.filter((l) => l.issuedOn === e.day).map((l) => l.title),
    };
  });

  // Art. 7: the vet visas at least once a month and at each visit; one row per recorded visit, then one blank row per
  // month of the batch's life for the monthly visa.
  const visas = batchMonths(batch, i.today).flatMap((month) => [
    ...vetVisits.filter((v) => v.on.startsWith(month)).map((v) => ({ month, on: v.on as string | null, vetName: v.vetName, notes: v.notes })),
    { month, on: null, vetName: null, notes: null },
  ]);

  return {
    cover: {
      farmName: i.farm.name,
      address: [i.farm.commune, i.farm.province, i.farm.region].join(", "),
      onssa: i.farm.onssa,
      house: i.house?.name ?? null,
      areaM2: i.house?.areaM2 ?? null,
      species: batch.species,
      strain: i.strainName,
      hatchery: batch.hatchery,
      deliveryNote: batch.deliveryNote,
      placedOn: batch.placedOn,
      // Art. 3: the birds placed, the hatchery's free supplement included (SPEC-m3 B10); the free part shown apart.
      placed: batch.chicksPlaced + (batch.freeChicks ?? 0),
      freeChicks: batch.freeChicks ?? 0,
      deadOnArrival: batch.deadOnArrival,
      closedOn: batch.closedOn ?? null,
      // Art. 3: as entered on the farm's settings; null or none is a line the keeper fills by hand
      holder: i.farm.holder ?? null,
      vet: i.farm.vet ?? null,
      technician: i.farm.technicianName ?? null,
      chickImportApproval: i.farm.chickImportApproval ?? null,
      keepers: i.farm.registerKeepers ?? [],
    },
    // Art. 2: the supervision sheet; the vet contract is the vault's, when this phone has it.
    vetContracts: docs.filter((d) => d.category === "vetContract").map((d) => ({ title: d.title, issuedOn: d.issuedOn, expiresOn: d.expiresOn })),
    feedTypes,
    laying,
    days,
    // S6 (arrêté n° 3308-17) art. 14, S7 (n° 2466-17) art. 13: vaccine, commercial name and lot, date, number, species, age.
    vaccinations: vaccinations.map((v) => ({
      age: v.dayOfAge,
      dueOn: v.dueOn,
      product: product(v.productId),
      method: v.done?.method ?? v.method,
      done: v.done && { on: v.done.on, item: item(v.done.stockItemId)?.name ?? "—", lot: item(v.done.stockItemId)?.lot ?? null, doses: v.done.doses },
    })),
    // Art. 4: commercial name, dose, start and end of the treatment, the prescription it refers to.
    treatments: treatments.map((t) => ({
      product: item(t.stockItemId)?.name ?? "—",
      lot: item(t.stockItemId)?.lot ?? null,
      dose: t.dose,
      startOn: t.startOn,
      endOn: t.endOn,
      reason: t.reason,
      prescriber: t.prescriber,
      prescriptionRef: t.prescriptionRef ?? null,
      route: t.route ?? null,
      routeNote: t.routeNote ?? null,
      withdrawalEndsOn: t.withdrawalEndsOn,
    })),
    visas,
    // Art. 4: who the birds went to (name and address) and, when not the buyer's, the farm or establishment they went to.
    birdsOut: sold.map((s) => {
      const sale = i.sales.find((x) => x.id === s.id);
      const buyer = i.buyers.find((b) => b.id === sale?.buyerId);
      return {
        day: s.day,
        birds: s.birds,
        liveWeightGrams: s.liveWeightGrams,
        buyer: buyer?.name ?? null,
        buyerAddress: buyer?.address ?? null,
        destination: sale?.destination ?? null,
        originNumber: originNumber(s.id),
      };
    }),
    disposals: i.disposals.filter((d) => d.batchId === batch.id).sort(byDay).map((d) => ({ day: d.day, birds: d.birds, weightGrams: d.weightGrams, method: d.method, methodNote: d.methodNote })),
    labReports,
    // Art. 2, 5: the copies to file; only lab reports can already be in the vault, with their scan.
    annexes: ANNEXES.map((key) => ({
      key,
      references: key === "chickDelivery" ? [batch.deliveryNote] : key === "labReports" ? labReports.map((l) => l.title) : [],
      inVault: key === "labReports" && labReports.length > 0 && labReports.every((l) => l.fileId !== null),
    })),
  };
}

export type Register = ReturnType<typeof buildRegister>;
