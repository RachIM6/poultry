import { useTranslations } from "next-intl";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Link } from "@/i18n/navigation";

export default function Home() {
  const t = useTranslations();
  return (
    <>
      <header className="flex justify-end p-4">
        <LocaleSwitcher />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
        <h1 className="text-2xl font-semibold">{t("App.name")}</h1>
        <p>{t("App.description")}</p>
        <Link href="/install" className="underline underline-offset-4">
          {t("Install.title")}
        </Link>
      </main>
    </>
  );
}
