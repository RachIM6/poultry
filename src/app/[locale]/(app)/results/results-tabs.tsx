import { useTranslations } from "next-intl";
import { Tabs } from "@/components/tabs";

// tasks/plan-ui-cleanup.md §3: « Résultats et budget », the batch results, the budget and the exemption threshold as one
// section, three sibling routes (URLs unchanged).
export function ResultsTabs({ current }: { current: "results" | "budget" | "threshold" }) {
  const t = useTranslations("Results");
  return (
    <Tabs
      label={t("section")}
      current={current}
      tabs={[
        { key: "results", label: t("tabResults"), href: "/results" },
        { key: "budget", label: t("tabBudget"), href: "/budget" },
        { key: "threshold", label: t("tabThreshold"), href: "/threshold" },
      ]}
    />
  );
}
