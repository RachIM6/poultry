// The wide home « A · Cockpit » (tasks/plan-ui.md U18): its top row of figures and its checklist, from the open
// batches the home already reads off the phone. Pure. Not in today.tsx's render, so it can be tested on its own.

export type HomeVaccine = { id: string; dueOn: string; status: "late" | "today" | "upcoming" };

export type HomeBatch = {
  id: string;
  house: string;
  species: string;
  birds: number; // on hand
  enteredToday: boolean;
  missing: readonly { day: string; age: number }[]; // days before today without an entry
  until: string | null; // the withdrawal period's last day, while one runs
  vaccines: readonly HomeVaccine[]; // the ones the home shows: due, late, or due tomorrow
  eggsYesterday: number | null; // a laying batch's collected eggs yesterday; null when none was recorded
};

/** What the role's phone holds (today.tsx): without it a figure would read as a fact it isn't. */
type Holds = { farming: boolean; counting: boolean; tasked: boolean; recording: boolean };

/** The top row. A figure with nothing behind it is null, so the tile is left out rather than showing 0. */
export function homeKpis(rows: readonly HomeBatch[], holds: Holds) {
  const laid = rows.filter((r) => r.species === "layer" && r.eggsYesterday !== null);
  const missing = holds.recording ? rows.reduce((n, r) => n + r.missing.length, 0) : 0;
  const entries = holds.recording ? rows.filter((r) => !r.enteredToday).length : 0;
  const vaccines = rows.reduce((n, r) => n + r.vaccines.length, 0);
  return {
    birds: holds.farming && rows.length > 0 ? { total: rows.reduce((n, r) => n + r.birds, 0), batches: rows.length } : null,
    eggs: holds.counting && laid.length > 0 ? { total: laid.reduce((n, r) => n + r.eggsYesterday!, 0), houses: laid.map((r) => r.house) } : null,
    // Each missing day is an entry still to make, so "dont N saisies manquantes" adds up with today's entries.
    tasks: holds.tasked && rows.length > 0 ? { remaining: missing + entries + vaccines, missing } : null,
  };
}

/**
 * The checklist's order: the withdrawals in progress, then what is late or due (missing days, then vaccines by due
 * day), then one row per house for today's entry, those still to do first. Missing days and entries are the
 * recorders' (flock.record); a vet sees the vaccines only.
 */
export function homeTasks<R extends HomeBatch>(rows: readonly R[], recording: boolean) {
  type Urgent = { kind: "missing"; batch: R } | { kind: "vaccine"; batch: R; vaccine: R["vaccines"][number] };
  const missing: Urgent[] = recording ? rows.filter((r) => r.missing.length > 0).map((batch) => ({ kind: "missing", batch })) : [];
  const vaccines: Urgent[] = rows
    .flatMap((batch) => batch.vaccines.map((vaccine) => ({ kind: "vaccine" as const, batch, vaccine })))
    .sort((a, b) => a.vaccine.dueOn.localeCompare(b.vaccine.dueOn));
  return {
    alerts: rows.filter((r) => r.until !== null),
    urgent: [...missing, ...vaccines],
    entries: recording ? [...rows.filter((r) => !r.enteredToday), ...rows.filter((r) => r.enteredToday)] : [],
  };
}
