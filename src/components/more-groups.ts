import type { MessagePath } from "@/i18n/pick";
import { can } from "@/lib/permissions";
import { pulls } from "@/lib/sync/views";
import type { TenantContext } from "@/lib/tenant";

// The "Plus" screens (tasks/plan-ui.md U2), by group and role: the /more page (server) and the wide sidebar (client,
// app-nav-live.tsx) both list these. Labels are message keys, icons SVG paths (the sidebar's, Menu4.dc.html). The
// sidebar's filter is for display only: the server still checks every page. tasks/plan-ui-cleanup.md §3: one entry per
// topic, its other pages reached by the page's route tabs (`routes`: what else marks it current); `phone`: only on /more,
// the header holds it on wide screens (the bell, the sync chip).
type Rule = (ctx: TenantContext) => boolean;
const money: Rule = (ctx) => can(ctx, "money.read"); // reads: the accountant too (SPEC-m5 PA5)
// Offline screens built on records a partner's phone never receives (SPEC-m5 §5) aren't offered to them.
const holds = (entity: string): Rule => (ctx) => pulls(ctx.role, entity);
const docs: Rule = (ctx) => can(ctx, "documents.manage");

const GROUPS: { title: string; icon: string; links: { href: string; label: string; routes?: string[]; phone?: true; icon?: string; show?: Rule }[] }[] = [
  {
    title: "More.farm",
    icon: "M3 21V10l4-6h10l4 6v11zM9 21v-7h6v7M9 14l6 7M15 14l-6 7", // a barn (gambrel roof, crossed door): not Aujourd'hui's house
    links: [
      { href: "/farms", label: "Farms.title" },
      { href: "/eggs", label: "EggStock.title", show: holds("eggCollection") }, // SPEC-m3 E4
      { href: "/compare", label: "Compare.title", show: holds("dailyEntry") }, // SPEC-m3 D2
      { href: "/protocol", label: "Protocol.open", show: holds("protocol") },
      { href: "/tasks", label: "Tasks.open", show: holds("routine") },
      { href: "/climate", label: "Climate.open", show: holds("climateReading") }, // and /climate/targets
      { href: "/planning", label: "Planning.open", show: holds("plannedBatch") },
      { href: "/staff", label: "Staff.open", show: money }, // the accountant reads (SPEC-m5 PA5)
    ],
  },
  {
    title: "More.money",
    icon: "M3 7h18v10H3zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
    links: [
      { href: "/receivables", label: "Receivables.open", show: money }, // the accountant reads (SPEC-m5 PA5)
      { href: "/expenses", label: "Expenses.open", show: (ctx) => can(ctx, "finance.record") },
      { href: "/treasury", label: "Treasury.open", show: money }, // and /treasury/bank (SPEC-finance FC9, FCX2)
      { href: "/prices", label: "Prices.open", show: money },
    ],
  },
  // UX review C5: the daily money above, the books and the year's closing here, so neither list runs to 16 links.
  {
    title: "More.accounting",
    icon: "M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3zM4 17a3 3 0 0 1 3-3h11",
    links: [
      { href: "/books", label: "Books.open", show: money },
      { href: "/results", label: "Results.section", routes: ["/budget", "/threshold"], show: money },
      // Step 1 first, the count (SPEC-finance FC3, FCX2); then /closing (FCX4) and /closing/statements (FC8).
      { href: "/closing/count", label: "Close.steps.label", routes: ["/closing"], show: money },
      { href: "/assets", label: "Assets.open", show: money }, // SPEC-finance FC1, FCX2
      { href: "/loans", label: "Loans.open", show: money }, // SPEC-finance FC2, FCX2
      // The accountant reads the profile and the chart (SPEC-m5 PA5), the owner changes them and the posting rules.
      { href: "/settings/accounting", label: "Accounting.open", routes: ["/settings/chart", "/settings/posting"], show: money },
    ],
  },
  // SPEC-m2-compliance: the logs and documents an inspection asks for.
  {
    title: "More.compliance",
    icon: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4",
    links: [
      { href: "/visitors", label: "Visitors.open", show: holds("visit") },
      { href: "/disposal", label: "Disposal.open", show: holds("disposal") },
      { href: "/cleanout", label: "Cleanout.open", show: holds("cleanout") },
      { href: "/documents", label: "Documents.open", show: docs },
      { href: "/inspection", label: "Inspection.open", show: docs },
    ],
  },
  {
    title: "More.account",
    icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
    links: [
      { href: "/settings/members", label: "Members.title", icon: "M16 20a4 4 0 0 0-8 0M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM21 20a3 3 0 0 0-3-3M17.5 11a2.5 2.5 0 1 0 0-5", show: (ctx) => can(ctx, "members.manage") },
      // SPEC-m5 PA2: switch farms, accept an invitation, or join another farm with an invite code (ADR-015).
      { href: "/organizations", label: "Organizations.title", icon: "M7 7h13l-3-3M17 17H4l3 3" },
      { href: "/inbox", label: "Inbox.open", phone: true },
      { href: "/sync", label: "More.sync", phone: true },
    ],
  },
];

/** The role's groups and links, empty groups left out. */
export const moreGroups = (ctx: TenantContext) =>
  GROUPS.map((g) => ({ ...g, links: g.links.filter((l) => l.show?.(ctx) ?? true) })).filter((g) => g.links.length > 0);

/** Every message the groups name, for the client components that show them (src/i18n/client-messages.tsx). */
export const MORE_MESSAGES = GROUPS.flatMap((g) => [g.title, ...g.links.map((l) => l.label)]) as MessagePath[];
