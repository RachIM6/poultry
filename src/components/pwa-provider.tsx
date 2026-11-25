"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";

export function PwaProvider({ children }: { children: ReactNode }) {
  // Ask the browser not to evict our offline data (ADR-001: iOS can clear it otherwise).
  useEffect(() => void navigator.storage?.persist?.(), []);

  return (
    <>
      {process.env.NODE_ENV !== "development" && <UpdateBanner />}
      {children}
    </>
  );
}

/** poultry-pwa §0.6: a new version waits for the user's go-ahead, so it never lands in the middle of a form. */
function UpdateBanner() {
  const t = useTranslations("Pwa");
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  // The platform API, not @serwist/window (~2 KB gzip on every page): register after the page has loaded, as it did.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let registration: ServiceWorkerRegistration | undefined;
    // An update is installed and waits; the very first install activates at once (no controller yet), no banner.
    const onUpdate = () => {
      const sw = registration?.installing;
      sw?.addEventListener("statechange", () => {
        if (sw.state === "installed" && navigator.serviceWorker.controller) setWaiting(sw);
      });
    };
    const register = async () => {
      registration = await navigator.serviceWorker.register("/serwist/sw.js", { scope: "/", type: "module" });
      if (registration.waiting) setWaiting(registration.waiting);
      onUpdate(); // one may already be installing
      registration.addEventListener("updatefound", onUpdate);
      // clients.claim() skips a page still loading: one opened while the first install ran stays uncontrolled until its
      // next full load, and offline its next chunk fails. Ask the worker to claim it (src/sw.ts).
      const ready = await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) ready.active?.postMessage({ type: "CLAIM" });
    };
    if (document.readyState === "complete") void register();
    else window.addEventListener("load", () => void register(), { once: true });
    return () => registration?.removeEventListener("updatefound", onUpdate);
  }, []);

  if (!waiting) return null;
  return (
    <div role="status" className="flex items-center justify-between gap-3 bg-ink p-3 text-shell">
      <span>{t("updateAvailable")}</span>
      <button
        type="button"
        onClick={() => {
          navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
          waiting.postMessage({ type: "SKIP_WAITING" });
        }}
        className="min-h-11 rounded-lg border border-white px-3 py-2 font-semibold"
      >
        {t("update")}
      </button>
    </div>
  );
}
