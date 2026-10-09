import type { Metadata } from "next";
import { AuthProvider } from "@/components/AuthProvider";
import { StickyHeaders } from "@/components/StickyHeaders";
import { Toaster } from "@/components/Toaster";
import { I18nProvider } from "@/i18n/client";
import { fontVars } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "XCap Insight",
  description: "Multi-chain wallet flow dashboard",
};

// Static shell: language, time zone and session are resolved in the browser (I18nProvider, AuthProvider).
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th-TH" data-locale="th" className={fontVars}>
      <body>
        <I18nProvider>
          <AuthProvider>{children}</AuthProvider>
        </I18nProvider>
        <Toaster />
        <StickyHeaders />
      </body>
    </html>
  );
}
