import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { dataTable, dataTableWrap } from "@/components/layout";
import { Page } from "@/components/page";
import { redirect } from "@/i18n/navigation";
import { can } from "@/lib/permissions";
import { chartView } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { SettingsTabs } from "../accounting/settings-tabs";

// Mockup F-Chart, SPEC-finance FN2, FN6, FN8: each operation and the account it is posted to, in both charts, and the
// owner's replacement when there is one (set on /settings/posting). Online, read-only.
// tasks/plan-ui-cleanup.md §4: one table grouped by account class under sticky class rows, the entity's chart first.
// The phone shows the accounts under the operation instead of in their columns.
export default function ChartPage() {
  return (
    <Suspense fallback={<Page width="wide" back="/more" />}>
      <Content />
    </Suspense>
  );
}

// The plan's grouping, by the account's class (first digit); clients and suppliers are both "tiers".
const GROUPS = [
  ["charges", "6"],
  ["revenue", "7"],
  ["thirdParties", "34"],
  ["cash", "5"],
  ["capital", "1"],
] as const;
const wide = "hidden lg:table-cell";

async function Content() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations()]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const view = await chartView(ctx.value);
  if (!view.ok) return redirect({ href: "/dashboard", locale: lang });
  const { rows, pca } = view.value;
  const opLabel = (op: string) => (op.startsWith("expense.") ? t(`Expenses.categories.${op.slice(8)}`) : t(`Chart.ops.${op}`));
  const replaced = rows.some((r) => r.override); // the "replaced" column only when the owner replaced an account
  // The entity's chart first and in bold (unless replaced), the other one muted.
  const charts = (pca ? ["pca", "cgnc"] : ["cgnc", "pca"]) as ("pca" | "cgnc")[];
  const classOf = (r: (typeof rows)[number]) => (r.pca ?? r.cgnc)?.number[0] ?? "?"; // "?": no account, in "other"
  const groups = [
    ...GROUPS.map(([key, classes]) => ({ key, rows: rows.filter((r) => classes.includes(classOf(r))) })),
    { key: "other", rows: rows.filter((r) => !GROUPS.some(([, classes]) => classes.includes(classOf(r)))) },
  ].filter((g) => g.rows.length > 0);
  const cols = 1 + charts.length + (replaced ? 1 : 0);
  // account labels stay in French: the official charts and the accountants use them (same as the export)
  const account = (a: { number: string; label: string } | null, active: boolean) => (
    <bdi dir="ltr" lang="fr" className={active ? "font-semibold" : "text-ink-2"}>{a ? `${a.number} · ${a.label}` : "—"}</bdi>
  );
  const accounts = (r: (typeof rows)[number]) => [
    ...charts.map((c, i) => ({ title: t(`Chart.${c}`), cell: account(r[c], i === 0 && !r.override) })),
    ...(replaced ? [{ title: t("Chart.override"), cell: r.override ? account(r.override, true) : null }] : []),
  ];
  return (
    <Page width="wide" back="/more" title={t("Accounting.title")} nav={<SettingsTabs current="chart" owner={can(ctx.value, "finance.manage")} />}>
      <div className="flex max-w-prose flex-col gap-1 text-sm text-ink-2">
        <p>{t("Chart.intro")}</p>
        <p>{t(pca ? "Chart.activePca" : "Chart.activeCgnc")}</p>
      </div>
      <div className={dataTableWrap}>
        <table className={dataTable} aria-label={t("Chart.title")}>
          <thead>
            <tr>
              <th scope="col">{t("Overrides.rule")}</th>
              {charts.map((c) => <th key={c} scope="col" className={wide}>{t(`Chart.${c}`)}</th>)}
              {replaced && <th scope="col" className={wide}>{t("Chart.override")}</th>}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.key}>
              <tr>
                {/* sticky under the sticky header row (36 px): the class in view stays named while its lines scroll */}
                <th colSpan={cols} scope="colgroup" className="bg-shell font-semibold! text-ink lg:sticky lg:top-9">{t(`Chart.groups.${g.key}`)}</th>
              </tr>
              {g.rows.map((r) => (
                <tr key={r.op}>
                  <th scope="row" className="text-ink">
                    {opLabel(r.op)}
                    <span className="mt-1 flex flex-col gap-0.5 font-normal lg:hidden">
                      {accounts(r).map(({ title, cell }) => cell && <span key={title} className="flex gap-2"><span className="w-16 shrink-0 text-ink-2">{title}</span>{cell}</span>)}
                    </span>
                  </th>
                  {accounts(r).map(({ title, cell }) => <td key={title} className={wide}>{cell}</td>)}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <p className="max-w-prose text-sm text-ink-2">{t("Chart.review")}</p>
    </Page>
  );
}
