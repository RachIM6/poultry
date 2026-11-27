"use client";

import { useTranslations } from "next-intl";
import { useId, type FormEvent } from "react";
import type { Write } from "@/components/daily-entry";
import { useFieldError, useInline } from "@/components/focus";
import { formActions } from "@/components/layout";
import { Sheet } from "@/components/sheet";
import { cleanedOutSince, type CleanoutDto } from "@/modules/biosecurity/shared";
import { FLOCK_MUTATIONS as M, checkReopen, type BatchDto } from "@/modules/flock/shared";
import { danger, field, ghost, primary, secondarySm } from "@/components/ui";

// SPEC B6 "Reopening" on a closed batch's screen, the owner's: a confirmation with a reason. Its own chunk (SPEC §9.3).
// The phone checks the house and its clean-outs as the server; the period lock is the server's (finance), which may
// still refuse it.

/** The batch open again on the phone, as the server reopens it: its closing's figures gone. */
export function reopenedLocally(batch: BatchDto): BatchDto {
  const open: BatchDto = { ...batch, status: "open" };
  for (const k of ["closedOn", "closeReason", "soldGrams", "costCentimes", "costPerKgCentimes"] as const) delete open[k];
  return open;
}

export function ReopenBatchForm({ batch, batches, cleanouts, write }: { batch: BatchDto; batches: BatchDto[]; cleanouts: CleanoutDto[]; write: Write }) {
  const t = useTranslations();
  const reasonId = useId();
  const { open, opener, close } = useInline<"reopen">();
  const { id: errorId, error, set: setError, field: bad } = useFieldError();

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const reason = String(new FormData(e.currentTarget).get("reason") ?? "").trim();
    if (!reason) return setError("errors.INVALID_INPUT", e.currentTarget, "reason");
    const checked = checkReopen(batch, batches); // as the server
    if (!checked.ok) return setError(`errors.${checked.error}`);
    if (cleanedOutSince(cleanouts, { ...batch, closedOn: batch.closedOn! })) return setError("errors.CLEANOUT_STARTED"); // BS4
    setError(undefined);
    await write({ type: M.reopenBatch, payload: { batchId: batch.id, reason } }, [{ entity: "batch", id: batch.id, data: reopenedLocally(batch) }]);
  };

  // tasks/plan-ui-cleanup.md §2.7: an occasional form, in a sheet.
  return (
    <>
      <button type="button" aria-haspopup="dialog" {...opener("reopen")} className={`${secondarySm} w-fit`}>{t("Closing.reopen")}</button>
      <Sheet open={open === "reopen"} onClose={close} title={t("Closing.reopen")}>
        <form onSubmit={submit} className="flex flex-col gap-3" aria-label={t("Closing.reopen")}>
          <p>{t("Closing.reopenWarning")}</p>
          <div className="flex flex-col gap-1">
            <label htmlFor={reasonId}>{t("Closing.reopenReason")}</label>
            <input id={reasonId} name="reason" required maxLength={200} autoFocus {...bad("reason")} className={field} />
          </div>
          {error && <p id={errorId} role="alert" className={danger}>{t(error)}</p>}
          <div className={formActions}>
            <button type="submit" className={primary}>{t("Closing.reopenConfirm")}</button>
            <button type="button" onClick={close} className={ghost}>{t("Closing.cancel")}</button>
          </div>
        </form>
      </Sheet>
    </>
  );
}
