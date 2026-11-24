import { useTranslations } from "next-intl";
import { BrandLockup } from "@/components/brand";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Link } from "@/i18n/navigation";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = ["LocaleSwitcher"];

export default function Home() {
  const t = useTranslations();
  return (
    <ClientMessages paths={MESSAGES}>
      <header className="flex justify-end p-4">
        <LocaleSwitcher />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
        <h1>
          <BrandLockup large />
        </h1>
        <p>{t("App.tagline")}</p>
        <Link href="/login" className="underline underline-offset-4">
          {t("Login.title")}
        </Link>
        <Link href="/install" className="underline underline-offset-4">
          {t("Install.title")}
        </Link>
      </main>
    </ClientMessages>
  );
}
