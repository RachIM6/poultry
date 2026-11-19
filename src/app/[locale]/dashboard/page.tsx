import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { LogoutButton } from "@/components/logout-button";
import { redirect } from "@/i18n/navigation";
import { listLegalEntities } from "@/modules/farm-registry";
import { getTenantContext } from "@/modules/identity";

// Empty until farms exist (T10).
export default function Dashboard() {
  return (
    <>
      <header className="flex justify-end p-4">
        <LocaleSwitcher />
      </header>
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 p-4">
        <Suspense>
          <Content />
        </Suspense>
      </main>
    </>
  );
}

async function Content() {
  const [ctx, lang, t] = await Promise.all([getTenantContext(await headers()), locale(), getTranslations()]);
  if (!ctx.ok) return redirect({ href: ctx.error === "NO_MEMBERSHIP" ? "/onboarding" : "/login", locale: lang });
  const [entity] = await listLegalEntities(ctx.value);
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">{entity?.name}</h1>
        {entity && <p className="opacity-75">{t(`Onboarding.forms.${entity.form}`)}</p>}
      </div>
      <p className="rounded-lg border border-dashed border-current/30 p-6 text-center">{t("Dashboard.noFarms")}</p>
      <LogoutButton />
    </>
  );
}
