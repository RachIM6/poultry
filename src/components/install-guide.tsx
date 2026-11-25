"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, useSyncExternalStore } from "react";
import { detectPlatform, installView, runPrompt, stepsOrder, type Outcome } from "@/components/install-prompt";
import { primary, warn } from "@/components/ui";
import { Link } from "@/i18n/navigation";

const noSubscribe = () => () => {};
// The root layout's CAPTURE_SCRIPT listens first, so window.installPrompt is already set when onChange runs.
const onPrompt = (onChange: () => void) => {
  addEventListener("beforeinstallprompt", onChange);
  return () => removeEventListener("beforeinstallprompt", onChange);
};
const getPrompt = () => window.installPrompt ?? null;
const getPlatform = () => detectPlatform(navigator.userAgent, navigator.maxTouchPoints);
const isInstalled = () =>
  matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

export function InstallGuide() {
  const t = useTranslations("Install");
  const prompt = useSyncExternalStore(onPrompt, getPrompt, () => null);
  const platform = useSyncExternalStore(noSubscribe, getPlatform, () => "android" as const);
  const installed = useSyncExternalStore(noSubscribe, isInstalled, () => false);
  const [outcome, setOutcome] = useState<Outcome>();

  // Also when installed from the browser's own menu while this page is open.
  useEffect(() => {
    const done = () => setOutcome("accepted");
    addEventListener("appinstalled", done);
    return () => removeEventListener("appinstalled", done);
  }, []);

  const view = installView({ installed, prompt: prompt !== null, outcome });
  const order = stepsOrder(platform);
  // With the one-tap button, every platform's steps fold away; without it, the user's own come first.
  const [shown, others] = view === "prompt" ? [[], order] : [order.slice(0, 1), order.slice(1)];
  // After a dismissed or failed prompt, say so above the steps.
  const status = view === "steps" && (outcome === "dismissed" || outcome === "failed") ? outcome : view;

  const install = async () => {
    if (!prompt) return;
    window.installPrompt = null; // one prompt per event
    setOutcome(await runPrompt(prompt));
  };

  const steps = (p: (typeof order)[number]) => (
    <section key={p} className="flex flex-col gap-2">
      <h2 className="text-[17px] font-semibold text-ink-2">{t(`${p}.title`)}</h2>
      <ol className="list-decimal space-y-1 ps-6">
        <li>{t(`${p}.step1`)}</li>
        <li>{t(`${p}.step2`)}</li>
        <li>{t(`${p}.step3`)}</li>
      </ol>
    </section>
  );

  return (
    <>
      <p role="status">{t(`status.${status}`)}</p>
      {view === "prompt" && (
        <button type="button" onClick={() => void install()} className={primary}>
          {t("title")}
        </button>
      )}
      {view === "installed" ? (
        <Link href="/today" className={primary}>
          {t("open")}
        </Link>
      ) : (
        <>
          {platform === "firefox" && <p className={warn}>{t("firefox")}</p>}
          {shown.map(steps)}
          <details className="rounded-2xl border border-line bg-card p-3">
            <summary className="min-h-11 py-2.5 text-[17px] font-semibold text-ink-2">{t("others")}</summary>
            <div className="flex flex-col gap-4">{others.map(steps)}</div>
          </details>
        </>
      )}
    </>
  );
}
