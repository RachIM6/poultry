"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { formatCount, formatDay, formatKg } from "@/lib/format";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { FarmDto, HouseDto } from "@/modules/farm-registry/schema";
import { ageOn, type BatchDto } from "@/modules/flock/shared";
import type { BuyerDto, SaleDto } from "@/modules/sales/shared";
import { cachedReference, currentScope, localDb, scopeKey, type Scope } from "@/offline/db";
import { startSync } from "@/offline/sync";

// SPEC V5 on the static /origin shell: the origin document of one sale (/origin#<sale id>), built from the phone's own
// records so it prints offline, in the page's language (law 49-99 art. 10). Print CSS only, no PDF library (T23).

const onHashChange = (notify: () => void) => (window.addEventListener("hashchange", notify), () => window.removeEventListener("hashchange", notify));
const useHash = () => useSyncExternalStore(onHashChange, () => decodeURIComponent(window.location.hash.slice(1)), () => "");

export function OriginDocumentScreen() {
  const t = useTranslations("Sync");
  const scope = useLiveQuery(() => currentScope().then((s) => s ?? null), [], undefined);
  if (scope === undefined) return null;
  if (scope === null) {
    return (
      <p>
        {t("signedOut")} <Link href="/login" className="underline underline-offset-4">{t("login")}</Link>
      </p>
    );
  }
  return <OriginDocument key={scopeKey(scope)} {...scope} />;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2 border-b border-current/20 py-1">
      <dt className="opacity-75">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="break-inside-avoid">
      <h2 className="mb-1 text-lg font-semibold">{title}</h2>
      <dl>{children}</dl>
    </section>
  );
}

function OriginDocument({ userId, organizationId, role }: Scope) {
  const t = useTranslations("Origin");
  const tr = useTranslations();
  const locale = useLocale();
  const saleId = useHash();
  useEffect(() => startSync({ userId, organizationId, role }), [userId, organizationId, role]);
  const db = localDb({ userId, organizationId });
  const records = useLiveQuery(() => db.records.where("entity").anyOf("farm", "house", "batch", "buyer", "sale").toArray(), [userId, organizationId]);
  const reference = useLiveQuery(() => cachedReference().then((r) => r ?? null), []);
  if (!records || reference === undefined) return null;

  const find = <T extends { id: string },>(entity: string, id: string | undefined) => records.find((r) => r.entity === entity && r.id === id)?.data as T | undefined;
  const sale = find<SaleDto>("sale", saleId);
  const batch = find<BatchDto>("batch", sale?.batchId);
  const farm = find<FarmDto>("farm", batch?.farmId);
  if (!sale || !batch || !farm) return <p>{t("notFound")}</p>;
  const house = find<HouseDto>("house", batch.houseId);
  const buyer = find<BuyerDto>("buyer", sale.buyerId);
  const strain = reference?.data.strains.find((s) => s.id === batch.strainId)?.name ?? batch.strainId;
  const day = (d: string) => formatDay(d as FarmDay, locale);

  return (
    <article className="flex flex-col gap-4">
      <header className="flex flex-col gap-1 text-center">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="opacity-75">{t("law")}</p>
        <p>{t("number", { number: sale.id.slice(0, 8).toUpperCase() })}</p>
      </header>
      <Part title={t("farm")}>
        <Row label={t("farmName")}>{farm.name}</Row>
        <Row label={t("address")}>{[farm.commune, farm.province, farm.region].join(", ")}</Row>
        <Row label={t("onssa")}>{farm.onssa
            ? t.rich("onssaValue", { number: farm.onssa.number, date: day(farm.onssa.expiresOn), code: (c) => <bdi dir="ltr">{c}</bdi> }) // a code keeps its order in Arabic
            : t("onssaNone")}</Row>
      </Part>
      <Part title={t("batch")}>
        <Row label={t("house")}>{house?.name ?? "—"}</Row>
        <Row label={t("strain")}>{strain}</Row>
        <Row label={t("placedOn")}>{day(batch.placedOn)}</Row>
        <Row label={t("age")}>{t("days", { age: String(ageOn(batch.placedOn as FarmDay, sale.day as FarmDay)) })}</Row>
      </Part>
      <Part title={t("sale")}>
        <Row label={t("day")}>{day(sale.day)}</Row>
        <Row label={t("birds")}>{formatCount(sale.birds)}</Row>
        <Row label={t("weight")}>{formatKg(sale.farmWeightGrams)}</Row>
        <Row label={t("average")}>{formatKg(Math.round(sale.farmWeightGrams / sale.birds))}</Row>
      </Part>
      <Part title={t("buyer")}>
        <Row label={t("buyerName")}>{buyer?.name ?? "—"}</Row>
        <Row label={t("buyerType")}>{buyer ? tr(`Sale.types.${buyer.type}`) : "—"}</Row>
        <Row label={t("buyerPhone")}>{buyer?.phone ? <span dir="ltr">{buyer.phone}</span> : "—"}</Row>
      </Part>
      <div className="grid break-inside-avoid grid-cols-2 gap-4">
        {[t("signFarm"), t("signBuyer")].map((label) => (
          <div key={label} className="flex h-36 flex-col rounded border border-current p-2">
            <span>{label}</span>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => window.print()} className="rounded-lg bg-green-700 px-4 py-3 font-semibold text-white print:hidden">
        {t("print")}
      </button>
    </article>
  );
}
