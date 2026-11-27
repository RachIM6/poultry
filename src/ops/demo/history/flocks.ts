import { addFarmDays, type FarmDay } from "@/lib/kernel/farm-day";
import { planFor } from "@/modules/health/shared";
import { at, id } from "../kit";
import { RANK, type Actor, type Rng, type Story } from "./story";

// How the flocks of the long history live: growth, intake, mortality and lay by age, plausible for Moroccan farms in
// 2025–2026 (approximate, never a breeder's reference), and each batch's days, weighings, vaccines, treatments, vet
// rounds, sales and clean-out as the farm's members would have typed them.

/** Piecewise-linear by age, from [age, value] points. */
export const curve = (points: [number, number][]) => (age: number) => {
  if (age <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [a1, v1] = points[i];
    if (age <= a1) {
      const [a0, v0] = points[i - 1];
      return v0 + ((v1 - v0) * (age - a0)) / (a1 - a0);
    }
  }
  return points[points.length - 1][1];
};

export const BROILER = {
  grams: curve([[0, 42], [7, 175], [14, 445], [21, 880], [28, 1_400], [35, 1_960], [42, 2_480], [46, 2_720]]),
  intake: curve([[0, 12], [7, 36], [14, 72], [21, 112], [28, 150], [35, 180], [42, 202], [46, 210]]),
};
export const TURKEY = {
  grams: curve([[0, 58], [14, 290], [28, 950], [56, 3_500], [84, 7_000], [112, 10_400], [130, 12_100]]),
  intake: curve([[0, 20], [14, 60], [28, 130], [56, 250], [84, 360], [112, 455], [130, 495]]),
};
export const BELDI = {
  grams: curve([[0, 36], [30, 360], [60, 960], [90, 1_580], [115, 1_860]]),
  intake: curve([[0, 8], [30, 40], [60, 70], [90, 88], [115, 95]]),
};
export const PULLET = {
  grams: curve([[0, 38], [28, 290], [56, 720], [84, 1_080], [119, 1_460]]),
  intake: curve([[0, 10], [28, 30], [56, 50], [84, 63], [119, 76]]),
};
/** Lohmann Brown–like, by age in days: hen-day lay, egg weight, intake. */
export const LAYER = {
  lay: curve([[119, 0.02], [133, 0.45], [147, 0.82], [161, 0.91], [175, 0.935], [210, 0.94], [280, 0.91], [350, 0.87], [420, 0.82], [490, 0.765], [520, 0.74]]),
  eggGrams: curve([[126, 48], [161, 56], [210, 61], [280, 63], [350, 64.5], [420, 65.5], [520, 66.2]]),
  intake: curve([[119, 92], [147, 108], [175, 116], [210, 119], [520, 121]]),
};

const month = (day: FarmDay) => Number(day.slice(5, 7));
export const hot = (day: FarmDay) => month(day) >= 6 && month(day) <= 9;
export const cold = (day: FarmDay) => month(day) === 12 || month(day) <= 2;

/** Birds dead out of `alive` at a daily rate per thousand, with the day's spread. */
const deaths = (rng: Rng, alive: number, perMille: number) => Math.max(0, Math.round(alive * (perMille / 1000) * rng.around(1, 0.6)));

/** Feed and vaccine use, per stock item and day, for the purchases (supply.ts). */
export type Needs = Map<string, Map<FarmDay, number>>;
export const need = (needs: Needs, item: string, day: FarmDay, quantity: number) => {
  const days = needs.get(item) ?? new Map<FarmDay, number>();
  days.set(day, (days.get(day) ?? 0) + quantity);
  needs.set(item, days);
};

export type ProtocolLine = { dayOfAge: number; productId: string; method: "spray" | "drinkingWater" | "eyeDrop" | "injection" };
/** The vaccine lot in use on a day, per product (a new lot each quarter: supply.ts buys it). */
export type Lots = (productId: string, day: FarmDay, farmId: string) => string;

/** A batch's sale: by the kg (live) or by the head, to a buyer, paid one way; `share` of the birds on hand, the last takes the rest. */
export type SalePlan = { age: number; share: number; buyerId: string; method: "cash" | "transfer" | "cheque" | "credit" | "bill"; dueOn?: FarmDay };
/** What a generator tells the farm's money and paperwork about a sale. */
export type SaleDone = { saleId: string; day: FarmDay; buyerId: string; total: number; method: SalePlan["method"]; birds: number; batchId: string; instrument: { id: string; dueOn: FarmDay } | null };

export type Farmhand = {
  story: Story;
  rng: Rng;
  farmId: string;
  needs: Needs;
  lots: Lots;
  vetName: string;
  /** Who types the days of this farm's houses (the worker on the first farm, the manager on the second). */
  hand: Actor;
  /** Cheque and bill numbers: one counter per farm, so no number is used twice. */
  instrument: (kind: "cheque" | "bill") => string;
  sales: SaleDone[];
  medicine: string; // the antibiotic lot
  disinfectant: { product: string; lot: string };
};

/** Live-bird sale total, as sales' saleAmount: per kg, half up. */
const perKgTotal = (grams: number, perKg: number) => Math.floor((grams * perKg * 2 + 1000) / 2000);

type Grow = {
  batchId: string;
  houseId: string;
  placedOn: FarmDay;
  placed: number; // chicks alive after the dead on arrival
  lastAge: number; // the last day of age with an entry (the last sale's day), or today's age for an open batch
  open: boolean;
  feed: (age: number) => string;
  model: { grams: (age: number) => number; intake: (age: number) => number };
  perMille: (age: number, day: FarmDay) => number;
  perf: number; // this batch's growth against the model
  skip?: number[];
  sales: SalePlan[];
  pricePerKg?: (day: FarmDay) => number; // by the kg; else by the head (`headPrice`)
  headSale?: (day: FarmDay, birds: number) => { item: "rooster" | "hen" | "bird"; birds: number; pricePerHeadCentimes: string }[];
  weighEvery: number;
  sample: number;
  catching?: (birds: number) => number; // the crew paid in cash on a sale day, in centimes
};

/** The batch's days from placement, the weekly weighings, its sales (the last closes it). Returns the birds left. */
export function grow(f: Farmhand, g: Grow) {
  const { story, rng } = f;
  let alive = g.placed;
  const dayOf = (age: number) => addFarmDays(g.placedOn, age);
  const sales = new Map(g.sales.map((s) => [s.age, s]));
  const lastSaleAge = Math.max(...g.sales.map((s) => s.age));
  for (let age = 0; age <= g.lastAge; age++) {
    const day = dayOf(age);
    if (g.open && day === story.today) break; // today's entry is the presenter's to type
    const dead = Math.min(alive, deaths(rng, alive, g.perMille(age, day)));
    const culled = age > 6 && age % 11 === 4 ? Math.round(alive * rng.around(0.0004, 0.5)) : 0;
    alive -= dead + culled;
    const item = g.feed(age);
    const grams = Math.round(alive * g.model.intake(age) * rng.around(1, 0.03));
    const cause = dead === 0 ? null : hot(day) && age > 21 && rng.chance(0.5) ? "heat" : age < 5 ? "unknown" : rng.pick(["unknown", "unknown", "disease", "leg", "smothering"] as const);
    if (!g.skip?.includes(age)) {
      need(f.needs, item, day, grams);
      story.add(day, RANK.day, f.hand, "flock.recordDay", { batchId: g.batchId, day, changes: { dead, deathCause: cause, culled, feed: { stockItemId: item, grams }, waterMl: Math.round(grams * (hot(day) ? 2.2 : 1.8)), note: null } });
    } else alive += dead + culled; // nothing typed that day
    if (age > 0 && age % g.weighEvery === 0 && age < g.lastAge) {
      const avg = Math.round(g.model.grams(age) * g.perf * rng.around(1, 0.03));
      story.add(day, RANK.day, f.hand, "flock.recordWeighing", { id: id(), batchId: g.batchId, day, sample: { totalGrams: avg * g.sample, count: g.sample } });
    }
    if (age % 7 === 6 && age > 0) disposal(f, g.batchId, day, Math.round(g.placed * 0.004 * rng.around(1, 0.5)), g.model.grams(age) * g.perf);
    const plan = sales.get(age);
    if (plan && day < story.today) {
      const birds = age === lastSaleAge ? alive : Math.round(alive * plan.share);
      sell(f, g, plan, day, birds, Math.round(g.model.grams(age) * g.perf));
      alive -= birds;
    }
  }
  return alive;
}

function sell(f: Farmhand, g: Grow, plan: SalePlan, day: FarmDay, birds: number, avg: number) {
  const saleId = id();
  const farmWeightGrams = birds * avg;
  let total: number;
  let payload: object;
  const instrument = plan.method === "cheque" || plan.method === "bill" ? f.instrument(plan.method) : null;
  const paper = instrument && { number: instrument, dueOn: plan.dueOn ?? addFarmDays(day, plan.method === "bill" ? 30 : f.rng.int(0, 10)) };
  if (g.pricePerKg) {
    const perKg = g.pricePerKg(day);
    total = perKgTotal(farmWeightGrams, perKg);
    payload = { id: saleId, batchId: g.batchId, buyerId: plan.buyerId, day, birds, farmWeightGrams, buyerWeightGrams: farmWeightGrams - birds * 15, pricePerKgCentimes: String(perKg), paymentMethod: plan.method, paidCentimes: plan.method === "credit" ? "0" : String(total), instrument: paper };
    f.story.add(day, RANK.sale, "manager", "sales.recordSale", payload, plan.method === "cash" ? { cash: total } : plan.method === "transfer" ? { bank: total } : undefined);
  } else {
    const lines = g.headSale!(day, birds);
    total = lines.reduce((s, l) => s + l.birds * Number(l.pricePerHeadCentimes), 0);
    payload = { id: saleId, batchId: g.batchId, buyerId: plan.buyerId, day, lines, farmWeightGrams, paymentMethod: plan.method, paidCentimes: plan.method === "credit" ? "0" : String(total), instrument: paper };
    f.story.add(day, RANK.sale, "manager", "sales.recordHeadSale", payload, plan.method === "cash" ? { cash: total } : plan.method === "transfer" ? { bank: total } : undefined);
  }
  if (g.catching) {
    const crew = g.catching(birds);
    f.story.add(day, RANK.money, "manager", "finance.recordExpense", { id: id(), day, category: "catching", amountCentimes: String(crew), paidFrom: "cash", treasuryId: null, note: "Équipe de ramassage et chargement", batchId: g.batchId }, { cash: -crew });
  }
  f.story.add(day, RANK.sale, f.hand, "biosecurity.recordVisit", { id: id(), farmId: f.farmId, enteredAt: at(day, "05:30"), visitor: "Chauffeur de l'acheteur", vehicle: plate(f.rng), purpose: "buyer", recentFarm: f.rng.chance(0.3), wheelsDisinfected: true, footbath: true, farmClothing: false, zone: "dirty" });
  f.sales.push({ saleId, day, buyerId: plan.buyerId, total, method: plan.method, birds, batchId: g.batchId, instrument: paper ? { id: saleId, dueOn: paper.dueOn } : null });
}

/** The week's dead birds, out to the sealed pit. */
function disposal(f: Farmhand, batchId: string, day: FarmDay, birds: number, grams: number) {
  if (birds > 0) f.story.add(day, RANK.close, f.hand, "biosecurity.recordDisposal", { id: id(), farmId: f.farmId, day, batchId, birds, weightGrams: Math.round(birds * grams * 0.8), method: "sealedPit", methodNote: null });
}

/** A Moroccan plate, made up: 12345-A-6. */
export const plate = (rng: Rng) => `${rng.int(10_000, 99_999)}-${rng.pick(["A", "B", "D", "H", "W"])}-${rng.int(1, 60)}`;

/** The batch's vaccination plan from the farmer's programme, each line given on its day with the lot then in use. */
export function vaccinate(f: Farmhand, batchId: string, placedOn: FarmDay, protocolId: string, programme: ProtocolLine[], birds: number, ageAtPlacementDays = 0, until = f.story.today, planRank: number = RANK.place) {
  f.story.add(placedOn, planRank, "manager", "health.planVaccinations", { batchId, protocolId, items: programme });
  for (const v of planFor(batchId, placedOn, programme, ageAtPlacementDays)) {
    if (v.dueOn > until || v.dueOn < placedOn) continue;
    const lot = f.lots(v.productId, v.dueOn as FarmDay, f.farmId);
    need(f.needs, lot, v.dueOn as FarmDay, birds);
    f.story.add(v.dueOn as FarmDay, RANK.care, f.hand, "health.recordVaccination", { id: v.id, on: v.dueOn, stockItemId: lot, doses: birds, method: v.method });
  }
}

/** The vet's rounds on these ages (at least monthly), signed in the register. */
export function rounds(f: Farmhand, batchId: string, placedOn: FarmDay, ages: number[], notes: (age: number) => string) {
  for (const age of ages) {
    const day = addFarmDays(placedOn, age);
    if (f.story.add(day, RANK.care, "vet", "health.recordVetVisit", { id: id(), batchId, on: day, vetName: f.vetName, notes: notes(age) }))
      f.story.add(day, RANK.care, f.hand, "biosecurity.recordVisit", { id: id(), farmId: f.farmId, enteredAt: at(day, "10:00"), visitor: f.vetName, vehicle: null, purpose: "vet", recentFarm: false, wheelsDisinfected: true, footbath: true, farmClothing: true, zone: "clean" });
  }
}

/** A prescribed treatment over `days` from `startAge`, with the prescription's withdrawal. */
export function treat(f: Farmhand, batchId: string, placedOn: FarmDay, startAge: number, days: number, withdrawalDays: number, ml: number, reason: string, ref: string, eggWithdrawalDays: number | null = null) {
  const startOn = addFarmDays(placedOn, startAge);
  need(f.needs, f.medicine, startOn, ml);
  f.story.add(startOn, RANK.care, "vet", "health.recordVetVisit", { id: id(), batchId, on: startOn, vetName: f.vetName, notes: `${reason} : examen de quelques sujets, traitement prescrit (ordonnance ${ref}).` });
  f.story.add(startOn, RANK.care, f.hand, "health.recordTreatment", {
    id: id(), batchId, stockItemId: f.medicine, quantity: ml, dose: "1 ml par litre d'eau de boisson", startOn, endOn: addFarmDays(startOn, days - 1),
    reason, prescriber: f.vetName, withdrawalDays, eggWithdrawalDays, route: "drinkingWater", prescriptionRef: ref,
  });
}

/** After the last sale: the clean-out steps over a week, the manure out, a rodent check, the litter spread before the next placement. */
export function cleanout(f: Farmhand, houseId: string, batchId: string, closedOn: FarmDay, nextOn: FarmDay | null, manureKg: number, upTo = 7) {
  const cleanoutId = id();
  const d = (n: number) => addFarmDays(closedOn, n);
  if (!f.story.add(d(1), RANK.close, f.hand, "biosecurity.startCleanout", { id: cleanoutId, houseId, afterBatchId: batchId, startedOn: d(1) })) return;
  const steps = [["manureOut", 1, null], ["equipmentWashed", 2, null], ["pressureWash", 3, null], ["disinfection", 5, f.disinfectant], ["rodentControl", 6, { product: "Appât raticide en blocs", lot: null }], ["waterFlush", 7, null]] as const;
  for (const [step, n, product] of steps.filter(([, n]) => n <= upTo))
    f.story.add(d(n), RANK.close, f.hand, "biosecurity.recordCleanoutStep", { id: id(), cleanoutId, step, day: d(n), product: product?.product ?? null, dose: step === "disinfection" ? "1 litre pour 200 litres d'eau, 0,3 l/m²" : null, productLot: product?.lot ?? null, note: null });
  if (nextOn && upTo >= 7) f.story.add(addFarmDays(nextOn, -2), RANK.close, f.hand, "biosecurity.recordCleanoutStep", { id: id(), cleanoutId, step: "litterPreheat", day: addFarmDays(nextOn, -2), product: null, dose: null, productLot: null, note: "Litière neuve étalée, chauffage allumé la veille de l'arrivée" });
  const spread = f.rng.chance(0.3); // on the farm's own fields, 500 m and more from the houses (CQ4)
  f.story.add(d(1), RANK.close, f.hand, "biosecurity.recordManure", { id: id(), farmId: f.farmId, day: d(1), houseId, batchId, quantityKg: manureKg, destination: spread ? "spread" : "sold", recipient: spread ? null : f.rng.pick(["Agriculteur voisin, maraîchage", "Coopérative agricole locale", "Exploitation céréalière voisine"]), ...(spread && { spreadDeclared: true }) });
}
