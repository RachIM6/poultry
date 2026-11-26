import { describe, expect, it } from "vitest";
import { homeKpis, homeTasks, type HomeBatch } from "@/components/today-cockpit";

const batch = (over: Partial<HomeBatch> & { id: string }): HomeBatch => ({
  house: over.id,
  species: "broiler",
  birds: 1000,
  enteredToday: false,
  missing: [],
  until: null,
  vaccines: [],
  eggsYesterday: null,
  ...over,
});

const all = { farming: true, counting: true, tasked: true, recording: true };

describe("homeKpis (the wide home's top row)", () => {
  const rows = [
    batch({ id: "b1", birds: 7843, missing: [{ day: "2026-11-17", age: 15 }] }),
    batch({ id: "p1", house: "Pondeuses", species: "layer", birds: 4975, eggsYesterday: 4577, enteredToday: true }),
  ];

  it("sums the live birds of every open batch", () => {
    expect(homeKpis(rows, all).birds).toEqual({ total: 12818, batches: 2 });
  });

  it("counts yesterday's eggs of the laying houses that recorded a collection", () => {
    expect(homeKpis(rows, all).eggs).toEqual({ total: 4577, houses: ["Pondeuses"] });
  });

  it("counts each missing day as an entry still to make, beside today's entries", () => {
    // b1: 1 missing day + today's entry; p1: entered today
    expect(homeKpis(rows, all).tasks).toEqual({ remaining: 2, missing: 1 });
  });

  it("leaves a figure out when there is nothing to count, rather than showing 0", () => {
    const broilers = [batch({ id: "b1" })];
    expect(homeKpis(broilers, all).eggs).toBeNull(); // no laying batch
    expect(homeKpis([batch({ id: "p1", species: "layer" })], all).eggs).toBeNull(); // no collection yesterday
    expect(homeKpis([], all)).toEqual({ birds: null, eggs: null, tasks: null }); // no open batch
  });

  it("follows what the role's phone holds (SPEC-m5 §5, #297)", () => {
    expect(homeKpis(rows, { ...all, farming: false }).birds).toBeNull(); // accountant: no daily entries, no count
    expect(homeKpis(rows, { ...all, counting: false }).eggs).toBeNull(); // no egg collection on the phone
    expect(homeKpis(rows, { ...all, tasked: false, recording: false }).tasks).toBeNull(); // no task of theirs
  });

  it("gives a vet the vaccines due only: entries and missing days are the recorders'", () => {
    const vet = [batch({ id: "b1", missing: [{ day: "2026-11-17", age: 15 }], vaccines: [{ id: "v1", dueOn: "2026-11-26", status: "today" }] })];
    expect(homeKpis(vet, { ...all, recording: false }).tasks).toEqual({ remaining: 1, missing: 0 });
  });
});

describe("homeTasks (the wide home's checklist)", () => {
  const rows = [
    batch({ id: "a", enteredToday: true, vaccines: [{ id: "va", dueOn: "2026-11-27", status: "upcoming" }] }),
    batch({ id: "b", until: "2026-12-01", missing: [{ day: "2026-11-17", age: 15 }], vaccines: [{ id: "vb", dueOn: "2026-11-24", status: "late" }] }),
    batch({ id: "c" }),
  ];

  it("puts the withdrawals and the missing days first, then the vaccines by due day, then today's entries", () => {
    const { alerts, urgent, entries } = homeTasks(rows, true);
    expect(alerts.map((r) => r.id)).toEqual(["b"]);
    expect(urgent.map((x) => (x.kind === "missing" ? `missing ${x.batch.id}` : `vaccine ${x.vaccine.id}`))).toEqual(["missing b", "vaccine vb", "vaccine va"]);
    expect(entries.map((r) => `${r.id} ${r.enteredToday}`)).toEqual(["b false", "c false", "a true"]); // to do first, done last
  });

  it("shows a non-recorder no entry and no missing day", () => {
    const { urgent, entries } = homeTasks(rows, false);
    expect(urgent.map((x) => x.kind)).toEqual(["vaccine", "vaccine"]);
    expect(entries).toEqual([]);
  });
});
