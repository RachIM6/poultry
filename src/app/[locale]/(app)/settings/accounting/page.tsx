import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BackLink } from "@/components/app-nav";
import { Link, redirect } from "@/i18n/navigation";
import { accountingSettings } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { AccountingForm } from "./form";

// SPEC-finance FN1, FN9, FC6, FN14, mockup F-Profile: the owner's accounting choices. Online, owner only (finance.manage).
export default function AccountingSettings() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 p-4">
      <Suspense>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations()]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const settings = await accountingSettings(ctx.value);
  if (!settings.ok) return redirect({ href: "/dashboard", locale: lang }); // not the owner; the action re-checks can()
  if (!settings.value) return <p>{t("Accounting.none")}</p>;
  const { entity, books, locked } = settings.value;
  const months = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(lang === "ar" ? "ar-MA" : "fr", { month: "long", timeZone: "UTC" }).format(Date.UTC(2026, i, 1)));
  return (
    <>
      <BackLink href="/more" />
      <h1 className="text-2xl font-semibold">{t("Accounting.title")}</h1>
      <p>
        <span className="font-semibold">{entity.name}</span> · {t(`Onboarding.forms.${entity.form}`)}
      </p>
      {entity.form === "cooperative" && <p className="text-sm text-ink-2">{t("Accounting.coop")}</p>}
      {locked && <p role="note" className="rounded-lg border border-line p-3">{t("errors.FISCAL_YEAR_HAS_ENTRIES")}</p>}
      <AccountingForm
        legalEntityId={entity.id}
        books={entity.accountingProfile.books}
        booksAllowed={books}
        pca={entity.accountingProfile.overlays.includes("pca")}
        month={entity.fiscalYearStartMonth}
        months={months}
        vatRegistered={entity.vatRegistered}
        hensMethod={entity.hensMethod}
        allocationKey={entity.allocationKey}
        locked={locked}
      />
      <Link href="/settings/chart" className="inline-flex min-h-11 items-center underline underline-offset-4">{t("Chart.open")}</Link>
      <Link href="/settings/posting" className="inline-flex min-h-11 items-center underline underline-offset-4">{t("Overrides.open")}</Link>
      <Link href="/threshold" className="inline-flex min-h-11 items-center underline underline-offset-4">{t("Threshold.open")}</Link>
    </>
  );
}
