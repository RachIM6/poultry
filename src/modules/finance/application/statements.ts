import { db } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { listLegalEntities } from "@/modules/farm-registry";
import { catchUp } from "@/modules/finance/application/posting";
import { trialBalance } from "@/modules/finance/domain/books";
import { countDay, countYearOf } from "@/modules/finance/domain/count";
import { fiscalYearOf, type Line } from "@/modules/finance/domain/entry";
import { eticTables, officialBilan, officialCpc, SIMPLIFIED_LIMIT_CENTIMES } from "@/modules/finance/domain/official-statements";
import { yearClose } from "@/modules/finance/infrastructure/ledger";

// SPEC-finance FC8 (T116): the official statements of a fiscal year, in the simplified model, from the posted lines.

const date = (day: string) => new Date(`${day}T00:00:00Z`);
const fiscalYear = (year: number, startMonth: number) => fiscalYearOf(countDay(year, startMonth), startMonth);
const yearIn = (y: number) => Number.isInteger(y) && y >= 2000 && y <= 2100;

/** The year's lines, the à-nouveaux (FN3's `opening:` source) apart: the ETIC's opening column. */
async function linesOf(ctx: TenantContext, legalEntityId: string, from: FarmDay, to: FarmDay) {
  const entries = await db.journalEntry.findMany({
    where: { organizationId: ctx.organizationId, legalEntityId, day: { gte: date(from), lte: date(to) } },
    include: { lines: true },
  });
  const opening: Line[] = [];
  const movements: Line[] = [];
  for (const e of entries)
    for (const l of e.lines) (e.sourceModule === "finance" && e.sourceId?.startsWith("opening:") ? opening : movements).push({ account: l.account, debit: l.debitCentimes, credit: l.creditCentimes });
  return { count: entries.length, opening, movements };
}

const statementsOf = (lines: readonly Line[], pca: boolean) => {
  const rows = trialBalance(lines).rows;
  return { bilan: officialBilan(rows, pca), cpc: officialCpc(rows, pca) };
};

export type OfficialStatements =
  | { books: "cash_book"; year: number }
  | ({
      books: "ledger";
      year: number;
      from: FarmDay;
      to: FarmDay;
      pca: boolean; // the PCA variant (overlay on)
      closedOn: FarmDay | null; // FCX6: "Projet" until then
      aboveLimit: boolean; // revenue over the simplified model's limit (FQ22): the normal model applies, out of scope
      previous: ReturnType<typeof statementsOf> | null; // N-1, when it has entries
      etic: ReturnType<typeof eticTables>;
    } & ReturnType<typeof statementsOf>);

/**
 * FC8: the bilan, CPC and computable ETIC tables of the fiscal year ending in `year` (the current one by default), with
 * N-1. A `cash_book` entity has none (FCX4). Owner, manager and the accountant read (FCX1).
 */
export async function officialStatements(ctx: TenantContext, year: number | null, clock: Clock = systemClock): Promise<Result<OfficialStatements, "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND">> {
  if (!can(ctx, "money.read")) return fail("FORBIDDEN");
  await catchUp(ctx); // §9
  const [entity] = await listLegalEntities(ctx); // ponytail: one legal entity per organisation in M1
  if (!entity) return fail("NOT_FOUND");
  const y = year ?? countYearOf(farmDayOf(clock.now()), entity.fiscalYearStartMonth);
  if (!yearIn(y)) return fail("INVALID_INPUT");
  if (entity.accountingProfile.books !== "ledger") return ok({ books: "cash_book", year: y });
  const pca = entity.accountingProfile.overlays.includes("pca");
  const { from, to } = fiscalYear(y, entity.fiscalYearStartMonth);
  const previousYear = fiscalYear(y - 1, entity.fiscalYearStartMonth);
  const [current, before, closed] = await Promise.all([
    linesOf(ctx, entity.id, from, to),
    linesOf(ctx, entity.id, previousYear.from, previousYear.to),
    yearClose(db, ctx, entity.id, to),
  ]);
  const statements = statementsOf([...current.opening, ...current.movements], pca);
  const revenue = statements.cpc.results.find((r) => r.key === "chiffreAffaires")?.amount ?? 0n;
  return ok({
    books: "ledger",
    year: y,
    from,
    to,
    pca,
    closedOn: closed && farmDayOf(closed.closedAt),
    aboveLimit: revenue > SIMPLIFIED_LIMIT_CENTIMES,
    ...statements,
    previous: before.count > 0 ? statementsOf([...before.opening, ...before.movements], pca) : null,
    etic: eticTables(trialBalance(current.opening).rows, trialBalance(current.movements).rows, pca),
  });
}
