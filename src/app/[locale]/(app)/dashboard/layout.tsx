import { NextIntlClientProvider } from "next-intl";

// The dashboard still gets the whole catalogue: the root layout only sends what the layouts read
// (src/i18n/client-messages.tsx). ponytail: to drop once dashboard/page.tsx picks its own messages.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <NextIntlClientProvider>{children}</NextIntlClientProvider>;
}
