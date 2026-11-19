"use client";

import { SerwistProvider, useSerwist } from "@serwist/turbopack/react";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";

export function PwaProvider({ children }: { children: ReactNode }) {
  // Ask the browser not to evict our offline data (ADR-001: iOS can clear it otherwise).
  useEffect(() => void navigator.storage?.persist?.(), []);

  return (
    <SerwistProvider
      swUrl="/serwist/sw.js"
      disable={process.env.NODE_ENV === "development"}
      // The default reloads the page when the network returns, which would wipe a half-filled form.
      reloadOnOnline={false}
      // The default asks the worker to cache every page visited; signed-in pages must never be cached (poultry-pwa §0.2).
      cacheOnNavigation={false}
    >
      <UpdateBanner />
      {children}
    </SerwistProvider>
  );
}

/** poultry-pwa §0.6: a new version waits for the user's go-ahead, so it never lands in the middle of a form. */
function UpdateBanner() {
  const t = useTranslations("Pwa");
  const { serwist } = useSerwist();
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (!serwist) return;
    const onWaiting = () => setWaiting(true);
    serwist.addEventListener("waiting", onWaiting);
    return () => serwist.removeEventListener("waiting", onWaiting);
  }, [serwist]);

  if (!waiting || !serwist) return null;
  return (
    <div role="status" className="flex items-center justify-between gap-3 bg-green-700 p-3 text-white">
      <span>{t("updateAvailable")}</span>
      <button
        type="button"
        onClick={() => {
          serwist.addEventListener("controlling", () => window.location.reload());
          serwist.messageSkipWaiting();
        }}
        className="rounded-lg border border-white px-3 py-2 font-semibold"
      >
        {t("update")}
      </button>
    </div>
  );
}
