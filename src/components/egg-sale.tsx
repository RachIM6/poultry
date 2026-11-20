"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { v7 as uuidv7 } from "uuid";
import { card, field, primary, secondary } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { parseCentimes } from "@/lib/kernel/money";
import { drawFifo, drawId, type EggDrawDto, type EggItem, type Lot } from "@/modules/eggs/shared";
import type { BatchDto } from "@/modules/flock/shared";
import { eggWithdrawalWindows, type TreatmentDto } from "@/modules/health/shared";
import { PAYMENT_METHODS, SALES_MUTATIONS as S, checkEggSale, eggLineAmount, type BuyerDto, type PaymentMethod, type SaleDto } from "@/modules/sales/shared";

// SPEC-m3 V6 on /eggs (P-EggStock "Vendre des œufs"): eggs of a layer batch sold by the tray, offline. The phone draws them
// oldest first and refuses withheld eggs with the server's own rules.

const today = () => farmDayOf(new Date());
type Line = { item: EggItem; trays: string; eggsPerTray: string; price: string };
type Records = { entity: string; id: string; data: unknown }[];

export function EggSaleForm({
  batches,
  lots,
  buyers,
  treatments,
  itemName,
  onSave,
  onCancel,
}: {
  batches: BatchDto[];
  lots: Lot[];
  buyers: BuyerDto[];
  treatments: TreatmentDto[];
  itemName: (item: EggItem) => string;
  onSave: (mutation: { type: string; payload: unknown }, records: Records) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations();
  const withStock = batches.filter((b) => lots.some((l) => l.batchId === b.id));
  const [batchId, setBatchId] = useState(withStock[0]?.id);
  const items = [...new Set(lots.filter((l) => l.batchId === batchId).map((l) => l.item))];
  const [lines, setLines] = useState<Line[]>([{ item: items[0] ?? "ungraded", trays: "", eggsPerTray: "30", price: "" }]);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [error, setError] = useState<string>();
  if (buyers.length === 0) return <p>{t("EggSale.noBuyer")}</p>;
  if (!batchId) return <p>{t("EggStock.none")}</p>;

  const parsed = lines.map((l) => {
    const [trays, perTray] = [Number(l.trays), Number(l.eggsPerTray)];
    return { item: l.item, eggs: Math.round(trays * perTray), eggsPerTray: perTray, unitPriceCentimes: parseCentimes(l.price) ?? -1n };
  });
  const amount = parsed.every((l) => l.eggs > 0 && l.eggsPerTray > 0 && l.unitPriceCentimes > 0n) ? parsed.reduce((a, l) => a + eggLineAmount(l), 0n) : null;
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const paid = method === "credit" ? 0n : parseCentimes(get("paid") || "0");
    const vat = parseCentimes(get("vat") || "0"); // SPEC-finance FN9: part of the total
    const instrument = method === "cheque" || method === "bill" ? { number: get("number"), dueOn: get("dueOn") } : null;
    if (paid === null || vat === null || (instrument && (!instrument.number || !instrument.dueOn))) return setError("errors.INVALID_INPUT");
    const checked = checkEggSale({ lines: parsed, paymentMethod: method, paidCentimes: paid, vatCentimes: vat, instrument }); // as the server
    if (!checked.ok) return setError(`errors.${checked.error}`);
    const withheld = eggWithdrawalWindows(treatments.filter((x) => x.batchId === batchId).map((x) => ({ startOn: x.startOn as FarmDay, endOn: x.endOn as FarmDay, eggWithdrawalDays: x.eggWithdrawalDays ?? null })));
    const drawn = drawFifo(lots, batchId, parsed, withheld);
    if (!drawn.ok) return setError(`errors.${drawn.error}`);
    setError(undefined);

    const id = uuidv7();
    const payload = { id, batchId, buyerId: get("buyerId"), day: get("day") || today(), lines: parsed.map((l) => ({ ...l, unitPriceCentimes: String(l.unitPriceCentimes) })), paymentMethod: method, paidCentimes: String(paid), vatCentimes: String(vat), instrument };
    const sale: SaleDto = {
      ...payload,
      birds: 0,
      farmWeightGrams: 0,
      buyerWeightGrams: null,
      pricePerKgCentimes: "0",
      amountCentimes: String(checked.value.amountCentimes),
      creditApproval: null,
      kind: "eggs",
      lines: parsed.map((l) => ({ ...l, unitPriceCentimes: String(l.unitPriceCentimes), amountCentimes: String(eggLineAmount(l)) })),
    };
    const draws: EggDrawDto[] = drawn.value.map((d, n) => ({ id: drawId(id, n), batchId, saleId: id, ...d }));
    await onSave({ type: S.recordEggSale, payload }, [{ entity: "sale", id, data: sale }, ...draws.map((d) => ({ entity: "eggDraw", id: d.id, data: d }))]);
  };

  return (
    <form onSubmit={submit} className={card} aria-labelledby="egg-sale-title">
      <h2 id="egg-sale-title" className="text-lg font-semibold">{t("EggSale.title")}</h2>
      <label className="flex flex-col gap-1">
        {t("EggSale.buyer")}
        <select name="buyerId" className={field}>
          {buyers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>
      {withStock.length > 1 && (
        <label className="flex flex-col gap-1">
          {t("EggSale.batch")}
          <select value={batchId} onChange={(e) => setBatchId(e.target.value)} className={field}>
            {withStock.map((b) => <option key={b.id} value={b.id}>{b.placedOn}</option>)}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1">
        {t("EggSale.day")}
        <input name="day" type="date" defaultValue={today()} max={today()} className={field} />
      </label>
      {lines.map((l, i) => (
        <fieldset key={i} className="flex flex-col gap-2 rounded-2xl border border-line p-3">
          <legend>{t("EggSale.line", { n: String(i + 1) })}</legend>
          <label className="flex flex-col gap-1">
            {t("EggSale.item")}
            <select value={l.item} onChange={(e) => set(i, { item: e.target.value as EggItem })} className={field}>
              {items.map((it) => <option key={it} value={it}>{itemName(it)}</option>)}
            </select>
          </label>
          <span className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1">
              {t("EggSale.trays")}
              <input value={l.trays} onChange={(e) => set(i, { trays: e.target.value })} inputMode="decimal" required dir="ltr" className={field} />
            </label>
            <label className="flex flex-col gap-1">
              {t("EggSale.eggsPerTray")}
              <input value={l.eggsPerTray} onChange={(e) => set(i, { eggsPerTray: e.target.value })} inputMode="numeric" required dir="ltr" className={field} />
            </label>
            <label className="flex flex-col gap-1">
              {t("EggSale.price")}
              <input value={l.price} onChange={(e) => set(i, { price: e.target.value })} inputMode="decimal" required dir="ltr" className={field} />
            </label>
          </span>
        </fieldset>
      ))}
      <button type="button" className={secondary} onClick={() => setLines((ls) => [...ls, { item: items[0] ?? "ungraded", trays: "", eggsPerTray: "30", price: "" }])}>
        {t("EggSale.addLine")}
      </button>
      <label className="flex flex-col gap-1">
        {t("Sale.method")}
        <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={field}>
          {PAYMENT_METHODS.map((p) => <option key={p} value={p}>{t(`Sale.methods.${p}`)}</option>)}
        </select>
      </label>
      {method !== "credit" && (
        <label className="flex flex-col gap-1">
          {t("Sale.paid")}
          <input name="paid" inputMode="decimal" defaultValue="" dir="ltr" className={field} />
        </label>
      )}
      <label className="flex flex-col gap-1">
        {t("Sale.vat")}
        <input name="vat" inputMode="decimal" dir="ltr" className={field} />
      </label>
      {(method === "cheque" || method === "bill") && (
        <>
          <label className="flex flex-col gap-1">
            {t("Sale.instrumentNumber")}
            <input name="number" maxLength={40} required dir="ltr" className={field} />
          </label>
          <label className="flex flex-col gap-1">
            {t("Sale.instrumentDueOn")}
            <input name="dueOn" type="date" required className={field} />
          </label>
        </>
      )}
      {amount !== null && <p className="text-xl font-semibold">{t("EggSale.amount", { amount: formatMoney(amount) })}</p>}
      {error && <p role="alert">{t(error)}</p>}
      <span className="flex gap-2">
        <button type="submit" className={primary}>{t("EggSale.save")}</button>
        <button type="button" className={secondary} onClick={onCancel}>{t("Closing.cancel")}</button>
      </span>
    </form>
  );
}
