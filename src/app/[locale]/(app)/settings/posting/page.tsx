import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BackLink } from "@/components/app-nav";
import { redirect } from "@/i18n/navigation";
import { postingOverrides } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { OverridesForm } from "./form";

// SPEC-finance FN8: the owner replaces the account of a default posting rule for the entity. Online, owner only (finance.manage).
export default function PostingOverridesPage() {
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
  const view = await postingOverrides(ctx.value);
  if (!view.ok) return redirect({ href: "/dashboard", locale: lang }); // not the owner; the action re-checks can()
  if (!view.value) return <p>{t("Accounting.none")}</p>;
  return (
    <>
      <BackLink href="/settings/accounting" />
      <h1 className="text-2xl font-semibold">{t("Overrides.title")}</h1>
      <p>{t("Overrides.intro")}</p>
      <OverridesForm rows={view.value.rows} choices={view.value.choices} />
    </>
  );
}
