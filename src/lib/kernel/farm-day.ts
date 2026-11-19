// A calendar day on the farm, in Africa/Casablanca. Morocco leaves UTC+1 for UTC+0 around Ramadan,
// so the zone database decides the offset: never derive a farm day from a fixed offset.
export type FarmDay = string & { readonly __brand: "FarmDay" }; // YYYY-MM-DD

const casablanca = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca" }); // en-CA → YYYY-MM-DD

export const farmDayOf = (instant: Date) => casablanca.format(instant) as FarmDay;

export const nextFarmDay = (day: FarmDay) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) as FarmDay;

const farmClock = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Casablanca", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Minutes since midnight on the farm clock (Africa/Casablanca). */
export function farmMinutesOf(instant: Date): number {
  const [h, m] = farmClock.format(instant).split(":").map(Number);
  return h * 60 + m;
}

/** The instant the farm clock shows `minutes` past midnight on `day`. The zone database gives the offset of that day. */
export function farmInstant(day: FarmDay, minutes: number): Date {
  const wall = Date.parse(`${day}T00:00:00Z`) + minutes * 60_000; // the wall time, read as if it were UTC
  const offsetAt = (t: number) => Date.parse(`${farmDayOf(new Date(t))}T00:00:00Z`) + farmMinutesOf(new Date(t)) * 60_000 - t;
  return new Date(wall - offsetAt(wall - offsetAt(wall)));
}
