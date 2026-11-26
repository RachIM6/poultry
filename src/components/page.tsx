import type { ReactNode } from "react";
import { BackLink } from "@/components/app-nav";

// tasks/plan-ui.md "Desktop rules": the one container of a signed-in page, so its back link sits above its title, inside
// the column, at every width. Phone: one column, as before. A server component: it adds no client JS (BackLink is the nav's).
const WIDTHS = {
  form: "max-w-xl", // a form or field entry
  wide: "max-w-xl lg:max-w-6xl", // lists, money, operations
  doc: "max-w-xl lg:max-w-5xl print:max-w-none print:p-0", // a printable document
} as const;

/**
 * ```tsx
 * <Page width="wide" back="/more" title={t("Assets.title")} subtitle={t("Assets.hint")} actions={<Link …/>}>…</Page>
 * ```
 * `title` is the page's h1. Leave it out only while a page has none to show (a refusal, a Suspense fallback): a title
 * that needs data renders the whole Page inside the Suspense, with `<Page width back />` as its fallback.
 * A page inside `ClientMessages` lists "Nav" when it has `back`.
 */
export function Page({ width, back, title, subtitle, actions, children }: {
  width: keyof typeof WIDTHS;
  back?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <main className={`mx-auto flex w-full flex-1 flex-col gap-5 p-4 ${WIDTHS[width]}`}>
      {(back || title) && (
        <header className="flex flex-col gap-4">
          {back && <BackLink href={back} />}
          {title && (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold">{title}</h1>
                {subtitle && <p className="text-sm text-ink-2">{subtitle}</p>}
              </div>
              {actions}
            </div>
          )}
        </header>
      )}
      {children}
    </main>
  );
}
