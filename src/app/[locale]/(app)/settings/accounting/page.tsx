import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { EntityHeader } from "@/components/entity-header";
import { split, splitAside } from "@/components/layout";
import { Page } from "@/components/page";
import { card, link } from "@/components/ui";
import { Link, redirect } from "@/i18n/navigation";
import { formatDay } from "@/lib/format";
import { can } from "@/lib/permissions";
import { accountingSettings } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { AccountingForm } from "./form";
import { LegalIdsForm } from "./ids-form";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Accounting", "LegalIds", "Nav", "Offline", "Sync.refused", "errors"];

// SPEC-finance FN1, FN9, FC6, FN14, mockup F-Profile: the owner's accounting choices. Online. The owner changes them
// (finance.manage); the accountant and the manager read them and the registration numbers, with no form (SPEC-m5 PA5).
// Wide screens: the entity and its registration numbers on one side, the accounting choices on the other.
export default function AccountingSettings() {
  return (
    <ClientMessages paths={MESSAGES}>
      <Suspense fallback={<Page width="wide" back="/more" />}>
        <Content />
      </Suspense>
    </ClientMessages>
  );
}

async function Content() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations()]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const settings = await accountingSettings(ctx.value);
  if (!settings.ok) return redirect({ href: "/dashboard", locale: lang }); // no money.read; the actions re-check can()
  if (!settings.value) return <Page width="wide" back="/more"><p>{t("Accounting.none")}</p></Page>;
  const { entity, books, locked, nextYearFrom } = settings.value;
  const months = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(lang === "ar" ? "ar-MA" : "fr", { month: "long", timeZone: "UTC" }).format(Date.UTC(2026, i, 1)));
  if (!can(ctx.value, "finance.manage")) {
    const p = entity.accountingProfile;
    const chart = p.overlays.includes("pca") ? "pca" : "cgnc";
    const rows = [
      [t("Accounting.books"), t(`Accounting.booksOptions.${p.books}.title`)],
      [t("Accounting.chart"), t(`Accounting.charts.${chart}.title`)],
      [t("Accounting.yearStart"), months[entity.fiscalYearStartMonth - 1]],
      [t("Accounting.vat"), t(entity.vatRegistered ? "Accounting.vatRegistered" : "Accounting.vatNotRegistered")],
      [t("Accounting.hens"), t(`Accounting.hensMethods.${entity.hensMethod}.title`)],
      [t("Accounting.allocation"), t(`Accounting.allocationKeys.${entity.allocationKey}.title`)],
    ];
    return (
      <Page width="wide" back="/more" title={t("Accounting.title")} subtitle={t("Accounting.readOnly")}>
        <EntityHeader name={entity.name} form={entity.form} ids={settings.value.ids} />
        <dl className={`${card} gap-3 lg:grid lg:grid-cols-3 lg:gap-x-8`}>
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-sm text-ink-2">{label}</dt>
              <dd className="font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        <Link href="/settings/chart" className={link}>{t("Chart.open")}</Link>
        <Link href="/threshold" className={link}>{t("Threshold.open")}</Link>
      </Page>
    );
  }
  return (
    <Page width="wide" back="/more" title={t("Accounting.title")}>
      <div className={split}>
        <div className={`flex flex-col gap-5 ${splitAside}`}>
          <p>
            <span className="font-semibold">{entity.name}</span> · {t(`Onboarding.forms.${entity.form}`)}
          </p>
          {entity.form === "cooperative" && <p className="text-sm text-ink-2">{t("Accounting.coop")}</p>}
          <LegalIdsForm legalEntityId={entity.id} ids={settings.value.ids} />
        </div>
        <div className="flex flex-col gap-5">
          {locked && (
            <div role="note" className="flex flex-col gap-2 rounded-lg border border-line p-3">
              <p>{t("errors.FISCAL_YEAR_HAS_ENTRIES")}</p>
              <p>{t("Accounting.lockedHow", { day: formatDay(nextYearFrom, lang) })}</p>
            </div>
          )}
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
        </div>
      </div>
      <Link href="/settings/chart" className={link}>{t("Chart.open")}</Link>
      <Link href="/settings/posting" className={link}>{t("Overrides.open")}</Link>
      <Link href="/threshold" className={link}>{t("Threshold.open")}</Link>
    </Page>
  );
}
