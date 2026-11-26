import { farmDayOf, type FarmDay } from "@/lib/kernel/farm-day";

// Its own file, not lib/format: that one ships with /batches, which is near its JS budget (SPEC §9.3).
// One date format everywhere, the long one ("18 août 2026"); in a dense table or list the year goes without saying
// when it is this year's ("18 août").

const tag = (locale: string) => (locale === "ar" ? "ar-MA" : "fr");

/** A day in a table: "18 août", or "18 août 2025" when it isn't `today`'s year. */
export function formatDayShort(day: string, locale: string, today: FarmDay): string {
  return new Intl.DateTimeFormat(tag(locale), {
    numberingSystem: "latn",
    day: "numeric",
    month: "long",
    year: day.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric",
    timeZone: "UTC", // a FarmDay is already a calendar date
  }).format(new Date(`${day}T00:00:00Z`));
}

/** A moment in farm time (Africa/Casablanca): "26 novembre à 01:25", the year only when it isn't `today`'s. */
export function formatMomentShort(iso: string, locale: string, today: FarmDay): string {
  const at = new Date(iso);
  return new Intl.DateTimeFormat(tag(locale), {
    numberingSystem: "latn",
    day: "numeric",
    month: "long",
    year: farmDayOf(at).slice(0, 4) === today.slice(0, 4) ? undefined : "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Casablanca",
  }).format(at);
}
