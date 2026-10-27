import { notFound } from "next/navigation";
import * as rootParams from "next/root-params";
import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ locale }) => {
  // The [locale] segment is a root param, so it is readable here without setRequestLocale (works with cacheComponents).
  const requested = locale ?? (await rootParams.locale());
  if (!hasLocale(routing.locales, requested)) notFound();

  return {
    locale: requested,
    timeZone: "Africa/Casablanca",
    messages: (await import(`../../messages/${requested}.json`)).default,
  };
});
