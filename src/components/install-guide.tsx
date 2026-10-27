"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, useSyncExternalStore } from "react";

type Platform = "android" | "ios";
type InstallPrompt = Event & { prompt(): Promise<void> };

const noSubscribe = () => () => {};
const detectPlatform = (): Platform | null => {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch points tell them apart.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  return /Android/.test(ua) ? "android" : null;
};
const isInstalled = () =>
  matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

export function InstallGuide() {
  const t = useTranslations("Install");
  const platform = useSyncExternalStore(noSubscribe, detectPlatform, () => null);
  const installed = useSyncExternalStore(noSubscribe, isInstalled, () => false);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);

  // Android Chrome offers a one-tap install; keep its event for the button.
  useEffect(() => {
    const keep = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    addEventListener("beforeinstallprompt", keep);
    return () => removeEventListener("beforeinstallprompt", keep);
  }, []);

  if (installed) return <p>{t("installed")}</p>;

  return (
    <>
      {prompt && (
        <button
          type="button"
          onClick={() => void prompt.prompt().then(() => setPrompt(null))}
          className="rounded-lg bg-green-700 px-4 py-3 font-semibold text-white"
        >
          {t("title")}
        </button>
      )}
      {(platform ? [platform] : (["android", "ios"] as const)).map((p) => (
        <section key={p} className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t(`${p}.title`)}</h2>
          <ol className="list-decimal space-y-1 ps-6">
            <li>{t(`${p}.step1`)}</li>
            <li>{t(`${p}.step2`)}</li>
            <li>{t(`${p}.step3`)}</li>
          </ol>
        </section>
      ))}
    </>
  );
}
