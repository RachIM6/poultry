import { useTranslations } from "next-intl";
import { Tabs } from "@/components/tabs";

// tasks/plan-ui-cleanup.md §3: Trésorerie and Rapprochement bancaire are one section, two sibling routes (URLs unchanged).
export function TreasuryTabs({ current }: { current: "overview" | "bank" }) {
  const t = useTranslations("Treasury");
  return (
    <Tabs
      label={t("title")}
      current={current}
      tabs={[
        { key: "overview", label: t("tabOverview"), href: "/treasury" },
        { key: "bank", label: t("tabBank"), href: "/treasury/bank" },
      ]}
    />
  );
}
