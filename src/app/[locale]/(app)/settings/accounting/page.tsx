import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { EntityHeader } from "@/components/entity-header";
import { Page } from "@/components/page";
import { card, warn } from "@/components/ui";
import { redirect } from "@/i18n/navigation";
import { formatDay } from "@/lib/format";
import { can } from "@/lib/permissions";
import { accountingSettings } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { AccountingForm } from "./form";
import { LegalIdsForm } from "./ids-form";
import { SettingsTabs } from "./settings-tabs";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Accounting", "LegalIds", "Nav", "Offline", "Sync.refused", "errors"];

// SPEC-finance FN1, FN9, FC6, FN14, mockup F-Profile: the owner's accounting choices. Online. The owner changes them
// (finance.manage); the accountant and the manager read them and the registration numbers, with no form (SPEC-m5 PA5).
// tasks/plan-ui-cleanup.md §4: one column, the registration numbers then the choices, two by two from lg; the other
// accounting screens are the section's tabs.
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
  const owner = can(ctx.value, "finance.manage");
  const shell = { width: "wide", back: "/more", title: t("Accounting.title"), nav: <SettingsTabs current="profile" owner={owner} /> } as const;
  if (!settings.value) return <Page {...shell}><p>{t("Accounting.none")}</p></Page>;
  const { entity, books, locked, nextYearFrom } = settings.value;
  const months = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(lang === "ar" ? "ar-MA" : "fr", { month: "long", timeZone: "UTC" }).format(Date.UTC(2026, i, 1)));
  if (!owner) {
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
      <Page {...shell} subtitle={t("Accounting.readOnly")}>
        <EntityHeader name={entity.name} form={entity.form} ids={settings.value.ids} />
        <dl className={`${card} gap-3 lg:grid lg:grid-cols-3 lg:gap-x-8`}>
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-sm text-ink-2">{label}</dt>
              <dd className="font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </Page>
    );
  }
  return (
    <Page {...shell}>
      <div className="flex flex-col gap-1">
        <p>
          <span className="font-semibold">{entity.name}</span> · {t(`Onboarding.forms.${entity.form}`)}
        </p>
        {entity.form === "cooperative" && <p className="text-sm text-ink-2">{t("Accounting.coop")}</p>}
      </div>
      <LegalIdsForm legalEntityId={entity.id} ids={settings.value.ids} />
      {/* The registration numbers never lock; the choices do, once the year has an entry */}
      {locked && (
        <p role="note" className={warn}>
          {t("errors.FISCAL_YEAR_HAS_ENTRIES")} {t("Accounting.lockedHow", { day: formatDay(nextYearFrom, lang) })}
        </p>
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
    </Page>
  );
}
