"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { field, primary, secondary } from "@/components/ui";
import { createLoanAction, createSubsidyAction, discardLoanAction, payInstallmentAction, scheduleAction, type LoanState } from "./actions";

const row = "flex min-w-0 flex-col gap-1";
const wide = `${field} w-full min-w-0`; // a long option or a date never widens the form past the phone

/**
 * SPEC-finance FC2: the owner types a loan from its contract; its schedule comes back as a draft. The id is made once
 * per loan, so sending the form again creates one. Refused, the form keeps what was typed.
 */
export function LoanForm({ today, banks }: { today: string; banks: { id: string; name: string }[] }) {
  const t = useTranslations();
  const [id, setId] = useState(() => uuidv7());
  const [opening, setOpening] = useState(false);
  const [state, setState] = useState<LoanState>({});
  const [pending, startTransition] = useTransition();

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      const created = await createLoanAction(data);
      setState(created);
      if (!created.ok) return;
      form.reset();
      setId(uuidv7());
      setOpening(false);
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <fieldset className="flex min-w-0 flex-col gap-3">
        <label className={row}>
          {t("Loans.lender")}
          <input name="lender" maxLength={120} required className={wide} />
        </label>
        <label className={row}>
          {t("Loans.bank")}
          <select name="treasuryId" required defaultValue="" className={wide}>
            <option value="" disabled>—</option>
            {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="opening" checked={opening} onChange={(e) => setOpening(e.target.checked)} className="mt-1 size-5" />
          {t("Loans.opening")}
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={row}>
            {t(opening ? "Loans.principalOpening" : "Loans.principal")}
            <input name="principal" inputMode="decimal" required dir="ltr" className={wide} />
          </label>
          <label className={row}>
            {t("Loans.rate")}
            <input name="rate" inputMode="decimal" required dir="ltr" className={wide} />
          </label>
          <label className={row}>
            {t("Loans.frequency")}
            <select name="frequency" required defaultValue="" className={wide}>
              <option value="" disabled>—</option>
              {(["monthly", "quarterly"] as const).map((f) => <option key={f} value={f}>{t(`Loans.frequencies.${f}`)}</option>)}
            </select>
          </label>
          <label className={row}>
            {t("Loans.installments")}
            <input type="number" name="installments" min={1} max={600} step={1} required dir="ltr" className={wide} />
          </label>
          <label className={row}>
            {t("Loans.deferral")}
            <input type="number" name="deferral" min={0} max={120} step={1} defaultValue={0} dir="ltr" className={wide} />
          </label>
          {!opening && (
            <label className={row}>
              {t("Loans.disbursedOn")}
              <input type="date" name="disbursedOn" max={today} required className={wide} />
            </label>
          )}
          <label className={row}>
            {t("Loans.firstDueOn")}
            <input type="date" name="firstDueOn" required className={wide} />
          </label>
        </div>
        {state.messageKey && <p role={state.ok ? "status" : "alert"}>{t(state.messageKey)}</p>}
        <button type="submit" disabled={pending} className={primary}>{t("Loans.save")}</button>
      </fieldset>
    </form>
  );
}

/**
 * SPEC-finance FC2 (T106): the owner records a subsidy as received (default FQ17), with the register's assets it
 * finances. The id is made once per subsidy, so sending the form again records one. Refused, the form keeps what was typed.
 */
export function SubsidyForm({ today, banks, assets }: { today: string; banks: { id: string; name: string }[]; assets: { id: string; label: string }[] }) {
  const t = useTranslations();
  const [id, setId] = useState(() => uuidv7());
  const [state, setState] = useState<LoanState>({});
  const [pending, startTransition] = useTransition();

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      const created = await createSubsidyAction(data);
      setState(created);
      if (!created.ok) return;
      form.reset();
      setId(uuidv7());
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <fieldset className="flex min-w-0 flex-col gap-3">
        <label className={row}>
          {t("Subsidies.label")}
          <input name="label" maxLength={120} required className={wide} />
        </label>
        <label className={row}>
          {t("Subsidies.grantor")}
          <input name="grantor" maxLength={120} required className={wide} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={row}>
            {t("Subsidies.amount")}
            <input name="amount" inputMode="decimal" required dir="ltr" className={wide} />
          </label>
          <label className={row}>
            {t("Subsidies.receivedOn")}
            <input type="date" name="receivedOn" max={today} required className={wide} />
          </label>
        </div>
        <label className={row}>
          {t("Subsidies.bank")}
          <select name="treasuryId" required defaultValue="" className={wide}>
            <option value="" disabled>—</option>
            {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-1">{t("Subsidies.assets")}</legend>
          {assets.map((a) => (
            <label key={a.id} className="flex items-start gap-2">
              <input type="checkbox" name="assetId" value={a.id} className="mt-1 size-5" />
              {a.label}
            </label>
          ))}
        </fieldset>
        {state.messageKey && <p role={state.ok ? "status" : "alert"}>{t(state.messageKey)}</p>}
        <button type="submit" disabled={pending} className={primary}>{t("Subsidies.save")}</button>
      </fieldset>
    </form>
  );
}

/** FC2: a draft's rows, adjusted to the bank's table, saved or confirmed. Refused, the rows keep what was typed. */
export function ScheduleForm({ loanId, children }: { loanId: string; children: ReactNode }) {
  const t = useTranslations();
  const [state, setState] = useState<LoanState>({});
  const [pending, startTransition] = useTransition();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(async () => setState(await scheduleAction(data)));
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input type="hidden" name="loanId" value={loanId} />
      {children}
      {state.messageKey && <p role={state.ok ? "status" : "alert"}>{t(state.messageKey)}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="intent" value="save" disabled={pending} className={secondary}>{t("Loans.saveRows")}</button>
        <button type="submit" name="intent" value="confirm" disabled={pending} className={primary}>{t("Loans.confirm")}</button>
      </div>
    </form>
  );
}

const ACTIONS = { pay: payInstallmentAction, discard: discardLoanAction };

/** An installment marked paid, or a draft thrown away: the server-rendered fields, sent to the server action. */
export function LoanActionForm({ kind, submit, children }: { kind: keyof typeof ACTIONS; submit: string; children: ReactNode }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(ACTIONS[kind], {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      {children}
      <button type="submit" disabled={pending} className={secondary}>{submit}</button>
      {state.messageKey && <p role={state.ok ? "status" : "alert"} className="basis-full">{t(state.messageKey)}</p>}
    </form>
  );
}
