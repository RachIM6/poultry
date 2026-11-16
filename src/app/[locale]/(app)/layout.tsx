import { AppNav } from "@/components/app-nav";

// The signed-in screens: bottom tabs on the phone, a sidebar on wide screens (tasks/plan-ui.md U2). A route group, so
// the URLs (and the service worker's precached shells) don't change.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <AppNav />
      <div className="flex min-w-0 flex-1 flex-col pb-[76px] print:pb-0 lg:pb-0">{children}</div>
    </div>
  );
}
