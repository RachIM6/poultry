import { db } from "@/lib/db";
import type { FarmDay } from "@/lib/kernel/farm-day";
import type { TenantContext } from "@/lib/tenant";
import { createOrganization } from "@/modules/farm-registry";
import { addOwner } from "@/modules/identity";
import { operator } from "@/ops/organization-data";
import { must, today } from "../kit";
import { COMPANY_FARM, COMPANY_NAME, fillCompanyHistory } from "./company";
import { FARM_NAMES, fillFarmHistory } from "./farm";
import { joinMembers, VET_NAME } from "./members";
import { DEMO_PREFIX, notDemo, resetDemo } from "./reset";
import { applyAll } from "./story";

// DEMO_HISTORY_FROM=2025-01-01 (with DEMO_INTO_EXISTING=1, DEMO_RESET=1 to start clean): the demo owner's organisation
// filled with the farm's long history to today, a company with its books (the past years closed), and four members
// who sign in by email. Run again: nothing added (the marker below), unless the story changes (HISTORY_VERSION).

const HISTORY_VERSION = 1; // bump when the story changes: a run then resets and tells the new one (with DEMO_RESET=1)
const MARKER = "demo-history";
/** Every farm name the demo seed ever made, the old scenario's and this one's. */
export const SEED_FARMS = ["Ferme Démo Ben Ahmed", "Ferme Démo Tiflet", "Ferme Démo Berrechid", ...FARM_NAMES, COMPANY_FARM];

export type HistoryOptions = { phone: string; organizationId?: string; from: string; reset: boolean; membersFile: string; rotate: boolean; sarlName: string; freePhones: (n: number, exclude: string) => Promise<string[]> };
export type HistoryResult = { added: boolean; lines: string[] };

export async function seedHistory(o: HistoryOptions): Promise<HistoryResult> {
  const started = Date.now();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.from) || o.from >= today) throw new Error(`demo: DEMO_HISTORY_FROM must be a day before today (YYYY-MM-DD), not « ${o.from} »`);
  const from = o.from as FarmDay;
  const user = await db.user.findUnique({ where: { phoneNumber: o.phone } });
  if (!user) throw new Error(`demo: no account with the phone ${o.phone}: sign up with it first`);
  const owned = await db.membership.findMany({ where: { userId: user.id, role: "owner", organization: { leftAt: null } }, select: { organization: { select: { id: true, name: true } } } });
  const companyNames = [o.sarlName, COMPANY_NAME];
  const companies = owned.map((m) => m.organization).filter((x) => companyNames.includes(x.name));
  const candidates = owned.map((m) => m.organization).filter((x) => (o.organizationId ? x.id === o.organizationId : !companyNames.includes(x.name)));
  if (candidates.length !== 1) {
    const list = owned.map((x) => `${x.organization.id} « ${x.organization.name} »`).join(", ") || "none";
    throw new Error(`demo: set DEMO_ORGANIZATION_ID to the organisation to fill, one of: ${list}`);
  }
  const target = candidates[0];
  const key = { from, version: HISTORY_VERSION };
  const marker = await db.auditEvent.findFirst({ where: { organizationId: target.id, entity: "Organization", action: MARKER }, orderBy: { id: "desc" } });
  if (marker && JSON.stringify((marker.after as { key?: unknown }).key) === JSON.stringify(key)) return { added: false, lines: [`demo: « ${target.name} » already holds the history from ${from}: nothing added`] };

  const lines: string[] = [];
  if (o.reset) {
    const why = await notDemo(user.id, [target, ...companies], SEED_FARMS, companyNames, target.id);
    if (why) throw new Error(`demo: reset refused, ${why}`);
    const r = await resetDemo(user.id, target, companies);
    lines.push(`demo: reset « ${target.name} » (kept: the organisation, its owner and the owner's settings) and deleted ${companies.map((c) => `« ${c.name} »`).join(", ") || "no company"}, ${r.users} made-up users; ${r.tombstones} sync deletions for the phones`);
    for (const [org, tables] of Object.entries(r.deleted)) lines.push(`demo:   ${org}: ${Object.entries(tables).map(([t, n]) => `${t} ${n}`).join(", ") || "nothing"}`);
  } else {
    if ((await db.farm.count({ where: { organizationId: target.id } })) > 0 || companies.some((c) => c.name === COMPANY_NAME))
      throw new Error(`demo: « ${target.name} » already has data: run with DEMO_RESET=1 to start it again`);
  }

  // The company, created by its associate (a made-up user) and co-owned by the owner, as the old scenario's SARL.
  const phones = await o.freePhones(8, o.phone);
  const associatePhone = phones.shift()!;
  if (!associatePhone.startsWith(DEMO_PREFIX)) throw new Error("demo: no free made-up number");
  const associate = await db.user.create({ data: { phoneNumber: associatePhone, firstName: "Driss", lastName: "Bennani", name: "Driss Bennani", email: `${associatePhone.slice(1)}@phone.invalid`, locale: "fr" } });
  const company = must("company onboarding", await createOrganization(associate.id, { name: COMPANY_NAME, form: "company", locale: "fr" })).value;
  await db.$transaction((tx) => addOwner(tx, { organizationId: company.organizationId, userId: user.id, locale: "fr" }));
  const owner: TenantContext = { userId: user.id, organizationId: target.id, role: "owner" };
  const companyOwner: TenantContext = { userId: user.id, organizationId: company.organizationId, role: "owner" };

  const members = await joinMembers(owner, companyOwner, { file: o.membersFile, rotate: o.rotate, phones });
  lines.push(`demo: members ${members.created} created, ${members.rotated} with a new password; email, role, name and password in ${members.file}`);

  // The two books are independent: told side by side (half the time over a network).
  const [farm, books] = await Promise.all([
    fillFarmHistory(owner, members, { manager: members.phones.manager, worker: members.phones.worker, vetName: VET_NAME }, from, today),
    fillCompanyHistory(companyOwner, VET_NAME, from, today),
  ]);
  const notifications = await quietNotifications([owner, companyOwner, members.manager]);

  await db.auditEvent.create({ data: { organizationId: target.id, entity: "Organization", entityId: target.id, action: MARKER, after: { key, operator: operator() } } });
  lines.push(`demo: « ${target.name} »: ${farm.applied} writes and ${farm.calls} online actions; ${await summary(target.id)}`);
  lines.push(`demo: « ${COMPANY_NAME} »: ${books.applied} writes and ${books.calls} online actions; ${await summary(company.organizationId)}, ${books.closes} year(s) closed`);
  lines.push(`demo: ${notifications.read} past notifications marked read (${notifications.unread} left unread), none pushed to phones; ${Math.round((Date.now() - started) / 1000)} s`);
  return { added: true, lines };
}

/**
 * The history's notifications are past news: all but the last four of each member marked read (through the app's own
 * write, so phones learn it), and none pushed (the dispatcher would send hundreds at once).
 */
async function quietNotifications(contexts: TenantContext[]) {
  let read = 0;
  let unread = 0;
  for (const ctx of contexts) {
    const rows = await db.notification.findMany({ where: { organizationId: ctx.organizationId, userId: ctx.userId, readAt: null }, orderBy: { id: "asc" }, select: { id: true } });
    const old = rows.slice(0, Math.max(0, rows.length - 4));
    await applyAll(old.map((n) => ({ ctx, type: "notifications.markRead", payload: { id: n.id } })));
    read += old.length;
    unread += rows.length - old.length;
  }
  await db.notification.updateMany({ where: { organizationId: { in: [...new Set(contexts.map((c) => c.organizationId))] }, pushedAt: null }, data: { pushedAt: new Date() } });
  return { read, unread };
}

async function summary(organizationId: string) {
  const where = { organizationId };
  const [farms, houses, open, closed, days, sales, purchases, entries] = await Promise.all([
    db.farm.count({ where }),
    db.house.count({ where }),
    db.batch.count({ where: { ...where, status: "open" } }),
    db.batch.count({ where: { ...where, status: "closed" } }),
    db.dailyEntry.count({ where }),
    db.sale.count({ where }),
    db.purchase.count({ where }),
    db.journalEntry.count({ where }),
  ]);
  return `${farms} farms, ${houses} houses, batches ${open} open and ${closed} closed, ${days} daily entries, ${sales} sales, ${purchases} purchases, ${entries} journal entries`;
}
