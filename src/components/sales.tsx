"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { closedLocally } from "@/components/closing";
import type { Write } from "@/components/daily-entry";
import { Link } from "@/i18n/navigation";
import { formatCount, formatDay, formatKg, formatMoney, formatPercent } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { parseCentimes } from "@/lib/kernel/money";
import { Batch, type BatchDto, type SoldBirdsDto } from "@/modules/flock/shared";
import { withdrawalUntil, type TreatmentDto } from "@/modules/health/shared";
import { parseQuantity } from "@/modules/inventory/shared";
import { card, danger, field, link, primary, secondary } from "@/components/ui";
import { useInline } from "@/components/focus";
import {
  BUYER_TYPES,
  PAYMENT_METHODS,
  SALES_MUTATIONS as S,
  HEAD_KINDS,
  TAKERS,
  checkHeadSale,
  checkSale,
  lastPrices,
  repriceSale,
  saleAmount,
  typedPrice,
  weighingGap,
  type BuyerDto,
  type PaymentMethod,
  type SaleDto,
  type Taker,
} from "@/modules/sales/shared";

// SPEC V1–V3 and B5 on the batch screen, offline. The phone shows the amount and the weighing gap as they are typed, and
// refuses a sale during a withdrawal with the same rule as the server. Sales are for owners and managers (`seller`:
// prices); a home consumption (SPEC-finance FC7) is the workers' too, without its price (I5).

const today = () => farmDayOf(new Date());

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}
const Input = ({ label, ...input }: { label: string } & InputHTMLAttributes<HTMLInputElement>) => (
  <Field label={label}>{(id) => <input id={id} className={field} {...input} />}</Field>
);

export function Sales({
  batch,
  sales,
  buyers,
  treatments,
  birdsOnHand,
  seller = true,
  write,
}: {
  batch: BatchDto;
  sales: SaleDto[]; // every batch's: a consumption's price is the farm's last sale's (FQ21)
  buyers: BuyerDto[];
  treatments: TreatmentDto[];
  birdsOnHand: number;
  seller?: boolean;
  write: Write;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [adding, setAdding] = useState(false);
  const buyerName = (id: string | null) => buyers.find((b) => b.id === id)?.name ?? "—";
  // A worker sees the consumptions only, not the farm's sales and buyers; egg sales are recorded on /eggs.
  const list = sales.filter((s) => s.batchId === batch.id && (seller || (s.takenBy && s.kind !== "eggs"))).sort((a, b) => b.day.localeCompare(a.day));
  const labelOf = (s: SaleDto) => {
    const date = formatDay(s.day as FarmDay, locale);
    const who = s.takenBy ? t(`Sale.takers.${s.takenBy}`) : buyerName(s.buyerId);
    if (s.kind === "eggs") return t("Sale.eggLine", { date, buyer: who, eggs: formatCount((s.lines ?? []).reduce((n, l) => n + l.eggs, 0)) });
    if (s.takenBy) return t("Sale.consumptionLine", { date, who, birds: formatCount(s.birds) });
    if (s.kind === "perHead") return t("Sale.headLine", { date, buyer: who, birds: formatCount(s.birds) });
    return t("Sale.line", { date, buyer: who, birds: formatCount(s.birds), kg: formatKg(s.farmWeightGrams) });
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby="sale-title">
      <h3 id="sale-title" className="text-[17px] font-semibold text-ink-2">{t("Sale.title")}</h3>
      {list.length === 0 ? (
        <p>{t("Sale.none")}</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-labelledby="sale-title">
          {list.map((s) => {
            const gap = weighingGap(s.farmWeightGrams, s.buyerWeightGrams);
            // SPEC-finance §9 "Cancelled records": birds can't come back to a closed batch (no reopening in v1)
            const actions = seller && <SaleActions sale={s} label={labelOf(s)} cancellable={batch.status === "open" || s.kind === "eggs"} write={write} />;
            if (s.takenBy) {
              return (
                <li key={s.id} className={card}>
                  <span className="font-semibold">{labelOf(s)}</span>
                  {s.amountCentimes && <span>{t("Sale.value", { amount: formatMoney(BigInt(s.amountCentimes)) })}</span>}
                  {actions}
                </li>
              );
            }
            return (
              <li key={s.id} className={card}>
                <span className="font-semibold">{labelOf(s)}</span>
                {s.amountCentimes && s.paymentMethod && (
                  <span>{t("Sale.detail", { amount: formatMoney(BigInt(s.amountCentimes)), method: t(`Sale.methods.${s.paymentMethod}`), paid: formatMoney(BigInt(s.paidCentimes ?? "0")) })}</span>
                )}
                {gap && <span>{t("Sale.gap", { kg: formatKg(gap.grams), percent: formatPercent(gap.percent) })}</span>}
                {/* V5: printed in either language, whatever the screen's (live birds) */}
                {s.kind !== "eggs" && (
                  <span className="flex gap-4">
                    {(["fr", "ar"] as const).map((l) => (
                      <Link key={l} href={`/origin#${s.id}`} locale={l} className={link}>
                        {t("Sale.origin", { language: t(`LocaleSwitcher.${l}`) })}
                      </Link>
                    ))}
                  </span>
                )}
                {actions}
              </li>
            );
          })}
        </ul>
      )}
      {batch.status !== "open" ? null : adding ? (
        <SaleForm batch={batch} sales={sales} buyers={buyers} treatments={treatments} birdsOnHand={birdsOnHand} seller={seller} write={write} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={secondary}>{t(seller ? "Sale.add" : "Sale.addConsumption")}</button>
      )}
    </section>
  );
}

/**
 * SPEC-finance §9 "Cancelled records": a sale typed wrong. Its prices and VAT are corrected here; anything else (birds,
 * weight, buyer, day) is cancelled, after a confirmation, then typed again. The server refuses either once a payment
 * covers it (SALE_HAS_PAYMENT), and a cancel once its batch is closed.
 */
function SaleActions({ sale, label, cancellable, write }: { sale: SaleDto; label: string; cancellable: boolean; write: Write }) {
  const t = useTranslations();
  const { open, opener, close } = useInline<"price">();
  const [error, setError] = useState<string>();
  const live = (sale.kind ?? "live") === "live";
  const lines = sale.lines ?? [];
  const lineName = (item: string) => (sale.kind === "eggs" ? (item.startsWith("grade:") ? item.slice(6).toUpperCase() : t(`EggStock.items.${item}`)) : t(`Sale.heads.${item}`));

  const cancel = async () => {
    if (!confirm(t("Sale.voidConfirm", { sale: label }))) return;
    await write({ type: S.cancelSale, payload: { saleId: sale.id } }, [
      { entity: "sale", id: sale.id, data: null },
      ...(sale.kind === "eggs" ? [] : [{ entity: "soldBirds", id: sale.id, data: null }]), // B5: the birds are back at once; eggs at the next sync
    ]);
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const text = (k: string) => String(data.get(k) ?? "").trim();
    const kg = live ? parseCentimes(text("perKg")) : null;
    const linePrices = lines.map((_, n) => parseCentimes(text(`line${n}`)));
    const vat = sale.takenBy || !text("vat") ? 0n : parseCentimes(text("vat"));
    if ((live ? kg === null : linePrices.some((p) => p === null)) || vat === null) return setError("errors.INVALID_INPUT");
    const priced = repriceSale(sale, { pricePerKgCentimes: kg, linePrices: linePrices as bigint[], vatCentimes: vat });
    if (!priced.ok) return setError(`errors.${priced.error}`);
    setError(undefined);
    const payload = { saleId: sale.id, pricePerKgCentimes: kg === null ? null : String(kg), linePrices: linePrices.map(String), vatCentimes: String(vat) };
    const corrected: SaleDto = { ...sale, pricePerKgCentimes: String(priced.value.pricePerKgCentimes), amountCentimes: String(priced.value.amountCentimes), vatCentimes: String(vat), lines: priced.value.lines };
    if (await write({ type: S.correctSale, payload }, [{ entity: "sale", id: sale.id, data: corrected }])) close();
  };

  if (open === "price") {
    return (
      <form onSubmit={submit} aria-label={t("Sale.correctOf", { sale: label })} className="mt-2 flex flex-col gap-2.5">
        <p className="text-sm text-ink-2">{t("Sale.correctHint")}</p>
        {live ? (
          <Input label={t("Sale.price")} name="perKg" defaultValue={typedPrice(BigInt(sale.pricePerKgCentimes ?? "0"))} inputMode="decimal" required dir="ltr" autoFocus />
        ) : (
          lines.map((l, n) => (
            <Input key={n} label={t("Sale.linePrice", { what: lineName(l.item) })} name={`line${n}`} defaultValue={typedPrice(BigInt(l.unitPriceCentimes))} inputMode="decimal" required dir="ltr" autoFocus={n === 0} />
          ))
        )}
        {!sale.takenBy && <Input label={t("Sale.vat")} name="vat" defaultValue={sale.vatCentimes && sale.vatCentimes !== "0" ? typedPrice(BigInt(sale.vatCentimes)) : ""} inputMode="decimal" dir="ltr" />}
        {error && <p role="alert" className={danger}>{t(error)}</p>}
        <div className="flex gap-3">
          <button type="submit" className={primary}>{t("Sale.saveCorrection")}</button>
          <button type="button" onClick={close} className={secondary}>{t("Sale.cancel")}</button>
        </div>
      </form>
    );
  }
  return (
    <span className="mt-1 flex flex-wrap gap-2">
      <button type="button" {...opener("price")} aria-label={t("Sale.correctOf", { sale: label })} className={`${secondary} text-sm`}>{t("Sale.correct")}</button>
      {cancellable && <button type="button" onClick={cancel} aria-label={t("Sale.voidOf", { sale: label })} className={`${secondary} text-sm`}>{t("Sale.void")}</button>}
    </span>
  );
}

function SaleForm({
  batch,
  sales,
  buyers,
  treatments,
  birdsOnHand,
  seller,
  write,
  onDone,
}: {
  batch: BatchDto;
  sales: SaleDto[];
  buyers: BuyerDto[];
  treatments: TreatmentDto[];
  birdsOnHand: number;
  seller: boolean;
  write: Write;
  onDone: () => void;
}) {
  const t = useTranslations();
  const [takenBy, setTakenBy] = useState<Taker | null>(seller ? null : TAKERS[0]); // FC7: null = a sale
  const [buyerId, setBuyerId] = useState(buyers[0]?.id ?? "new");
  const [farmKg, setFarmKg] = useState("");
  const [buyerKg, setBuyerKg] = useState("");
  const [price, setPrice] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [error, setError] = useState<string>();
  // SPEC-m3 V7: beldi and quail are sold by the head (P-Beldi); any batch may be.
  const [perHead, setPerHead] = useState(batch.species === "beldi" || batch.species === "quail");
  const [heads, setHeads] = useState<Record<(typeof HEAD_KINDS)[number], { birds: string; price: string }>>({ rooster: { birds: "", price: "" }, hen: { birds: "", price: "" }, bird: { birds: "", price: "" } });
  const headLines = HEAD_KINDS.flatMap((k) => {
    const birds = /^\d+$/.test(heads[k].birds) ? Number(heads[k].birds) : 0;
    const price = parseCentimes(heads[k].price);
    return birds > 0 ? [{ item: k, birds, pricePerHeadCentimes: price ?? -1n }] : [];
  });
  const headAmount = headLines.length > 0 && headLines.every((l) => l.pricePerHeadCentimes > 0n) ? headLines.reduce((a, l) => a + BigInt(l.birds) * l.pricePerHeadCentimes, 0n) : null;
  const farmGrams = parseQuantity(farmKg, "kg");
  const buyerGrams = buyerKg ? parseQuantity(buyerKg, "kg") : null;
  const pricePerKg = parseCentimes(price);
  const amount = farmGrams !== null && pricePerKg !== null ? saleAmount(farmGrams, pricePerKg) : null;
  const gap = farmGrams !== null && buyerGrams !== null ? weighingGap(farmGrams, buyerGrams) : null;
  const withInstrument = method === "cheque" || method === "bill";
  const buyer = buyers.find((b) => b.id === buyerId);

  // The register (arrêté 2126-05 art. 4): the buyer's address, typed with a new buyer or set for a known one, and where
  // the birds go when not to the buyer. Optional; an address without a name is refused.
  const newBuyerOf = (get: (k: string) => string) =>
    buyerId === "new" ? { id: uuidv7(), name: get("buyerName"), phone: get("buyerPhone") || null, type: get("buyerType") as BuyerDto["type"], address: get("buyerAddress") || null } : null;
  const destinationOf = (get: (k: string) => string) => (get("destinationName") ? { name: get("destinationName"), address: get("destinationAddress") || null } : get("destinationAddress") ? undefined : null);
  const saveBuyer = (newBuyer: ReturnType<typeof newBuyerOf>, get: (k: string) => string) => {
    if (newBuyer) return write({ type: S.createBuyer, payload: newBuyer }, [{ entity: "buyer", id: newBuyer.id, data: newBuyer }]);
    const address = get("buyerAddress") || null;
    if (!buyer || address === (buyer.address ?? null)) return true;
    return write({ type: S.setBuyerAddress, payload: { buyerId, address } }, [{ entity: "buyer", id: buyerId, data: { ...buyer, address } }]);
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const day = (get("day") || today()) as FarmDay;
    const paid = parseCentimes(get("paid"));
    const vat = parseCentimes(get("vat") || "0"); // SPEC-finance FN9: part of the total
    if (takenBy) return submitConsumption(day, takenBy, get);
    if (vat === null) return setError("errors.INVALID_INPUT");
    if (perHead) return submitPerHead(day, paid, vat, get);
    const birds = /^\d+$/.test(get("birds")) ? Number(get("birds")) : NaN;
    const newBuyer = newBuyerOf(get);
    const destination = destinationOf(get);
    if (farmGrams === null || pricePerKg === null || paid === null || (buyerKg && buyerGrams === null) || (newBuyer && !newBuyer.name) || destination === undefined) return setError("errors.INVALID_INPUT");
    const instrument = withInstrument && get("instrumentNumber") && get("instrumentDueOn") ? { number: get("instrumentNumber"), dueOn: get("instrumentDueOn") } : null;

    // As the server: the withdrawal on the sale day (health's rule), the sale itself, then the birds on hand (flock).
    const checked = checkSale(
      { birds, farmWeightGrams: farmGrams, buyerWeightGrams: buyerGrams, pricePerKgCentimes: pricePerKg, paymentMethod: method, paidCentimes: paid, vatCentimes: vat, instrument },
      withdrawalUntil(treatments.map((x) => ({ startOn: x.startOn as FarmDay, endOn: x.endOn as FarmDay, withdrawalDays: x.withdrawalDays })), day),
    );
    if (!checked.ok) return setError(`errors.${checked.error}`);
    const aggregate = Batch.rehydrate({ ...batch, placedOn: batch.placedOn as FarmDay, chickUnitPriceCentimes: 0n }, batch.status);
    const birdsOk = aggregate.checkBirdsSold(day, birds, birdsOnHand, today());
    if (!birdsOk.ok) return setError(`errors.${birdsOk.error}`);
    setError(undefined);

    if (!(await saveBuyer(newBuyer, get))) return;
    const payload = {
      id: uuidv7(),
      batchId: batch.id,
      buyerId: newBuyer?.id ?? buyerId,
      day,
      birds,
      farmWeightGrams: farmGrams,
      buyerWeightGrams: buyerGrams,
      pricePerKgCentimes: String(pricePerKg),
      paymentMethod: method,
      paidCentimes: String(paid),
      vatCentimes: String(vat),
      instrument,
      destination,
    };
    const sale: SaleDto = { ...payload, amountCentimes: String(checked.value.amountCentimes) };
    const sold: SoldBirdsDto = { id: payload.id, batchId: batch.id, day, birds, liveWeightGrams: farmGrams };
    const saved = await write({ type: S.recordSale, payload }, [
      { entity: "sale", id: payload.id, data: sale },
      { entity: "soldBirds", id: payload.id, data: sold }, // B5: birds on hand go down on the phone at once
      ...(birds === birdsOnHand ? [{ entity: "batch", id: batch.id, data: closedLocally(batch, day, null) }] : []), // B6: the last ones close it
    ]);
    if (saved) onDone();
  };

  // SPEC-m3 V7: the same checks as the server: withdrawal, lines, birds on hand.
  const submitPerHead = async (day: FarmDay, paid: bigint | null, vat: bigint, get: (k: string) => string) => {
    const weighed = farmKg ? farmGrams : null;
    const newBuyer = newBuyerOf(get);
    const destination = destinationOf(get);
    if (paid === null || (farmKg && weighed === null) || (newBuyer && !newBuyer.name) || destination === undefined) return setError("errors.INVALID_INPUT");
    const instrument = withInstrument && get("instrumentNumber") && get("instrumentDueOn") ? { number: get("instrumentNumber"), dueOn: get("instrumentDueOn") } : null;
    const checked = checkHeadSale(
      { lines: headLines, farmWeightGrams: weighed, paymentMethod: method, paidCentimes: paid, vatCentimes: vat, instrument },
      withdrawalUntil(treatments.map((x) => ({ startOn: x.startOn as FarmDay, endOn: x.endOn as FarmDay, withdrawalDays: x.withdrawalDays })), day),
    );
    if (!checked.ok) return setError(`errors.${checked.error}`);
    const birds = checked.value.birds;
    const aggregate = Batch.rehydrate({ ...batch, placedOn: batch.placedOn as FarmDay, chickUnitPriceCentimes: 0n }, batch.status);
    const birdsOk = aggregate.checkBirdsSold(day, birds, birdsOnHand, today());
    if (!birdsOk.ok) return setError(`errors.${birdsOk.error}`);
    setError(undefined);

    if (!(await saveBuyer(newBuyer, get))) return;
    const lines = headLines.map((l) => ({ item: l.item, birds: l.birds, pricePerHeadCentimes: String(l.pricePerHeadCentimes) }));
    const payload = { id: uuidv7(), batchId: batch.id, buyerId: newBuyer?.id ?? buyerId, day, lines, farmWeightGrams: weighed, paymentMethod: method, paidCentimes: String(paid), vatCentimes: String(vat), instrument, destination };
    const sale: SaleDto = {
      ...payload,
      birds,
      farmWeightGrams: weighed ?? 0,
      buyerWeightGrams: null,
      pricePerKgCentimes: "0",
      amountCentimes: String(checked.value.amountCentimes),
      kind: "perHead",
      lines: headLines.map((l) => ({ item: l.item, eggs: l.birds, eggsPerTray: 1, unitPriceCentimes: String(l.pricePerHeadCentimes), amountCentimes: String(BigInt(l.birds) * l.pricePerHeadCentimes) })),
    };
    const sold: SoldBirdsDto = { id: payload.id, batchId: batch.id, day, birds, liveWeightGrams: weighed ?? 0 };
    const saved = await write({ type: S.recordHeadSale, payload }, [
      { entity: "sale", id: payload.id, data: sale },
      { entity: "soldBirds", id: payload.id, data: sold },
      ...(birds === birdsOnHand ? [{ entity: "batch", id: batch.id, data: closedLocally(batch, day, null) }] : []),
    ]);
    if (saved) onDone();
  };

  // FQ21: a consumption is prefilled with the farm's last sale prices, which the owner or manager can change.
  const prefill = () => {
    const head = lastPrices(sales, "perHead", today());
    setPrice(typedPrice(lastPrices(sales, "live", today()).get("kg")));
    setHeads((h) => ({ rooster: { ...h.rooster, price: typedPrice(head.get("rooster")) }, hen: { ...h.hen, price: typedPrice(head.get("hen")) }, bird: { ...h.bird, price: typedPrice(head.get("bird")) } }));
  };

  // SPEC-finance FC7: no buyer and no payment; the withdrawal and birds on hand as a sale. A worker's has no price (I5).
  const submitConsumption = async (day: FarmDay, who: Taker, get: (k: string) => string) => {
    const typed = (text: string) => (seller && text ? parseCentimes(text) : null); // none: the server takes the last sale's
    const weighed = farmKg ? farmGrams : null;
    const badPrice = seller && (perHead ? headLines.some((l) => heads[l.item].price && l.pricePerHeadCentimes < 0n) : price && pricePerKg === null);
    if (badPrice || (perHead ? headLines.length === 0 || (farmKg && weighed === null) : farmGrams === null)) return setError("errors.INVALID_INPUT");
    if (withdrawalUntil(treatments.map((x) => ({ startOn: x.startOn as FarmDay, endOn: x.endOn as FarmDay, withdrawalDays: x.withdrawalDays })), day)) return setError("errors.WITHDRAWAL_IN_PROGRESS");
    const birds = perHead ? headLines.reduce((n, l) => n + l.birds, 0) : /^\d+$/.test(get("birds")) ? Number(get("birds")) : NaN;
    const aggregate = Batch.rehydrate({ ...batch, placedOn: batch.placedOn as FarmDay, chickUnitPriceCentimes: 0n }, batch.status);
    const birdsOk = aggregate.checkBirdsSold(day, birds, birdsOnHand, today());
    if (!birdsOk.ok) return setError(`errors.${birdsOk.error}`);
    setError(undefined);

    const grams = (perHead ? weighed : farmGrams) ?? 0;
    const base = { id: uuidv7(), batchId: batch.id, day, takenBy: who };
    const payload = perHead
      ? { ...base, kind: "perHead" as const, lines: headLines.map((l) => ({ item: l.item, birds: l.birds, pricePerHeadCentimes: typed(heads[l.item].price)?.toString() ?? null })), farmWeightGrams: weighed }
      : { ...base, kind: "live" as const, birds, farmWeightGrams: grams, pricePerKgCentimes: typed(price)?.toString() ?? null };
    const value = seller ? (perHead ? headAmount : amount) : null; // provisional: the server prices it, the pull brings it back
    const sale: SaleDto = { ...base, buyerId: null, birds, farmWeightGrams: grams, buyerWeightGrams: null, kind: payload.kind, ...(value !== null && { amountCentimes: String(value) }) };
    const sold: SoldBirdsDto = { id: base.id, batchId: batch.id, day, birds, liveWeightGrams: grams };
    const saved = await write({ type: S.recordConsumption, payload }, [
      { entity: "sale", id: base.id, data: sale },
      { entity: "soldBirds", id: base.id, data: sold },
      ...(birds === birdsOnHand ? [{ entity: "batch", id: batch.id, data: closedLocally(batch, day, null) }] : []),
    ]);
    if (saved) onDone();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5">
      {seller && (
        <fieldset className="flex gap-2">
          <legend className="sr-only">{t("Sale.kind")}</legend>
          {[null, TAKERS[0]].map((who) => (
            <label key={String(who)} className={`${secondary} flex-1 gap-2 has-[:checked]:border-ink has-[:checked]:font-semibold`}>
              <input
                type="radio"
                name="kind"
                checked={(takenBy === null) === (who === null)}
                onChange={() => {
                  setTakenBy(who);
                  if (who) prefill();
                }}
              />
              {t(who ? "Sale.consumption" : "Sale.sale")}
            </label>
          ))}
        </fieldset>
      )}
      <fieldset className="flex gap-2">
        <legend className="sr-only">{t("Sale.pricing")}</legend>
        {[false, true].map((head) => (
          <label key={String(head)} className={`${secondary} flex-1 gap-2 has-[:checked]:border-ink has-[:checked]:font-semibold`}>
            <input type="radio" name="pricing" checked={perHead === head} onChange={() => setPerHead(head)} />
            {t(head ? "Sale.perHead" : "Sale.perKg")}
          </label>
        ))}
      </fieldset>
      <div className={`${card} grid grid-cols-2 gap-2.5 [&>*]:min-w-0`}>
      <div className="col-span-2">
      {takenBy ? (
        <Field label={t("Sale.takenBy")}>
          {(id) => (
            <select id={id} value={takenBy} onChange={(e) => setTakenBy(e.target.value as Taker)} className={field}>
              {TAKERS.map((w) => <option key={w} value={w}>{t(`Sale.takers.${w}`)}</option>)}
            </select>
          )}
        </Field>
      ) : (
      <Field label={t("Sale.buyer")}>
        {(id) => (
          <select id={id} value={buyerId} onChange={(e) => setBuyerId(e.target.value)} className={field}>
            {buyers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            <option value="new">{t("Sale.newBuyer")}</option>
          </select>
        )}
      </Field>
      )}
      </div>
      {!takenBy && buyerId === "new" && (
        <>
          <Input label={t("Sale.buyerName")} name="buyerName" required maxLength={120} />
          <Input label={t("Sale.buyerPhone")} name="buyerPhone" type="tel" maxLength={32} dir="ltr" />
          <Field label={t("Sale.buyerType")}>
            {(id) => (
              <select id={id} name="buyerType" className={field}>
                {BUYER_TYPES.map((b) => <option key={b} value={b}>{t(`Sale.types.${b}`)}</option>)}
              </select>
            )}
          </Field>
        </>
      )}
      {!takenBy && (
        <>
          <div className="col-span-2">
            <Input key={buyerId} label={t("Sale.buyerAddress")} name="buyerAddress" defaultValue={buyer?.address ?? ""} maxLength={200} />
          </div>
          <details className="col-span-2">
            <summary className="min-h-11 py-2.5">{t("Sale.destination")}</summary>
            <div className="mt-2 flex flex-col gap-2.5">
              <Input label={t("Sale.destinationName")} name="destinationName" maxLength={120} />
              <Input label={t("Sale.destinationAddress")} name="destinationAddress" maxLength={200} />
            </div>
          </details>
        </>
      )}
      <Input label={t("Sale.day")} name="day" type="date" defaultValue={today()} required />
      {perHead ? (
        <>
          {HEAD_KINDS.map((k) => (
            <div key={k} className="col-span-2 grid grid-cols-2 gap-2.5">
              <Input label={t(`Sale.heads.${k}`)} value={heads[k].birds} onChange={(e) => setHeads((h) => ({ ...h, [k]: { ...h[k], birds: e.target.value } }))} inputMode="numeric" dir="ltr" />
              {seller && <Input label={t("Sale.pricePerHead", { what: t(`Sale.heads.${k}`) })} value={heads[k].price} onChange={(e) => setHeads((h) => ({ ...h, [k]: { ...h[k], price: e.target.value } }))} inputMode="decimal" dir="ltr" />}
            </div>
          ))}
          <Input label={t("Sale.farmKgOptional")} value={farmKg} onChange={(e) => setFarmKg(e.target.value)} inputMode="decimal" dir="ltr" />
        </>
      ) : (
        <>
          <Input label={t("Sale.birds")} name="birds" inputMode="numeric" pattern="\d+" required dir="ltr" />
          <Input label={t("Sale.farmKg")} value={farmKg} onChange={(e) => setFarmKg(e.target.value)} inputMode="decimal" required dir="ltr" />
          {!takenBy && <Input label={t("Sale.buyerKg")} value={buyerKg} onChange={(e) => setBuyerKg(e.target.value)} inputMode="decimal" dir="ltr" />}
        </>
      )}
      {gap && <p className="col-span-2 text-sm font-medium text-brick-fg">{t("Sale.gap", { kg: formatKg(gap.grams), percent: formatPercent(gap.percent) })}</p>}
      </div>
      {seller && (
      <div className={`${card} grid grid-cols-2 gap-2.5 [&>*]:min-w-0`}>
      {!perHead && <Input label={t("Sale.price")} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" required={!takenBy} dir="ltr" />}
      {!takenBy && (
      <>
      <Field label={t("Sale.method")}>
        {(id) => (
          <select id={id} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={field}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{t(`Sale.methods.${m}`)}</option>)}
          </select>
        )}
      </Field>
      <Input label={t("Sale.paid")} name="paid" inputMode="decimal" required dir="ltr" />
      <Input label={t("Sale.vat")} name="vat" inputMode="decimal" dir="ltr" />
      {withInstrument && (
        <>
          <Input label={t("Sale.instrumentNumber")} name="instrumentNumber" required maxLength={40} dir="ltr" />
          <Input label={t("Sale.instrumentDueOn")} name="instrumentDueOn" type="date" required />
        </>
      )}
      </>
      )}
      </div>
      )}
      {seller && perHead && headAmount !== null && (
        <p className="flex items-baseline justify-between gap-3 rounded-[18px] bg-ink px-4 py-3.5 text-shell">
          <span className="text-sm text-sand">{t("Sale.headCount", { birds: formatCount(headLines.reduce((n, l) => n + l.birds, 0)) })}</span>
          <b className="text-[22px] font-semibold">{t(takenBy ? "Sale.value" : "Sale.amount", { amount: formatMoney(headAmount) })}</b>
        </p>
      )}
      {seller && !perHead && amount !== null && (
        <p className="flex items-baseline justify-between gap-3 rounded-[18px] bg-ink px-4 py-3.5 text-shell">
          <span className="text-sm text-sand">{farmKg} kg × {price}</span>
          <b className="text-[22px] font-semibold">{t(takenBy ? "Sale.value" : "Sale.amount", { amount: formatMoney(amount) })}</b>
        </p>
      )}
      {error && <p role="alert" className={danger}>{t(error)}</p>}
      <div className="flex gap-3">
        <button type="submit" className={primary}>{t(takenBy ? "Sale.saveConsumption" : "Sale.save")}</button>
        <button type="button" onClick={onDone} className={secondary}>{t("Sale.cancel")}</button>
      </div>
    </form>
  );
}
