import { useTranslations } from "next-intl";
import { BrandLockup } from "@/components/brand";
import { InstallGuide } from "@/components/install-guide";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { link } from "@/components/ui";
import { ClientMessages } from "@/i18n/client-messages";
import { Link } from "@/i18n/navigation";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["Install", "LocaleSwitcher", "Nav", "Sync.refused"];

// A public page, framed like the sign-in: the lockup and the locale switcher, then on wide screens the three platforms
// side by side (install-guide.tsx). CSS only: the guide is the page's one client component, as before.
const FRAME = "mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8"; // 16 px on a 320 px phone, as the auth pages

export default function Install() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <header className={`${FRAME} flex items-center justify-between gap-4 py-4`}>
        <BrandLockup />
        <LocaleSwitcher />
      </header>
      <main className={`${FRAME} flex flex-1 flex-col gap-5 pb-8 pt-4 lg:gap-6 lg:pt-10`}>
        <h1 className="text-[28px] font-semibold leading-tight lg:text-[38px]">{t("Install.title")}</h1>
        <p className="max-w-3xl text-lg">{t("Install.about")}</p>
        <InstallGuide />
        <Link href="/login" className={`${link} self-start`}>{t("Login.backToSignIn")}</Link>
      </main>
    </ClientMessages>
  );
}
