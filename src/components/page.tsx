import type { ComponentProps, ReactNode } from "react";
import { BackLink } from "@/components/app-nav";
import { Link } from "@/i18n/navigation";

// tasks/plan-ui.md "Desktop rules": the one container of a signed-in page, so its back link sits above its title, inside
// the column, at every width. Phone: one column, as before. No hooks: pages render it on the server, a client screen whose
// title comes from the phone (batches.tsx) renders it too; BackLink is the nav's, already loaded.
const WIDTHS = {
  form: "max-w-xl", // a form or field entry
  wide: "max-w-xl lg:max-w-6xl", // lists, money, operations
  doc: "max-w-xl lg:max-w-5xl print:max-w-none print:p-0", // a printable document
  docAside: "max-w-xl lg:max-w-6xl print:max-w-none print:p-0", // a printable document with its contents beside it (/inspection)
} as const;

/**
 * ```tsx
 * <Page width="wide" back="/more" title={t("Assets.title")} subtitle={t("Assets.hint")} actions={<Link …/>}>…</Page>
 * ```
 * `title` is the page's h1. Leave it out only while a page has none to show (a refusal, a Suspense fallback): a title
 * that needs data renders the whole Page inside the Suspense, with `<Page width back />` as its fallback.
 * A page inside `ClientMessages` lists "Nav" when it has `back`. `back` is a path, or a `<BackLink>` of its own (a
 * hash, another label: the batch day, batches.tsx).
 * tasks/plan-ui-cleanup.md §2.1: `actions` are small buttons only (`primarySm`, `secondarySm`, `ghost`), one primary at
 * most; `nav` is the header's third row, full width: a `<PeriodNav>`, then `<Tabs>`. A back link stays for detail pages.
 */
export function Page({ width, back, title, subtitle, actions, nav, children }: {
  width: keyof typeof WIDTHS;
  back?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  nav?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <main className={`mx-auto flex w-full flex-1 flex-col gap-5 p-4 ${WIDTHS[width]}`}>
      {(back || title || nav) && (
        <header className="flex flex-col gap-4">
          {typeof back === "string" ? <BackLink href={back} /> : back}
          {title && (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold">{title}</h1>
                {subtitle && <p className="text-sm text-ink-2">{subtitle}</p>}
              </div>
              {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
            </div>
          )}
          {nav}
        </header>
      )}
      {children}
    </main>
  );
}

type Href = ComponentProps<typeof Link>["href"];

/**
 * The « ← novembre 2026 → » stepper (books, closing, count, statements), for Page's `nav`. Each arrow is a link with
 * its own name; they mirror in Arabic. `end` sits on the end side (« Exporter », « Imprimer »).
 * ```tsx
 * <PeriodNav label={t("Count.year")} period={<span dir="ltr">{year}</span>}
 *   prev={{ href: { pathname: "/closing", query: { year: year - 1 } }, label: t("Count.previousYear") }}
 *   next={{ href: { pathname: "/closing", query: { year: year + 1 } }, label: t("Count.nextYear") }} />
 * ```
 */
export function PeriodNav({ label, period, prev, next, end }: {
  label: string;
  period: ReactNode;
  prev: { href: Href; label: string };
  next: { href: Href; label: string };
  end?: ReactNode;
}) {
  const arrow = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-shell rtl:-scale-x-100 lg:min-h-9 lg:min-w-9";
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-2 print:hidden">
      <Link href={prev.href} aria-label={prev.label} className={arrow}>←</Link>
      <span className="font-semibold">{period}</span>
      <Link href={next.href} aria-label={next.label} className={arrow}>→</Link>
      {end && <div className="ms-auto flex flex-wrap items-center gap-2">{end}</div>}
    </nav>
  );
}
