import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, LOCALES, type Locale } from "./config";
import { DICTS } from "./dict";
import { DEFAULT_TZ, isTimeZone, TZ_COOKIE } from "./tz";

// Saved choice first, then the browser's Accept-Language, then Thai.
export async function getLocale(): Promise<Locale> {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(saved)) return saved;
  const accept = (await headers()).get("accept-language") ?? "";
  for (const part of accept.split(",")) {
    const base = part.split(";")[0].trim().slice(0, 2).toLowerCase();
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

export async function getT() {
  const locale = await getLocale();
  return { t: DICTS[locale], locale };
}

// Saved time zone (set from the browser on first visit, or in Account settings), else Bangkok.
export async function getTimeZone(): Promise<string> {
  const saved = (await cookies()).get(TZ_COOKIE)?.value;
  return isTimeZone(saved) ? saved : DEFAULT_TZ;
}

// Whether the user (or their browser) has chosen a time zone yet.
export async function hasTimeZone(): Promise<boolean> {
  return isTimeZone((await cookies()).get(TZ_COOKIE)?.value);
}

export { LOCALES };
