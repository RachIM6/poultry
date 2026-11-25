import { connection } from "next/server";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BrandLockup } from "@/components/brand";
import { BrandPanel } from "@/components/landing";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { PasswordLoginForm } from "@/components/password-login-form";
import { link } from "@/components/ui";
import { ClientMessages } from "@/i18n/client-messages";
import { Link } from "@/i18n/navigation";
import type { MessagePath } from "@/i18n/pick";
import { smsEnabled } from "@/modules/identity";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["LocaleSwitcher", "Login", "errors"];

// ADR-015: phone or email, and a password. M1-LoginPhone.dc.html's frame (tasks/plan-ui.md U3).
export default function Login() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <div className="flex flex-1 flex-col lg:grid lg:grid-cols-2">
        <BrandPanel />
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-7 px-6 pb-8 pt-6">
          <div className="flex justify-end">
            <LocaleSwitcher />
          </div>
          {/* lg+: the brand panel shows them instead, and the title is shown. */}
          <div className="flex flex-col items-start gap-3.5 pt-6 lg:hidden">
            <BrandLockup large />
            <p className="text-lg text-ink-2">{t("App.tagline")}</p>
          </div>
          <h1 className="sr-only lg:not-sr-only lg:pt-16 lg:text-[28px] lg:font-semibold lg:leading-tight">{t("Login.title")}</h1>
          <PasswordLoginForm />
          <nav aria-label={t("Login.otherWays")} className="flex flex-col items-start">
            <Link href="/signup" className={link}>{t("Login.signupLink")}</Link>
            <Link href="/join" className={link}>{t("Login.joinLink")}</Link>
            <Link href="/reset" className={link}>{t("Login.resetLink")}</Link>
            <Suspense>
              <SmsLink />
            </Suspense>
          </nav>
        </main>
      </div>
    </ClientMessages>
  );
}

// The setting is read when the page is served, not when it is built (the image is built once for every host).
async function SmsLink() {
  await connection();
  if (!smsEnabled()) return null;
  const t = await getTranslations("Login");
  return <Link href="/login/code" className={link}>{t("smsLink")}</Link>;
}
