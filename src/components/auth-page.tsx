import { getTranslations } from "next-intl/server";
import { BrandLockup } from "@/components/brand";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { link } from "@/components/ui";
import { ClientMessages } from "@/i18n/client-messages";
import { Link } from "@/i18n/navigation";
import type { MessagePath } from "@/i18n/pick";

/** The frame of the signed-out account screens (ADR-015): sign up, join with a code, set a new password. */
export async function AuthPage({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  const t = await getTranslations("Login");
  // What the account forms read (src/components/account-forms.tsx, captcha-field.tsx).
  const messages: MessagePath[] = ["Account", "Login", "LocaleSwitcher", "errors"];
  return (
    <ClientMessages paths={messages}>
      <header className="flex items-center justify-between gap-4 p-4">
        <BrandLockup />
        <LocaleSwitcher />
      </header>
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 px-6 pb-8">
        <h1 className="text-[28px] font-semibold leading-tight">{title}</h1>
        <p className="text-ink-2">{intro}</p>
        {children}
        <Link href="/login" className={`${link} self-start`}>{t("backToSignIn")}</Link>
      </main>
    </ClientMessages>
  );
}
