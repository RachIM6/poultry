// A calendar day on the farm, in Africa/Casablanca. Morocco leaves UTC+1 for UTC+0 around Ramadan,
// so the zone database decides the offset: never derive a farm day from a fixed offset.
export type FarmDay = string & { readonly __brand: "FarmDay" }; // YYYY-MM-DD

const casablanca = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca" }); // en-CA → YYYY-MM-DD

export const farmDayOf = (instant: Date) => casablanca.format(instant) as FarmDay;
