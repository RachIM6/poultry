import { InspectionScreen } from "@/components/inspection";
import { ClientMessages } from "@/i18n/client-messages";
import type { MessagePath } from "@/i18n/pick";

// What this page's client components read (src/i18n/client-messages.tsx).
const MESSAGES: MessagePath[] = [
  "App", "Biosecurity", "Cleanout", "Day", "Disposal", "Documents", "Inspection", "Nav", "Protocol.methods",
  "Register", "Sync.login", "Sync.signedOut", "Treatment.routes", "Types", "Visitors",
];

// A static shell, precached by the service worker (src/app/serwist): the farm, its documents, logs and batches come from
// IndexedDB (poultry-pwa §0.3). In the app's shell like every signed-in screen (the shell is static too); the screen
// renders its Page, whose title is the farm's. Only the document prints: the shell, the contents and the button don't.
export default function InspectionPage() {
  return (
    <ClientMessages paths={MESSAGES}>
      <InspectionScreen />
    </ClientMessages>
  );
}
