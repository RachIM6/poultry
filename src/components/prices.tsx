"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { v7 as uuidv7 } from "uuid";
import { Scoped } from "@/components/scoped";
import { card, done, field, primary } from "@/components/ui";
import { formatDay, formatMoney } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { parseCentimes } from "@/lib/kernel/money";
import { can } from "@/lib/permissions";
import { latestByProduct, PRICE_MUTATIONS as P, PRODUCTS, UNIT, type PriceDto, type Product } from "@/modules/market-prices/shared";
import { localDb, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";

// SPEC-m5 MP1, MP2 on the static /prices shell, offline: the farm's own price log. Nothing is shared (MP3).

export const PricesScreen = () => <Scoped>{(scope) => <Prices {...scope} />}</Scoped>;

function Prices(scope: Scope) {
  const t = useTranslations();
  const locale = useLocale();
  const db = localDb(scope);
  const prices = useLiveQuery(() => db.records.where("entity").equals("price").toArray(), [scope.userId, scope.organizationId]);
  const [message, setMessage] = useState<string>();
  const [key, setKey] = useState(0); // a new key empties the form after a save
  const ids = { product: useId(), price: useId(), day: useId(), seenOn: useId() };
  if (!can(scope, "money.read")) return <p>{t("Prices.forbidden")}</p>;
  if (!prices) return null;
  const all = prices.map((r) => r.data as PriceDto);
  const perUnit = (p: { product: Product; priceCentimes: string }) => t(`Prices.per.${UNIT[p.product]}`, { amount: formatMoney(BigInt(p.priceCentimes)) });
  const today = farmDayOf(new Date());

  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const data = new FormData(ev.currentTarget);
    const centimes = parseCentimes(String(data.get("price") ?? ""));
    if (centimes === null || centimes <= 0n) return setMessage("errors.INVALID_QUANTITY");
    const p: PriceDto = { id: uuidv7(), product: String(data.get("product")) as Product, day: String(data.get("day")), priceCentimes: String(centimes), seenOn: String(data.get("seenOn") ?? "").trim() || null, byUserId: scope.userId };
    try {
      await writeLocal(db, { type: P.recordPrice, payload: p }, { entity: "price", id: p.id, data: p });
      setMessage("Farms.saved");
      setKey((k) => k + 1);
    } catch {
      setMessage("Farms.saveFailed"); // QuotaExceededError: never pretend it was saved
    }
  };

  return (
    <>
      {message && <p role="status" className={done}>{t(message)}</p>}
      <section aria-label={t("Prices.latest")} className="flex flex-col gap-2">
        <h2 className="text-[17px] font-semibold text-ink-2">{t("Prices.latest")}</h2>
        {all.length === 0 ? (
          <p className="text-ink-2">{t("Prices.none")}</p>
        ) : (
          <ul aria-label={t("Prices.latest")} className={`${card} gap-2`}>
            {latestByProduct(all).map(({ product, latest, changeCentimes }) => (
              <li key={product} className="flex items-baseline justify-between gap-3">
                <span>
                  <b className="font-semibold">{t(`Prices.products.${product}`)}</b>
                  <span className="block text-sm text-ink-2">{[formatDay(latest.day as FarmDay, locale), latest.seenOn].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="text-end">
                  <b className="whitespace-nowrap">{perUnit(latest)}</b>
                  {changeCentimes !== null && changeCentimes !== 0n && (
                    <span className="block whitespace-nowrap text-sm text-ink-2">{t(changeCentimes > 0n ? "Prices.up" : "Prices.down", { amount: formatMoney(changeCentimes < 0n ? -changeCentimes : changeCentimes) })}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {can(scope, "prices.record") && (
        <form key={key} onSubmit={submit} className={card} aria-label={t("Prices.add")}>
          <label htmlFor={ids.product}>{t("Prices.product")}</label>
          <select id={ids.product} name="product" className={field}>
            {PRODUCTS.map((p) => <option key={p} value={p}>{t(`Prices.products.${p}`)} ({t(`Prices.units.${UNIT[p]}`)})</option>)}
          </select>
          <label htmlFor={ids.price}>{t("Prices.price")}</label>
          <input id={ids.price} name="price" inputMode="decimal" dir="ltr" required className={field} />
          <label htmlFor={ids.day}>{t("Prices.day")}</label>
          <input id={ids.day} name="day" type="date" required max={today} defaultValue={today} className={field} />
          <label htmlFor={ids.seenOn}>{t("Prices.seenOn")}</label>
          <input id={ids.seenOn} name="seenOn" maxLength={200} className={field} />
          <button type="submit" className={primary}>{t("Prices.save")}</button>
        </form>
      )}
      {all.length > 0 && (
        <section aria-label={t("Prices.history")} className="flex flex-col gap-2">
          <h2 className="text-[17px] font-semibold text-ink-2">{t("Prices.history")}</h2>
          <ul aria-label={t("Prices.history")} className={`${card} gap-2`}>
            {[...all].sort((a, b) => b.day.localeCompare(a.day) || b.id.localeCompare(a.id)).map((p) => (
              <li key={p.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span>{formatDay(p.day as FarmDay, locale)} · {t(`Prices.products.${p.product}`)}{p.seenOn ? ` · ${p.seenOn}` : ""}</span>
                <span className="whitespace-nowrap">{perUnit(p)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
