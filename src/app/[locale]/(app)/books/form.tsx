"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { v7 as uuidv7 } from "uuid";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/format";
import { parseCentimes } from "@/lib/kernel/money";
import { OfflineHint, unsent, useOnline } from "@/components/online";
import { Sheet, useCloseSheet } from "@/components/sheet";
import { danger, field, primary, secondarySm } from "@/components/ui";
import { treasuryKindOfAccount, type TreasuryAccountDto } from "@/modules/finance/shared";
import { periodLockAction, postManualEntryAction, reverseEntryAction, type PostState } from "./actions";

type Prefill = { day: string; label: string; debit: string; bank: string };

/**
 * SPEC-finance FCX3: the owner's manual entry, with a live Σdebit − Σcredit. The accounts come from the server-rendered
 * <datalist id={accounts}>, not from this bundle. The id is made once per entry, so sending it again posts nothing twice.
 * FN3: a line on 5141 or 5161 names the bank account or cash box it moves.
 * FC9: a bank statement's line not in the books comes prefilled as the first line, 5141 on its bank account; the user
 * types the other side. The first entry only.
 */
export function ManualEntryForm({ today, accounts, treasuries, prefill }: { today: string; accounts: string; treasuries: TreasuryAccountDto[]; prefill?: Prefill }) {
  const t = useTranslations();
  const router = useRouter();
  const [id, setId] = useState(() => uuidv7());
  const [rows, setRows] = useState(2);
  const [diff, setDiff] = useState(() => (prefill && parseCentimes(prefill.debit)) || 0n);
  const [pre, setPre] = useState(prefill);
  const [typed, setTyped] = useState<string[]>(prefill ? ["5141"] : []); // each row's account, for its bank account or cash box
  const [unread, setUnread] = useState<string[]>([]); // the amounts that don't read, "debit-0", "credit-1"
  const [said, setSaid] = useState(""); // WCAG 4.1.3: the balance, said on leaving an amount, not on each keystroke
  const [state, setState] = useState<PostState>({});
  const [pending, startTransition] = useTransition();
  const online = useOnline();
  const close = useCloseSheet(); // the journal link leaves the sheet

  const sum = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const total = (k: string) => data.getAll(k).reduce((s: bigint, v) => s + (parseCentimes(String(v)) ?? 0n), 0n);
    setDiff(total("debit") - total("credit"));
    setTyped(data.getAll("account").map((v) => String(v).trim()));
    const bad = (k: string) => data.getAll(k).flatMap((v, i) => (String(v).trim() !== "" && parseCentimes(String(v)) === null ? [`${k}-${i}`] : []));
    setUnread([...bad("debit"), ...bad("credit")]);
  };
  const balance = diff === 0n ? t("Books.entryBalanced") : t("Books.entryUnbalanced");
  const invalid = (name: string) => unread.includes(name) || undefined;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const receipt = data.get("receipt");
    data.delete("receipt"); // ADR-011: through the upload route, after the entry exists
    startTransition(async () => {
      const posted = await unsent(postManualEntryAction(data));
      if (posted.ok && receipt instanceof File && receipt.size > 0) {
        const res = await fetch(`/api/files?purpose=receipt&manualEntry=${id}`, { method: "POST", body: receipt, headers: { "x-requested-with": "poultry" } }).catch(() => null);
        if (!res?.ok) {
          // The form stays: sending it again posts nothing twice and retries the file.
          const body = (await res?.json().catch(() => null)) as { messageKey?: string } | null;
          return setState({ messageKey: body?.messageKey ?? "Files.failed" });
        }
        router.refresh();
      }
      setState(posted);
      if (!posted.ok) return;
      form.reset();
      setId(uuidv7());
      setRows(2);
      setDiff(0n);
      setTyped([]);
      setUnread([]);
      setSaid("");
      setPre(undefined);
    });
  };

  return (
    <form
      onSubmit={submit}
      onInput={(e) => sum(e.currentTarget)}
      onBlur={(e) => ["debit", "credit"].includes((e.target as Element).getAttribute("name") ?? "") && setSaid(diff === 0n ? balance : `${balance} · ${formatMoney(diff)}`)}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="id" value={id} />
      <fieldset key={id} className="flex min-w-0 flex-col gap-3">
        <label className="flex flex-col gap-1">
          {t("Books.day")}
          <input type="date" name="day" defaultValue={pre?.day ?? today} max={today} required className={field} />
        </label>
        <label className="flex flex-col gap-1">
          {t("Books.label")}
          <input name="label" defaultValue={pre?.label} maxLength={200} required className={field} />
        </label>
        <label className="flex flex-col gap-1">
          {t("Books.piece")}
          <input name="piece" maxLength={40} dir="ltr" className={field} />
        </label>
        <div aria-hidden className="grid grid-cols-[2fr_1fr_1fr] gap-2 text-sm text-ink-2">
          <span>{t("Books.account")}</span>
          <span>{t("Books.debit")}</span>
          <span>{t("Books.credit")}</span>
        </div>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="grid grid-cols-[2fr_1fr_1fr] gap-2">
            <input name="account" defaultValue={i === 0 && pre ? "5141" : undefined} list={accounts} aria-label={t("Books.lineAccount", { n: i + 1 })} dir="ltr" className={`${field} w-full min-w-0`} />
            <input name="debit" defaultValue={i === 0 ? pre?.debit : undefined} inputMode="decimal" aria-label={t("Books.lineDebit", { n: i + 1 })} aria-invalid={invalid(`debit-${i}`)} dir="ltr" className={`${field} w-full min-w-0 aria-invalid:border-alert`} />
            <input name="credit" inputMode="decimal" aria-label={t("Books.lineCredit", { n: i + 1 })} aria-invalid={invalid(`credit-${i}`)} dir="ltr" className={`${field} w-full min-w-0 aria-invalid:border-alert`} />
            <TreasurySelect kind={treasuryKindOfAccount(typed[i] ?? "")} row={i} treasuries={treasuries} selected={i === 0 ? pre?.bank : undefined} />
          </div>
        ))}
        <button type="button" onClick={() => setRows((r) => r + 1)} className={secondarySm}>{t("Books.addLine")}</button>
        <p className={diff === 0n ? "text-olive" : "text-brick-fg"}>
          {t("Books.difference")} <bdi dir="ltr" className="tabular-nums">{formatMoney(diff)}</bdi> · {balance}
        </p>
        <p role="status" className="sr-only">{said}</p>
        <label className="flex flex-col gap-1">
          {t("Books.receiptFile")}
          <input type="file" name="receipt" accept="image/jpeg,image/png,image/webp,application/pdf" className="min-h-11" />
        </label>
        {state.messageKey && (
          <p role={state.ok ? "status" : "alert"} className={state.ok ? undefined : danger}>
            {t(state.messageKey)}{" "}
            {state.ok && state.month && <Link href={{ pathname: "/books", query: { view: "journals", month: state.month } }} onClick={close} className="underline underline-offset-4">{t("Books.manualSee")}</Link>}
          </p>
        )}
        <OfflineHint online={online} />
        <button type="submit" disabled={pending || !online} className={primary}>{t("Books.manualPost")}</button>
      </fieldset>
    </form>
  );
}

/**
 * tasks/plan-ui-cleanup.md §2.7: the manual entry in a sheet, open at once when /treasury/bank sends a line to book (FC9).
 * It stays open once posted: the form says so, links to the journal, and takes the next entry.
 */
export function ManualEntrySheet({ label, open: initial, children }: { label: string; open: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initial);
  const opener = useRef<HTMLButtonElement>(null);
  const was = useRef(initial);
  useEffect(() => {
    if (was.current && !open) opener.current?.focus(); // back on the button once the sheet has gone (WCAG 2.4.3)
    was.current = open;
  }, [open]);
  return (
    <>
      <button ref={opener} type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} className={secondarySm}>{label}</button>
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>{children}</Sheet>
    </>
  );
}

/** FN3: the bank account (5141) or cash box (5161) of one line, sent as `treasury-<row>`; none for other accounts. */
function TreasurySelect({ kind, row, treasuries, selected }: { kind: TreasuryAccountDto["kind"] | null; row: number; treasuries: TreasuryAccountDto[]; selected?: string }) {
  const t = useTranslations();
  if (!kind) return null;
  const options = treasuries.filter((a) => a.kind === kind);
  if (options.length === 0) return <p className="col-span-3 text-sm text-brick-fg">{t("Books.treasuryNone")}</p>;
  return (
    <select name={`treasury-${row}`} required defaultValue={selected ?? ""} aria-label={t("Books.lineTreasury", { n: row + 1 })} className={`${field} col-span-3`}>
      <option value="" disabled>{t(kind === "bank" ? "Books.treasuryBank" : "Books.treasuryCash")}</option>
      {options.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );
}

/** SPEC-finance FN5, FCX3: the owner cancels a manual entry, after a confirmation; then types the right one. */
export function ReverseEntryForm({ entryId, name, reversed }: { entryId: string; name: string; reversed: boolean }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(reverseEntryAction, {});
  const online = useOnline();
  return (
    <form action={action} onSubmit={(e) => !confirm(t("Books.reverseConfirm", { name })) && e.preventDefault()} className="flex flex-col items-start gap-2">
      <input type="hidden" name="entryId" value={entryId} />
      {!reversed && <button type="submit" disabled={pending || !online} aria-label={t("Books.reverseOf", { name })} className={secondarySm}>{t("Books.reverse")}</button>}
      {state.messageKey && <p role={state.ok ? "status" : "alert"} className={state.ok ? undefined : danger}>{t(state.messageKey)}</p>}
    </form>
  );
}

/** SPEC-finance FN5: the owner locks the month (after sending the export) or unlocks it. */
export function PeriodLockForm({ month, locked }: { month: string; locked: boolean }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(periodLockAction, {});
  const online = useOnline();
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="locked" value={locked ? "0" : "1"} />
      <OfflineHint online={online} />
      <button type="submit" disabled={pending || !online} className={secondarySm}>{t(locked ? "Books.unlockMonth" : "Books.lockMonth")}</button>
      {state.messageKey && <p role={state.ok ? "status" : "alert"} className={state.ok ? undefined : danger}>{t(state.messageKey)}</p>}
    </form>
  );
}
