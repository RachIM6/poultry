import { defineRouting } from "next-intl/routing";

// ADR-004: Arabic (default, RTL) and French. No Darija in v1.
export const routing = defineRouting({ locales: ["ar", "fr"], defaultLocale: "ar" });

export const dirOf = (locale: string) => (locale === "ar" ? "rtl" : "ltr");
