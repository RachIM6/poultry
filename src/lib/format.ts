import type { FarmDay } from "@/lib/kernel/farm-day";

// Display formatting (ADR-004): Western digits in both locales, French number style (1 234,50) for
// money and weights, which are written the same way in Arabic and French screens in Morocco.
// Format numbers here, then pass the strings to messages, rather than using ICU number arguments.

const money = new Intl.NumberFormat("fr", { numberingSystem: "latn", minimumFractionDigits: 2 });
const kg = new Intl.NumberFormat("fr", { numberingSystem: "latn", maximumFractionDigits: 3 });

export function formatMoney(centimes: bigint): string {
  const abs = centimes < 0n ? -centimes : centimes;
  // Intl formats decimal strings exactly, so bigint amounts never pass through a float.
  const decimal = `${centimes < 0n ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
  return `${money.format(decimal as Intl.StringNumericLiteral)} DH`;
}

export const formatKg = (grams: number) => `${kg.format(grams / 1000)} kg`;

/** A moment (e.g. the last sync) in farm time: Africa/Casablanca, which follows Morocco's Ramadan offset change. */
export function formatDateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-MA" : "fr", {
    numberingSystem: "latn",
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Africa/Casablanca",
  }).format(new Date(iso));
}

export function formatDay(day: FarmDay, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-MA" : "fr", {
    numberingSystem: "latn",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC", // a FarmDay is already a calendar date
  }).format(new Date(`${day}T00:00:00Z`));
}
