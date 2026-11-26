import { AppNav } from "@/components/app-nav";
import { DemoBanner } from "@/components/demo-banner";
import { MORE_MESSAGES } from "@/components/more-groups";
import { ClientMessages } from "@/i18n/client-messages";

// The signed-in screens: bottom tabs on the phone, a sidebar on wide screens (tasks/plan-ui.md U2). A route group, so
// the URLs (and the service worker's precached shells) don't change. The nav comes after the content in the DOM, so the
// keyboard and screen readers reach the page first (WCAG 2.4.3); it is fixed on the phone and order-first on wide screens.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      {/* The demo banner tops the content column, not the page: the wide sidebar keeps its full height (ADR-016). */}
      <div className="flex min-w-0 flex-1 flex-col pb-[76px] print:pb-0 lg:pb-0">
        <DemoBanner />
        {children}
      </div>
      {/* The nav's own messages: the wide sidebar lists the "Plus" screens (more-groups.ts). The page's provider doesn't reach here. */}
      <ClientMessages paths={["Nav", "Sync.refused", "More.settings", ...MORE_MESSAGES]}>
        <AppNav />
      </ClientMessages>
    </div>
  );
}
