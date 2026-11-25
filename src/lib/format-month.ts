// Its own file, not lib/format: that one ships with /batches, which is near its JS budget (SPEC §9.3).

/** A "2026-11" month as "novembre 2026" / "نونبر 2026", Western digits (ADR-004). */
export function formatMonth(month: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-MA" : "fr", { numberingSystem: "latn", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}
