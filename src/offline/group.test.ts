import { describe, expect, it } from "vitest";
import { batchStrip } from "@/components/batch-strip";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { birdsOnHand, birdsStarted, type BatchDto, type DailyEntryDto, type SoldBirdsDto } from "@/modules/flock/shared";
import type { TreatmentDto, VaccinationDto } from "@/modules/health/shared";
import type { LocalRecord } from "./db";
import { groupRecords } from "./group";

const today = "2026-11-24" as FarmDay;

// 40 batches (30 open: broilers, layers, beldi bands in one house) and 5,000 records in all: a busy farm's phone.
function farm() {
  const records: LocalRecord[] = [];
  const add = (entity: string, id: string, data: object) => records.push({ key: `${entity}:${id}`, entity, id, data: { id, ...data } });
  const day = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
  add("farm", "f1", { name: "Ferme" });
  for (let b = 0; b < 40; b++) {
    const open = b < 30;
    const species = b % 5 === 0 ? "layer" : b % 7 === 0 ? "beldi" : "broiler";
    add("house", `h${b}`, { farmId: "f1", name: `B${b}` });
    add("batch", `b${b}`, { farmId: "f1", houseId: species === "beldi" ? "h0" : `h${b}`, species, status: open ? "open" : "closed", placedOn: day(open ? 35 : 120 + b), chicksPlaced: 10_000, deadOnArrival: 10 });
  }
  for (let i = 0; records.length < 5_000; i++) {
    const batchId = `b${i % 40}`;
    const kind = i % 10;
    if (kind < 6) add("dailyEntry", `e${i}`, { batchId, day: day(i % 35), dead: 3, culled: 1 });
    else if (kind === 6) add("soldBirds", `s${i}`, { batchId, day: day(i % 35), birds: 20 });
    else if (kind === 7) add("vaccination", `v${i}`, { batchId, dueOn: day((i % 40) - 5), done: i % 3 === 0 });
    else if (kind === 8) add("treatment", `t${i}`, { batchId, startOn: day(i % 20), withdrawalEndsOn: day((i % 20) - 7) });
    else add("weighing", `w${i}`, { batchId, day: day(i % 35) });
  }
  return records;
}

// The /batches list's figures (src/components/batches.tsx): birds on hand on every card and in the band totals, the
// strip on each open card.
function list(records: LocalRecord[]) {
  const g = groupRecords(records);
  const birds = new Map(g.of<BatchDto>("batch").map((b) => [b.id, birdsOnHand(birdsStarted(b), g.ofBatch<DailyEntryDto>("dailyEntry", b.id), g.ofBatch<SoldBirdsDto>("soldBirds", b.id))]));
  const strips = g
    .of<BatchDto>("batch")
    .filter((b) => b.status === "open")
    .map((b) => batchStrip(b, today, { entries: g.ofBatch<DailyEntryDto>("dailyEntry", b.id), vaccinations: g.ofBatch<VaccinationDto>("vaccination", b.id), treatments: g.ofBatch<TreatmentDto>("treatment", b.id) }));
  return { birds, strips };
}

describe("groupRecords", () => {
  it("gives each entity's and each batch's rows in the records' order, as filtering them would", () => {
    const records = farm();
    const g = groupRecords(records);
    const filter = (entity: string, batchId?: string) =>
      records.filter((r) => r.entity === entity && (batchId === undefined || (r.data as { batchId?: string }).batchId === batchId)).map((r) => r.data);
    for (const entity of ["farm", "house", "batch", "dailyEntry", "soldBirds", "treatment", "nothing"]) expect(g.of(entity)).toEqual(filter(entity));
    for (const batchId of ["b0", "b7", "b39", "none"]) {
      for (const entity of ["dailyEntry", "vaccination", "batch"]) expect(g.ofBatch(entity, batchId)).toEqual(filter(entity, batchId));
    }
  });

  it("computes the /batches list of 40 batches and 5,000 records in ≤ 50 ms", () => {
    const records = farm();
    expect(list(records).strips).toHaveLength(30); // warm-up, and the fixture is what it says
    const runs = Array.from({ length: 5 }, () => {
      const start = performance.now();
      list(records);
      return performance.now() - start;
    }).sort((a, b) => a - b);
    console.log(`/batches list: ${runs[2].toFixed(1)} ms (median of 5)`);
    expect(runs[2]).toBeLessThanOrEqual(50);
  });
});
