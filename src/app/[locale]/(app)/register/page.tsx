import { getMessages } from "next-intl/server";
import { RegisterScreen } from "@/components/register-document";
import { ClientMessages } from "@/i18n/client-messages";
import { pick, type MessagePath } from "@/i18n/pick";
import { routing } from "@/i18n/routing";

// What this page's client components read (src/i18n/client-messages.tsx), in the app's language.
const MESSAGES: MessagePath[] = [
  "Inspection.contents", "LocaleSwitcher.ar", "LocaleSwitcher.fr", "Nav", "Sync.login", "Sync.signedOut",
  ...(["title", "batchOf", "language", "notFound", "incomplete", "print", "cover", "supervision", "daily", "treatments", "vaccinations", "birdsOut", "disposals", "labReports", "visas", "annexes"] as const).map((k) => `Register.${k}` as const),
];
// What the document reads, in each of its languages: it is printed in French or Arabic whatever the app's language.
const DOCUMENT: MessagePath[] = ["App.name", "Day.causes", "Disposal.methods", "Inspection.state", "Protocol.methods", "Register", "Treatment.routes", "Types"];

// A static shell, precached by the service worker (src/app/serwist): the batch and its records come from IndexedDB
// (poultry-pwa §0.3). In the app's shell like every signed-in screen; the screen renders its Page. Only the document
// prints: the shell, the page's header and the contents don't.
export default async function RegisterPage() {
  const documents = Object.fromEntries(await Promise.all(routing.locales.map(async (l) => [l, pick(await getMessages({ locale: l }), DOCUMENT)])));
  return (
    <ClientMessages paths={MESSAGES}>
      <RegisterScreen documents={documents} />
    </ClientMessages>
  );
}
