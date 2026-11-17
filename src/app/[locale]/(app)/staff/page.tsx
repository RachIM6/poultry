import { useTranslations } from "next-intl";
import { StaffScreen } from "@/components/staff";

// A static shell, precached by the service worker (src/app/serwist): employees come from IndexedDB (SPEC-m4 §7).
export default function StaffPage() {
  const t = useTranslations();
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 p-4">
      <h1 className="text-2xl font-semibold">{t("Staff.title")}</h1>
      <StaffScreen />
    </main>
  );
}
