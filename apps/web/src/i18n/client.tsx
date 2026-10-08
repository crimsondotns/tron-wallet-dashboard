"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect } from "react";
import { DEFAULT_LOCALE, type Locale } from "./config";
import { DICTS, type Dict } from "./dict";
import { setTimeZone } from "./actions";
import { DEFAULT_TZ, isTimeZone } from "./tz";

const Ctx = createContext<Locale>(DEFAULT_LOCALE);
const TzCtx = createContext<string>(DEFAULT_TZ);

// Only the locale and time zone cross the server/client boundary; dictionaries are bundled.
// Without a saved time zone, the browser's zone is saved once and the page re-rendered with it.
export function I18nProvider({ locale, tz, tzSaved, children }: { locale: Locale; tz: string; tzSaved: boolean; children: React.ReactNode }) {
  const router = useRouter();
  useEffect(() => {
    if (tzSaved) return;
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!isTimeZone(detected)) return;
    void setTimeZone(detected).then(() => { if (detected !== tz) router.refresh(); });
  }, [tzSaved, tz, router]);
  return (
    <Ctx.Provider value={locale}>
      <TzCtx.Provider value={tz}>{children}</TzCtx.Provider>
    </Ctx.Provider>
  );
}
export const useLocale = () => useContext(Ctx);
export const useT = (): Dict => DICTS[useContext(Ctx)];
// The user's IANA time zone, for fmtDateTime and day ranges in client components.
export const useTimeZone = () => useContext(TzCtx);
