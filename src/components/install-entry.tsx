"use client";

import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";
import { getPrompt, isInstalled, onPrompt, runPrompt, type Outcome } from "@/components/install-prompt";
import { secondary } from "@/components/ui";
import { Link } from "@/i18n/navigation";

const noSubscribe = () => () => {};

/** The login's way to install: the browser's own dialog when it made the offer, else the install page; none once installed. */
export function InstallEntry() {
  const t = useTranslations("Login");
  const prompt = useSyncExternalStore(onPrompt, getPrompt, () => null);
  const installed = useSyncExternalStore(noSubscribe, isInstalled, () => false);
  const [outcome, setOutcome] = useState<Outcome>();

  if (installed || outcome === "accepted") return null;
  // The same outlined button either way, set apart from the text links above it.
  if (!prompt) return <Link href="/install" className={`${secondary} self-start`}>{t("install")}</Link>;
  const install = async () => {
    window.installPrompt = null; // one prompt per event: after a refusal, the link to the steps instead
    setOutcome(await runPrompt(prompt));
  };
  return (
    <button type="button" onClick={() => void install()} className={`${secondary} self-start`}>
      {t("install")}
    </button>
  );
}
