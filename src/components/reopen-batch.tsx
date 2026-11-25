"use client";

import { useTranslations } from "next-intl";
import { useId, type FormEvent } from "react";
import type { Write } from "@/components/daily-entry";
import { useFieldError, useInline } from "@/components/focus";
import { FLOCK_MUTATIONS as M, checkReopen, type BatchDto } from "@/modules/flock/shared";
import { danger, field, primary, secondary } from "@/components/ui";

// SPEC B6 "Reopening" on a closed batch's screen, the owner's: a confirmation with a reason. Its own chunk (SPEC §9.3).
// The phone checks the house as the server; the period lock is the server's (finance), which may still refuse it.

/** The batch open again on the phone, as the server reopens it: its closing's figures gone. */
export function reopenedLocally(batch: BatchDto): BatchDto {
  const open: BatchDto = { ...batch, status: "open" };
  for (const k of ["closedOn", "closeReason", "soldGrams", "costCentimes", "costPerKgCentimes"] as const) delete open[k];
  return open;
}

export function ReopenBatchForm({ batch, batches, write }: { batch: BatchDto; batches: BatchDto[]; write: Write }) {
  const t = useTranslations();
  const reasonId = useId();
  const { open, opener, close } = useInline<"reopen">();
  const { id: errorId, error, set: setError, field: bad } = useFieldError();
  if (!open) return <button type="button" {...opener("reopen")} className={`${secondary} self-start`}>{t("Closing.reopen")}</button>;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const reason = String(new FormData(e.currentTarget).get("reason") ?? "").trim();
    if (!reason) return setError("errors.INVALID_INPUT", e.currentTarget, "reason");
    const checked = checkReopen(batch, batches); // as the server
    if (!checked.ok) return setError(`errors.${checked.error}`);
    setError(undefined);
    await write({ type: M.reopenBatch, payload: { batchId: batch.id, reason } }, [{ entity: "batch", id: batch.id, data: reopenedLocally(batch) }]);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-3" aria-labelledby={`${reasonId}-title`}>
      <h3 id={`${reasonId}-title`} className="text-lg font-semibold">{t("Closing.reopen")}</h3>
      <p>{t("Closing.reopenWarning")}</p>
      <div className="flex flex-col gap-1">
        <label htmlFor={reasonId}>{t("Closing.reopenReason")}</label>
        <input id={reasonId} name="reason" required maxLength={200} autoFocus {...bad("reason")} className={field} />
      </div>
      {error && <p id={errorId} role="alert" className={danger}>{t(error)}</p>}
      <div className="flex gap-3">
        <button type="submit" className={primary}>{t("Closing.reopenConfirm")}</button>
        <button type="button" onClick={close} className={secondary}>{t("Closing.cancel")}</button>
      </div>
    </form>
  );
}
