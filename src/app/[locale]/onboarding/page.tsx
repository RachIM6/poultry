import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BrandLockup } from "@/components/brand";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { LogoutButton } from "@/components/logout-button";
import { JoinCodeForm } from "@/components/join-code-form";
import { OnboardingForm } from "@/components/onboarding-form";
import { redirect } from "@/i18n/navigation";
import { LEGAL_FORMS } from "@/modules/farm-registry";
import { getTenantContext } from "@/modules/identity";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Account", "LocaleSwitcher", "Onboarding", "errors"];

export default function Onboarding() {
  return (
    <ClientMessages paths={MESSAGES}>
      <header className="flex items-center justify-between gap-4 p-4">
        <BrandLockup />
        <LocaleSwitcher />
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4">
        <Suspense>
          <Form />
        </Suspense>
      </main>
    </ClientMessages>
  );
}

async function Form() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations("Onboarding")]);
  if (ctx.ok) return redirect({ href: "/dashboard", locale: lang });
  if (ctx.error === "UNAUTHENTICATED") return redirect({ href: "/login", locale: lang });
  return (
    <>
      <h1 className="text-[28px] font-semibold leading-tight">{t("title")}</h1>
      <p className="text-ink-2">{t("intro")}</p>
      <OnboardingForm forms={LEGAL_FORMS} />
      <section aria-labelledby="join-title" className="flex flex-col gap-3 border-t border-line pt-6">
        <h2 id="join-title" className="text-[17px] font-semibold text-ink-2">{t("joinTitle")}</h2>
        <p className="text-sm text-muted">{t("joinIntro")}</p>
        <JoinCodeForm />
      </section>
      <LogoutButton />
    </>
  );
}
