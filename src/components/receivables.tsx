"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { Link } from "@/i18n/navigation";
import { formatDay, formatMoney } from "@/lib/format";
import { daysBetween, farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { parseCentimes } from "@/lib/kernel/money";
import { can } from "@/lib/permissions";
import {
  LATER_PAYMENT_METHODS as METHODS,
  AGEING_BUCKETS,
  SALES_MUTATIONS as S,
  ageing,
  buyerBalances,
  checkPayment,
  checkTransition,
  instrumentsOf,
  type BuyerDto,
  type Instrument,
  type InstrumentStatusDto,
  type PaymentDto,
  type SaleDto,
} from "@/modules/sales/shared";
import { currentScope, localDb, scopeKey, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";
import { startSync } from "@/offline/sync";

// SPEC V4 on the static /receivables shell, offline: what each buyer owes, their cheques and bills with due dates, and
// later payments, checked with the same rule as the server. Owners and managers only: workers get no sale money (I5).

const field = "rounded-lg border border-current/30 bg-transparent px-3 py-3 text-lg";
const primary = "rounded-lg bg-green-700 px-4 py-3 font-semibold text-white";
const secondary = "rounded-lg border border-current/30 px-4 py-3";
const today = () => farmDayOf(new Date());

export function ReceivablesScreen() {
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
  return <Receivables key={scopeKey(scope)} {...scope} />;
}

function Receivables(scope: Scope) {
  const { userId, organizationId, role } = scope;
  const t = useTranslations();
  const locale = useLocale();
  useEffect(() => startSync({ userId, organizationId, role }), [userId, organizationId, role]);
  const db = localDb({ userId, organizationId });
  const records = useLiveQuery(() => db.records.where("entity").anyOf("buyer", "sale", "buyerPayment", "instrumentStatus").toArray(), [userId, organizationId]);
  const [paying, setPaying] = useState<string>();
  const [message, setMessage] = useState<string>();
  if (!can(scope, "sales.manage")) return <p>{t("Receivables.forbidden")}</p>;
  if (!records) return null;

  const of = <T,>(entity: string) => records.filter((r) => r.entity === entity).map((r) => r.data as T);
  const sales = of<SaleDto>("sale");
  const payments = of<PaymentDto>("buyerPayment");
  const buyers = of<BuyerDto>("buyer");
  // FN11: every cheque and bill received, with its state, as the server computes it.
  const instruments = instrumentsOf(
    sales.map((s) => ({ id: s.id, buyerId: s.buyerId, paymentMethod: s.paymentMethod ?? "", paidCentimes: BigInt(s.paidCentimes ?? 0), instrument: s.instrument ?? null, day: s.day })),
    payments.map((p) => ({ ...p, amountCentimes: BigInt(p.amountCentimes) })),
    of<InstrumentStatusDto>("instrumentStatus"),
  );
  const balances = buyerBalances(
    sales.map((s) => ({ buyerId: s.buyerId, amountCentimes: BigInt(s.amountCentimes ?? 0), paidCentimes: BigInt(s.paidCentimes ?? 0) })),
    payments.map((p) => ({ buyerId: p.buyerId, amountCentimes: BigInt(p.amountCentimes) })),
    instruments.filter((i) => i.state === "unpaid"),
  );
  const nameOf = (id: string) => buyers.find((b) => b.id === id)?.name ?? "—";
  const owing = buyers
    .filter((b) => (balances.get(b.id) ?? 0n) > 0n)
    .sort((x, y) => x.name.localeCompare(y.name));

  const write = async (mutation: { type: string; payload: unknown }, recs: { entity: string; id: string; data: unknown }[]) => {
    try {
      await writeLocal(db, mutation, recs);
      setMessage("Farms.saved");
    } catch {
      setMessage("Farms.saveFailed"); // QuotaExceededError: never pretend it was saved
    }
  };
  const move = (i: Instrument, state: InstrumentStatusDto["state"]) => {
    const status: InstrumentStatusDto = { id: uuidv7(), instrumentId: i.id, state, day: today() };
    const buyer = buyers.find((b) => b.id === i.buyerId);
    const blocked = state === "unpaid" && buyer ? [{ entity: "buyer", id: buyer.id, data: { ...buyer, creditBlocked: true } }] : []; // FN12, as the server
    return write({ type: S.setInstrumentState, payload: status }, [{ entity: "instrumentStatus", id: status.id, data: status }, ...blocked]);
  };
  const unblock = (b: BuyerDto) => write({ type: S.unblockBuyer, payload: { buyerId: b.id } }, [{ entity: "buyer", id: b.id, data: { ...b, creditBlocked: false } }]);
  const pending = instruments.filter((i) => i.state === "in_portfolio" || i.state === "remitted").sort((x, y) => x.dueOn.localeCompare(y.dueOn));
  // FN12: each buyer's debts by age, as the server would compute them.
  const ageOf = (buyerId: string) =>
    ageing(
      [
        ...sales.filter((s) => s.buyerId === buyerId).map((s) => ({ dueOn: s.day, amountCentimes: BigInt(s.amountCentimes ?? 0) - BigInt(s.paidCentimes ?? 0) })),
        ...instruments.filter((i) => i.buyerId === buyerId && i.state === "unpaid").map((i) => ({ dueOn: i.dueOn, amountCentimes: i.amountCentimes })),
      ].filter((d) => d.amountCentimes > 0n),
      payments.filter((p) => p.buyerId === buyerId).reduce((sum, p) => sum + BigInt(p.amountCentimes), 0n),
      (dueOn) => daysBetween(dueOn as FarmDay, today()),
    );
  const awaiting = sales.filter((s) => s.creditApproval === "pending");
  const owner = can(scope, "finance.manage");
  const approve = (saleId: string) => {
    const sale = sales.find((s) => s.id === saleId)!;
    return write({ type: S.approveCredit, payload: { saleId } }, [{ entity: "sale", id: saleId, data: { ...sale, creditApproval: "approved" } }]);
  };
  const setLimit = (b: BuyerDto, limit: bigint | null) =>
    write({ type: S.setCreditLimit, payload: { buyerId: b.id, limitCentimes: limit === null ? null : String(limit) } }, [
      { entity: "buyer", id: b.id, data: { ...b, creditLimitCentimes: limit === null ? null : String(limit) } },
    ]);

  const save = async (payment: PaymentDto) => {
    try {
      await writeLocal(db, { type: S.recordPayment, payload: payment }, [{ entity: "buyerPayment", id: payment.id, data: payment }]);
      setMessage("Farms.saved");
      setPaying(undefined);
    } catch {
      setMessage("Farms.saveFailed"); // QuotaExceededError: never pretend it was saved
    }
  };

  return (
    <>
      {message && <p role="status" className="rounded-lg bg-green-700/10 p-3">{t(message)}</p>}
      <h2 className="text-lg font-semibold">{t("Receivables.portfolio")}</h2>
      {pending.length === 0 ? (
        <p>{t("Receivables.portfolioNone")}</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t("Receivables.portfolio")}>
          {pending.map((i) => (
            <li key={i.id} className="flex flex-col gap-2 rounded-lg border border-current/30 p-3">
              <span>
                {t("Receivables.instrument", { kind: i.kind, number: i.number ?? "none", buyer: nameOf(i.buyerId), amount: formatMoney(i.amountCentimes), date: formatDay(i.dueOn as FarmDay, locale) })}
              </span>
              <span className="opacity-75">{t(`Receivables.states.${i.state}`)}</span>
              <div className="flex flex-wrap gap-2">
                {(["remitted", "cashed", "unpaid"] as const).filter((to) => checkTransition(i.state, to).ok).map((to) => (
                  <button key={to} type="button" onClick={() => move(i, to)} className={secondary}>
                    {t(to === "remitted" ? "Receivables.remit" : to === "cashed" ? "Receivables.cash" : "Receivables.unpaid")}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      {buyers.filter((b) => b.creditBlocked).map((b) => (
        <p key={b.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-red-700/50 p-3">
          {t("Receivables.blocked", { buyer: b.name })}
          {can(scope, "finance.manage") && <button type="button" onClick={() => unblock(b)} className={secondary}>{t("Receivables.unblock")}</button>}
        </p>
      ))}
      {awaiting.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={t("Receivables.awaiting")}>
          {awaiting.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-600/60 p-3">
              {t("Receivables.awaitingLine", { buyer: nameOf(s.buyerId), amount: formatMoney(BigInt(s.amountCentimes ?? 0) - BigInt(s.paidCentimes ?? 0)), date: formatDay(s.day as FarmDay, locale) })}
              {owner && <button type="button" onClick={() => approve(s.id)} className={secondary}>{t("Receivables.approve")}</button>}
            </li>
          ))}
        </ul>
      )}
      <h2 className="text-lg font-semibold">{t("Receivables.title")}</h2>
      {owing.length === 0 ? (
        <p>{t("Receivables.none")}</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t("Receivables.title")}>
          {owing.map((b) => {
            const balance = balances.get(b.id)!;
            const instruments = sales.filter((s) => s.buyerId === b.id && s.instrument).sort((x, y) => x.instrument!.dueOn.localeCompare(y.instrument!.dueOn));
            return (
              <li key={b.id} className="flex flex-col gap-2 rounded-lg border border-current/30 p-3">
                <span className="font-semibold">{t("Receivables.owes", { buyer: b.name, amount: formatMoney(balance) })}</span>
                <span className="text-sm opacity-75">
                  {AGEING_BUCKETS.flatMap((bucket) => {
                    const amount = ageOf(b.id)[bucket];
                    return amount > 0n ? [t(`Receivables.ageing.${bucket}`, { amount: formatMoney(amount) })] : [];
                  }).join(" · ")}
                </span>
                {b.creditLimitCentimes && <span className="text-sm">{t("Receivables.limit", { amount: formatMoney(BigInt(b.creditLimitCentimes)) })}</span>}
                {instruments.map((s) => (
                  <span key={s.id}>
                    {t("Receivables.due", {
                      method: s.paymentMethod ?? "",
                      number: s.instrument!.number,
                      amount: formatMoney(BigInt(s.amountCentimes ?? 0)),
                      date: formatDay(s.instrument!.dueOn as FarmDay, locale),
                    })}
                  </span>
                ))}
                {paying === b.id ? (
                  <PaymentForm buyerId={b.id} balance={balance} onSave={save} onCancel={() => setPaying(undefined)} />
                ) : (
                  <button type="button" onClick={() => setPaying(b.id)} className={secondary}>{t("Receivables.pay")}</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {owner && buyers.length > 0 && (
        <>
          <h2 className="text-lg font-semibold">{t("Receivables.limits")}</h2>
          <ul className="flex flex-col gap-2">
            {[...buyers].sort((x, y) => x.name.localeCompare(y.name)).map((b) => <LimitRow key={b.id} buyer={b} onSave={(limit) => setLimit(b, limit)} />)}
          </ul>
        </>
      )}
    </>
  );
}

/** FN12: the owner sets or removes a buyer's credit limit. */
function LimitRow({ buyer, onSave }: { buyer: BuyerDto; onSave: (limit: bigint | null) => Promise<void> }) {
  const t = useTranslations();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();
  const limit = buyer.creditLimitCentimes ? BigInt(buyer.creditLimitCentimes) : null;
  // The current limit in the input as the farmer types it ("10000,50"), centimes kept.
  const shown = limit === null ? "" : `${limit / 100n},${String(limit % 100n).padStart(2, "0")}`;
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = String(new FormData(e.currentTarget).get("limit") ?? "").trim();
    const value = text === "" ? null : parseCentimes(text);
    if (text !== "" && value === null) return setError("errors.INVALID_INPUT");
    await onSave(value);
    setEditing(false);
  };
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-current/30 p-3">
      <span>{buyer.name} · {limit === null ? t("Receivables.noLimit") : t("Receivables.limit", { amount: formatMoney(limit) })}</span>
      {editing ? (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <Field label={t("Receivables.limitLabel")}>{(id) => <input id={id} name="limit" inputMode="decimal" dir="ltr" defaultValue={shown} className={field} />}</Field>
          {error && <p role="alert">{t(error)}</p>}
          <div className="flex gap-3">
            <button type="submit" className={primary}>{t("Receivables.saveLimit")}</button>
            <button type="button" onClick={() => setEditing(false)} className={secondary}>{t("Receivables.cancel")}</button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className={secondary}>{t("Receivables.editLimit")}</button>
      )}
    </li>
  );
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}

function PaymentForm({ buyerId, balance, onSave, onCancel }: { buyerId: string; balance: bigint; onSave: (p: PaymentDto) => Promise<void>; onCancel: () => void }) {
  const t = useTranslations();
  const [error, setError] = useState<string>();

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const amount = parseCentimes(get("amount"));
    if (amount === null) return setError("errors.INVALID_INPUT");
    const checked = checkPayment(amount, balance); // as the server
    if (!checked.ok) return setError(`errors.${checked.error}`);
    if (get("day") > today()) return setError("errors.DAY_IN_FUTURE");
    setError(undefined);
    await onSave({ id: uuidv7(), buyerId, day: get("day") || today(), amountCentimes: String(amount), method: get("method") as PaymentDto["method"] });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label={t("Receivables.day")}>{(id) => <input id={id} name="day" type="date" defaultValue={today()} max={today()} required className={field} />}</Field>
      <Field label={t("Receivables.amount")}>{(id) => <input id={id} name="amount" inputMode="decimal" required dir="ltr" className={field} />}</Field>
      <Field label={t("Receivables.method")}>
        {(id) => (
          <select id={id} name="method" className={field}>
            {METHODS.map((m) => <option key={m} value={m}>{t(`Sale.methods.${m}`)}</option>)}
          </select>
        )}
      </Field>
      {error && <p role="alert">{t(error)}</p>}
      <div className="flex gap-3">
        <button type="submit" className={primary}>{t("Receivables.save")}</button>
        <button type="button" onClick={onCancel} className={secondary}>{t("Receivables.cancel")}</button>
      </div>
    </form>
  );
}
