import type { Metadata } from "next";
import { StickyHeaders } from "@/components/StickyHeaders";
import { Toaster } from "@/components/Toaster";
import { LOCALE_TAGS } from "@/i18n/config";
import { I18nProvider } from "@/i18n/client";
import { getLocale, getTimeZone, hasTimeZone } from "@/i18n/server";
import { fontVars } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "XCap Insight",
  description: "Multi-chain wallet flow dashboard",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [locale, tz, tzSaved] = await Promise.all([getLocale(), getTimeZone(), hasTimeZone()]);
  return (
    <html lang={LOCALE_TAGS[locale]} data-locale={locale} className={fontVars}>
      <body>
        <I18nProvider locale={locale} tz={tz} tzSaved={tzSaved}>{children}</I18nProvider>
        <Toaster />
        <StickyHeaders />
      </body>
    </html>
  );
}
