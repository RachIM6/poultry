import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { moreGroups } from "@/components/more-groups";
import { card } from "@/components/ui";
import { Link, redirect } from "@/i18n/navigation";
import { getTenantContext } from "@/modules/identity";

// The "Plus" tab (tasks/plan-ui.md U2): every screen that isn't a tab, by role. Online, like the dashboard. The language
// and the sign-out are in the header's account menu (U20).
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
  // SPEC-m5 PA2: « Mes exploitations », as in the sidebar: a signed-in user has at least one. The page also joins
  // another farm with an invite code (ADR-015).
  const groups = moreGroups(ctx.value).map((g) => ({ title: t(g.title), links: g.links.map((l) => ({ href: l.href, label: t(l.label) })) }));

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
    </>
  );
}
