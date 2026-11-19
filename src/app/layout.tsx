import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Poultry",
  description: "Poultry farm management",
};

// Placeholder: locale routing, lang/dir and fonts arrive with T3 (ADR-004).
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ar" dir="rtl" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
