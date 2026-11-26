import { AppHeader } from "@/components/app-header";
import { AppNav } from "@/components/app-nav";
import { DemoBanner } from "@/components/demo-banner";
import { MORE_MESSAGES } from "@/components/more-groups";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

const HEADER_MESSAGES: MessagePath[] = [
  "Header.notifications", "Header.yourName", "Members.roles", "Organizations.title", "LocaleSwitcher",
  "Account.logout", "Account.logoutEverywhere", "Account.everywhereConfirm", "Account.unsyncedConfirm", "errors.NETWORK",
];

// The signed-in screens: bottom tabs on the phone, a sidebar on wide screens (tasks/plan-ui.md U2). A route group, so
// the URLs (and the service worker's precached shells) don't change. The nav comes after the content in the DOM, so the
// keyboard and screen readers reach the page first (WCAG 2.4.3); it is fixed on the phone and order-first on wide screens.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      {/* The header bar (U20), then the demo banner, top the content column, not the page: the wide sidebar keeps its
          full height (ADR-016). The header's own messages: the page's provider doesn't reach it. */}
      <div className="flex min-w-0 flex-1 flex-col pb-[76px] print:pb-0 lg:pb-0">
        <ClientMessages paths={HEADER_MESSAGES}>
          <AppHeader />
        </ClientMessages>
        <DemoBanner />
        {children}
      </div>
      {/* The nav's own messages: the wide sidebar lists the "Plus" screens (more-groups.ts). The page's provider doesn't reach here. */}
      <ClientMessages paths={["Nav", "Sync.refused", ...MORE_MESSAGES]}>
        <AppNav />
      </ClientMessages>
    </div>
  );
}
