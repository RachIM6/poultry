import { connection } from "next/server";
import { locale } from "next/root-params";
import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { BrandLockup } from "@/components/brand";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { LoginForm } from "@/components/login-form";
import { ClientMessages } from "@/i18n/client-messages";
import { redirect } from "@/i18n/navigation";
import type { MessagePath } from "@/i18n/pick";
import { smsEnabled } from "@/modules/identity";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["LocaleSwitcher", "Login", "errors"];

// M1-LoginPhone.dc.html / M1-LoginCode.dc.html (tasks/plan-ui.md U3). ADR-015: SMS code login, only with
// AUTH_SMS_ENABLED=true (dormant until an SMS provider exists); otherwise this sends to the password login.
export default function LoginWithCode() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-7 px-6 pb-8 pt-6">
        <div className="flex justify-end">
          <LocaleSwitcher />
        </div>
        <div className="flex flex-col items-start gap-3.5 pt-6">
          <BrandLockup large />
          <p className="text-lg text-ink-2">{t("App.tagline")}</p>
        </div>
        <h1 className="sr-only">{t("Login.title")}</h1>
        <Suspense>
          <CodeLogin />
        </Suspense>
      </main>
    </ClientMessages>
  );
}

// The setting is read when the page is served, not when it is built.
async function CodeLogin() {
  await connection();
  if (!smsEnabled()) return redirect({ href: "/login", locale: await locale() });
  return <LoginForm />;
}
