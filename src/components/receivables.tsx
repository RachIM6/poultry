"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { Link } from "@/i18n/navigation";
import { formatDay, formatMoney } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { parseCentimes } from "@/lib/kernel/money";
import { can } from "@/lib/permissions";
import { RecordPayment, SALES_MUTATIONS as S, buyerBalances, checkPayment, type BuyerDto, type PaymentDto, type SaleDto } from "@/modules/sales/schema";
import { currentScope, localDb, scopeKey, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";
import { startSync } from "@/offline/sync";

// SPEC V4 on the static /receivables shell, offline: what each buyer owes, their cheques and bills with due dates, and
// later payments, checked with the same rule as the server. Owners and managers only: workers get no sale money (I5).

const field = "rounded-lg border border-current/30 bg-transparent px-3 py-3 text-lg";
const primary = "rounded-lg bg-green-700 px-4 py-3 font-semibold text-white";
const secondary = "rounded-lg border border-current/30 px-4 py-3";
const today = () => farmDayOf(new Date());
const METHODS = RecordPayment.shape.method.options;

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
  const records = useLiveQuery(() => db.records.where("entity").anyOf("buyer", "sale", "buyerPayment").toArray(), [userId, organizationId]);
  const [paying, setPaying] = useState<string>();
  const [message, setMessage] = useState<string>();
  if (!can(scope, "sales.manage")) return <p>{t("Receivables.forbidden")}</p>;
  if (!records) return null;

  const of = <T,>(entity: string) => records.filter((r) => r.entity === entity).map((r) => r.data as T);
  const sales = of<SaleDto>("sale");
  const balances = buyerBalances(
    sales.map((s) => ({ buyerId: s.buyerId, amountCentimes: BigInt(s.amountCentimes ?? 0), paidCentimes: BigInt(s.paidCentimes ?? 0) })),
    of<PaymentDto>("buyerPayment").map((p) => ({ buyerId: p.buyerId, amountCentimes: BigInt(p.amountCentimes) })),
  );
  const owing = of<BuyerDto>("buyer")
    .filter((b) => (balances.get(b.id) ?? 0n) > 0n)
    .sort((x, y) => x.name.localeCompare(y.name));

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
    </>
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
