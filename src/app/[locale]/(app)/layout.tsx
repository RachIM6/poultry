import { AppNav } from "@/components/app-nav";

// The signed-in screens: bottom tabs on the phone, a sidebar on wide screens (tasks/plan-ui.md U2). A route group, so
// the URLs (and the service worker's precached shells) don't change. The nav comes after the content in the DOM, so the
// keyboard and screen readers reach the page first (WCAG 2.4.3); it is fixed on the phone and order-first on wide screens.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col pb-[76px] print:pb-0 lg:pb-0">{children}</div>
      <AppNav />
    </div>
  );
}
