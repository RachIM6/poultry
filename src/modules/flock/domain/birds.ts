// SPEC B4, B5: birds on hand = birds started − dead − culled − sold. The one rule the server and the phone use. Its own
// file: kpi.ts ships with /batches, which has no room to grow.
export const birdsOnHand = (started: number, entries: readonly { dead: number; culled: number }[], sold: readonly { birds: number }[]) =>
  started - entries.reduce((n, e) => n + e.dead + e.culled, 0) - sold.reduce((n, s) => n + s.birds, 0);
