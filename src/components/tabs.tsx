import type { ComponentProps, ReactNode } from "react";
import { Link } from "@/i18n/navigation";

// tasks/plan-ui-cleanup.md §2.4: tabs are links, not a role="tablist": back and forward work, a tab can be linked and
// opened in a new tab, no JS (the /disposal decision: not a half tablist). Server-safe; a client screen renders it too.
// The current tab comes from `pickTab` (paging.ts, pure, so the unit tests and the phone's lists use it without Next).

type Href = ComponentProps<typeof Link>["href"];

/**
 * Query tabs (`?tab=<key>` on one page; the URL keeps the page's other query) or route tabs (sibling routes of one
 * section, carrying their shared query). It scrolls sideways on the phone instead of wrapping.
 * ```tsx
 * const tab = pickTab(["open", "closed"], search.tab); // paging.ts
 * <Tabs label="Bandes" current={tab} tabs={[
 *   { key: "open", label: "En cours", count: 4, href: { pathname: "/batches", query: { tab: "open" } } }, …]} />
 * ```
 */
export function Tabs({ label, current, tabs }: {
  label: string;
  current: string;
  tabs: readonly { key: string; label: ReactNode; href: Href; count?: number }[];
}) {
  return (
    // The rule under the tabs is an inset shadow, under the current tab's own border: a -1px margin over a border-b
    // overflowed the bar by 1 px, and overflow-x makes it a vertical scroll (a scrollbar on Windows). The bar clips
    // what passes its edges, so a tab's focus ring is drawn inside the tab (WCAG 2.4.7).
    <nav aria-label={label} className="flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--color-line)] print:hidden">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          scroll={false}
          aria-current={tab.key === current ? "page" : undefined}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 border-transparent px-3 text-sm font-medium text-ink-2 hover:text-ink aria-[current=page]:border-ink aria-[current=page]:font-semibold aria-[current=page]:text-ink focus-visible:-outline-offset-3!"
        >
          {tab.label}
          {tab.count !== undefined && <span className="rounded-full bg-card px-2 text-xs" dir="ltr">{tab.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
