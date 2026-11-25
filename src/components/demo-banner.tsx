import { useTranslations } from "next-intl";

// ADR-016: the client demo (DEMO_MODE=1) holds synthetic data only, and every signed-in page says so. Server rendered,
// in the page's first HTML, so it moves nothing after load. The static shells read DEMO_MODE at build time: set it
// before `next build`. Not a control (nothing to click), and it prints, so a printed demo register is marked too.
export function DemoBanner() {
  const t = useTranslations("Demo");
  if (process.env.DEMO_MODE !== "1") return null;
  return (
    <p role="status" className="bg-chick px-4 py-1 text-center text-sm font-semibold text-ink">
      {t("banner")}
    </p>
  );
}
