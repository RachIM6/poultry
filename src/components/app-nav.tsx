"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useTranslations } from "next-intl";
import { BrandLockup } from "@/components/brand";
import { Link, usePathname } from "@/i18n/navigation";
import { can, type Action } from "@/lib/permissions";
import { currentScope } from "@/offline/db";

// tasks/plan-ui.md U2: the phone's bottom tab bar (Today.dc.html) and, on wide screens, the dark sidebar
// (WebOverview.dc.html). Static, so the offline shells stay static: what depends on the role lives on /more.
const TABS = [
  { href: "/dashboard", key: "today", icon: "M3 11l9-8 9 8M5 10v10h14V10" },
  { href: "/batches", key: "batches", icon: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" },
  { href: "/stock", key: "stock", icon: "M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8" },
  { href: "/more", key: "more", icon: "M5 12h.01M12 12h.01M19 12h.01" },
] as const;

// WebOverview.dc.html: on wide screens the owner's sidebar also lists the screens it uses most, by role. The role comes
// from the phone's database (who signed in last), so the shell stays static; the server still checks every page.
const WIDE: { href: string; key: string; action: Action; icon: string }[] = [
  { href: "/receivables", key: "sales", action: "sales.manage", icon: "M3 7h18v10H3zM7 12h4" },
  { href: "/books", key: "finance", action: "money.read", icon: "M4 20V4M4 20h16M8 16l4-5 3 3 5-7" },
  { href: "/settings/members", key: "members", action: "members.manage", icon: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 21a6 6 0 0 0-4-5.6" },
];

export function AppNav() {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  const scope = useLiveQuery(() => currentScope(), []);
  const wide = scope ? WIDE.filter((w) => can(scope, w.action)) : [];
  const isIn = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  // Everything that isn't one of the first three tabs is reached from "Plus".
  const current = pathname === "/today" ? "today" : (TABS.find((tab) => tab.key !== "more" && isIn(tab.href))?.key ?? (pathname === "/" ? undefined : "more"));
  return (
    <nav
      aria-label={t("label")}
      className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-card print:hidden lg:sticky lg:top-0 lg:h-dvh lg:w-60 lg:shrink-0 lg:border-0 lg:bg-ink lg:p-4 lg:text-shell"
    >
      <div className="hidden px-2 pb-6 pt-2 lg:block [&_span]:text-shell">
        <BrandLockup />
      </div>
      <ul className="grid h-[76px] grid-cols-4 lg:flex lg:h-auto lg:flex-col lg:gap-1">
        {TABS.map((tab) => (
          <li key={tab.key}>
            <Link
              href={tab.href}
              aria-current={current === tab.key ? "page" : undefined}
              className="group flex h-full flex-col items-center justify-center gap-1 text-[13px] text-muted aria-[current=page]:font-semibold aria-[current=page]:text-ink lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:rounded-xl lg:px-3 lg:text-[15px] lg:text-shell lg:hover:bg-shell/10 lg:aria-[current=page]:bg-chick lg:aria-[current=page]:text-ink"
            >
              <span className="grid h-[30px] w-[52px] place-items-center rounded-full group-aria-[current=page]:bg-chick-soft lg:w-auto lg:group-aria-[current=page]:bg-transparent">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={tab.icon} />
                </svg>
              </span>
              {t(tab.key)}
            </Link>
          </li>
        ))}
      </ul>
      {wide.length > 0 && (
        <ul className="mt-4 hidden flex-col gap-1 border-t border-shell/15 pt-4 lg:flex">
          {wide.map((w) => (
            <li key={w.key}>
              <Link
                href={w.href}
                aria-current={isIn(w.href) ? "page" : undefined}
                className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] text-shell hover:bg-shell/10 aria-[current=page]:bg-chick aria-[current=page]:font-semibold aria-[current=page]:text-ink"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={w.icon} />
                </svg>
                {t(w.key)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

/** The round back button of the mockups (Batch.dc.html), for screens reached from "Plus". */
export function BackLink({ href }: { href: string }) {
  const t = useTranslations("Nav");
  return (
    <Link href={href} aria-label={t("back")} className="grid size-11 place-items-center rounded-[14px] border border-line bg-card print:hidden">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="rtl:-scale-x-100">
        <path d="M15 6l-6 6 6 6" />
      </svg>
    </Link>
  );
}
