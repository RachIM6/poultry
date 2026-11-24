"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { saveOverrideAction } from "./actions";
import { card, field, primary } from "@/components/ui";

type Account = { number: string; label: string };
type Props = {
  rows: { op: string; ruleAccount: string; default: Account | null; override: (Account & { applies: boolean }) | null }[];
  choices: Account[];
};

// account labels stay in French: the official charts and the accountants use them (as on the chart screen)
const Named = ({ a }: { a: Account | null }) => <bdi dir="ltr" lang="fr">{a ? `${a.number} · ${a.label}` : "—"}</bdi>;

/** SPEC-finance FN8: each overridable rule with its default and override; the owner picks a leaf of the rule's class. */
export function OverridesForm({ rows, choices }: Props) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(saveOverrideAction, {});
  const [rule, setRule] = useState(rows[0]?.ruleAccount ?? "");
  const opLabel = (op: string) => (op.startsWith("expense.") ? t(`Expenses.categories.${op.slice(8)}`) : t(`Chart.ops.${op}`));
  return (
    <>
      <ul className="flex flex-col gap-3" aria-label={t("Overrides.title")}>
        {rows.map((r) => (
          <li key={r.op} className={card}>
            <span className="font-semibold">{opLabel(r.op)}</span>
            <span className={`text-sm ${r.override?.applies ? "text-ink-2" : "font-semibold"}`}>
              {t("Overrides.default")} <Named a={r.default} />
            </span>
            {r.override && (
              <>
                <span className={`text-sm ${r.override.applies ? "font-semibold" : "text-ink-2"}`}>
                  {t("Overrides.override")} <Named a={r.override} />
                </span>
                {!r.override.applies && <p className="text-sm">{t("Overrides.notApplied")}</p>}
                <form action={action}>
                  <input type="hidden" name="ruleAccount" value={r.ruleAccount} />
                  <input type="hidden" name="account" value="" />
                  <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">{t("Overrides.reset")}</button>
                </form>
              </>
            )}
          </li>
        ))}
      </ul>
      <form action={action} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-semibold">{t("Overrides.rule")}</span>
          <select name="ruleAccount" value={rule} onChange={(e) => setRule(e.target.value)} disabled={pending} className={field}>
            {rows.map((r) => <option key={r.op} value={r.ruleAccount}>{opLabel(r.op)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">{t("Overrides.account")}</span>
          {/* FN8: a charge stays a charge, a revenue a revenue: only the rule's class is offered (the server checks it too) */}
          <select key={rule[0]} name="account" required disabled={pending} className={field}>
            {choices.filter((a) => a.number[0] === rule[0]).map((a) => <option key={a.number} value={a.number}>{`${a.number} · ${a.label}`}</option>)}
          </select>
        </label>
        {state.messageKey && <p role={state.ok ? "status" : "alert"}>{t(state.messageKey)}</p>}
        <button type="submit" disabled={pending} className={primary}>{t("Overrides.save")}</button>
      </form>
    </>
  );
}
