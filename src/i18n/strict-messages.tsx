"use client";

import { IntlErrorCode, type IntlError, NextIntlClientProvider, useLocale } from "next-intl";

// Dev and the e2e build (playwright.config.ts): a message missing on the client throws instead of showing its key, so a
// path a page forgot to pick (client-messages.tsx) fails loudly. Production keeps next-intl's fallback: next.config.ts
// inlines STRICT_MESSAGES, so the minifier drops all but the pass-through.
const strict = process.env.NODE_ENV === "development" || process.env.STRICT_MESSAGES === "1";

const onError = (error: IntlError) => {
  if (error.code === IntlErrorCode.MISSING_MESSAGE) throw error;
  console.error(error);
};

function Strict({ children }: { children: React.ReactNode }) {
  return <NextIntlClientProvider locale={useLocale()} onError={onError}>{children}</NextIntlClientProvider>;
}

/** Under the root provider; nested providers inherit its onError, so it covers every page. */
export const StrictMessages = strict ? Strict : ({ children }: { children: React.ReactNode }) => children;
