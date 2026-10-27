import type { MetadataRoute } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { dirOf, routing } from "@/i18n/routing";

// One manifest per locale (app/manifest.ts can't vary by locale): the home-screen icon must start
// on /ar or /fr directly, because the / → locale redirect runs on the server and fails offline.
export async function GET(_: Request, { params }: RouteContext<"/[locale]/manifest.webmanifest">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return new Response(null, { status: 404 });
  const t = await getTranslations({ locale, namespace: "App" });

  const manifest: MetadataRoute.Manifest = {
    id: "/",
    name: t("name"),
    short_name: t("name"),
    description: t("description"),
    lang: locale,
    dir: dirOf(locale),
    start_url: `/${locale}`,
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#15803d",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return Response.json(manifest, { headers: { "Content-Type": "application/manifest+json" } });
}
