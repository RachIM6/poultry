import type { MessagePath } from "@/i18n/pick";
import { can } from "@/lib/permissions";
import { pulls } from "@/lib/sync/views";
import type { TenantContext } from "@/lib/tenant";

// The "Plus" screens (tasks/plan-ui.md U2), by group and role: the /more page (server) and the wide sidebar (client,
// app-nav-live.tsx) both list these. Labels are message keys, icons SVG paths (the sidebar's, Menu4.dc.html). The
// sidebar's filter is for display only: the server still checks every page.
type Rule = (ctx: TenantContext) => boolean;
const money: Rule = (ctx) => can(ctx, "money.read"); // reads: the accountant too (SPEC-m5 PA5)
// Offline screens built on records a partner's phone never receives (SPEC-m5 §5) aren't offered to them.
const holds = (entity: string): Rule => (ctx) => pulls(ctx.role, entity);
const docs: Rule = (ctx) => can(ctx, "documents.manage");

const GROUPS: { title: string; icon: string; links: { href: string; label: string; icon?: string; show?: Rule }[] }[] = [
  {
    title: "More.farm",
    icon: "M3 21V9l9-6 9 6v12M9 21v-6h6v6",
    links: [
      { href: "/farms", label: "Farms.title" },
      { href: "/eggs", label: "EggStock.title", show: holds("eggCollection") }, // SPEC-m3 E4
      { href: "/compare", label: "Compare.title", show: holds("dailyEntry") }, // SPEC-m3 D2
      { href: "/protocol", label: "Protocol.open", show: holds("protocol") },
      { href: "/tasks", label: "Tasks.open", show: holds("routine") },
      { href: "/climate", label: "Climate.open", show: holds("climateReading") },
      { href: "/planning", label: "Planning.open", show: holds("plannedBatch") },
      { href: "/staff", label: "Staff.open", show: money }, // the accountant reads (SPEC-m5 PA5)
      { href: "/inbox", label: "Inbox.open" },
      { href: "/sync", label: "More.sync" },
    ],
  },
  {
    title: "More.money",
    icon: "M3 7h18v10H3zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
    links: [
      { href: "/receivables", label: "Receivables.open", show: money }, // the accountant reads (SPEC-m5 PA5)
      { href: "/expenses", label: "Expenses.open", show: (ctx) => can(ctx, "finance.record") },
      { href: "/treasury", label: "Treasury.open", show: money },
      { href: "/treasury/bank", label: "Bank.open", show: money }, // SPEC-finance FC9, FCX2
      { href: "/prices", label: "Prices.open", show: money },
    ],
  },
  // UX review C5: the daily money above, the books and the year's closing here, so neither list runs to 16 links.
  {
    title: "More.accounting",
    icon: "M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3zM4 17a3 3 0 0 1 3-3h11",
    links: [
      { href: "/books", label: "Books.open", show: money },
      { href: "/results", label: "Results.open", show: money },
      { href: "/budget", label: "Budget.open", show: money },
      { href: "/threshold", label: "Threshold.open", show: money },
      { href: "/closing/count", label: "Count.open", show: money }, // SPEC-finance FC3, FCX2
      { href: "/closing", label: "Close.open", show: money }, // SPEC-finance FCX4
      { href: "/closing/statements", label: "Statements.open", show: money }, // SPEC-finance FC8
      { href: "/assets", label: "Assets.open", show: money }, // SPEC-finance FC1, FCX2
      { href: "/loans", label: "Loans.open", show: money }, // SPEC-finance FC2, FCX2
      { href: "/settings/accounting", label: "Accounting.open", show: money }, // the accountant reads it, the owner changes it
      { href: "/settings/chart", label: "Chart.open", show: money }, // read-only; the accountant reads it (SPEC-m5 PA5)
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
    ],
  },
];

/** The role's groups and links, empty groups left out. */
export const moreGroups = (ctx: TenantContext) =>
  GROUPS.map((g) => ({ ...g, links: g.links.filter((l) => l.show?.(ctx) ?? true) })).filter((g) => g.links.length > 0);

/** Every message the groups name, for the client components that show them (src/i18n/client-messages.tsx). */
export const MORE_MESSAGES = GROUPS.flatMap((g) => [g.title, ...g.links.map((l) => l.label)]) as MessagePath[];
