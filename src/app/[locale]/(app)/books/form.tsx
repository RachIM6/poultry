"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition, type FormEvent } from "react";
import { v7 as uuidv7 } from "uuid";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/format";
import { parseCentimes } from "@/lib/kernel/money";
import { field, primary, secondary } from "@/components/ui";
import { postManualEntryAction, type PostState } from "./actions";

/**
 * SPEC-finance FCX3: the owner's manual entry, with a live Σdebit − Σcredit. The accounts come from the server-rendered
 * <datalist id={accounts}>, not from this bundle. The id is made once per entry, so sending it again posts nothing twice.
 */
export function ManualEntryForm({ today, accounts, blocked }: { today: string; accounts: string; blocked: boolean }) {
  const t = useTranslations();
  const router = useRouter();
  const [id, setId] = useState(() => uuidv7());
  const [rows, setRows] = useState(2);
  const [diff, setDiff] = useState(0n);
  const [state, setState] = useState<PostState>({});
  const [pending, startTransition] = useTransition();

  const sum = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const total = (k: string) => data.getAll(k).reduce((s: bigint, v) => s + (parseCentimes(String(v)) ?? 0n), 0n);
    setDiff(total("debit") - total("credit"));
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const receipt = data.get("receipt");
    data.delete("receipt"); // ADR-011: through the upload route, after the entry exists
    startTransition(async () => {
      const posted = await postManualEntryAction(data);
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
    });
  };

  return (
    <form onSubmit={submit} onInput={(e) => sum(e.currentTarget)} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <fieldset disabled={blocked} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          {t("Books.day")}
          <input type="date" name="day" defaultValue={today} max={today} required className={field} />
        </label>
        <label className="flex flex-col gap-1">
          {t("Books.label")}
          <input name="label" maxLength={200} required className={field} />
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
            <input name="account" list={accounts} aria-label={t("Books.lineAccount", { n: i + 1 })} dir="ltr" className={`${field} w-full min-w-0`} />
            <input name="debit" inputMode="decimal" aria-label={t("Books.lineDebit", { n: i + 1 })} dir="ltr" className={`${field} w-full min-w-0`} />
            <input name="credit" inputMode="decimal" aria-label={t("Books.lineCredit", { n: i + 1 })} dir="ltr" className={`${field} w-full min-w-0`} />
          </div>
        ))}
        <button type="button" onClick={() => setRows((r) => r + 1)} className={secondary}>{t("Books.addLine")}</button>
        <p role="status" className={diff === 0n ? "text-olive" : "text-brick-fg"}>
          {t("Books.difference")} <bdi dir="ltr" className="tabular-nums">{formatMoney(diff)}</bdi>
        </p>
        <label className="flex flex-col gap-1">
          {t("Books.receiptFile")}
          <input type="file" name="receipt" accept="image/jpeg,image/png,image/webp,application/pdf" />
        </label>
        {state.messageKey && (
          <p role={state.ok ? "status" : "alert"}>
            {t(state.messageKey)}{" "}
            {state.ok && state.month && <Link href={{ pathname: "/books", query: { view: "journals", month: state.month } }} className="underline underline-offset-4">{t("Books.manualSee")}</Link>}
          </p>
        )}
        <button type="submit" disabled={pending} className={primary}>{t("Books.manualPost")}</button>
      </fieldset>
    </form>
  );
}
