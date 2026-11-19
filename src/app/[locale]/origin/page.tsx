import { useTranslations } from "next-intl";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { OriginDocumentScreen } from "@/components/origin-document";
import { Link } from "@/i18n/navigation";

// A static shell, precached by the service worker (src/app/serwist): the sale comes from IndexedDB (poultry-pwa §0.3).
// Only the document prints: the header is for the screen.
export default function Origin() {
  const t = useTranslations();
  return (
    <>
      <header className="flex justify-between gap-4 p-4 print:hidden">
        <Link href="/batches" className="py-2 underline underline-offset-4">{t("Batches.title")}</Link>
        <LocaleSwitcher />
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 print:max-w-none print:p-0">
        <OriginDocumentScreen />
      </main>
    </>
  );
}
