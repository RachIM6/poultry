"use client";

import { solveChallenge, type Challenge, type Payload } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/web/pbkdf2";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

/**
 * The only captcha UI (poultry-auth references/captcha.md). No puzzle: it fetches a challenge from our server, solves
 * the proof of work in the browser (Web Crypto) and hands the payload to the form. The user sees a short status.
 * Remount it (React key) for a new payload: each one is single use.
 */
export function CaptchaField({ onSolved }: { onSolved: (payload: Payload) => void }) {
  const t = useTranslations();
  const [state, setState] = useState<"solving" | "solved" | "failed">("solving");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const res = await fetch("/api/captcha/challenge", { cache: "no-store", signal: controller.signal });
      if (!res.ok) throw new Error(`challenge ${res.status}`);
      const challenge = (await res.json()) as Challenge;
      const solution = await solveChallenge({ challenge, deriveKey, controller, timeout: 30_000 });
      if (!solution) throw new Error("not solved");
      return { challenge, solution };
    })().then(
      (payload) => {
        if (controller.signal.aborted) return;
        setState("solved");
        onSolved(payload);
      },
      () => {
        if (!controller.signal.aborted) setState("failed"); // offline, server error or timeout
      },
    );
    return () => controller.abort();
  }, [attempt, onSolved]);

  return (
    <div aria-live="polite" className="flex min-h-6 flex-wrap items-center gap-x-3 text-sm text-muted">
      {state === "solving" && t("Login.captchaChecking")}
      {state === "solved" && <span className="sr-only">{t("Login.captchaDone")}</span>}
      {state === "failed" && (
        <>
          <span className="text-alert-fg">{t("errors.CAPTCHA_REQUIRED")}</span>
          <button
            type="button"
            onClick={() => {
              setState("solving");
              setAttempt((n) => n + 1);
            }}
            className="min-h-11 font-medium text-ink underline underline-offset-4"
          >
            {t("Login.captchaRetry")}
          </button>
        </>
      )}
    </div>
  );
}
