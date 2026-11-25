import type { Metadata, Viewport } from "next";
import { Readex_Pro } from "next/font/google";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { PwaProvider } from "@/components/pwa-provider";
import { ClientMessages } from "@/i18n/client-messages";
import { dirOf, routing } from "@/i18n/routing";
import { StrictMessages } from "@/i18n/strict-messages";
import "./globals.css";

// Readex Pro (Arabic + Latin), self-hosted by next/font: the design canvas's one UI face.
const readex = Readex_Pro({ subsets: ["arabic", "latin"], variable: "--font-readex" });

export const generateStaticParams = () => routing.locales.map((locale) => ({ locale }));

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App");
  return {
    title: t("name"),
    description: t("description"),
    manifest: `/${await locale()}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: t("name") },
    icons: { apple: "/icons/apple-touch-icon.png" },
  };
}

export const viewport: Viewport = { themeColor: "#24211c" };

// Unknown locales 404 in i18n/request.ts, which runs before anything below renders.
export default async function RootLayout({ children }: LayoutProps<"/[locale]">) {
  const lang = await locale();
  return (
    <html lang={lang} dir={dirOf(lang)} className={`${readex.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {/* What the layouts' client components read (PwaProvider, AppNav, the error boundary); pages add theirs. */}
        <ClientMessages paths={["Nav", "Offline", "Pwa", "Sync.refused"]}>
          <StrictMessages>
            <PwaProvider>{children}</PwaProvider>
          </StrictMessages>
        </ClientMessages>
      </body>
    </html>
  );
}
