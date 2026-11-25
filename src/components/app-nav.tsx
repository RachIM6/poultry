"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { BrandLockup } from "@/components/brand";
import { Link, usePathname } from "@/i18n/navigation";

// tasks/plan-ui.md U2: the phone's bottom tab bar (Today.dc.html) and, on wide screens, the dark sidebar
// (WebOverview.dc.html). Static, so the offline shells stay static: what depends on the role lives on /more.
const TABS = [
  { href: "/dashboard", key: "today", icon: "M3 11l9-8 9 8M5 10v10h14V10" },
  { href: "/batches", key: "batches", icon: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" },
  { href: "/stock", key: "stock", icon: "M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8" },
  { href: "/more", key: "more", icon: "M5 12h.01M12 12h.01M19 12h.01" },
] as const;

// What the nav reads from the phone's database (the refused writes' count, the role's wide links) comes in its own
// chunk, once the page has loaded: Dexie stays off the first load of the online-only pages (books, treasury, closing…).
// Neither moves the layout when it arrives: the count is absolutely placed, the links come last in the sidebar, and the
// wide "Plus" button takes the "Plus" link's place, same size, once the role is known (the link stays until then).
const Refused = dynamic(() => import("@/components/app-nav-live").then((m) => m.Refused), { ssr: false });
const WideLinks = dynamic(() => import("@/components/app-nav-live").then((m) => m.WideLinks), { ssr: false });
const WideMore = dynamic(() => import("@/components/app-nav-live").then((m) => m.WideMore), { ssr: false });
const onLoad = (cb: () => void) => {
  window.addEventListener("load", cb);
  return () => window.removeEventListener("load", cb);
};

export function AppNav() {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  const loaded = useSyncExternalStore(onLoad, () => document.readyState === "complete", () => false);
  const isIn = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  // Everything that isn't one of the first three tabs is reached from "Plus".
  const current = pathname === "/today" ? "today" : (TABS.find((tab) => tab.key !== "more" && isIn(tab.href))?.key ?? (pathname === "/" ? undefined : "more"));
  return (
    <nav
      aria-label={t("label")}
      className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-card print:hidden lg:sticky lg:top-0 lg:order-first lg:h-dvh lg:w-60 lg:shrink-0 lg:overflow-y-auto lg:overscroll-contain lg:border-0 lg:bg-ink lg:p-4 lg:text-shell"
    >
      <div className="hidden px-2 pb-6 pt-2 lg:block [&_span]:text-shell">
        <BrandLockup />
      </div>
      <ul className="grid h-[76px] grid-cols-4 lg:flex lg:h-auto lg:flex-col lg:gap-1">
        {TABS.map((tab) => (
          <li key={tab.key} className="lg:[&:has(>[data-wide-more])>a]:hidden">
            <Link
              href={tab.href}
              aria-current={current === tab.key ? "page" : undefined}
              className="group flex h-full flex-col items-center justify-center gap-1 text-[13px] text-muted aria-[current=page]:font-semibold aria-[current=page]:text-ink lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:rounded-xl lg:px-3 lg:text-[15px] lg:text-shell lg:hover:bg-shell/10 lg:aria-[current=page]:bg-chick lg:aria-[current=page]:text-ink"
            >
              <span className="relative grid h-[30px] w-[52px] place-items-center rounded-full group-aria-[current=page]:bg-chick-soft lg:w-auto lg:group-aria-[current=page]:bg-transparent">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={tab.icon} />
                </svg>
                {tab.key === "more" && loaded && <Refused />}
              </span>
              {t(tab.key)}
              {tab.key === "more" && loaded && <Refused spoken />}
            </Link>
            {tab.key === "more" && loaded && <WideMore icon={tab.icon} isIn={isIn} />}
          </li>
        ))}
      </ul>
      {loaded && <WideLinks isIn={isIn} />}
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
