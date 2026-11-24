import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { LogoutButton } from "@/components/logout-button";
import { card } from "@/components/ui";
import { Link, redirect } from "@/i18n/navigation";
import { can } from "@/lib/permissions";
import { pulls } from "@/lib/sync/views";
import { getTenantContext, myOrganizations } from "@/modules/identity";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Account", "LocaleSwitcher", "errors.NETWORK"];

// The "Plus" tab (tasks/plan-ui.md U2): every screen that isn't a tab, by role. Online, like the dashboard.
export default function More() {
  return (
    <ClientMessages paths={MESSAGES}>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-4">
        <Suspense>
          <Content />
        </Suspense>
      </main>
    </ClientMessages>
  );
}

const row = "flex min-h-12 items-center justify-between py-2 after:text-muted after:content-['›'] rtl:after:content-['‹']";

async function Content() {
  const [ctx, lang, t, mine] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations(), myOrganizations(await headers())]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const money = can(ctx.value, "money.read"); // reads: the accountant too (SPEC-m5 PA5)
  // Offline screens built on records a partner's phone never receives (SPEC-m5 §5) aren't offered to them.
  const holds = (entity: string) => pulls(ctx.value.role, entity);
  const groups = [
    {
      title: t("More.farm"),
      links: [
        { href: "/farms", label: t("Farms.title") },
        holds("eggCollection") && { href: "/eggs", label: t("EggStock.title") }, // SPEC-m3 E4
        holds("dailyEntry") && { href: "/compare", label: t("Compare.title") }, // SPEC-m3 D2
        holds("protocol") && { href: "/protocol", label: t("Protocol.open") },
        holds("routine") && { href: "/tasks", label: t("Tasks.open") },
        holds("climateReading") && { href: "/climate", label: t("Climate.open") },
        holds("plannedBatch") && { href: "/planning", label: t("Planning.open") },
        money && { href: "/staff", label: t("Staff.open") }, // the accountant reads (SPEC-m5 PA5)
        { href: "/inbox", label: t("Inbox.open") },
        { href: "/sync", label: t("More.sync") },
      ].filter((l) => l !== false),
    },
    {
      title: t("More.money"),
      links: [
        money && { href: "/receivables", label: t("Receivables.open") }, // the accountant reads (SPEC-m5 PA5)
        can(ctx.value, "finance.record") && { href: "/expenses", label: t("Expenses.open") },
        money && { href: "/treasury", label: t("Treasury.open") },
        money && { href: "/treasury/bank", label: t("Bank.open") }, // SPEC-finance FC9, FCX2
        money && { href: "/prices", label: t("Prices.open") },
        money && { href: "/results", label: t("Results.open") },
        money && { href: "/budget", label: t("Budget.open") },
        money && { href: "/books", label: t("Books.open") },
        money && { href: "/threshold", label: t("Threshold.open") },
        money && { href: "/closing/count", label: t("Count.open") }, // SPEC-finance FC3, FCX2
        money && { href: "/closing", label: t("Close.open") }, // SPEC-finance FCX4
        money && { href: "/closing/statements", label: t("Statements.open") }, // SPEC-finance FC8
        money && { href: "/assets", label: t("Assets.open") }, // SPEC-finance FC1, FCX2
        money && { href: "/loans", label: t("Loans.open") }, // SPEC-finance FC2, FCX2
        can(ctx.value, "finance.manage") && { href: "/settings/accounting", label: t("Accounting.open") },
        money && { href: "/settings/chart", label: t("Chart.open") }, // read-only; the accountant reads it (SPEC-m5 PA5)
      ].filter((l) => l !== false),
    },
    // SPEC-m2-compliance: the logs and documents an inspection asks for.
    { title: t("More.compliance"), links: [holds("visit") && { href: "/visitors", label: t("Visitors.open") }, holds("disposal") && { href: "/disposal", label: t("Disposal.open") }, holds("cleanout") && { href: "/cleanout", label: t("Cleanout.open") }, can(ctx.value, "documents.manage") && { href: "/documents", label: t("Documents.open") }, can(ctx.value, "documents.manage") && { href: "/inspection", label: t("Inspection.open") }].filter((l) => l !== false) },
    {
      title: t("More.account"),
      links: [
        can(ctx.value, "members.manage") && { href: "/settings/members", label: t("Members.title") },
        // SPEC-m5 PA2: a second farm to open, or an invitation waiting.
        mine.ok && mine.value.memberships.length + mine.value.invitations.length > 1 && { href: "/organizations", label: t("Organizations.link") },
      ].filter((l) => l !== false),
    },
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
