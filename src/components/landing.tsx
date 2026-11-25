import { useTranslations } from "next-intl";
import { BatchStrip, stripDays } from "@/components/batch-strip";
import { BrandLockup } from "@/components/brand";
import { addFarmDays, type FarmDay } from "@/lib/kernel/farm-day";

// The public pages' illustration: the app's own 42-day strip (batch-strip.tsx) on an example batch, so the landing
// page and the wide sign-in panel show the real thing, not a drawing of it. Server-only markup, no client JS.

const PLACED = "2026-01-01" as FarmDay; // any day: only the shape of the strip is shown
const AGE = 23;
const FORGOTTEN = 17;
const days = stripDays({
  placedOn: PLACED,
  today: addFarmDays(PLACED, AGE),
  age: AGE,
  entered: new Set(Array.from({ length: AGE - 1 }, (_, i) => i + 1).filter((age) => age !== FORGOTTEN).map((age) => addFarmDays(PLACED, age))),
  vaccineDays: [addFarmDays(PLACED, 26)],
  withdrawal: null,
});

// The strip's own bar colours on dark (BatchStrip `onDark`), as small swatches.
const LEGEND = [
  ["done", "bg-sand"],
  ["missing", "bg-brick"],
  ["today", "bg-chick"],
  ["vaccine", "bg-shell/15 shadow-[inset_0_0_0_2px_var(--color-chick)]"],
  ["upcoming", "bg-shell/15"],
] as const;

/** The example strip on the ink ground, as in the app's Today header. The caller gives the dark surface. */
export function StripExample() {
  const t = useTranslations("Landing");
  const total = String(days.length);
  return (
    <figure className="flex flex-col gap-4">
      <p className="text-lg font-semibold lg:text-xl">{t("strip.house")}</p>
      <BatchStrip days={days} onDark label={t("strip.label", { day: String(AGE), total })} />
      <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-[15px] text-sand">
        <span>{t("strip.dayOf", { day: String(AGE), total })}</span>
        <span>{t("strip.missing", { day: String(FORGOTTEN) })}</span>
      </p>
      <ul aria-label={t("strip.legendLabel")} className="flex flex-wrap gap-x-5 gap-y-2 text-[15px] text-sand">
        {LEGEND.map(([key, swatch]) => (
          <li key={key} className="flex items-center gap-2">
            <span aria-hidden="true" className={`size-3.5 rounded-[3px] ${swatch}`} />
            {t(`strip.legend.${key}`)}
          </li>
        ))}
      </ul>
      <figcaption className="text-[15px] text-sand">{t("strip.caption")}</figcaption>
    </figure>
  );
}

/** Wide screens only (lg+): the brand beside the sign-in and account forms. Hidden below lg, so phones are unchanged. */
export function BrandPanel() {
  const t = useTranslations();
  return (
    // The ground runs the full height of a long form; its content stays in view while the form scrolls.
    <aside className="hidden bg-ink text-shell lg:block">
      <div className="sticky top-0 flex h-dvh flex-col justify-center gap-10 overflow-y-auto p-12 xl:p-16">
        <div className="flex flex-col gap-4">
          {/* The lockup's wordmark is ink on light grounds; the menu does the same on its ink sidebar (app-nav.tsx). */}
          <div className="[&_span]:text-shell">
            <BrandLockup large />
          </div>
          <p className="text-2xl">{t("App.tagline")}</p>
        </div>
        <ul className="flex max-w-md flex-col gap-3 text-lg">
          {(["daily", "all", "languages"] as const).map((key) => (
            <li key={key} className="flex gap-3">
              <span aria-hidden="true" className="mt-2.5 size-2 shrink-0 rounded-full bg-chick" />
              {t(`Landing.panel.${key}`)}
            </li>
          ))}
        </ul>
        <div className="max-w-xl rounded-3xl bg-shell/10 p-6">
          <StripExample />
        </div>
      </div>
    </aside>
  );
}
