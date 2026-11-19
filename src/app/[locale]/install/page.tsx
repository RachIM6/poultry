import { useTranslations } from "next-intl";
import { InstallGuide } from "@/components/install-guide";
import { Link } from "@/i18n/navigation";

export default function Install() {
  const t = useTranslations("Install");
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4">
      <Link href="/" className="underline underline-offset-4">
        {t("back")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <InstallGuide />
    </main>
  );
}
