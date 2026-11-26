import { useTranslations } from "next-intl";
import { BrandLockup, BrandMark } from "@/components/brand";
import { StripExample } from "@/components/landing";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { link, primary } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["LocaleSwitcher"];

// The public entry page: what the app does today, from the screens themselves. Static, server-only: the locale
// switcher is its one piece of client code. No numbers, customers or quotes: there are none to show yet.
// Off for now: next.config.ts redirects /ar and /fr to the login (or the dashboard), so this page is built but never served.
const FRAME = "mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8";
const H2 = "text-[26px] font-semibold leading-tight tracking-[-0.015em] lg:text-[38px]";
const SECTION = "py-14 lg:py-24";

/** A section's points: name, then what it does. */
function Points({ group, keys, className = "" }: { group: "daily" | "health" | "trade" | "staff" | "finance" | "app"; keys: readonly string[]; className?: string }) {
  const t = useTranslations("Landing");
  return (
    <dl className={`grid gap-x-10 gap-y-7 ${className}`}>
      {keys.map((key) => (
        <div key={key} className="flex flex-col gap-1.5">
          <dt className="text-lg font-semibold">{t(`${group}.items.${key}.title`)}</dt>
          <dd className="text-ink-2">{t(`${group}.items.${key}.body`)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Actions() {
  const t = useTranslations("Landing");
  return (
    <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap">
      <Link href="/signup" className={primary}>{t("signup")}</Link>
      <Link href="/login" className="inline-flex min-h-14 items-center justify-center rounded-2xl border border-line bg-card px-5 text-lg font-medium">{t("login")}</Link>
    </div>
  );
}

export default function Home() {
  const t = useTranslations("Landing");
  const app = useTranslations("App");
  return (
    <ClientMessages paths={MESSAGES}>
      <header className={`${FRAME} flex justify-end py-2`}>
        <LocaleSwitcher />
      </header>
      <main className="flex flex-1 flex-col">
        <section className={`${FRAME} grid items-center gap-12 pb-14 pt-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16 lg:pb-24 lg:pt-12`}>
          <div className="flex flex-col items-start gap-6">
            <h1>
              <BrandLockup large />
            </h1>
            <p className="max-w-[18ch] text-[34px] font-semibold leading-[1.08] tracking-[-0.02em] lg:text-[52px]">{t("headline")}</p>
            <p className="max-w-xl text-lg lg:text-xl">{t("subline")}</p>
            <p className="max-w-xl text-ink-2">{t("species")}</p>
            <Actions />
            <Link href="/install" className={link}>{t("install")}</Link>
          </div>
          <div className="rounded-3xl bg-ink p-5 text-shell sm:p-8 lg:p-10">
            <StripExample />
          </div>
        </section>

        <section aria-labelledby="daily" className={`bg-card ${SECTION}`}>
          <div className={`${FRAME} grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16`}>
            <div className="flex flex-col gap-4">
              <h2 id="daily" className={H2}>{t("daily.title")}</h2>
              <p className="text-lg">{t("daily.intro")}</p>
            </div>
            <Points group="daily" keys={["dead", "feed", "eggs", "weighing"]} className="sm:grid-cols-2" />
          </div>
        </section>

        <section aria-labelledby="health" className={SECTION}>
          <div className={`${FRAME} flex flex-col gap-10 lg:gap-14`}>
            <div className="grid gap-4 lg:grid-cols-2 lg:items-end lg:gap-16">
              <h2 id="health" className={H2}>{t("health.title")}</h2>
              <p className="text-lg">{t("health.intro")}</p>
            </div>
            <Points group="health" keys={["vaccination", "treatment", "register", "vet", "biosecurity", "notifiable"]} className="sm:grid-cols-2 lg:grid-cols-3" />
          </div>
        </section>

        <div className={`bg-card ${SECTION}`}>
          <div className={`${FRAME} grid gap-14 lg:grid-cols-2 lg:gap-16`}>
            {(["trade", "staff"] as const).map((group) => (
              <section key={group} aria-labelledby={group} className="flex flex-col gap-8">
                <h2 id={group} className={H2}>{t(`${group}.title`)}</h2>
                <Points group={group} keys={group === "trade" ? ["stock", "sales", "receivables"] : ["workers", "attendance", "pay"]} />
              </section>
            ))}
          </div>
        </div>

        <section aria-labelledby="finance" className={SECTION}>
          <div className={`${FRAME} flex flex-col gap-10 lg:gap-14`}>
            <div className="flex max-w-3xl flex-col gap-4">
              <h2 id="finance" className={H2}>{t("finance.title")}</h2>
              <p className="text-lg">{t("finance.intro")}</p>
            </div>
            <Points group="finance" keys={["books", "treasury", "budget", "close"]} className="sm:grid-cols-2 lg:grid-cols-4" />
          </div>
        </section>

        <section aria-labelledby="roles" className={`bg-card ${SECTION}`}>
          <div className={`${FRAME} grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16`}>
            <div className="flex flex-col gap-4">
              <h2 id="roles" className={H2}>{t("roles.title")}</h2>
              <p className="text-lg">{t("roles.intro")}</p>
              <p className="text-ink-2">{t("roles.partners")}</p>
            </div>
            <dl className="flex flex-col gap-5">
              {(["owner", "manager", "worker", "vet", "accountant"] as const).map((role) => (
                <div key={role} className="grid gap-1 rounded-2xl bg-shell p-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6 sm:p-5">
                  <dt className="text-lg font-semibold">{t(`roles.items.${role}.title`)}</dt>
                  <dd>{t(`roles.items.${role}.body`)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section aria-labelledby="app" className={SECTION}>
          <div className={`${FRAME} flex flex-col gap-10 lg:gap-14`}>
            <h2 id="app" className={`${H2} max-w-3xl`}>{t("app.title")}</h2>
            <Points group="app" keys={["languages", "install", "offline"]} className="sm:grid-cols-3" />
          </div>
        </section>

        <section aria-labelledby="closing" className="bg-ink py-16 text-shell lg:py-24">
          <div className={`${FRAME} flex flex-col items-start gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-16`}>
            <div className="flex max-w-2xl flex-col gap-4">
              <h2 id="closing" className={H2}>{t("closing.title")}</h2>
              <p className="text-lg text-sand">{t("closing.body")}</p>
            </div>
            <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
              <Link href="/signup" className={primary}>{t("signup")}</Link>
              <Link href="/login" className="inline-flex min-h-14 items-center justify-center rounded-2xl bg-shell/10 px-5 text-lg font-medium">{t("login")}</Link>
            </div>
          </div>
        </section>
      </main>
      <footer className={`${FRAME} flex flex-col gap-4 py-8 sm:flex-row sm:items-center sm:justify-between`}>
        <div className="flex items-center gap-3">
          <BrandMark size={32} />
          <p className="text-ink-2">{app("tagline")}</p>
        </div>
        <nav aria-label={t("footerNav")} className="flex flex-wrap gap-x-6">
          <Link href="/login" className={link}>{t("login")}</Link>
          <Link href="/signup" className={link}>{t("signup")}</Link>
          <Link href="/install" className={link}>{t("install")}</Link>
        </nav>
      </footer>
    </ClientMessages>
  );
}
