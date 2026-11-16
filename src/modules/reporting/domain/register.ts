import type { FarmDay } from "@/lib/kernel/farm-day";
import type { DisposalDto } from "@/modules/biosecurity/shared";
import type { DocumentDto } from "@/modules/documents/shared";
import { ageOn, type BatchDto, type DailyEntryDto, type SoldBirdsDto } from "@/modules/flock/shared";
import type { TreatmentDto, VaccinationDto, VetVisitDto } from "@/modules/health/shared";
import { originNumber, type SaleDto } from "@/modules/sales/shared";

// SPEC-m2-compliance RP1: the health monitoring register of one batch (law 49-99 art. 3), from the records the phone
// already holds (SPEC H6). Pure: the page lays it out; the layout waits for ONSSA's official template (CQ1), the
// contents are those NEEDS-ANALYSIS §4 lists. No money field is ever read into the output.

/** What the register needs, in the DTO shapes the phone stores. Farm, house and catalogue names come from modules
 * `reporting` doesn't depend on, so they are plain fields here. */
export type RegisterInput = {
  farm: { name: string; commune: string; province: string; region: string; onssa: { number: string; expiresOn: string } | null };
  house: { name: string; areaM2: number } | null;
  strainName: string;
  batch: BatchDto;
  dailyEntries: DailyEntryDto[];
  vaccinations: VaccinationDto[];
  treatments: TreatmentDto[];
  vetVisits: VetVisitDto[];
  soldBirds: SoldBirdsDto[];
  sales: SaleDto[]; // none on a worker's phone
  buyers: { id: string; name: string }[];
  disposals: DisposalDto[];
  labReports: DocumentDto[];
  products: { id: string; name: string }[]; // catalogue names in the page's language
  stockItems: { id: string; name: string; lot: string | null }[];
};

const byDay = <T extends { day: string }>(x: T, y: T) => x.day.localeCompare(y.day);

export function buildRegister(i: RegisterInput) {
  const { batch } = i;
  const of = (b: { batchId: string }) => b.batchId === batch.id;
  const age = (day: string) => ageOn(batch.placedOn as FarmDay, day as FarmDay);
  const item = (id: string) => i.stockItems.find((s) => s.id === id);
  const treatments = i.treatments.filter(of).sort((x, y) => x.startOn.localeCompare(y.startOn));
  const sold = i.soldBirds.filter(of).sort(byDay);

  let onHand = batch.chicksPlaced - batch.deadOnArrival;
  const days = i.dailyEntries
    .filter(of)
    .sort(byDay)
    .map((e) => {
      const out = sold.filter((s) => s.day === e.day).reduce((n, s) => n + s.birds, 0);
      onHand -= e.dead + e.culled + out;
      return {
        day: e.day,
        age: age(e.day),
        onHand,
        dead: e.dead,
        culled: e.culled,
        cause: e.deathCause,
        feedGrams: e.feed?.grams ?? null,
        waterMl: e.waterMl,
        out,
        treatments: treatments.filter((t) => t.startOn <= e.day && e.day <= t.endOn).map((t) => item(t.stockItemId)?.name ?? "—"),
        withdrawal: treatments.some((t) => t.startOn <= e.day && e.day <= t.withdrawalEndsOn),
      };
    });

  const end = batch.closedOn ?? "9999-12-31";
  return {
    cover: {
      farmName: i.farm.name,
      address: [i.farm.commune, i.farm.province, i.farm.region].join(", "),
      onssa: i.farm.onssa,
      house: i.house?.name ?? null,
      areaM2: i.house?.areaM2 ?? null,
      strain: i.strainName,
      hatchery: batch.hatchery,
      deliveryNote: batch.deliveryNote,
      placedOn: batch.placedOn,
      chicksPlaced: batch.chicksPlaced,
      deadOnArrival: batch.deadOnArrival,
      closedOn: batch.closedOn ?? null,
    },
    days,
    vaccinations: i.vaccinations
      .filter(of)
      .sort((x, y) => x.dueOn.localeCompare(y.dueOn))
      .map((v) => ({
        age: v.dayOfAge,
        dueOn: v.dueOn,
        product: i.products.find((p) => p.id === v.productId)?.name ?? v.productId,
        method: v.done?.method ?? v.method,
        done: v.done && { on: v.done.on, item: item(v.done.stockItemId)?.name ?? "—", lot: item(v.done.stockItemId)?.lot ?? null, doses: v.done.doses },
      })),
    treatments: treatments.map((t) => ({
      product: item(t.stockItemId)?.name ?? "—",
      lot: item(t.stockItemId)?.lot ?? null,
      dose: t.dose,
      startOn: t.startOn,
      endOn: t.endOn,
      ageFrom: age(t.startOn),
      ageTo: age(t.endOn),
      reason: t.reason,
      prescriber: t.prescriber,
      withdrawalEndsOn: t.withdrawalEndsOn,
    })),
    vetVisits: i.vetVisits.filter(of).sort((x, y) => x.on.localeCompare(y.on)).map((v) => ({ on: v.on, vetName: v.vetName, notes: v.notes })),
    birdsOut: sold.map((s) => {
      const buyerId = i.sales.find((x) => x.id === s.id)?.buyerId;
      return { day: s.day, birds: s.birds, liveWeightGrams: s.liveWeightGrams, buyer: i.buyers.find((b) => b.id === buyerId)?.name ?? null, originNumber: originNumber(s.id) };
    }),
    disposals: i.disposals.filter((d) => d.batchId === batch.id).sort(byDay).map((d) => ({ day: d.day, birds: d.birds, weightGrams: d.weightGrams, method: d.method, methodNote: d.methodNote })),
    labReports: i.labReports
      .filter((d) => d.category === "labReport" && (d.farmId === null || d.farmId === batch.farmId) && d.issuedOn !== null && batch.placedOn <= d.issuedOn && d.issuedOn <= end)
      .map((d) => ({ title: d.title, issuedOn: d.issuedOn, fileId: d.fileId })),
  };
}

export type Register = ReturnType<typeof buildRegister>;
