import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Tabs } from "@/components/tabs";

// tasks/plan-ui-cleanup.md §3: « Clôture de l'exercice », the year end's three pages as numbered route tabs. The URLs
// stay; each tab keeps the year shown.
const STEPS = [
  { key: "count", pathname: "/closing/count" },
  { key: "entries", pathname: "/closing" },
  { key: "statements", pathname: "/closing/statements" },
] as const;

/** Page's `nav`: the year's stepper (`period`, a PeriodNav), then the steps; from lg one row, the steps first. */
export async function ClosingSteps({ current, year, period }: { current: (typeof STEPS)[number]["key"]; year: number; period: ReactNode }) {
  const t = await getTranslations("Close");
  return (
    <div className="flex flex-col gap-2 lg:flex-row-reverse lg:items-center lg:gap-6">
      {period}
      <div className="min-w-0 lg:flex-1">
        <Tabs
          label={t("steps.label")}
          current={current}
          tabs={STEPS.map((s, i) => ({ key: s.key, label: <><span dir="ltr" className="tabular-nums">{i + 1}</span> {t(`steps.${s.key}`)}</>, href: { pathname: s.pathname, query: { year } } }))}
        />
      </div>
    </div>
  );
}
