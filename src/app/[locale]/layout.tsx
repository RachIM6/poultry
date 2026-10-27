import type { Metadata } from "next";
import { locale } from "next/root-params";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { dirOf, routing } from "@/i18n/routing";
import "./globals.css";

export const generateStaticParams = () => routing.locales.map((locale) => ({ locale }));

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App");
  return { title: t("name"), description: t("description") };
}

// Unknown locales 404 in i18n/request.ts, which runs before anything below renders.
export default async function RootLayout({ children }: LayoutProps<"/[locale]">) {
  const lang = await locale();
  return (
    <html lang={lang} dir={dirOf(lang)} className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
