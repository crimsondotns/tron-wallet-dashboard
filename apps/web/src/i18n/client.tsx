"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { DEFAULT_LOCALE, LOCALE_TAGS, type Locale } from "./config";
import { DICTS, type Dict } from "./dict";
import { setTimeZone } from "./actions";
import { currentLocale, currentTimeZone, PREFS_EVENT, savedTimeZone } from "./prefs";
import { DEFAULT_TZ, isTimeZone } from "./tz";

const Ctx = createContext<Locale>(DEFAULT_LOCALE);
const TzCtx = createContext<string>(DEFAULT_TZ);

// Locale and time zone come from cookies (see prefs.ts). Nothing renders until they are read, so
// a static page never flashes the default language. Without a saved time zone, the browser's
// zone is saved once.
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<{ locale: Locale; tz: string } | null>(null);
  useEffect(() => {
    const read = () => setPrefs({ locale: currentLocale(), tz: currentTimeZone() });
    read();
    window.addEventListener(PREFS_EVENT, read);
    if (!savedTimeZone()) {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (isTimeZone(detected)) void setTimeZone(detected);
    }
    return () => window.removeEventListener(PREFS_EVENT, read);
  }, []);
  useEffect(() => {
    if (!prefs) return;
    document.documentElement.lang = LOCALE_TAGS[prefs.locale];
    document.documentElement.dataset.locale = prefs.locale;
  }, [prefs]);
  if (!prefs) return null;
  return (
    <Ctx.Provider value={prefs.locale}>
      <TzCtx.Provider value={prefs.tz}>{children}</TzCtx.Provider>
    </Ctx.Provider>
  );
}
export const useLocale = () => useContext(Ctx);
export const useT = (): Dict => DICTS[useContext(Ctx)];
// The user's IANA time zone, for fmtDateTime and day ranges in client components.
export const useTimeZone = () => useContext(TzCtx);
