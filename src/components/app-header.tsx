"use client";

import dynamic from "next/dynamic";
import { useLoaded } from "@/components/app-nav";

// tasks/plan-ui.md U20: the bar at the top of every signed-in screen, its controls at the end (the right; the left in
// Arabic): the sync chip (tasks/plan-ui-cleanup.md §3), the notifications bell and its panel, then the profile (avatar,
// name and role on wide screens) opening the account menu. Static, like the nav: what it reads from the phone's database
// (the name, the role, the unread notifications, what waits to be sent) comes in its own chunk once the page has loaded,
// into boxes of the same size, so nothing moves when it arrives.
const slots = (
  <>
    <span className="h-11 w-40" />
    <span className="size-11" />
    <span className="size-11 lg:w-60" />
  </>
);
const HeaderLive = dynamic(() => import("@/components/app-header-live").then((m) => m.HeaderLive), { ssr: false, loading: () => slots });

export function AppHeader() {
  const loaded = useLoaded();
  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center justify-end gap-2 border-b border-line bg-card px-4 print:hidden lg:h-16 lg:px-6">
      {loaded ? <HeaderLive /> : slots}
    </header>
  );
}
