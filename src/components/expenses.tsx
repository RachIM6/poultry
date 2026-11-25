"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { Link } from "@/i18n/navigation";
import { formatDay, formatMoney } from "@/lib/format";
import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";
import { parseCentimes, typedCentimes } from "@/lib/kernel/money";
import { can } from "@/lib/permissions";
import { bankOnly, EXPENSE_CATEGORIES, FINANCE_MUTATIONS as F, TREASURY_KINDS, type ExpenseDto, type TreasuryAccountDto } from "@/modules/finance/shared";
import { currentScope, localDb, scopeKey, type Scope } from "@/offline/db";
import { writeLocal } from "@/offline/outbox";
import { startSync } from "@/offline/sync";
import { FileUpload, useOnline } from "@/components/local-screen";
import { useFieldError, useInline } from "@/components/focus";
import { fields2, rowTable, splitAside, splitNarrow } from "@/components/layout";
import { cardRow, tightHead } from "@/components/layout-tight";
import { card, danger, field, primary, secondary } from "@/components/ui";

// SPEC-finance FX4 on the static /expenses shell, offline: a quick expense (electricity, water, vet, insurance, catching
// crew, bank fees) paid from a cash box, a bank account or on credit, and the organisation's cash boxes and bank accounts
// (FN3). Bank fees: from a bank account only (FC9). Posted by the server once it syncs. Owners and managers only (FX2).
// FC9: /treasury/bank opens it prefilled with a statement's bank debit (?category=bank_fees&amount=&day=&from=<bank id>).
// SPEC-finance §9 "Cancelled records": a recent expense is corrected in the same form, or cancelled after a confirmation.

const today = () => farmDayOf(new Date());
const typed = (centimes: string) => typedCentimes(BigInt(centimes));

/** An expense as the form's fields, to correct it. */
const fieldsOf = (e: ExpenseDto): Pick<URLSearchParams, "get"> => {
  const f: Record<string, string> = {
    category: e.category,
    amount: typed(e.amountCentimes),
    vat: e.vatCentimes && e.vatCentimes !== "0" ? typed(e.vatCentimes) : "",
    from: e.treasuryId ?? e.paidFrom,
    allocation: e.batchId ?? (e.serviceMonth ? "shared" : "general"),
    month: e.serviceMonth ?? e.day.slice(0, 7),
    day: e.day,
    note: e.note ?? "",
  };
  return { get: (k: string) => f[k] ?? null };
};

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
  const { open: adding, opener, close } = useInline<"account">();
  const { open: correcting, opener: corrector, close: stopCorrecting } = useInline<string>();
  const [uploadError, setUploadError] = useState<string>();
  const online = useOnline();
  const queued = useLiveQuery(() => db.outbox.toArray(), [userId, organizationId]);
  const prefill = useSearchParams();
  const unsent = new Set((queued ?? []).flatMap((e) => e.recordKeys ?? []));
  if (!can(scope, "finance.record")) return <p>{t("Expenses.forbidden")}</p>;
  if (!records) return null;

  const of = <T,>(entity: string) => records.filter((r) => r.entity === entity).map((r) => r.data as T);
  const accounts = of<TreasuryAccountDto>("treasuryAccount").sort((x, y) => x.name.localeCompare(y.name));
  // FN13, FN14: an expense goes to one open batch, or is shared across the month's batches, or to none.
  const houses = of<{ id: string; name: string }>("house");
  const batches = of<{ id: string; houseId: string; placedOn: string; status: string }>("batch")
    .filter((b) => b.status === "open")
    .map((b) => ({ id: b.id, label: t("Expenses.batch", { house: houses.find((h) => h.id === b.houseId)?.name ?? "—", date: formatDay(b.placedOn as FarmDay, locale) }) }));
  const line = (e: ExpenseDto) => t("Expenses.line", { category: t(`Expenses.categories.${e.category}`), amount: formatMoney(BigInt(e.amountCentimes)), date: formatDay(e.day as FarmDay, locale) });
  const recent = of<ExpenseDto>("expense").sort((x, y) => y.day.localeCompare(x.day) || y.id.localeCompare(x.id)).slice(0, 20);

  // `local`: what the phone keeps (null: drops it)
  const write = async (mutation: { type: string; payload: unknown }, entity: string, data: { id: string }, local: unknown = data) => {
    try {
      await writeLocal(db, mutation, [{ entity, id: data.id, data: local }]);
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
      {/* Wide screens: the recent expenses as a table, the form beside it and in view (first on the phone, as it was).
          A 360 px form, not half the page: the table's five columns need the room. */}
      <div className={splitNarrow}>
        <div className={`lg:order-last ${splitAside}`}>
          <ExpenseForm key={prefill.toString()} prefill={prefill} accounts={accounts} batches={batches} onSave={(e) => write({ type: F.recordExpense, payload: e }, "expense", e)} />
        </div>
        <div className="flex flex-col gap-5">
          <h2 className="text-[17px] font-semibold text-ink-2">{t("Expenses.recent")}</h2>
          {uploadError && <p role="alert" className={danger}>{t(uploadError)}</p>}
          {recent.length === 0 ? (
            <p>{t("Expenses.none")}</p>
          ) : (
            <ul className={`${rowTable} lg:grid-cols-[auto_minmax(0,1.4fr)_auto_minmax(0,1fr)_auto]`} aria-label={t("Expenses.recent")}>
              <li aria-hidden="true" className={tightHead}>
                <span>{t("Expenses.day")}</span>
                <span>{t("Expenses.category")}</span>
                <span className="text-end">{t("Expenses.colAmount")}</span>
                <span>{t("Expenses.colReceipt")}</span>
              </li>
              {recent.map((e) => (
                <li key={e.id} className={`flex flex-col gap-2 rounded-2xl border border-line bg-card p-3 ${cardRow}`}>
                  {/* The phone's line, read whole by screen readers; its parts in columns from lg. */}
                  <span className="lg:sr-only">{line(e)}</span>
                  <span aria-hidden="true" className="hidden whitespace-nowrap lg:block">{formatDay(e.day as FarmDay, locale)}</span>
                  <span aria-hidden="true" className="hidden lg:block">{t(`Expenses.categories.${e.category}`)}</span>
                  <span aria-hidden="true" className="hidden text-end tabular-nums whitespace-nowrap lg:block"><bdi dir="ltr">{formatMoney(BigInt(e.amountCentimes))}</bdi></span>
                  {correcting === e.id ? (
                    <div className="lg:order-1 lg:col-span-full">
                      <ExpenseForm
                        prefill={fieldsOf(e)}
                        accounts={accounts}
                        batches={batches}
                        editing={{ id: e.id, title: t("Expenses.correcting", { expense: line(e) }), onCancel: stopCorrecting }}
                        onSave={async (x) => {
                          const saved = await write({ type: F.correctExpense, payload: x }, "expense", x, { ...e, ...x }); // the receipt stays
                          if (saved) stopCorrecting();
                          return saved;
                        }}
                      />
                    </div>
                  ) : (
                    <span className="flex flex-wrap gap-2 lg:order-1 lg:justify-end">
                      <button type="button" {...corrector(e.id)} aria-label={t("Expenses.correctOf", { expense: line(e) })} className={`${secondary} text-sm`}>{t("Expenses.correct")}</button>
                      <button
                        type="button"
                        onClick={() => confirm(t("Expenses.voidConfirm", { expense: line(e) })) && write({ type: F.cancelExpense, payload: { expenseId: e.id } }, "expense", e, null)}
                        aria-label={t("Expenses.voidOf", { expense: line(e) })}
                        className={`${secondary} text-sm`}
                      >
                        {t("Expenses.void")}
                      </button>
                    </span>
                  )}
                  {/* FN10: the receipt photo goes up once the expense is on the server and the phone is online (ADR-011).
                      Below the buttons on the phone, before them from lg. */}
                  <div className="contents lg:block">
                    {e.receiptFileId ? (
                      <a href={`/api/files/${e.receiptFileId}`} aria-label={t("Expenses.receiptOf", { expense: line(e) })} className="underline underline-offset-4">{t("Expenses.receipt")}</a>
                    ) : unsent.has(`expense:${e.id}`) || !online ? (
                      <span className="text-sm text-ink-2">{t("Expenses.receiptMissing")}</span>
                    ) : (
                      <FileUpload url={`/api/files?purpose=receipt&expense=${e.id}`} accept="image/jpeg,image/png,image/webp,application/pdf" camera label={t("Expenses.receiptAdd")} onError={setUploadError} />
                    )}
                  </div>
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
                if (await write({ type: F.createTreasuryAccount, payload: a }, "treasuryAccount", a)) close();
              }}
              onCancel={close}
            />
          ) : (
            <button type="button" {...opener("account")} className={`${secondary} lg:self-start`}>{t("Expenses.addAccount")}</button>
          )}
        </div>
      </div>
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

/** `editing`: correcting the expense with this id (§9 "Cancelled records"); its fields are the prefill. */
function ExpenseForm({
  prefill,
  accounts,
  batches,
  editing,
  onSave,
}: {
  prefill: Pick<URLSearchParams, "get">;
  accounts: TreasuryAccountDto[];
  batches: { id: string; label: string }[];
  editing?: { id: string; title: string; onCancel: () => void };
  onSave: (e: ExpenseDto) => Promise<boolean>;
}) {
  const t = useTranslations();
  const { id: errorId, error, set: setError, field: bad } = useFieldError();
  const [key, setKey] = useState(0); // a new key empties the form after a save
  const pre = (name: string) => (key === 0 ? (prefill.get(name) ?? undefined) : undefined); // the first form only
  const [bank, setBank] = useState(() => bankOnly(pre("category") ?? "")); // FC9 (T119): bank fees are paid from a bank account only
  const sources = bank ? accounts.filter((a) => a.kind === "bank") : accounts;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "").trim();
    const amount = parseCentimes(get("amount"));
    if (amount === null || amount <= 0n) return setError("errors.INVALID_QUANTITY", e.currentTarget, "amount");
    const vat = parseCentimes(get("vat") || "0"); // SPEC-finance FN9: part of the total
    if (vat === null) return setError("errors.INVALID_INPUT", e.currentTarget, "vat");
    if (vat > amount) return setError("errors.VAT_MORE_THAN_AMOUNT", e.currentTarget, "vat");
    if (get("day") > today()) return setError("errors.DAY_IN_FUTURE", e.currentTarget, "day");
    // "from" is "credit", "cash", "bank", or a treasury account's id
    const from = get("from");
    const account = accounts.find((a) => a.id === from);
    // "shared" | "general" | a batch id
    const to = get("allocation");
    const day = get("day") || today();
    const paidFrom = (account ? account.kind : from) as ExpenseDto["paidFrom"];
    if (bank && account?.kind !== "bank") return setError("Expenses.bankFeesAccount", e.currentTarget, "from");
    setError(undefined);
    const saved = await onSave({
      id: editing?.id ?? uuidv7(),
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
    if (saved) {
      setKey((k) => k + 1);
      setBank(false);
    }
  };

  return (
    <form key={key} onSubmit={submit} aria-label={editing?.title} className={`${card} ${editing ? fields2 : ""}`}>
      <Field label={t("Expenses.category")}>
        {(id) => (
          <select id={id} name="category" defaultValue={pre("category")} onChange={(e) => setBank(bankOnly(e.target.value))} className={field}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`Expenses.categories.${c}`)}</option>)}
          </select>
        )}
      </Field>
      <Field label={t("Expenses.amount")}>{(id) => <input id={id} name="amount" defaultValue={pre("amount")} inputMode="decimal" required dir="ltr" {...bad("amount")} className={field} />}</Field>
      <Field label={t("Sale.vat")}>{(id) => <input id={id} name="vat" defaultValue={pre("vat")} inputMode="decimal" dir="ltr" {...bad("vat")} className={field} />}</Field>
      <Field label={t("Expenses.from")}>
        {(id) => (
          <select id={id} name="from" defaultValue={pre("from")} {...bad("from")} className={field}>
            {!bank && accounts.length === 0 && <option value="cash">{t("Expenses.kinds.cash")}</option>}
            {sources.map((a) => <option key={a.id} value={a.id}>{t(`Expenses.kinds.${a.kind}`)} · {a.name}</option>)}
            {!bank && accounts.length === 0 && <option value="bank">{t("Expenses.kinds.bank")}</option>}
            {!bank && <option value="credit">{t("Expenses.credit")}</option>}
          </select>
        )}
      </Field>
      <Field label={t("Expenses.allocation")}>
        {(id) => (
          <select id={id} name="allocation" defaultValue={pre("allocation")} className={field}>
            <option value="shared">{t("Expenses.shared")}</option>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            <option value="general">{t("Expenses.general")}</option>
          </select>
        )}
      </Field>
      <Field label={t("Expenses.month")}>{(id) => <input id={id} name="month" type="month" defaultValue={pre("month") ?? (pre("day") ?? today()).slice(0, 7)} max={today().slice(0, 7)} className={field} />}</Field>
      <Field label={t("Expenses.day")}>{(id) => <input id={id} name="day" type="date" defaultValue={pre("day") ?? today()} max={today()} required {...bad("day")} className={field} />}</Field>
      <Field label={t("Expenses.note")}>{(id) => <input id={id} name="note" defaultValue={pre("note")} maxLength={200} className={field} />}</Field>
      {error && <p id={errorId} role="alert" className={`${danger} lg:col-span-full`}>{t(error)}</p>}
      {editing ? (
        <div className="flex gap-3 lg:col-span-full">
          <button type="submit" className={primary}>{t("Expenses.saveCorrection")}</button>
          <button type="button" onClick={editing.onCancel} className={secondary}>{t("Expenses.keep")}</button>
        </div>
      ) : (
        <button type="submit" className={`${primary} lg:col-span-full`}>{t("Expenses.save")}</button>
      )}
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
          <select id={id} name="kind" autoFocus className={field}>
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
