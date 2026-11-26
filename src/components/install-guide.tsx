"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, useSyncExternalStore } from "react";
import { detectPlatform, getPrompt, installView, isInstalled, onPrompt, runPrompt, stepsOrder, type Outcome } from "@/components/install-prompt";
import { primary, warn } from "@/components/ui";
import { Link } from "@/i18n/navigation";

const noSubscribe = () => () => {};
const getPlatform = () => detectPlatform(navigator.userAgent, navigator.maxTouchPoints);

type Shown = (ReturnType<typeof stepsOrder>)[number];

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
  // Phone: with the one-tap button, every platform's steps fold away; without it, the user's own come first.
  const [shown, others] = view === "prompt" ? [[], order] : [order.slice(0, 1), order.slice(1)];
  // After a dismissed or failed prompt, say so above the steps.
  const status = view === "steps" && (outcome === "dismissed" || outcome === "failed") ? outcome : view;

  const install = async () => {
    if (!prompt) return;
    window.installPrompt = null; // one prompt per event
    setOutcome(await runPrompt(prompt));
  };

  // `framed`: a card (the phone's own steps, the wide columns); the current device's is outlined and labelled.
  const steps = (p: Shown, framed = false) => {
    const current = p === order[0];
    return (
      <section key={p} className={`flex flex-col gap-3 ${framed ? `rounded-[18px] bg-card p-5 ${current ? "border-2 border-ink" : "border border-line"}` : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[17px] font-semibold">{t(`${p}.title`)}</h2>
          {framed && current && <span className="rounded-full bg-chick-soft px-3 py-1 text-sm font-semibold text-chick-fg">{t("thisDevice")}</span>}
        </div>
        <ol className="list-decimal space-y-1 ps-6">
          <li>{t(`${p}.step1`)}</li>
          <li>{t(`${p}.step2`)}</li>
          <li>{t(`${p}.step3`)}</li>
        </ol>
        {p === "desktop" && (
          // No icon in the address bar: Chrome shows it on some visits only, and not for a while after a refusal.
          <div className="flex flex-col gap-1 text-ink-2">
            <p>{t("desktop.noIcon")}</p>
            <ul className="list-disc space-y-1 ps-6">
              <li>{t("desktop.chrome")}</li>
              <li>{t("desktop.edge")}</li>
            </ul>
          </div>
        )}
      </section>
    );
  };

  return (
    <>
      <p role="status">{t(`status.${status}`)}</p>
      {view === "prompt" && (
        <button type="button" onClick={() => void install()} className={`${primary} lg:self-start`}>
          {t("title")}
        </button>
      )}
      {view === "installed" ? (
        <Link href="/today" className={`${primary} lg:self-start`}>
          {t("open")}
        </Link>
      ) : (
        <>
          {platform === "firefox" && <p className={`${warn} lg:max-w-3xl`}>{t("firefox")}</p>}
          {/* The phone: one column, the other devices folded. Wide screens: the three side by side, this one first. */}
          <div className="flex flex-col gap-5 lg:hidden">
            {shown.map((p) => steps(p, true))}
            <details className="rounded-2xl border border-line bg-card p-3">
              <summary className="min-h-11 py-2.5 text-[17px] font-semibold text-ink-2">{t("others")}</summary>
              <div className="flex flex-col gap-4">{others.map((p) => steps(p))}</div>
            </details>
          </div>
          <div className="hidden gap-5 lg:grid lg:grid-cols-3 lg:items-start">{order.map((p) => steps(p, true))}</div>
        </>
      )}
    </>
  );
}
