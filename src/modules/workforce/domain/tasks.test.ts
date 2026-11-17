import { describe, expect, it } from "vitest";
import { dayTasks, routineFalls, type Routine, type TaskInputs } from "@/modules/workforce/domain/tasks";

const F = "farm-1";
const none: TaskInputs = { batches: [], entries: [], vaccinations: [], employees: [], routines: [], oneOffs: [], done: [], assignments: [] };
const batch = { id: "b1", farmId: F, houseId: "h2", placedOn: "2026-10-05", status: "open" }; // J31 on 2026-11-05
const routine = (r: Partial<Routine>): Routine => ({ id: "r1", farmId: F, houseId: null, title: "Contrôle des abreuvoirs", time: "07:30", everyDays: 1, startOn: "2026-11-01", fromAge: null, stopOn: null, employeeId: null, ...r });
const said = { id: "said", farmId: F, houseIds: ["h2"], startedOn: "2026-01-01", leftOn: null };
const hamid = { id: "hamid", farmId: F, houseIds: [], startedOn: "2026-01-01", leftOn: null };
const keys = (x: TaskInputs, day = "2026-11-05") => dayTasks(F, day, x).map((t) => [t.key, t.done]);

describe("a farm day's tasks (SPEC-m4 WF4)", () => {
  it("one daily entry per open batch, done once that day's entry exists; none for a closed or other farm's batch", () => {
    const x = { ...none, batches: [batch, { ...batch, id: "b2", status: "closed" }, { ...batch, id: "b3", farmId: "farm-2" }] };
    expect(keys(x)).toEqual([["entry:b1", false]]);
    expect(keys({ ...x, entries: [{ batchId: "b1", day: "2026-11-04" }] })).toEqual([["entry:b1", false]]);
    expect(keys({ ...x, entries: [{ batchId: "b1", day: "2026-11-05" }] })).toEqual([["entry:b1", true]]);
    expect(dayTasks(F, "2026-11-05", x)[0]).toMatchObject({ houseId: "h2", age: 31 });
  });

  it("vaccines due that day or late, done once recorded that day; not those done earlier or due later", () => {
    const v = (id: string, dueOn: string, done: string | null) => ({ id, batchId: "b1", dueOn, productId: "gumboro", done: done ? { on: done } : null });
    const x = { ...none, batches: [batch], vaccinations: [v("today", "2026-11-05", null), v("late", "2026-11-01", null), v("doneNow", "2026-11-05", "2026-11-05"), v("doneBefore", "2026-10-20", "2026-10-20"), v("later", "2026-11-06", null)] };
    expect(keys(x)).toEqual([["entry:b1", false], ["vaccine:today", false], ["vaccine:late", false], ["vaccine:doneNow", true]]);
    expect(dayTasks(F, "2026-11-05", x).find((t) => t.key === "vaccine:late")).toMatchObject({ late: true, productId: "gumboro" });
  });

  it("calendar routines every n days from their start, until the day they stop", () => {
    const r = routine({ everyDays: 7, startOn: "2026-11-02" });
    expect(["2026-11-01", "2026-11-02", "2026-11-08", "2026-11-09", "2026-11-16"].map((d) => routineFalls(r, d, null))).toEqual([false, true, false, true, true]);
    expect(routineFalls({ ...r, stopOn: "2026-11-16" }, "2026-11-16", null)).toBe(false);
    expect(routineFalls({ ...r, stopOn: "2026-11-16" }, "2026-11-09", null)).toBe(true);
  });

  it("batch routines from an age of the house's open batch, never without one", () => {
    const r = routine({ houseId: "h2", startOn: null, fromAge: 7, everyDays: 7, title: "Pesée de 100 sujets" });
    expect([6, 7, 14, 31, 35].map((age) => routineFalls(r, "2026-11-05", age))).toEqual([false, true, true, false, true]);
    expect(routineFalls(r, "2026-11-05", null)).toBe(false);
    expect(keys({ ...none, batches: [{ ...batch, placedOn: "2026-10-01" }], routines: [r] })).toEqual([["entry:b1", false], ["routine:r1", false]]); // J35
    expect(keys({ ...none, routines: [r] })).toEqual([]);
  });

  it("one-off tasks on their day, not cancelled; routines and one-offs done once ticked that day", () => {
    const o = { id: "o1", farmId: F, houseId: null, day: "2026-11-05", title: "Recevoir le camion d’aliment", time: "09:00", employeeId: null, cancelled: false };
    const x = { ...none, routines: [routine({})], oneOffs: [o, { ...o, id: "o2", cancelled: true }, { ...o, id: "o3", day: "2026-11-06" }] };
    expect(keys(x)).toEqual([["routine:r1", false], ["oneoff:o1", false]]); // 07:30, 09:00
    expect(keys({ ...x, done: [{ key: "oneoff:o1", day: "2026-11-05" }, { key: "routine:r1", day: "2026-11-04" }] })).toEqual([["routine:r1", false], ["oneoff:o1", true]]);
  });
});

describe("who does each task (SPEC-m4 WF7)", () => {
  const who = (x: TaskInputs, day = "2026-11-05") => Object.fromEntries(dayTasks(F, day, x).map((t) => [t.key, t.assignees]));

  it("the explicit assignee, else whoever looks after the house, else everyone on the farm", () => {
    const x = { ...none, batches: [batch], employees: [said, hamid], routines: [routine({}), routine({ id: "r2", employeeId: "hamid", houseId: "h2" })] };
    expect(who(x)).toEqual({ "entry:b1": ["said"], "routine:r1": ["said", "hamid"], "routine:r2": ["hamid"] });
  });

  it("a reassignment that day wins; the last one counts", () => {
    const x = { ...none, batches: [batch], employees: [said, hamid], assignments: [{ key: "entry:b1", day: "2026-11-05", employeeId: "hamid" }, { key: "entry:b1", day: "2026-11-04", employeeId: "said" }] };
    expect(who(x)).toEqual({ "entry:b1": ["hamid"] });
    expect(who({ ...x, assignments: [...x.assignments, { key: "entry:b1", day: "2026-11-05", employeeId: "said" }] })).toEqual({ "entry:b1": ["said"] });
  });

  it("an employee who left, or hasn't started, gets nothing: the task falls back to the others", () => {
    const left = { ...said, leftOn: "2026-11-05" };
    const x = { ...none, batches: [batch], employees: [left, hamid], routines: [routine({ employeeId: "said" })] };
    expect(who(x)).toEqual({ "entry:b1": ["hamid"], "routine:r1": ["hamid"] });
    expect(who(x, "2026-11-04")).toEqual({ "entry:b1": ["said"], "routine:r1": ["said"] });
    expect(who({ ...x, employees: [{ ...hamid, startedOn: "2026-11-06" }] })).toEqual({ "entry:b1": [], "routine:r1": [] });
  });
});
