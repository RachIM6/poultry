import { daysBetween, type FarmDay } from "@/lib/kernel/farm-day";

// SPEC-m4 WF4, WF7: a farm day's tasks are computed, never stored. The same function runs on the phone (offline) and on
// the server, from records both already have: open batches, their entries and vaccination plans, the manager's routines
// and one-off tasks. Only completions, reassignments, routines and one-off tasks are stored.

type Day = string; // farm day, YYYY-MM-DD

/** A recurring task: every `everyDays` days from a calendar day, or from an age of the house's open batch. */
export type Routine = {
  id: string;
  farmId: string;
  houseId: string | null; // null: the whole farm
  title: string;
  time: string | null; // "HH:MM" on the farm clock
  everyDays: number;
  startOn: Day | null; // calendar routine
  fromAge: number | null; // batch routine (needs a house): from this age of its open batch
  stopOn: Day | null; // nothing from this day on
  employeeId: string | null;
};
export type OneOffTask = { id: string; farmId: string; houseId: string | null; day: Day; title: string; time: string | null; employeeId: string | null; cancelled: boolean };

export type TaskInputs = {
  batches: { id: string; farmId: string; houseId: string; placedOn: Day; status: string }[];
  entries: { batchId: string; day: Day }[];
  vaccinations: { id: string; batchId: string; dueOn: Day; productId: string; done: { on: Day } | null }[];
  employees: { id: string; farmId: string; houseIds: string[]; startedOn: Day; leftOn: Day | null }[];
  routines: Routine[];
  oneOffs: OneOffTask[];
  done: { key: string; day: Day }[];
  assignments: { key: string; day: Day; employeeId: string }[];
};

export type DayTask = {
  key: string; // stable per source: completions and reassignments refer to it with the day
  kind: "entry" | "vaccine" | "routine" | "oneoff";
  farmId: string;
  houseId: string | null;
  batchId: string | null;
  age: number | null; // the batch's age that day
  time: string | null;
  title: string | null; // the manager's words (routine, one-off)
  productId: string | null; // vaccine
  everyDays: number | null; // routine
  late: boolean; // a vaccine due before that day
  assignees: string[]; // employee ids
  done: boolean;
};

const blank = { batchId: null, age: null, time: null, title: null, productId: null, everyDays: null, late: false };

export const taskKey = {
  entry: (batchId: string) => `entry:${batchId}`,
  vaccine: (vaccinationId: string) => `vaccine:${vaccinationId}`,
  routine: (routineId: string) => `routine:${routineId}`,
  oneoff: (taskId: string) => `oneoff:${taskId}`,
};

/** Does the routine fall on `day`? For a batch routine, `age` is the age of the house's open batch that day. */
export function routineFalls(r: Routine, day: Day, age: number | null): boolean {
  if (r.stopOn !== null && day >= r.stopOn) return false;
  const since = r.fromAge !== null ? (age === null ? -1 : age - r.fromAge) : r.startOn !== null ? daysBetween(r.startOn as FarmDay, day as FarmDay) : -1;
  return since >= 0 && since % r.everyDays === 0;
}

const active = (e: TaskInputs["employees"][number], day: Day) => e.startedOn <= day && (e.leftOn === null || day < e.leftOn);

/** The tasks of one farm on one day, untimed first (entry, vaccines), then by time. */
export function dayTasks(farmId: string, day: Day, x: TaskInputs): DayTask[] {
  const open = x.batches.filter((b) => b.farmId === farmId && b.status === "open" && b.placedOn <= day);
  const ageIn = (houseId: string | null) => {
    const b = houseId === null ? undefined : open.find((o) => o.houseId === houseId);
    return b ? daysBetween(b.placedOn as FarmDay, day as FarmDay) : null;
  };
  const ticked = new Set(x.done.filter((d) => d.day === day).map((d) => d.key));
  const tasks: Omit<DayTask, "assignees">[] = [];

  for (const b of open) {
    const age = daysBetween(b.placedOn as FarmDay, day as FarmDay);
    const at = { farmId, houseId: b.houseId, batchId: b.id, age };
    tasks.push({ ...blank, ...at, key: taskKey.entry(b.id), kind: "entry", done: x.entries.some((e) => e.batchId === b.id && e.day === day) });
    for (const v of x.vaccinations.filter((v) => v.batchId === b.id && (v.done ? v.done.on === day : v.dueOn <= day))) {
      tasks.push({ ...blank, ...at, key: taskKey.vaccine(v.id), kind: "vaccine", productId: v.productId, late: v.dueOn < day, done: v.done !== null });
    }
  }
  for (const r of x.routines.filter((r) => r.farmId === farmId)) {
    const age = ageIn(r.houseId);
    if (!routineFalls(r, day, age)) continue;
    const key = taskKey.routine(r.id);
    tasks.push({ ...blank, key, kind: "routine", farmId, houseId: r.houseId, age, time: r.time, title: r.title, everyDays: r.everyDays, done: ticked.has(key) });
  }
  for (const o of x.oneOffs.filter((o) => o.farmId === farmId && o.day === day && !o.cancelled)) {
    const key = taskKey.oneoff(o.id);
    tasks.push({ ...blank, key, kind: "oneoff", farmId, houseId: o.houseId, age: ageIn(o.houseId), time: o.time, title: o.title, done: ticked.has(key) });
  }

  // WF7: a reassignment that day, else the task's own assignee, else whoever looks after the house, else the whole farm.
  const staff = x.employees.filter((e) => e.farmId === farmId && active(e, day));
  const owner = (key: string) => x.routines.find((r) => taskKey.routine(r.id) === key)?.employeeId ?? x.oneOffs.find((o) => taskKey.oneoff(o.id) === key)?.employeeId ?? null;
  const assign = (t: Omit<DayTask, "assignees">) => {
    const chosen = x.assignments.filter((a) => a.key === t.key && a.day === day).at(-1)?.employeeId ?? owner(t.key);
    if (chosen !== null && staff.some((e) => e.id === chosen)) return [chosen];
    const house = t.houseId === null ? [] : staff.filter((e) => e.houseIds.includes(t.houseId!));
    return (house.length > 0 ? house : staff).map((e) => e.id);
  };
  return tasks
    .map((t) => ({ ...t, assignees: assign(t) }))
    .sort((a, b) => (a.time ?? "").localeCompare(b.time ?? "") || RANK[a.kind] - RANK[b.kind]);
}

const RANK: Record<DayTask["kind"], number> = { entry: 0, vaccine: 1, routine: 2, oneoff: 3 };
