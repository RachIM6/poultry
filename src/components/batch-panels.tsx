"use client";

import { useLocale, useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import type { ComponentProps, MouseEventHandler, ReactNode } from "react";
import { BatchDashboard, BatchNotes } from "@/components/batch-dashboard";
import type { Write } from "@/components/daily-entry";
import { Tabs } from "@/components/tabs";
import { Treatments, VetVisits } from "@/components/treatments";
import { card, link } from "@/components/ui";
import { Weighings } from "@/components/weighing";
import { formatDay } from "@/lib/format";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import type { CleanoutDto } from "@/modules/biosecurity/shared";
import type { EggCollectionDto } from "@/modules/eggs/shared";
import type { FarmDto, HouseDto } from "@/modules/farm-registry/schema";
import { canJoinHouse, type BatchCostDto, type BatchDto, type DailyEntryDto, type SoldBirdsDto, type WeighingDto } from "@/modules/flock/shared";
import type { TreatmentDto, VaccinationDto, VetVisitDto } from "@/modules/health/shared";
import type { StockItemDto } from "@/modules/inventory/shared";
import type { ProtocolDto, ReferenceData } from "@/modules/reference-data/schema";
import type { BuyerDto, SaleDto } from "@/modules/sales/shared";
import type { groupRecords } from "@/offline/group";

// tasks/plan-ui-cleanup.md batch 1: everything of a batch's screen but the day's entry, behind one lazy import of
// batches.tsx, so /batches' first load stays within its budget (SPEC §9.3): the tab bars, the card and alerts above the
// tabs, the day's other sections, and every other tab. The tabs' own sections load their chunks in turn; the service
// worker precaches them all, so they open offline too.
export { BatchNotes, OpenBatchCard } from "@/components/batch-dashboard";
export { EggCollections } from "@/components/eggs";
export { RegisterLinks } from "@/components/register-links";
export { WithdrawalBanner } from "@/components/treatments";
export { TurkeySexes } from "@/components/turkey-sexes";
export { Weighings } from "@/components/weighing";
const LayerDashboard = dynamic(() => import("@/components/layer-dashboard").then((m) => m.LayerDashboard));
const Vaccinations = dynamic(() => import("@/components/vaccinations").then((m) => m.Vaccinations));
const NotifiableDiseases = dynamic(() => import("@/components/notifiable-diseases").then((m) => m.NotifiableDiseases));
const Sales = dynamic(() => import("@/components/sales").then((m) => m.Sales));
const BatchCosts = dynamic(() => import("@/components/closing").then((m) => m.BatchCosts));
const ClosedSummary = dynamic(() => import("@/components/closing").then((m) => m.ClosedSummary));
const CloseBatchForm = dynamic(() => import("@/components/closing").then((m) => m.CloseBatchForm));
const TransferForm = dynamic(() => import("@/components/closing").then((m) => m.TransferForm));
const CorrectPlacement = dynamic(() => import("@/components/correct-placement").then((m) => m.CorrectPlacement));
const ReopenBatchForm = dynamic(() => import("@/components/reopen-batch").then((m) => m.ReopenBatchForm)); // SPEC B6 "Reopening"

// WebBatch.dc.html: on wide screens a tab's sections sit in two columns; one column on the phone (as batches.tsx).
const lower = "flex flex-col gap-5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-6 lg:gap-y-8";

/** The tabs of the list or of a batch; `follow` opens a tab in place (batches.tsx). */
export function TabBar({ follow, ...tabs }: ComponentProps<typeof Tabs> & { follow: MouseEventHandler }) {
  return (
    <div onClickCapture={follow}>
      <Tabs {...tabs} />
    </div>
  );
}

/** The list's « Clôturées » tab: one line per closed batch, with its « Voir le bilan » (opened in place by `follow`). */
export function ClosedBatches({ label, rows, follow }: { label: string; rows: { href: string; name: ReactNode; kind: ReactNode; closedOn: string }[]; follow: MouseEventHandler }) {
  const t = useTranslations("Closing");
  const locale = useLocale();
  return (
    <ul className={`${card} gap-0 py-1`} aria-label={label}>
      {rows.map((r) => (
        <li key={r.href} className="flex flex-wrap items-center justify-between gap-x-4 border-line py-2 not-first:border-t">
          <span className="flex min-w-0 flex-col">
            <span className="font-semibold">{r.name}</span>
            <span className="text-sm text-ink-2">
              {r.kind} · {t("closedOn", { date: formatDay(r.closedOn as FarmDay, locale) })}
            </span>
          </span>
          <a href={r.href} onClick={follow} className={link}>{t("open")}</a>
        </li>
      ))}
    </ul>
  );
}

/** A batch's tab other than the day's entry: Santé, Ventes, Indicateurs, Gestion; Bilan and Ventes once it is closed. */
export function BatchPanel({
  tab,
  batch,
  batches,
  houses,
  farms,
  strains,
  products,
  title,
  onHand,
  farming,
  scope,
  records: { of, ofBatch },
  write,
}: {
  tab: string;
  batch: BatchDto;
  batches: BatchDto[];
  houses: HouseDto[];
  farms: Map<string, FarmDto>;
  strains: ReferenceData["strains"];
  products: ReferenceData["products"];
  title: string; // the batch's full name, for the correction's button (SPEC X4)
  onHand: number;
  farming: boolean; // SPEC-m5 §5: the accountant's phone holds no daily entry
  scope: TenantContext & { userId: string };
  records: ReturnType<typeof groupRecords>;
  write: Write;
}) {
  const t = useTranslations();
  const entries = ofBatch<DailyEntryDto>("dailyEntry", batch.id);
  const sold = ofBatch<SoldBirdsDto>("soldBirds", batch.id);
  const weighings = ofBatch<WeighingDto>("weighing", batch.id);
  const vaccinations = ofBatch<VaccinationDto>("vaccination", batch.id);
  const treatments = ofBatch<TreatmentDto>("treatment", batch.id);
  const visits = ofBatch<VetVisitDto>("vetVisit", batch.id);
  const costs = ofBatch<BatchCostDto>("batchCost", batch.id);
  const items = (kind: StockItemDto["kind"]) => of<StockItemDto>("stockItem").filter((i) => i.farmId === batch.farmId && i.kind === kind);
  const strain = strains.find((s) => s.id === batch.strainId);
  const curves = strain?.curves ?? []; // its sex's is picked where shown (OQ5, R6)
  const figures =
    batch.species === "layer" ? (
      // latest laying curve version (R7)
      <LayerDashboard batch={batch} entries={entries} sold={sold} collections={ofBatch<EggCollectionDto>("eggCollection", batch.id)} curve={strain?.layingCurves?.at(-1)?.points ?? null} />
    ) : (
      <BatchDashboard batch={batch} entries={entries} weighings={weighings} sold={sold} curves={curves} money={batch.status === "open" && can(scope, "money.read")} />
    );
  const record = can(scope, "flock.record");
  const manage = can(scope, "flock.manage");

  if (batch.status === "closed") {
    // B6: read-only, with the locked figures; its sales stay listed for their origin documents (V5).
    return tab === "ventes" ? (
      <Sales batch={batch} sales={of<SaleDto>("sale")} buyers={of<BuyerDto>("buyer")} treatments={[]} birdsOnHand={0} write={write} />
    ) : (
      <>
        <ClosedSummary batch={batch} money={can(scope, "money.read")} />
        {can(scope, "finance.manage") && <ReopenBatchForm batch={batch} batches={batches} cleanouts={of<CleanoutDto>("cleanout")} write={write} />}
        {farming ? figures : <p className="text-sm text-ink-2">{t("Batches.noFarming")}</p>}
        <BatchCosts batch={batch} costs={costs} manage={manage} />
      </>
    );
  }
  if (tab === "sante") {
    return (
      <div className={lower}>
        <Vaccinations
          batch={batch}
          vaccinations={vaccinations}
          products={products}
          lots={items("vaccine")}
          birdsOnHand={onHand}
          userId={scope.userId}
          protocols={of<ProtocolDto>("protocol")}
          manage={can(scope, "health.manage")}
          write={write}
        />
        {can(scope, "health.record") && (
          <>
            <Treatments batch={batch} treatments={treatments} medicines={items("medicine")} userId={scope.userId} write={write} />
            <VetVisits batch={batch} visits={visits} userId={scope.userId} write={write} />
          </>
        )}
        <NotifiableDiseases />
      </div>
    );
  }
  if (tab === "ventes") {
    return (
      <>
        {record && (
          <Sales batch={batch} sales={of<SaleDto>("sale")} buyers={of<BuyerDto>("buyer")} treatments={treatments} birdsOnHand={onHand} seller={can(scope, "sales.manage")} write={write} />
        )}
        <BatchCosts batch={batch} costs={costs} manage={manage} />
      </>
    );
  }
  if (tab === "indicateurs") {
    return (
      <>
        <BatchNotes batch={batch} areaM2={houses.find((h) => h.id === batch.houseId)?.areaM2} claimPermille={undefined} />
        {figures}
        {!record && <Weighings batch={batch} weighings={weighings} curves={curves} />}
      </>
    );
  }
  // Gestion: the batch's occasional changes, each in a sheet (sheet.tsx).
  return (
    <section aria-label={t("Batches.tabs.gestion")} className={`${card} lg:max-w-xl`}>
      <div className="flex flex-wrap gap-3">
        {batch.species === "pullet" && (
          <TransferForm
            batch={batch}
            onHand={onHand}
            houses={houses.map((h) => ({
              id: h.id,
              label: `${farms.get(h.farmId)?.name ?? ""} · ${h.name}`,
              free: canJoinHouse("layer", batches.filter((b) => b.status === "open" && b.houseId === h.id && b.id !== batch.id)).ok, // its own house too (B13)
            }))}
            write={write}
          />
        )}
        {!batch.fromBatchId && (
          <CorrectPlacement batch={batch} title={title} houses={houses} batches={batches} entries={entries} weighings={weighings} sold={sold} strains={strains} vaccinations={vaccinations} treatments={treatments} visits={visits} write={write} />
        )}
        <CloseBatchForm batch={batch} write={write} />
      </div>
    </section>
  );
}
