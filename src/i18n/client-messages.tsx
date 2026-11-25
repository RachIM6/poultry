import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { type MessagePath, pick } from "./pick";

/**
 * The messages its client components read, rather than the whole catalogue (~36 KB gzip) in every page's HTML and
 * precached shell. It replaces the layout's messages below it (next-intl doesn't merge nested providers), so a page
 * lists everything its client components read: `errors` wherever a form shows a refusal from the server. A path left
 * out throws in dev and e2e (strict-messages.tsx); a path that isn't in the catalogue throws (pick.ts).
 */
export async function ClientMessages({ paths, children }: { paths: readonly MessagePath[]; children: React.ReactNode }) {
  return <NextIntlClientProvider messages={pick(await getMessages(), paths)}>{children}</NextIntlClientProvider>;
}
