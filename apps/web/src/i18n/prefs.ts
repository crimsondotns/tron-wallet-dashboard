"use client";

import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "./config";
import { DEFAULT_TZ, isTimeZone, TZ_COOKIE } from "./tz";

// Locale / time zone live in cookies (as before), read in the browser now that there is no server.
export const PREFS_EVENT = "xcap:prefs";
const YEAR = 60 * 60 * 24 * 365;

export function readCookie(name: string) {
  return document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
}
export function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${YEAR}; samesite=lax`;
  window.dispatchEvent(new Event(PREFS_EVENT));
}

// Saved choice first, then the browser's languages, then Thai.
export function currentLocale(): Locale {
  const saved = readCookie(LOCALE_COOKIE);
  if (isLocale(saved)) return saved;
  for (const l of navigator.languages ?? [navigator.language]) {
    const base = l.slice(0, 2).toLowerCase();
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
export function savedTimeZone(): string | null {
  const v = decodeURIComponent(readCookie(TZ_COOKIE) ?? "");
  return isTimeZone(v) ? v : null;
}
export const currentTimeZone = () => savedTimeZone() ?? DEFAULT_TZ;
