import { useTranslations } from "next-intl";
import { Tabs } from "@/components/tabs";

// tasks/plan-ui-cleanup.md §3: Climat des bâtiments and Cibles de climat are one section, two sibling routes (URLs unchanged).
export function ClimateTabs({ current }: { current: "readings" | "targets" }) {
  const t = useTranslations("Climate");
  return (
    <Tabs
      label={t("title")}
      current={current}
      tabs={[
        { key: "readings", label: t("tabReadings"), href: "/climate" },
        { key: "targets", label: t("tabTargets"), href: "/climate/targets" },
      ]}
    />
  );
}
