"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { BrandLockup } from "@/components/brand";
import { Link, usePathname } from "@/i18n/navigation";

// tasks/plan-ui.md U2: the phone's bottom tab bar (Today.dc.html) and, on wide screens, the dark sidebar, unfolded
// (288 px, Menu4.dc.html) or folded to a 72 px rail (Menu4b.dc.html, U19), as <html data-nav> says before the first paint.
// Static, so the offline shells stay static: what depends on the role comes after the page has loaded (below).
const TABS = [
  { href: "/dashboard", key: "today", icon: "M3 11l9-8 9 8M5 10v10h14V10" },
  { href: "/batches", key: "batches", icon: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" },
  { href: "/stock", key: "stock", icon: "M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8" },
  { href: "/more", key: "more", icon: "M5 12h.01M12 12h.01M19 12h.01" },
] as const;

// What the nav reads from the phone's database (the refused writes' count, the role's « Plus » groups, the wide sidebar's
// fold) comes in its own chunk, once the page has loaded: Dexie stays off the first load of the online-only pages (books,
// treasury, closing…). Neither moves the layout when it arrives: the count is absolutely placed, and the groups fill the
// sidebar below the tabs, whose width the CSS already set. On wide screens « Plus » is gone: its groups are in the sidebar.
const Refused = dynamic(() => import("@/components/app-nav-live").then((m) => m.Refused), { ssr: false });
const WideGroups = dynamic(() => import("@/components/app-nav-live").then((m) => m.WideGroups), { ssr: false });
const onLoad = (cb: () => void) => {
  window.addEventListener("load", cb);
  return () => window.removeEventListener("load", cb);
};
/** True once the page has loaded: what reads the phone's database (Dexie) comes after, in its own chunk (app-header.tsx too). */
export const useLoaded = () => useSyncExternalStore(onLoad, () => document.readyState === "complete", () => false);

export function AppNav() {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  const loaded = useLoaded();
  const isIn = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  // Everything that isn't one of the first three tabs is reached from "Plus".
  const current = pathname === "/today" ? "today" : (TABS.find((tab) => tab.key !== "more" && isIn(tab.href))?.key ?? (pathname === "/" ? undefined : "more"));
  return (
    <nav
      aria-label={t("label")}
      className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-card print:hidden lg:sticky lg:top-0 lg:order-first lg:flex lg:h-dvh lg:w-72 lg:shrink-0 lg:flex-col lg:scroll-pb-20 lg:overflow-y-auto lg:overscroll-contain lg:border-0 lg:bg-ink lg:px-2 lg:py-4 lg:text-shell lg:rail:w-[72px] lg:rail:items-center lg:rail:px-3 lg:overflow-x-hidden lg:rail:[@media(min-height:640px)]:overflow-visible"
    >
      <div className="hidden px-2 pb-5 pt-2 lg:block lg:rail:px-0 lg:rail:pb-3.5 lg:rail:pt-0 lg:rail:[&>span>span]:hidden [&_span]:text-shell">
        <BrandLockup />
      </div>
      <ul className="grid h-[76px] grid-cols-4 lg:flex lg:h-auto lg:flex-col lg:gap-0.5 lg:rail:gap-1.5">
        {TABS.map((tab) => (
          <li key={tab.key} className={tab.key === "more" ? "lg:hidden" : undefined}>
            <Link
              href={tab.href}
              aria-current={current === tab.key ? "page" : undefined}
              className="group flex h-full flex-col items-center justify-center gap-1 text-[13px] text-muted aria-[current=page]:font-semibold aria-[current=page]:text-ink lg:relative lg:min-h-11 lg:flex-row lg:justify-start lg:gap-2.5 lg:rounded-xl lg:px-2 lg:text-[15px] lg:text-shell lg:hover:bg-shell/10 lg:aria-[current=page]:bg-chick lg:aria-[current=page]:text-ink lg:rail:size-12 lg:rail:justify-center lg:rail:rounded-[14px] lg:rail:px-0"
            >
              <span className="relative grid h-[30px] w-[52px] place-items-center rounded-full group-aria-[current=page]:bg-chick-soft lg:w-auto lg:group-aria-[current=page]:bg-transparent">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={tab.icon} />
                </svg>
                {tab.key === "more" && loaded && <Refused />}
              </span>
              <span data-tip>{t(tab.key)}</span>
              {tab.key === "more" && loaded && <Refused spoken />}
            </Link>
          </li>
        ))}
      </ul>
      {loaded && <WideGroups isIn={isIn} />}
    </nav>
  );
}

/**
 * The round back button of the mockups (Batch.dc.html), for screens reached from "Plus". A hash (`#`: a batch's day
 * back to the list) is a plain link, so the hash the screen reads changes. Back to "Plus" is phone-only: on wide screens
 * the sidebar lists the "Plus" screens itself, so the /more page is not where these screens were reached from.
 */
export function BackLink({ href, label }: { href: string; label?: string }) {
  const t = useTranslations("Nav");
  const props = {
    "aria-label": label ?? t("back"),
    className: `grid size-11 shrink-0 place-items-center rounded-[14px] border border-line bg-card print:hidden${href === "/more" ? " lg:hidden" : ""}`,
    children: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="rtl:-scale-x-100">
        <path d="M15 6l-6 6 6 6" />
      </svg>
    ),
  };
  return href.startsWith("#") ? <a href={href} {...props} /> : <Link href={href} {...props} />;
}
