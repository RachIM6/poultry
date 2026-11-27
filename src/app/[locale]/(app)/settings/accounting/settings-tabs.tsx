import { useTranslations } from "next-intl";
import { Tabs } from "@/components/tabs";

// tasks/plan-ui-cleanup.md §3: « Paramètres comptables », the profile, the chart and the replaced accounts as one section,
// three sibling routes (URLs unchanged). Replacing an account is the owner's (finance.manage): the others don't see it.
export function SettingsTabs({ current, owner }: { current: "profile" | "chart" | "overrides"; owner: boolean }) {
  const t = useTranslations("Accounting");
  return (
    <Tabs
      label={t("title")}
      current={current}
      tabs={[
        { key: "profile", label: t("tabProfile"), href: "/settings/accounting" },
        { key: "chart", label: t("tabChart"), href: "/settings/chart" },
        ...(owner ? [{ key: "overrides", label: t("tabOverrides"), href: "/settings/posting" }] : []),
      ]}
    />
  );
}
