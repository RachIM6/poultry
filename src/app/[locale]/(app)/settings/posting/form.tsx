"use client";

import { useTranslations } from "next-intl";
import { startTransition, useActionState, useState } from "react";
import { saveOverrideAction } from "./actions";
import { OfflineHint, useOnline } from "@/components/online";
import { dataTable, dataTableWrap, formActions } from "@/components/layout";
import { SheetButton, useCloseSheet } from "@/components/sheet";
import { danger, done, field, ghost, primary } from "@/components/ui";

type Account = { number: string; label: string };
type Row = { op: string; ruleAccount: string; default: Account | null; override: (Account & { applies: boolean }) | null };
type Props = { rows: Row[]; choices: Account[] };

// account labels stay in French: the official charts and the accountants use them (as on the chart screen)
const Named = ({ a }: { a: Account | null }) => <bdi dir="ltr" lang="fr">{a ? `${a.number} · ${a.label}` : "—"}</bdi>;
const wide = "hidden lg:table-cell";

/**
 * SPEC-finance FN8: each overridable rule with its default and override. « Remplacer » opens the rule's form in a sheet
 * (tasks/plan-ui-cleanup.md §4); saved, the sheet closes and the page says so.
 */
export function OverridesForm({ rows, choices }: Props) {
  const t = useTranslations();
  const [saved, setSaved] = useState<string>();
  const opLabel = (op: string) => (op.startsWith("expense.") ? t(`Expenses.categories.${op.slice(8)}`) : t(`Chart.ops.${op}`));
  const cells = (r: Row) => [
    { title: t("Overrides.default"), cell: <span className={r.override?.applies ? "text-ink-2" : "font-semibold"}><Named a={r.default} /></span> },
    {
      title: t("Overrides.override"),
      cell: r.override && (
        <span className="flex flex-col gap-1">
          <span className={r.override.applies ? "font-semibold" : "text-ink-2"}><Named a={r.override} /></span>
          {!r.override.applies && <span>{t("Overrides.notApplied")}</span>}
        </span>
      ),
    },
  ];
  return (
    <>
      {saved && <p role="status" className={done}>{t(saved)}</p>}
      <div className={dataTableWrap}>
        <table className={dataTable} aria-label={t("Overrides.title")}>
          <thead>
            <tr>
              <th scope="col">{t("Overrides.rule")}</th>
              <th scope="col" className={wide}>{t("Overrides.default")}</th>
              <th scope="col" className={wide}>{t("Overrides.override")}</th>
              <th scope="col"><span className="sr-only">{t("Overrides.replace")}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const rule = opLabel(r.op);
              return (
                <tr key={r.op}>
                  <th scope="row" className="text-ink">
                    {rule}
                    {/* the phone: the accounts under the operation, each saying what it is */}
                    <span className="mt-1 flex flex-col gap-0.5 font-normal lg:hidden">
                      {cells(r).map(({ title, cell }) => cell && <span key={title}><span className="text-ink-2">{title} </span>{cell}</span>)}
                    </span>
                  </th>
                  {cells(r).map(({ title, cell }) => <td key={title} className={wide}>{cell}</td>)}
                  <td>
                    {/* a flex row, not text-end: the sheet's dialog sits in this cell and would inherit it */}
                    <div className="flex justify-end">
                      <SheetButton label={<>{t("Overrides.replace")}<span className="sr-only"> : {rule}</span></>} title={t("Overrides.replaceOf", { rule })}>
                        <ReplaceForm row={r} rule={rule} choices={choices} onSaved={setSaved} />
                      </SheetButton>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** One rule's form, in its sheet: a leaf of the rule's class, or back to the default when it is replaced. */
function ReplaceForm({ row, rule, choices, onSaved }: { row: Row; rule: string; choices: Account[]; onSaved: (key: string) => void }) {
  const t = useTranslations();
  const close = useCloseSheet();
  const online = useOnline();
  const [state, action, pending] = useActionState(async (before: { ok?: boolean; messageKey?: string }, form: FormData) => {
    const after = await saveOverrideAction(before, form);
    if (after.ok && after.messageKey) {
      onSaved(after.messageKey);
      close();
    }
    return after;
  }, {});
  const reset = () => {
    const form = new FormData();
    form.set("ruleAccount", row.ruleAccount);
    form.set("account", ""); // the server reads it as null: back to the default
    startTransition(() => action(form));
  };
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="ruleAccount" value={row.ruleAccount} />
      <p className="text-sm">
        <span className="text-ink-2">{t("Overrides.default")} </span><Named a={row.default} />
      </p>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{t("Overrides.account")}</span>
        {/* FN8: a charge stays a charge, a revenue a revenue: only the rule's class is offered (the server checks it too) */}
        <select name="account" required defaultValue={row.override?.applies ? row.override.number : undefined} disabled={pending} className={field}>
          {choices.filter((a) => a.number[0] === row.ruleAccount[0]).map((a) => <option key={a.number} value={a.number}>{`${a.number} · ${a.label}`}</option>)}
        </select>
      </label>
      {state.messageKey && !state.ok && <p role="alert" className={danger}>{t(state.messageKey)}</p>}
      <OfflineHint online={online} />
      <div className={formActions}>
        <button type="submit" disabled={pending || !online} className={primary}>{t("Overrides.save")}</button>
        {row.override && (
          <button type="button" onClick={reset} disabled={pending || !online} aria-label={t("Overrides.resetOf", { rule })} className={ghost}>{t("Overrides.reset")}</button>
        )}
      </div>
    </form>
  );
}
