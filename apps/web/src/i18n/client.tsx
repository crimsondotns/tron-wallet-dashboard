"use client";

import { createContext, useContext } from "react";
import { DEFAULT_LOCALE, type Locale } from "./config";
import { DICTS, type Dict } from "./dict";

const Ctx = createContext<Locale>(DEFAULT_LOCALE);

// Only the locale crosses the server/client boundary; dictionaries are bundled.
export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <Ctx.Provider value={locale}>{children}</Ctx.Provider>;
}
export const useLocale = () => useContext(Ctx);
export const useT = (): Dict => DICTS[useContext(Ctx)];
