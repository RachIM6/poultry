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
import { Batch, birdsStarted, type BatchDto, type SoldBirdsDto } from "@/modules/flock/shared";
import { withdrawalUntil, type TreatmentDto } from "@/modules/health/shared";
import { parseQuantity } from "@/modules/inventory/shared";
import { card, danger, field, primary, secondary } from "@/components/ui";
import {
  BUYER_TYPES,
  PAYMENT_METHODS,
  SALES_MUTATIONS as S,
  HEAD_KINDS,
  checkHeadSale,
  checkSale,
  saleAmount,
  weighingGap,
  type BuyerDto,
  type PaymentMethod,
  type SaleDto,
} from "@/modules/sales/shared";

// SPEC V1–V3 and B5 on the batch screen, offline, for owners and managers only (prices). The phone shows the amount and
// the weighing gap as they are typed, and refuses a sale during a withdrawal with the same rule as the server.

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
  write,
}: {
  batch: BatchDto;
  sales: SaleDto[];
  buyers: BuyerDto[];
  treatments: TreatmentDto[];
  birdsOnHand: number;
  write: Write;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [adding, setAdding] = useState(false);
  const buyerName = (id: string) => buyers.find((b) => b.id === id)?.name ?? "—";
  const list = [...sales].sort((a, b) => b.day.localeCompare(a.day));

  return (
    <section className="flex flex-col gap-3" aria-labelledby="sale-title">
      <h3 id="sale-title" className="text-[17px] font-semibold text-ink-2">{t("Sale.title")}</h3>
      {list.length === 0 ? (
        <p>{t("Sale.none")}</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-labelledby="sale-title">
          {list.map((s) => {
            const gap = weighingGap(s.farmWeightGrams, s.buyerWeightGrams);
            return (
              <li key={s.id} className={card}>
                <span className="font-semibold">
                  {s.kind === "perHead"
                    ? t("Sale.headLine", { date: formatDay(s.day as FarmDay, locale), buyer: buyerName(s.buyerId), birds: formatCount(s.birds) })
                    : t("Sale.line", { date: formatDay(s.day as FarmDay, locale), buyer: buyerName(s.buyerId), birds: formatCount(s.birds), kg: formatKg(s.farmWeightGrams) })}
                </span>
                {s.amountCentimes && s.paymentMethod && (
                  <span>{t("Sale.detail", { amount: formatMoney(BigInt(s.amountCentimes)), method: t(`Sale.methods.${s.paymentMethod}`), paid: formatMoney(BigInt(s.paidCentimes ?? "0")) })}</span>
                )}
                {gap && <span>{t("Sale.gap", { kg: formatKg(gap.grams), percent: formatPercent(gap.percent) })}</span>}
                {/* V5: printed in either language, whatever the screen's */}
                <span className="flex gap-4">
                  {(["fr", "ar"] as const).map((l) => (
                    <Link key={l} href={`/origin#${s.id}`} locale={l} className="py-2 underline underline-offset-4">
                      {t("Sale.origin", { language: t(`LocaleSwitcher.${l}`) })}
                    </Link>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {batch.status !== "open" ? null : adding ? (
        <SaleForm batch={batch} buyers={buyers} treatments={treatments} birdsOnHand={birdsOnHand} write={write} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={secondary}>{t("Sale.add")}</button>
      )}
    </section>
  );
}

function SaleForm({
  batch,
  buyers,
  treatments,
  birdsOnHand,
  write,
  onDone,
}: {
  batch: BatchDto;
  buyers: BuyerDto[];
  treatments: TreatmentDto[];
  birdsOnHand: number;
  write: Write;
  onDone: () => void;
}) {
  const t = useTranslations();
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

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const day = (get("day") || today()) as FarmDay;
    const paid = parseCentimes(get("paid"));
    if (perHead) return submitPerHead(day, paid, get);
    const birds = /^\d+$/.test(get("birds")) ? Number(get("birds")) : NaN;
    const newBuyer = buyerId === "new" ? { id: uuidv7(), name: get("buyerName"), phone: get("buyerPhone") || null, type: get("buyerType") as BuyerDto["type"] } : null;
    if (farmGrams === null || pricePerKg === null || paid === null || (buyerKg && buyerGrams === null) || (newBuyer && !newBuyer.name)) return setError("errors.INVALID_INPUT");
    const instrument = withInstrument && get("instrumentNumber") && get("instrumentDueOn") ? { number: get("instrumentNumber"), dueOn: get("instrumentDueOn") } : null;

    // As the server: the withdrawal on the sale day (health's rule), the sale itself, then the birds on hand (flock).
    const checked = checkSale(
      { birds, farmWeightGrams: farmGrams, buyerWeightGrams: buyerGrams, pricePerKgCentimes: pricePerKg, paymentMethod: method, paidCentimes: paid, instrument },
      withdrawalUntil(treatments.map((x) => ({ startOn: x.startOn as FarmDay, endOn: x.endOn as FarmDay, withdrawalDays: x.withdrawalDays })), day),
    );
    if (!checked.ok) return setError(`errors.${checked.error}`);
    const aggregate = Batch.rehydrate({ ...batch, placedOn: batch.placedOn as FarmDay, chickUnitPriceCentimes: 0n }, batch.status);
    const birdsOk = aggregate.checkBirdsSold(day, birds, birdsStarted(batch) - birdsOnHand, today());
    if (!birdsOk.ok) return setError(`errors.${birdsOk.error}`);
    setError(undefined);

    if (newBuyer && !(await write({ type: S.createBuyer, payload: newBuyer }, [{ entity: "buyer", id: newBuyer.id, data: newBuyer }]))) return;
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
      instrument,
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
  const submitPerHead = async (day: FarmDay, paid: bigint | null, get: (k: string) => string) => {
    const weighed = farmKg ? farmGrams : null;
    const newBuyer = buyerId === "new" ? { id: uuidv7(), name: get("buyerName"), phone: get("buyerPhone") || null, type: get("buyerType") as BuyerDto["type"] } : null;
    if (paid === null || (farmKg && weighed === null) || (newBuyer && !newBuyer.name)) return setError("errors.INVALID_INPUT");
    const instrument = withInstrument && get("instrumentNumber") && get("instrumentDueOn") ? { number: get("instrumentNumber"), dueOn: get("instrumentDueOn") } : null;
    const checked = checkHeadSale(
      { lines: headLines, farmWeightGrams: weighed, paymentMethod: method, paidCentimes: paid, instrument },
      withdrawalUntil(treatments.map((x) => ({ startOn: x.startOn as FarmDay, endOn: x.endOn as FarmDay, withdrawalDays: x.withdrawalDays })), day),
    );
    if (!checked.ok) return setError(`errors.${checked.error}`);
    const birds = checked.value.birds;
    const aggregate = Batch.rehydrate({ ...batch, placedOn: batch.placedOn as FarmDay, chickUnitPriceCentimes: 0n }, batch.status);
    const birdsOk = aggregate.checkBirdsSold(day, birds, birdsStarted(batch) - birdsOnHand, today());
    if (!birdsOk.ok) return setError(`errors.${birdsOk.error}`);
    setError(undefined);

    if (newBuyer && !(await write({ type: S.createBuyer, payload: newBuyer }, [{ entity: "buyer", id: newBuyer.id, data: newBuyer }]))) return;
    const lines = headLines.map((l) => ({ item: l.item, birds: l.birds, pricePerHeadCentimes: String(l.pricePerHeadCentimes) }));
    const payload = { id: uuidv7(), batchId: batch.id, buyerId: newBuyer?.id ?? buyerId, day, lines, farmWeightGrams: weighed, paymentMethod: method, paidCentimes: String(paid), instrument };
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

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5">
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
      <Field label={t("Sale.buyer")}>
        {(id) => (
          <select id={id} value={buyerId} onChange={(e) => setBuyerId(e.target.value)} className={field}>
            {buyers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            <option value="new">{t("Sale.newBuyer")}</option>
          </select>
        )}
      </Field>
      </div>
      {buyerId === "new" && (
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
      <Input label={t("Sale.day")} name="day" type="date" defaultValue={today()} required />
      {perHead ? (
        <>
          {HEAD_KINDS.map((k) => (
            <div key={k} className="col-span-2 grid grid-cols-2 gap-2.5">
              <Input label={t(`Sale.heads.${k}`)} value={heads[k].birds} onChange={(e) => setHeads((h) => ({ ...h, [k]: { ...h[k], birds: e.target.value } }))} inputMode="numeric" dir="ltr" />
              <Input label={t("Sale.pricePerHead", { what: t(`Sale.heads.${k}`) })} value={heads[k].price} onChange={(e) => setHeads((h) => ({ ...h, [k]: { ...h[k], price: e.target.value } }))} inputMode="decimal" dir="ltr" />
            </div>
          ))}
          <Input label={t("Sale.farmKgOptional")} value={farmKg} onChange={(e) => setFarmKg(e.target.value)} inputMode="decimal" dir="ltr" />
        </>
      ) : (
        <>
          <Input label={t("Sale.birds")} name="birds" inputMode="numeric" pattern="\d+" required dir="ltr" />
          <Input label={t("Sale.farmKg")} value={farmKg} onChange={(e) => setFarmKg(e.target.value)} inputMode="decimal" required dir="ltr" />
          <Input label={t("Sale.buyerKg")} value={buyerKg} onChange={(e) => setBuyerKg(e.target.value)} inputMode="decimal" dir="ltr" />
        </>
      )}
      {gap && <p className="col-span-2 text-sm font-medium text-brick-fg">{t("Sale.gap", { kg: formatKg(gap.grams), percent: formatPercent(gap.percent) })}</p>}
      </div>
      <div className={`${card} grid grid-cols-2 gap-2.5 [&>*]:min-w-0`}>
      {!perHead && <Input label={t("Sale.price")} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" required dir="ltr" />}
      <Field label={t("Sale.method")}>
        {(id) => (
          <select id={id} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={field}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{t(`Sale.methods.${m}`)}</option>)}
          </select>
        )}
      </Field>
      <Input label={t("Sale.paid")} name="paid" inputMode="decimal" required dir="ltr" />
      {withInstrument && (
        <>
          <Input label={t("Sale.instrumentNumber")} name="instrumentNumber" required maxLength={40} dir="ltr" />
          <Input label={t("Sale.instrumentDueOn")} name="instrumentDueOn" type="date" required />
        </>
      )}
      </div>
      {perHead && headAmount !== null && (
        <p className="flex items-baseline justify-between gap-3 rounded-[18px] bg-ink px-4 py-3.5 text-shell">
          <span className="text-sm text-sand">{t("Sale.headCount", { birds: formatCount(headLines.reduce((n, l) => n + l.birds, 0)) })}</span>
          <b className="text-[22px] font-semibold">{t("Sale.amount", { amount: formatMoney(headAmount) })}</b>
        </p>
      )}
      {!perHead && amount !== null && (
        <p className="flex items-baseline justify-between gap-3 rounded-[18px] bg-ink px-4 py-3.5 text-shell">
          <span className="text-sm text-sand">{farmKg} kg × {price}</span>
          <b className="text-[22px] font-semibold">{t("Sale.amount", { amount: formatMoney(amount) })}</b>
        </p>
      )}
      {error && <p role="alert" className={danger}>{t(error)}</p>}
      <div className="flex gap-3">
        <button type="submit" className={primary}>{t("Sale.save")}</button>
        <button type="button" onClick={onDone} className={secondary}>{t("Sale.cancel")}</button>
      </div>
    </form>
  );
}
