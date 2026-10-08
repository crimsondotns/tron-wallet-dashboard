"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, LOCALE_TAGS } from "@/i18n/config";
import { DICTS } from "@/i18n/dict";
import "./globals.css";

// Replaces the root layout when it fails, so there is no I18nProvider: read the locale cookie directly.
function cookieLocale() {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const v = document.cookie.split("; ").find((c) => c.startsWith(`${LOCALE_COOKIE}=`))?.split("=")[1];
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const locale = cookieLocale();
  const t = DICTS[locale];
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang={LOCALE_TAGS[locale]} data-locale={locale}>
      <body>
        <title>XCap Insight</title>
        <main className="state-page state-page-center" role="alert">
          <h1>{t.common.errTitle}</h1>
          <p className="subdued">{t.common.errGeneric}</p>
          <button type="button" className="btn-primary" onClick={() => retry()}>{t.common.retry}</button>
        </main>
      </body>
    </html>
  );
}
