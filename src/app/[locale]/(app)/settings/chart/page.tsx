import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BackLink } from "@/components/app-nav";
import { card } from "@/components/ui";
import { redirect } from "@/i18n/navigation";
import { chartView } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";

// Mockup F-Chart, SPEC-finance FN2, FN6: each operation and the account it is posted to, in both charts. Online, read-only.
export default function ChartPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 p-4">
      <Suspense>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations()]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const view = await chartView(ctx.value);
  if (!view.ok) return redirect({ href: "/dashboard", locale: lang });
  const { rows, pca } = view.value;
  const opLabel = (op: string) => (op.startsWith("expense.") ? t(`Expenses.categories.${op.slice(8)}`) : t(`Chart.ops.${op}`));
  const account = (title: string, a: { number: string; label: string } | null, active: boolean) => (
    <span className={`flex gap-2 text-sm ${active ? "font-semibold" : "text-ink-2"}`}>
      <span className="w-12 shrink-0">{title}</span>
      {/* account labels stay in French: the official charts and the accountants use them (same as the export) */}
      <bdi dir="ltr" lang="fr">{a ? `${a.number} · ${a.label}` : "—"}</bdi>
    </span>
  );
  return (
    <>
      <BackLink href="/more" />
      <h1 className="text-2xl font-semibold">{t("Chart.title")}</h1>
      <p>{t("Chart.intro")}</p>
      <p className="text-sm text-ink-2">{t(pca ? "Chart.activePca" : "Chart.activeCgnc")}</p>
      <ul className="flex flex-col gap-3" aria-label={t("Chart.title")}>
        {rows.map((r) => (
          <li key={r.op} className={card}>
            <span className="font-semibold">{opLabel(r.op)}</span>
            {account(t("Chart.pca"), r.pca, pca)}
            {account(t("Chart.cgnc"), r.cgnc, !pca)}
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-2">{t("Chart.review")}</p>
    </>
  );
}
