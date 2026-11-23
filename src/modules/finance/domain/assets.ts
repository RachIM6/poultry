import type { FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { fiscalYearOf } from "@/modules/finance/domain/entry";
import type { Journal, Posting } from "@/modules/finance/domain/posting";

// SPEC-finance FC1 (T102), pure: the fixed-asset register's rules and the straight-line schedule.

/**
 * FC1 "Fixed-asset categories, default": each category's asset account (PCA; `inChart` lands it on the CGNC fallback
 * with the PCA off) and its depreciation account. Land has none: it is never depreciated. The CGNC subdivides 2332,
 * 2832, 2833 and 2835 (scan pp. 266, 271–272), so each category posts to the leaf of its kind (FN4); 2834 has none.
 */
export const ASSET_ACCOUNTS = {
  land: { asset: "23111", depreciation: null }, // Terrains nus d'exploitation
  prepared_land: { asset: "23121", depreciation: null }, // Terrains aménagés d'exploitation
  building: { asset: "23211", depreciation: "28321" }, // Bâtiments d'exploitation, poultry houses included / … des bâtiments
  building_on_other_land: { asset: "23231", depreciation: "28323" }, // Constructions sur terrains d'autrui d'exploitation
  installation: { asset: "233111", depreciation: "28331" }, // Installations techniques Agricoles sur sol propre
  installation_on_other_land: { asset: "233112", depreciation: "28331" }, // ... sur terrain d'autrui
  equipment: { asset: "23321", depreciation: "28332" }, // Matériel: movable equipment (23324 Outillage has no category yet)
  transport: { asset: "2340", depreciation: "2834" }, // Matériel de transport
  office_furniture: { asset: "2351", depreciation: "28351" }, // Mobilier de bureau
  office_equipment: { asset: "2352", depreciation: "28352" }, // Matériel de bureau
  computer: { asset: "2355", depreciation: "28355" }, // Matériel informatique
  other_furniture: { asset: "2358", depreciation: "28358" }, // Autres mobilier, matériel de bureau et aménagements divers
} as const satisfies Record<string, { asset: string; depreciation: string | null }>;
export type AssetCategory = keyof typeof ASSET_ACCOUNTS;
export const ASSET_CATEGORIES = Object.keys(ASSET_ACCOUNTS) as AssetCategory[];
export const isAssetCategory = (c: string): c is AssetCategory => Object.hasOwn(ASSET_ACCOUNTS, c);

type DepreciationAccount = NonNullable<(typeof ASSET_ACCOUNTS)[AssetCategory]["depreciation"]>;
/**
 * FC1: the charge account of each depreciation account, paired as the CGNC pairs 6193x with 283x (6193 is subdivided,
 * so a line goes on its sub-account, FN4; CGNC Tome I scan p. 296). 2838 → 61938 "autres" has no category yet.
 */
export const DEPRECIATION_CHARGES = {
  "28321": "61932", // D.E.A. des constructions
  "28323": "61932",
  "28331": "61933", // D.E.A. des installations techniques, matériel et outillage
  "28332": "61933",
  "2834": "61934", // D.E.A. du matériel de transport
  "28351": "61935", // D.E.A. des mobilier, matériel de bureau et aménagements divers
  "28352": "61935",
  "28355": "61935",
  "28358": "61935",
} as const satisfies Record<DepreciationAccount, string>;
export const ASSET_VAT_RECOVERABLE = "34551"; // État – TVA récupérable sur immobilisations (3455 is subdivided, FN4; CGNC scan p. 279)
export const NET_BOOK_VALUE_DISPOSED = "6513"; // VNA des immobilisations corporelles cédées
export const DISPOSAL_PROCEEDS = "7513"; // Produits des cessions des immobilisations corporelles
export const ASSET_DEBTS = "4481"; // Dettes sur acquisition d'immobilisations (FQ23: 1486 is the other reading)

/** How an asset was paid (FC1). An issued cheque leaves the bank on its issue day, the acquisition's. */
export const ASSET_PAID_WITH = ["cash", "transfer", "cheque", "credit"] as const;
export type AssetPaidWith = (typeof ASSET_PAID_WITH)[number];
const PAID: Record<AssetPaidWith, { account: string; journal: Journal }> = {
  cash: { account: "5161", journal: "CA" },
  transfer: { account: "5141", journal: "BQ" },
  cheque: { account: "5141", journal: "BQ" },
  credit: { account: ASSET_DEBTS, journal: "OD" },
};
/** The treasury account kind each method moves money through: a cash box for cash, a bank account otherwise. */
export const treasuryKindOf = (method: Exclude<AssetPaidWith, "credit"> | "bank"): "cash" | "bank" => (method === "cash" ? "cash" : "bank");

/** What the depreciation needs. `opening`: an asset bought before Dawra, with its accumulated depreciation on that day. */
export type DepreciableAsset = {
  cost: bigint;
  residual: bigint;
  lifeMonths: number | null; // null: land
  inServiceOn: FarmDay;
  disposedOn: FarmDay | null;
  opening: { on: FarmDay; accumulated: bigint } | null;
};

/** One fiscal year of the schedule. `toDisposal`: the year of the disposal, whose charge the disposal posts (T103 skips it). */
export type ScheduleYear = { from: FarmDay; to: FarmDay; months: number; charge: bigint; accumulated: bigint; netBookValue: bigint; toDisposal: boolean };

const monthIndex = (day: FarmDay) => Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;
const firstDayOf = (index: number) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01` as FarmDay;
/** n ÷ d rounded half up, for n ≥ 0 and d > 0 (§7.1: "half up rounds a positive amount to the nearest centime"). */
const halfUp = (n: bigint, d: bigint) => (2n * n + d) / (2n * d);

/**
 * FC1, FQ9 default: whole months, the in-service month counts in full, the disposal month doesn't. Months are counted
 * from `start` (the in-service month, or the opening month for an asset in the opening balance), never beyond the life
 * left. The accumulated depreciation at the start of month `index` is opening + cumulative(m), with
 * cumulative(m) = base × min(m, life) ÷ life rounded half up once per figure, so the charges add up to the base.
 */
function depreciation(a: DepreciableAsset) {
  if (a.lifeMonths === null) return null;
  const inService = monthIndex(a.inServiceOn);
  const start = a.opening ? Math.max(inService, monthIndex(a.opening.on)) : inService;
  const life = a.lifeMonths - (start - inService); // the months left
  const already = a.opening?.accumulated ?? 0n;
  const base = a.cost - a.residual - already; // what is left to spread
  const end = a.disposedOn ? monthIndex(a.disposedOn) : Infinity; // the disposal month is excluded
  const used = (index: number) => Math.min(Math.max(0, Math.min(index, end) - start), Math.max(life, 0));
  const accumulatedAt = (index: number) => already + (life > 0 ? halfUp(base * BigInt(used(index)), BigInt(life)) : 0n);
  return { start, life, end, used, accumulatedAt };
}

/** FC1, §7 `straightLine`: the schedule by fiscal year (charge, accumulated, net book value). Land: none. */
export function straightLine(a: DepreciableAsset, fiscalYearStartMonth: number): ScheduleYear[] {
  const d = depreciation(a);
  if (!d || d.life <= 0) return [];
  const rows: ScheduleYear[] = [];
  for (let year = fiscalYearOf(firstDayOf(d.start), fiscalYearStartMonth); ; ) {
    const [from, to] = [monthIndex(year.from), monthIndex(year.to) + 1];
    const months = d.used(to) - d.used(from);
    if (months === 0) return rows; // the life is over, or the asset left: the months used are contiguous
    const accumulated = d.accumulatedAt(to);
    rows.push({
      ...year,
      months,
      charge: accumulated - d.accumulatedAt(from),
      accumulated,
      netBookValue: a.cost - accumulated,
      toDisposal: a.disposedOn !== null && year.from <= a.disposedOn && a.disposedOn <= year.to,
    });
    year = fiscalYearOf(firstDayOf(to), fiscalYearStartMonth);
  }
}

/**
 * FC1 year-end posting (the close run, T103): each asset's straight-line charge for the fiscal year starting on
 * `yearFrom`, D each charge account (61932–61935) / C each depreciation account (283xx), one line per account. The
 * disposal year is left out: the disposal posted its months (`toDisposal`). Null when there is nothing to post.
 */
export function yearEndDepreciation(assets: readonly (DepreciableAsset & { category: AssetCategory })[], yearFrom: FarmDay, fiscalYearStartMonth: number): Posting | null {
  const byAccount = new Map<DepreciationAccount, bigint>();
  for (const a of assets) {
    const account = ASSET_ACCOUNTS[a.category].depreciation;
    const year = straightLine(a, fiscalYearStartMonth).find((y) => y.from === yearFrom);
    if (account && year && !year.toDisposal && year.charge > 0n) byAccount.set(account, (byAccount.get(account) ?? 0n) + year.charge);
  }
  const shares = [...byAccount].sort(([a], [b]) => a.localeCompare(b));
  if (shares.length === 0) return null; // every charge kept is above zero
  const charges = new Map<string, bigint>(); // two depreciation leaves can share a charge account (28321, 28323 → 61932)
  for (const [account, amount] of shares) charges.set(DEPRECIATION_CHARGES[account], (charges.get(DEPRECIATION_CHARGES[account]) ?? 0n) + amount);
  return {
    journal: "OD",
    label: "Dotations aux amortissements de l’exercice",
    lines: [...[...charges].map(([account, debit]) => ({ account, debit, credit: 0n })), ...shares.map(([account, credit]) => ({ account, debit: 0n, credit }))],
  };
}

export type AssetError =
  | "INVALID_INPUT"
  | "LIFE_REQUIRED"
  | "LAND_NOT_DEPRECIATED"
  | "IN_SERVICE_BEFORE_ACQUISITION"
  | "VAT_MORE_THAN_AMOUNT"
  | "RESIDUAL_ABOVE_COST"
  | "ACCUMULATED_ABOVE_BASE"
  | "OPENING_LIFE_OVER";

/** FN9: the VAT stays out of the cost when the entity is VAT-registered (it goes to 34551), else it is part of it. */
export const assetCost = (amount: bigint, vat: bigint, vatRegistered: boolean) => (vatRegistered ? amount - vat : amount);

/**
 * FC1: the life is required, above zero and typed by the user (never prefilled); land has none. The residual value
 * stays within the cost; an asset in the opening balance has at most its base depreciated, and life left to spread
 * the rest over.
 */
export function checkAsset(a: DepreciableAsset & { category: string; acquiredOn: FarmDay; amount: bigint; vat: bigint }): Result<void, AssetError> {
  if (!isAssetCategory(a.category)) return fail("INVALID_INPUT");
  const land = ASSET_ACCOUNTS[a.category].depreciation === null;
  if (land && a.lifeMonths !== null) return fail("LAND_NOT_DEPRECIATED");
  if (!land && !(a.lifeMonths !== null && a.lifeMonths > 0)) return fail("LIFE_REQUIRED");
  if (a.inServiceOn < a.acquiredOn) return fail("IN_SERVICE_BEFORE_ACQUISITION");
  if (a.vat > a.amount) return fail("VAT_MORE_THAN_AMOUNT");
  if (a.residual > a.cost) return fail("RESIDUAL_ABOVE_COST");
  const already = a.opening?.accumulated ?? 0n;
  if (already > (land ? 0n : a.cost - a.residual)) return fail("ACCUMULATED_ABOVE_BASE");
  const d = depreciation(a);
  if (d && d.life <= 0 && already < a.cost - a.residual) return fail("OPENING_LIFE_OVER");
  return ok(undefined);
}

type Registered = { category: AssetCategory; label: string; cost: bigint; amount: bigint };

/** FC1 acquisition: D the asset account (+ D 34551 for a registered entity's VAT) / C 5161, 5141 or 4481. */
export function acquisitionPosting(a: Registered & { paidWith: AssetPaidWith; treasuryId: string | null }): Posting {
  const paid = PAID[a.paidWith];
  const vat = a.amount - a.cost;
  return {
    journal: paid.journal,
    label: `Acquisition : ${a.label}`,
    lines: [
      { account: ASSET_ACCOUNTS[a.category].asset, debit: a.cost, credit: 0n },
      ...(vat > 0n ? [{ account: ASSET_VAT_RECOVERABLE, debit: vat, credit: 0n }] : []),
      { account: paid.account, debit: 0n, credit: a.amount, treasuryId: a.paidWith === "credit" ? null : a.treasuryId },
    ],
  };
}

/** FC1: a later payment of an asset bought on credit, D 4481 / C 5161 or 5141. */
export function assetPaymentPosting(label: string, amount: bigint, paidWith: Exclude<AssetPaidWith, "credit">, treasuryId: string | null): Posting {
  const paid = PAID[paidWith];
  return { journal: paid.journal, label: `Paiement : ${label}`, lines: [{ account: ASSET_DEBTS, debit: amount, credit: 0n }, { account: paid.account, debit: 0n, credit: amount, treasuryId }] };
}

/**
 * FC1 disposal, on its day (OD), in this order: the depreciation of the fiscal year up to the disposal month
 * (D 6193x / C 283x), the asset leaving (D 283x accumulated, D 6513 net book value / C the asset account, its cost),
 * and the price (D 5161 / 5141 / C 7513). A part with nothing to post is left out; each keeps its place (source version).
 */
export function disposalPostings(
  a: Registered & DepreciableAsset & { disposedOn: FarmDay },
  price: bigint,
  receivedIn: "cash" | "bank",
  treasuryId: string | null,
  fiscalYearStartMonth: number,
): { version: number; posting: Posting }[] {
  const { asset, depreciation: depreciationAccount } = ASSET_ACCOUNTS[a.category];
  const d = depreciation(a);
  const yearStart = monthIndex(fiscalYearOf(a.disposedOn, fiscalYearStartMonth).from);
  const accumulated = d ? d.accumulatedAt(monthIndex(a.disposedOn)) : 0n;
  const charge = d ? accumulated - d.accumulatedAt(yearStart) : 0n;
  const out: { version: number; posting: Posting }[] = [];
  if (charge > 0n && depreciationAccount) {
    const lines = [{ account: DEPRECIATION_CHARGES[depreciationAccount], debit: charge, credit: 0n }, { account: depreciationAccount, debit: 0n, credit: charge }];
    out.push({ version: 1, posting: { journal: "OD", label: `Dotation aux amortissements : ${a.label}`, lines } });
  }
  out.push({
    version: 2,
    posting: {
      journal: "OD",
      label: `Cession : ${a.label}`,
      lines: [
        ...(accumulated > 0n && depreciationAccount ? [{ account: depreciationAccount, debit: accumulated, credit: 0n }] : []),
        ...(a.cost > accumulated ? [{ account: NET_BOOK_VALUE_DISPOSED, debit: a.cost - accumulated, credit: 0n }] : []),
        { account: asset, debit: 0n, credit: a.cost },
      ],
    },
  });
  if (price > 0n) {
    const lines = [{ account: PAID[receivedIn === "cash" ? "cash" : "transfer"].account, debit: price, credit: 0n, treasuryId }, { account: DISPOSAL_PROCEEDS, debit: 0n, credit: price }];
    out.push({ version: 3, posting: { journal: "OD", label: `Prix de cession : ${a.label}`, lines } });
  }
  return out;
}
