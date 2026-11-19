import { TodayShell } from "@/components/today";

// tasks/plan-ui.md U10: "Aujourd'hui" without network. A static shell, precached by the service worker, which serves
// it when /dashboard can't be reached (src/sw.ts). Reads who is signed in and the farm from the phone's database.
export default function TodayOffline() {
  return <TodayShell />;
}
