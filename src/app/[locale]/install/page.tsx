import { useTranslations } from "next-intl";
import { InstallGuide } from "@/components/install-guide";
import { BackLink } from "@/components/app-nav";

export default function Install() {
  const t = useTranslations("Install");
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4">
      <BackLink href="/" />
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <InstallGuide />
    </main>
  );
}
