import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { LogoutButton } from "@/components/logout-button";
import { moreGroups } from "@/components/more-groups";
import { card } from "@/components/ui";
import { Link, redirect } from "@/i18n/navigation";
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
  // SPEC-m5 PA2: a second farm to open, or an invitation waiting. Otherwise the same screen joins another farm with an
  // invite code (ADR-015): a vet or an accountant invited by a second farm.
  const many = mine.ok && mine.value.memberships.length + mine.value.invitations.length > 1;
  const label = (href: string, key: string) => (href === "/organizations" ? (many ? "Organizations.link" : "Account.joinWithCode") : key);
  const groups = moreGroups(ctx.value).map((g) => ({ title: t(g.title), links: g.links.map((l) => ({ href: l.href, label: t(label(l.href, l.label)) })) }));

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
