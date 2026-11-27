import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";
import { pageWindow } from "@/components/paging";
import { Link } from "@/i18n/navigation";

// tasks/plan-ui-cleanup.md §2.5: « 26–50 sur 132 · ‹ Précédent 1 … 4 5 6 … 12 Suivant › », as links (`?page=`), for the
// server pages and the phone's lists alike (a client list navigates to the same shell, offline too: src/sw.ts).
// Server-safe. A page inside ClientMessages lists "Ui".

type Href = ComponentProps<typeof Link>["href"];

/**
 * Nothing when everything fits on one page. `page` comes from `pageOf` (paging.ts); `href(n)` keeps the page's other
 * query (its tab, its filter).
 * ```tsx
 * const page = pageOf(search.page, rows.length, TABLE_PAGE);
 * …rows.slice((page - 1) * TABLE_PAGE, page * TABLE_PAGE)…
 * <Pager page={page} size={TABLE_PAGE} total={rows.length} href={(n) => ({ pathname: "/prices", query: { tab, page: n } })} />
 * ```
 */
export function Pager({ page, size, total, href }: { page: number; size: number; total: number; href: (page: number) => Href }) {
  const t = useTranslations("Ui");
  const count = Math.ceil(total / size);
  if (count <= 1) return null;
  const target = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 hover:bg-shell lg:min-h-8 lg:min-w-8";
  const step = (to: number, label: string, arrow: string, before: boolean) =>
    to < 1 || to > count ? null : (
      <Link href={href(to)} scroll={false} className={`${target} gap-1 text-ink-2 hover:text-ink`}>
        {before && <span aria-hidden="true">{arrow}</span>}
        {label}
        {!before && <span aria-hidden="true">{arrow}</span>}
      </Link>
    );
  return (
    <nav aria-label={t("pagination")} className="flex flex-wrap items-center gap-x-1 gap-y-2 text-sm print:hidden">
      <span className="me-auto text-ink-2">
        {t("range", { from: String((page - 1) * size + 1), to: String(Math.min(page * size, total)), total: String(total) })}
      </span>
      {step(page - 1, t("previous"), "‹", true)}
      {pageWindow(page, count).map((n, i) =>
        n === null ? (
          <span key={`gap${i}`} aria-hidden="true" className="px-1 text-ink-2">…</span>
        ) : (
          <Link
            key={n}
            href={href(n)}
            scroll={false}
            aria-label={t("page", { n: String(n) })}
            aria-current={n === page ? "page" : undefined}
            className={`${target} aria-[current=page]:bg-ink aria-[current=page]:font-semibold aria-[current=page]:text-shell`}
          >
            {n}
          </Link>
        ),
      )}
      {step(page + 1, t("next"), "›", false)}
    </nav>
  );
}
