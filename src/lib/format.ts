import type { FarmDay } from "@/lib/kernel/farm-day";

// Display formatting (ADR-004): Western digits in both locales, French number style (1 234,50) for
// money and weights, which are written the same way in Arabic and French screens in Morocco.
// Format numbers here, then pass the strings to messages, rather than using ICU number arguments.

const money = new Intl.NumberFormat("fr", { numberingSystem: "latn", minimumFractionDigits: 2 });
const kg = new Intl.NumberFormat("fr", { numberingSystem: "latn", maximumFractionDigits: 3 });

export function formatMoney(centimes: bigint): string {
  // Intl formats decimal strings exactly, so bigint amounts never pass through a float. typedCentimes(centimes, ".")
  // (@/lib/kernel/money) written out: this file ships with /batches, which has no room for that module (SPEC §9.3).
  const abs = centimes < 0n ? -centimes : centimes;
  const decimal = `${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
  // The true minus sign (U+2212): Intl's French one is a hyphen.
  return `${centimes < 0n ? "−" : ""}${money.format(decimal as Intl.StringNumericLiteral)} DH`;
}

const count = new Intl.NumberFormat("fr", { numberingSystem: "latn" });
/** Birds, m², heads: 12 000 in both locales. */
export const formatCount = (n: number) => count.format(n);

const kgWhole = new Intl.NumberFormat("fr", { numberingSystem: "latn", maximumFractionDigits: 0 });
/** The number alone ("0,165", "24 407": no decimals from 100 kg up), for messages that place the unit themselves. */
export const formatKgValue = (grams: number) => (Math.abs(grams) >= 100_000 ? kgWhole : kg).format(grams / 1000);
export const formatKg = (grams: number) => `${formatKgValue(grams)} kg`;

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

const percent = new Intl.NumberFormat("fr", { numberingSystem: "latn", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signedPercent = new Intl.NumberFormat("fr", { numberingSystem: "latn", minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" });
/** "7,9" (a CV) or, signed, "+3,1" / "-5,0" (a gap to the standard): the number alone, messages place the % sign. */
export const formatPercent = (n: number, signed = false) => (signed ? signedPercent : percent).format(n);

/** A ratio or rate with fixed decimals: FCR "1,49" (2), EPEF "429" (0). */
export const formatDecimal = (n: number, decimals: number) =>
  new Intl.NumberFormat("fr", { numberingSystem: "latn", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
