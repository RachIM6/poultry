import type { FarmDay } from "@/lib/kernel/farm-day";
import { divHalfUp } from "@/lib/kernel/money";
import { assetCost } from "@/modules/finance/domain/assets";
import type { Line } from "@/modules/finance/domain/entry";
import type { Posting } from "@/modules/finance/domain/posting";
import { batchInProgressValue } from "@/modules/finance/domain/stocks";

// SPEC-finance FC6 (T114, T115; FQ7, FQ8 decided defaults): laying hens and their pullets, PCA 2015 page numbers.

export const HENS_ADULTS = "23711"; // Animaux Reproducteurs Adultes (FQ7b)
export const HENS_YOUNG = "23712"; // Animaux Reproducteurs Jeunes de Renouvellement (FQ7b)
export const HENS_IN_PROGRESS = "23962"; // Immobilisations en cours - animaux (pp. 89–90)
export const HENS_PRODUCED = "71431"; // Immobilisations corporelles agricoles produites
export const HENS_DEPRECIATION = "28371"; // Amortissements des animaux reproducteurs
export const HENS_CHARGE = "61937"; // D.E.A des Animaux (pp. 58, 124)
export const HENS_CULL_SALE = "7187"; // Produits de cessions courantes d’éléments d’actif (p. 132)
export const HENS_CULL_NBV = "6187"; // VNA des éléments d’actif cédés (cessions courantes) (p. 123, FQ8)
export const HENS_LOST_NBV = "6513"; // VNA des immobilisations corporelles cédées: a flock lost without a sale (CGNC p. 147)
export const HENS_VARIATION_ADULTS = "7151"; // Variation d’inventaire : … Adulte (p. 131)
export const HENS_VARIATION_YOUNG = "7152"; // Variation d’inventaire : … Jeunes de renouvellement (p. 131)
export const HENS_PROVISION = "2937"; // Provisions pour dépréciation des animaux immobilisés (p. 52)
export const HENS_PROVISION_CHARGE = "61943"; // D.E.P. pour dépréciation des immobilisations corporelles (6194 is subdivided, FN4)
export const HENS_PROVISION_REVERSAL = "7194"; // Reprises sur provisions pour dépréciation des immobilisations

export type HensMethod = "classic" | "simplified";

/**
 * The method the books follow, or null when the hens are not valued: a `cash_book` entity has no balance sheet, and with
 * the PCA off every hens account lands on a CGNC account with sub-accounts (FQ25), so they are listed "non valorisés".
 */
export const hensMethodOf = (profile: { books: string; overlays: readonly string[] }, method: HensMethod): HensMethod | null =>
  profile.books === "ledger" && profile.overlays.includes("pca") ? method : null;

const line = (account: string, debit: bigint, credit: bigint): Line => ({ account, debit, credit });
/** D `debit` / C `credit` for a positive amount, the other way round for a negative one; nothing for zero. */
const pair = (debit: string, credit: string, amount: bigint): Line[] =>
  amount > 0n ? [line(debit, amount, 0n), line(credit, 0n, amount)] : amount < 0n ? [line(credit, -amount, 0n), line(debit, 0n, -amount)] : [];

/**
 * Classic method, at the transfer to lay (SPEC-m3 B13): the pullets' cost not capitalised at a year end yet goes on
 * 23962 (D 23962 / C 71431), then the batch's whole cost moves to 23711 (D 23711 / C 23962, FQ7c). `total`: the pullet
 * batch's production cost at the transfer (FQ19); `capitalised`: its cost at the last year end it was open on. Null
 * when nothing.
 */
export function layPosting(total: bigint, capitalised: bigint): Posting | null {
  if (total <= 0n) return null;
  return { journal: "OD", label: "Transfert en ponte", lines: [...pair(HENS_IN_PROGRESS, HENS_PRODUCED, total - capitalised), line(HENS_ADULTS, total, 0n), line(HENS_IN_PROGRESS, 0n, total)] };
}

const monthIndex = (day: string) => Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;
const birds = (xs: readonly { birds: number }[]) => xs.reduce((n, x) => n + x.birds, 0);

/**
 * A laying flock on 23711 under the classic method. `entry`: its value on 23711; `entryDay`: the day it entered (the
 * transfer or the purchase); `lifeMonths` and `cullValue`: typed by the owner. `out`: every bird that left, by day
 * (dead, culled, sold); `sold`: the sales alone; `closedOn`: the day the last bird left, if it has.
 */
export type LayingFlock = {
  entry: bigint;
  entryDay: FarmDay;
  lifeMonths: number;
  cullValue: bigint;
  started: number;
  out: readonly { day: string; birds: number }[];
  sold: readonly { day: string; birds: number }[];
  closedOn: string | null;
};

/** A flock's fiscal year: the depreciation charged, and what left at the culls: gross, accumulated, net book value sold (6187) or lost (6513). */
export type FlockYear = { charge: bigint; gross: bigint; accumulated: bigint; sold: bigint; lost: bigint };

/**
 * FC6 classic (§7 `straightLine`, FQ8), replayed from the entry to the year's last day. Straight line over the laying
 * period, base = entry − cull value, whole months (FC1: the entry month counts, a cull month doesn't for what leaves):
 * each step charges what is left of the base × months ÷ months left, half up. A sale of n hens out of the `alive`
 * before it removes the share n ÷ alive of the gross, the accumulated and the cull value; the schedule goes on over the
 * rest. On the day the flock closes everything left leaves: net book value to 6187 when hens were sold that day, else
 * to 6513 (lost without a sale). The dead are carried by the survivors.
 */
export function flockYear(f: LayingFlock, from: FarmDay, to: FarmDay): FlockYear {
  const end = monthIndex(f.entryDay) + f.lifeMonths;
  const yearStart = monthIndex(from);
  let gross = f.entry;
  let residual = f.cullValue < f.entry ? f.cullValue : f.entry;
  let accumulated = 0n;
  let cur = monthIndex(f.entryDay);
  const y: FlockYear = { charge: 0n, gross: 0n, accumulated: 0n, sold: 0n, lost: 0n };
  const step = (until: number) => {
    const months = Math.min(until, end) - cur;
    const base = gross - residual - accumulated;
    if (months > 0 && base > 0n) {
      const charge = divHalfUp(base * BigInt(months), BigInt(end - cur));
      accumulated += charge;
      if (cur >= yearStart) y.charge += charge;
    }
    cur = Math.max(cur, until);
  };
  const advance = (until: number) => (step(Math.min(until, yearStart)), step(until)); // the part before the year isn't its charge

  const days = [...new Set([...f.sold.map((s) => s.day), ...(f.closedOn ? [f.closedOn] : [])])].filter((d) => d <= to).sort();
  for (const day of days) {
    if (gross === 0n) break;
    advance(monthIndex(day));
    const alive = f.started - birds(f.out.filter((o) => o.day < day));
    const sold = birds(f.sold.filter((s) => s.day === day));
    const last = day === f.closedOn;
    if (!last && (alive <= 0 || sold <= 0)) continue;
    const part = (x: bigint) => (last ? x : divHalfUp(x * BigInt(Math.min(sold, alive)), BigInt(alive)));
    const [g, a, r] = [part(gross), part(accumulated), part(residual)];
    gross -= g;
    accumulated -= a;
    residual -= r;
    if (day < from) continue;
    y.gross += g;
    y.accumulated += a;
    if (last && sold === 0) y.lost += g - a;
    else y.sold += g - a;
  }
  if (gross > 0n) advance(monthIndex(to) + 1);
  return y;
}

/**
 * The close run's "hens" entry, classic method: D 23962 / C 71431 for the pullets still rearing (the cost of the year,
 * `capitalised`), D 61937 / C 28371 for the flocks' charge, and the culls of the year: D 28371 (accumulated) + D 6187
 * (net book value, sold) or 6513 (lost) / C 23711 (gross). Null when nothing.
 */
export function classicYearEnd(capitalised: bigint, flocks: readonly FlockYear[]): Posting | null {
  const t = flocks.reduce((s, f) => ({ charge: s.charge + f.charge, gross: s.gross + f.gross, accumulated: s.accumulated + f.accumulated, sold: s.sold + f.sold, lost: s.lost + f.lost }), {
    charge: 0n,
    gross: 0n,
    accumulated: 0n,
    sold: 0n,
    lost: 0n,
  });
  const lines = [
    ...pair(HENS_IN_PROGRESS, HENS_PRODUCED, capitalised),
    ...pair(HENS_CHARGE, HENS_DEPRECIATION, t.charge),
    ...(t.accumulated > 0n ? [line(HENS_DEPRECIATION, t.accumulated, 0n)] : []),
    ...(t.sold > 0n ? [line(HENS_CULL_NBV, t.sold, 0n)] : []),
    ...(t.lost > 0n ? [line(HENS_LOST_NBV, t.lost, 0n)] : []),
    ...(t.gross > 0n ? [line(HENS_ADULTS, 0n, t.gross)] : []),
  ];
  return lines.length > 0 ? { journal: "OD", label: "Poules pondeuses et poulettes", lines } : null;
}

/**
 * FC6 simplified, a flock's value at the close: birds counted × entry value per bird, half up once. A laying flock's
 * entry value is its acquisition cost, or the pullets' FN13 cost at the transfer, over the birds that entered; a pullet
 * batch's is its FN13 cost to date split by head as FC4 does (p. 52).
 */
export const simplifiedValue = (species: "layer" | "pullet", entry: bigint, entered: number, onHand: number, sold: number): bigint =>
  species === "pullet" ? batchInProgressValue(entry, onHand, sold, null).cost : entry > 0n && entered > 0 && onHand > 0 ? divHalfUp(entry * BigInt(onHand), BigInt(entered)) : 0n;

/**
 * FN13's hens (§9 "Laying hens in the batch result"): what a laying flock's entry value has used up by `to`, the hens
 * being a fixed asset (PCA p. 88), never its whole price at once. With the owner's laying period and cull value (the
 * classic method's schedule): the straight-line depreciation to date and the net book value of the hens gone at a cull
 * (`flockYear` from the entry). Without one: the entry value of the birds gone (dead, culled, sold), the simplified
 * method's value of the birds left at entry value (p. 52, no depreciation, p. 89). A closed flock has used up its entry.
 */
export function hensConsumed(
  f: Omit<LayingFlock, "lifeMonths" | "cullValue"> & { onHand: number },
  schedule: { lifeMonths: number; cullValue: bigint } | null,
  to: FarmDay,
): { depreciation: bigint; removed: bigint } {
  if (!schedule) return { depreciation: 0n, removed: f.entry - simplifiedValue("layer", f.entry, f.started, f.onHand, 0) };
  const y = flockYear({ ...f, ...schedule }, f.entryDay, to);
  return { depreciation: y.charge, removed: y.sold + y.lost };
}

/** The provision for a flock below its entry value: max(0, value − current value per bird × birds counted). */
export const simplifiedProvision = (value: bigint, perBird: bigint, onHand: number): bigint => {
  const current = perBird * BigInt(onHand);
  return value > current ? value - current : 0n;
};

/**
 * The close run's "hens" entry, simplified method (p. 131): D 23711 / C 7151 for the laying flocks, D 23712 / C 7152
 * for the pullets, D 61943 / C 2937 for the provision; and the previous year's value reversed in the same run
 * ("Parallèlement"): D 7151 / C 23711, D 7152 / C 23712, and its provision D 2937 / C 7194. `previous`: the lines of
 * the previous year's "hens" entry (a classic one debits neither 23711 nor 23712 and credits no 2937). Null when nothing.
 */
export function simplifiedYearEnd(flocks: readonly { species: "layer" | "pullet"; value: bigint; provision: bigint }[], previous: readonly Line[]): Posting | null {
  const total = (species: string) => flocks.reduce((s, f) => s + (f.species === species ? f.value : 0n), 0n);
  const was = (account: string, side: "debit" | "credit") => previous.reduce((s, l) => s + (l.account === account ? l[side] : 0n), 0n);
  const lines = [
    ...pair(HENS_VARIATION_ADULTS, HENS_ADULTS, was(HENS_ADULTS, "debit")),
    ...pair(HENS_VARIATION_YOUNG, HENS_YOUNG, was(HENS_YOUNG, "debit")),
    ...pair(HENS_PROVISION, HENS_PROVISION_REVERSAL, was(HENS_PROVISION, "credit")),
    ...pair(HENS_ADULTS, HENS_VARIATION_ADULTS, total("layer")),
    ...pair(HENS_YOUNG, HENS_VARIATION_YOUNG, total("pullet")),
    ...pair(HENS_PROVISION_CHARGE, HENS_PROVISION, flocks.reduce((s, f) => s + f.provision, 0n)),
  ];
  return lines.length > 0 ? { journal: "OD", label: "Cheptel reproducteur (méthode simplifiée)", lines } : null;
}

/**
 * FC6: each batch's production cost, an accounting value (23962, the transfer to lay, the pullets' entry value): FN13's
 * cost less the VAT a registered entity recovers on the batch (CGNC: a production cost excludes recoverable taxes); an
 * entity not registered keeps FN13's cost, VAT included (FQ30).
 */
export const productionCosts = (costs: readonly { id: string; costCentimes: bigint }[], recoverableVat: ReadonlyMap<string, bigint>, vatRegistered: boolean) =>
  new Map(costs.map((c) => [c.id, assetCost(c.costCentimes, recoverableVat.get(c.id) ?? 0n, vatRegistered)]));
