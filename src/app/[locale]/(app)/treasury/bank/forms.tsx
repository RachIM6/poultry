"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";
import { addStatementAction, matchAction } from "./actions";
import { field, primary, secondary, table } from "@/components/ui";

/** SPEC-finance FC9: a statement as printed, its end day and closing balance. */
export function StatementForm({ treasuryId, today }: { treasuryId: string; today: string }) {
  const t = useTranslations("Bank");
  const tAll = useTranslations();
  const locale = useLocale();
  const [state, action, pending] = useActionState(addStatementAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="treasuryId" value={treasuryId} />
      <input type="hidden" name="locale" value={locale} />
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{t("endDay")}</span>
        <input type="date" name="endDay" required max={today} className={field} />
      </label>
      <div className="flex flex-col gap-1">
        <label htmlFor="closing" className="font-semibold">{t("closing")}</label>
        <input id="closing" name="closing" required dir="ltr" autoComplete="off" className={field} aria-describedby="closing-hint" />
        <span id="closing-hint" className="text-sm text-ink-2">{t("closingHint")}</span>
      </div>
      {state.messageKey && <p role="alert">{tAll(state.messageKey)}</p>}
      <button type="submit" disabled={pending} className={primary}>{t("save")}</button>
    </form>
  );
}

type Line = { id: string; day: string; journal: string; label: string; amount: string; ticked: boolean; tickedOn: string | null };

/** The statement's lines: ticked on it, or not yet at the bank. Read-only for the accountant (no buttons). */
export function MatchTable({ statementId, lines, canWrite }: { statementId: string; lines: Line[]; canWrite: boolean }) {
  const t = useTranslations("Bank");
  const tAll = useTranslations();
  const [state, action, pending] = useActionState(matchAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="statementId" value={statementId} />
      {state.messageKey && <p role="alert">{tAll(state.messageKey)}</p>}
      <table className={table}>
        <thead>
          <tr>
            <th className="p-2 text-start">{tAll("Treasury.label")}</th>
            <th className="p-2 text-end">{t("amount")}</th>
            <th className="p-2 text-start">{t("state")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-t border-line">
              <td className="p-2">
                <span className="block">{l.label}</span>
                <span className="block text-ink-2">{l.day} · {l.journal}</span>
              </td>
              <td dir="ltr" className="whitespace-nowrap p-2 text-end tabular-nums">{l.amount}</td>
              <td className="p-2">
                {l.tickedOn ? (
                  <span className="text-ink-2">{t("tickedOn", { day: l.tickedOn })}</span>
                ) : (
                  <span className="flex items-center gap-2">
                    {l.ticked && <span><span aria-hidden="true">✓</span><span className="sr-only">{t("ticked")}</span></span>}
                    {canWrite && (
                      <button type="submit" name={l.ticked ? "untick" : "tick"} value={l.id} disabled={pending} className={secondary}>
                        {t(l.ticked ? "untick" : "tick")}
                      </button>
                    )}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </form>
  );
}
