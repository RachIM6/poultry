import { headers } from "next/headers";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LogoutButton } from "@/components/logout-button";
import { redirect } from "@/i18n/navigation";
import { getSession } from "@/modules/identity";

// Placeholder landing after login until onboarding and the dashboard exist (T6).
export default function Account() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-4">
      <Suspense>
        <SignedIn />
      </Suspense>
    </main>
  );
}

async function SignedIn() {
  const [session, lang, t] = await Promise.all([getSession(await headers()), locale(), getTranslations("Account")]);
  if (!session) return redirect({ href: "/login", locale: lang });
  return (
    <>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p>
        {t("signedInAs")} <bdi dir="ltr">{session.phone}</bdi>
      </p>
      <LogoutButton />
    </>
  );
}
