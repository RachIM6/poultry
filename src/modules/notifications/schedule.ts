import { farmDayOf, farmInstant, farmMinutesOf, nextFarmDay } from "@/lib/kernel/farm-day";

// SPEC N2. Pure: the same rule could run on the phone. Times are on the farm clock (Africa/Casablanca).

export type QuietHours = { start: string; end: string }; // "HH:MM"
export const DEFAULT_QUIET_HOURS: QuietHours = { start: "22:00", end: "06:00" }; // N2 default; each user can change it

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** When a push may go out: urgent ones now; others now, or at the end of the recipient's quiet hours if inside them. */
export function deliverAfter(now: Date, quiet: QuietHours, urgent: boolean): Date {
  if (urgent) return now;
  const [start, end, t] = [toMinutes(quiet.start), toMinutes(quiet.end), farmMinutesOf(now)];
  // A window may cross midnight (22:00–06:00). Equal start and end means no quiet hours.
  const inside = start < end ? t >= start && t < end : start > end ? t >= start || t < end : false;
  if (!inside) return now;
  const today = farmDayOf(now);
  return farmInstant(t < end ? today : nextFarmDay(today), end);
}
