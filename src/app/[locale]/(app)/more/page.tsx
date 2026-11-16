import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { LogoutButton } from "@/components/logout-button";
import { card } from "@/components/ui";
import { Link, redirect } from "@/i18n/navigation";
import { can } from "@/lib/permissions";
import { getTenantContext } from "@/modules/identity";

// The "Plus" tab (tasks/plan-ui.md U2): every screen that isn't a tab, by role. Online, like the dashboard.
export default function More() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-4">
      <Suspense>
        <Content />
      </Suspense>
    </main>
  );
}

const row = "flex min-h-12 items-center justify-between py-2 after:text-muted after:content-['›'] rtl:after:content-['‹']";

async function Content() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations()]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const money = can(ctx.value, "finance.record");
  const groups = [
    {
      title: t("More.farm"),
      links: [
        { href: "/farms", label: t("Farms.title") },
        { href: "/protocol", label: t("Protocol.open") },
        { href: "/inbox", label: t("Inbox.open") },
        { href: "/sync", label: t("More.sync") },
      ],
    },
    {
      title: t("More.money"),
      links: [
        can(ctx.value, "sales.manage") && { href: "/receivables", label: t("Receivables.open") },
        money && { href: "/expenses", label: t("Expenses.open") },
        money && { href: "/treasury", label: t("Treasury.open") },
        money && { href: "/results", label: t("Results.open") },
        money && { href: "/budget", label: t("Budget.open") },
        money && { href: "/books", label: t("Books.open") },
        money && { href: "/threshold", label: t("Threshold.open") },
      ].filter((l) => l !== false),
    },
    // SPEC-m2-compliance: the logs and documents an inspection asks for.
    { title: t("More.compliance"), links: [{ href: "/visitors", label: t("Visitors.open") }] },
    { title: t("More.account"), links: can(ctx.value, "members.manage") ? [{ href: "/settings/members", label: t("Members.title") }] : [] },
  ].filter((g) => g.links.length > 0);

  return (
    <>
      <h1 className="text-2xl font-semibold">{t("Nav.more")}</h1>
      {groups.map((g) => (
        <section key={g.title} aria-label={g.title} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink-2">{g.title}</h2>
          <ul className={card}>
            {g.links.map((l) => (
              <li key={l.href} className="border-t border-line first:border-t-0">
                <Link href={l.href} className={row}>{l.label}</Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section aria-label={t("More.account")} className={card}>
        <LocaleSwitcher />
        <LogoutButton />
        <LogoutButton everywhere />
      </section>
    </>
  );
}
