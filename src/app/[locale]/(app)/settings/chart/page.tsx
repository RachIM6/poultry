import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { row, rowHead, rowTable } from "@/components/layout";
import { Page } from "@/components/page";
import { redirect } from "@/i18n/navigation";
import { chartView } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";

// Mockup F-Chart, SPEC-finance FN2, FN6, FN8: each operation and the account it is posted to, in both charts, and the
// owner's replacement when there is one (set on /settings/posting). Online, read-only.
// Wide screens: one table, operation · PCA · PCGE (· replaced); the phone keeps its cards.
export default function ChartPage() {
  return (
    <Suspense fallback={<Page width="wide" back="/more" />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations()]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const view = await chartView(ctx.value);
  if (!view.ok) return redirect({ href: "/dashboard", locale: lang });
  const { rows, pca } = view.value;
  const opLabel = (op: string) => (op.startsWith("expense.") ? t(`Expenses.categories.${op.slice(8)}`) : t(`Chart.ops.${op}`));
  // On the phone each account says its chart; from lg the table's head says it, and the label stays for screen readers.
  const account = (title: string, a: { number: string; label: string } | null, active: boolean) => (
    <span className={`flex gap-2 text-sm ${active ? "font-semibold" : "text-ink-2"}`}>
      <span className="w-20 shrink-0 lg:sr-only">{title}</span>
      {/* account labels stay in French: the official charts and the accountants use them (same as the export) */}
      <bdi dir="ltr" lang="fr">{a ? `${a.number} · ${a.label}` : "—"}</bdi>
    </span>
  );
  const replaced = rows.some((r) => r.override); // the "replaced" column only when the owner replaced an account
  return (
    <Page width="wide" back="/more" title={t("Chart.title")}>
      <p className="max-w-prose">{t("Chart.intro")}</p>
      <p className="text-sm text-ink-2">{t(pca ? "Chart.activePca" : "Chart.activeCgnc")}</p>
      <ul
        className={`${rowTable} ${replaced ? "lg:grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,1.3fr))]" : "lg:grid-cols-[minmax(0,1fr)_repeat(2,minmax(0,1.4fr))]"}`}
        aria-label={t("Chart.title")}
      >
        <li aria-hidden="true" className={rowHead}>
          <span>{t("Overrides.rule")}</span>
          <span>{t("Chart.pca")}</span>
          <span>{t("Chart.cgnc")}</span>
          {replaced && <span>{t("Chart.override")}</span>}
        </li>
        {rows.map((r) => (
          <li key={r.op} className={row}>
            <span className="font-semibold">{opLabel(r.op)}</span>
            {account(t("Chart.pca"), r.pca, pca && !r.override)}
            {account(t("Chart.cgnc"), r.cgnc, !pca && !r.override)}
            {r.override && account(t("Chart.override"), r.override, true)}
          </li>
        ))}
      </ul>
      <p className="max-w-prose text-sm text-ink-2">{t("Chart.review")}</p>
    </Page>
  );
}
