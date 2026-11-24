import { useTranslations } from "next-intl";
import { BrandLockup } from "@/components/brand";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { LoginForm } from "@/components/login-form";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["LocaleSwitcher", "Login", "errors"];

// M1-LoginPhone.dc.html / M1-LoginCode.dc.html (tasks/plan-ui.md U3).
export default function Login() {
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
        <LoginForm />
      </main>
    </ClientMessages>
  );
}
