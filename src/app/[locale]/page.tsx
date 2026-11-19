import { useTranslations } from "next-intl";
import { LocaleSwitcher } from "@/components/locale-switcher";

export default function Home() {
  const t = useTranslations("App");
  return (
    <>
      <header className="flex justify-end p-4">
        <LocaleSwitcher />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
        <h1 className="text-2xl font-semibold">{t("name")}</h1>
        <p>{t("description")}</p>
      </main>
    </>
  );
}
