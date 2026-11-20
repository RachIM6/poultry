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
import { EXPENSE_CATEGORIES, FINANCE_MUTATIONS as F, TREASURY_KINDS, type ExpenseDto, type TreasuryAccountDto } from "@/modules/finance/shared";
import { currentScope, localDb, scopeKey, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";
import { startSync } from "@/offline/sync";
import { card, field, primary, secondary } from "@/components/ui";

// SPEC-finance FX4 on the static /expenses shell, offline: a quick expense (electricity, water, vet, insurance, catching
// crew) paid from a cash box, a bank account or on credit, and the organisation's cash boxes and bank accounts (FN3).
// Posted by the server once it syncs. Owners and managers only (FX2).

const today = () => farmDayOf(new Date());

export function ExpensesScreen() {
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
  return <Expenses key={scopeKey(scope)} {...scope} />;
}

function Expenses(scope: Scope) {
  const { userId, organizationId, role } = scope;
  const t = useTranslations();
  const locale = useLocale();
  useEffect(() => startSync({ userId, organizationId, role }), [userId, organizationId, role]);
  const db = localDb({ userId, organizationId });
  const records = useLiveQuery(() => db.records.where("entity").anyOf("treasuryAccount", "expense", "batch", "house").toArray(), [userId, organizationId]);
  const [message, setMessage] = useState<string>();
  const [adding, setAdding] = useState(false);
  if (!can(scope, "finance.record")) return <p>{t("Expenses.forbidden")}</p>;
  if (!records) return null;

  const of = <T,>(entity: string) => records.filter((r) => r.entity === entity).map((r) => r.data as T);
  const accounts = of<TreasuryAccountDto>("treasuryAccount").sort((x, y) => x.name.localeCompare(y.name));
  // FN13, FN14: an expense goes to one open batch, or is shared across the month's batches, or to none.
  const houses = of<{ id: string; name: string }>("house");
  const batches = of<{ id: string; houseId: string; placedOn: string; status: string }>("batch")
    .filter((b) => b.status === "open")
    .map((b) => ({ id: b.id, label: t("Expenses.batch", { house: houses.find((h) => h.id === b.houseId)?.name ?? "—", date: formatDay(b.placedOn as FarmDay, locale) }) }));
  const recent = of<ExpenseDto>("expense").sort((x, y) => y.day.localeCompare(x.day) || y.id.localeCompare(x.id)).slice(0, 20);

  const write = async (mutation: { type: string; payload: unknown }, entity: string, data: { id: string }) => {
    try {
      await writeLocal(db, mutation, [{ entity, id: data.id, data }]);
      setMessage("Farms.saved");
      return true;
    } catch {
      setMessage("Farms.saveFailed"); // QuotaExceededError: never pretend it was saved
      return false;
    }
  };

  return (
    <>
      {message && <p role="status" className="rounded-lg bg-olive-soft p-3 text-olive">{t(message)}</p>}
      <ExpenseForm accounts={accounts} batches={batches} onSave={(e) => write({ type: F.recordExpense, payload: e }, "expense", e)} />

      <h2 className="text-[17px] font-semibold text-ink-2">{t("Expenses.recent")}</h2>
      {recent.length === 0 ? (
        <p>{t("Expenses.none")}</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t("Expenses.recent")}>
          {recent.map((e) => (
            <li key={e.id} className="rounded-2xl border border-line bg-card p-3">
              {t("Expenses.line", { category: t(`Expenses.categories.${e.category}`), amount: formatMoney(BigInt(e.amountCentimes)), date: formatDay(e.day as FarmDay, locale) })}
            </li>
          ))}
        </ul>
      )}

      <h2 className="text-[17px] font-semibold text-ink-2">{t("Expenses.accounts")}</h2>
      <ul className="flex flex-col gap-1">
        {accounts.map((a) => <li key={a.id}>{t(`Expenses.kinds.${a.kind}`)} · {a.name}</li>)}
      </ul>
      {adding ? (
        <AccountForm
          onSave={async (a) => {
            if (await write({ type: F.createTreasuryAccount, payload: a }, "treasuryAccount", a)) setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={secondary}>{t("Expenses.addAccount")}</button>
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

function ExpenseForm({ accounts, batches, onSave }: { accounts: TreasuryAccountDto[]; batches: { id: string; label: string }[]; onSave: (e: ExpenseDto) => Promise<boolean> }) {
  const t = useTranslations();
  const [error, setError] = useState<string>();
  const [key, setKey] = useState(0); // a new key empties the form after a save

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const amount = parseCentimes(get("amount"));
    if (amount === null || amount <= 0n) return setError("errors.INVALID_QUANTITY");
    const vat = parseCentimes(get("vat") || "0"); // SPEC-finance FN9: part of the total
    if (vat === null) return setError("errors.INVALID_INPUT");
    if (vat > amount) return setError("errors.VAT_MORE_THAN_AMOUNT");
    if (get("day") > today()) return setError("errors.DAY_IN_FUTURE");
    // "from" is "credit", "cash", "bank", or a treasury account's id
    const from = get("from");
    const account = accounts.find((a) => a.id === from);
    // "shared" | "general" | a batch id
    const to = get("allocation");
    const day = get("day") || today();
    const paidFrom = (account ? account.kind : from) as ExpenseDto["paidFrom"];
    setError(undefined);
    const saved = await onSave({
      id: uuidv7(),
      day,
      category: get("category") as ExpenseDto["category"],
      amountCentimes: String(amount),
      vatCentimes: String(vat),
      paidFrom,
      treasuryId: account?.id ?? null,
      note: get("note") || null,
      batchId: to !== "shared" && to !== "general" ? to : null,
      serviceMonth: to === "shared" ? get("month") || day.slice(0, 7) : null,
    });
    if (saved) setKey((k) => k + 1);
  };

  return (
    <form key={key} onSubmit={submit} className={card}>
      <Field label={t("Expenses.category")}>
        {(id) => (
          <select id={id} name="category" className={field}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`Expenses.categories.${c}`)}</option>)}
          </select>
        )}
      </Field>
      <Field label={t("Expenses.amount")}>{(id) => <input id={id} name="amount" inputMode="decimal" required dir="ltr" className={field} />}</Field>
      <Field label={t("Sale.vat")}>{(id) => <input id={id} name="vat" inputMode="decimal" dir="ltr" className={field} />}</Field>
      <Field label={t("Expenses.from")}>
        {(id) => (
          <select id={id} name="from" className={field}>
            {accounts.length === 0 && <option value="cash">{t("Expenses.kinds.cash")}</option>}
            {accounts.map((a) => <option key={a.id} value={a.id}>{t(`Expenses.kinds.${a.kind}`)} · {a.name}</option>)}
            {accounts.length === 0 && <option value="bank">{t("Expenses.kinds.bank")}</option>}
            <option value="credit">{t("Expenses.credit")}</option>
          </select>
        )}
      </Field>
      <Field label={t("Expenses.allocation")}>
        {(id) => (
          <select id={id} name="allocation" className={field}>
            <option value="shared">{t("Expenses.shared")}</option>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            <option value="general">{t("Expenses.general")}</option>
          </select>
        )}
      </Field>
      <Field label={t("Expenses.month")}>{(id) => <input id={id} name="month" type="month" defaultValue={today().slice(0, 7)} max={today().slice(0, 7)} className={field} />}</Field>
      <Field label={t("Expenses.day")}>{(id) => <input id={id} name="day" type="date" defaultValue={today()} max={today()} required className={field} />}</Field>
      <Field label={t("Expenses.note")}>{(id) => <input id={id} name="note" maxLength={200} className={field} />}</Field>
      {error && <p role="alert">{t(error)}</p>}
      <button type="submit" className={primary}>{t("Expenses.save")}</button>
    </form>
  );
}

function AccountForm({ onSave, onCancel }: { onSave: (a: TreasuryAccountDto) => Promise<void>; onCancel: () => void }) {
  const t = useTranslations();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    await onSave({ id: uuidv7(), kind: String(data.get("kind")) as TreasuryAccountDto["kind"], name: String(data.get("name") ?? "").trim() });
  };
  return (
    <form onSubmit={submit} className={card}>
      <Field label={t("Expenses.kind")}>
        {(id) => (
          <select id={id} name="kind" className={field}>
            {TREASURY_KINDS.map((k) => <option key={k} value={k}>{t(`Expenses.kinds.${k}`)}</option>)}
          </select>
        )}
      </Field>
      <Field label={t("Expenses.accountName")}>{(id) => <input id={id} name="name" required maxLength={80} className={field} />}</Field>
      <div className="flex gap-3">
        <button type="submit" className={primary}>{t("Expenses.saveAccount")}</button>
        <button type="button" onClick={onCancel} className={secondary}>{t("Receivables.cancel")}</button>
      </div>
    </form>
  );
}
