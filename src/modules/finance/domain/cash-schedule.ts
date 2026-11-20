import { addFarmDays, type FarmDay } from "@/lib/kernel/farm-day";

export type Flow = { dueOn: string; amountCentimes: bigint; direction: "in" | "out" };
export type ScheduleWeek = { from: string; to: string; inCentimes: bigint; outCentimes: bigint; afterCentimes: bigint };

/**
 * F-Effects' 30-day schedule: today's cash run forward week by week with what falls due (cheques and bills to collect
 * in, supplier debts out). Overdue flows land in the first week; flows after the horizon are left out. Facts only:
 * nothing is forecast that isn't already owed with a date.
 */
export function cashSchedule(today: FarmDay, startCentimes: bigint, flows: readonly Flow[], weeks = 4): ScheduleWeek[] {
  const out: ScheduleWeek[] = [];
  let cash = startCentimes;
  for (let w = 0; w < weeks; w++) {
    const from = addFarmDays(today, 7 * w);
    const to = addFarmDays(today, 7 * w + 6);
    const inWeek = flows.filter((f) => (w === 0 ? f.dueOn <= to : f.dueOn >= from && f.dueOn <= to));
    const sum = (d: Flow["direction"]) => inWeek.filter((f) => f.direction === d).reduce((s, f) => s + f.amountCentimes, 0n);
    const [inCentimes, outCentimes] = [sum("in"), sum("out")];
    cash += inCentimes - outCentimes;
    out.push({ from, to, inCentimes, outCentimes, afterCentimes: cash });
  }
  return out;
}
