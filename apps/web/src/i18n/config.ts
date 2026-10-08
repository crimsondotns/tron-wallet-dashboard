export const LOCALES = ["th", "en", "zh", "ja"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "th";
export const LOCALE_COOKIE = "locale";
export const LOCALE_NAMES: Record<Locale, string> = { th: "ไทย", en: "English", zh: "中文", ja: "日本語" };
// BCP 47 tags for <html lang> and Intl date/number formatting.
export const LOCALE_TAGS: Record<Locale, string> = { th: "th-TH", en: "en-US", zh: "zh-CN", ja: "ja-JP" };
export const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale);

// "{name}" placeholders. Strings only, so dictionaries stay serializable for client components.
export function fmt(s: string, vars: Record<string, string | number> = {}): string {
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// Full date + 24h time, e.g. "Saturday, October 3, 2026 14:05", "วันเสาร์ที่ 3 ตุลาคม 2569 14:05".
export function fmtDateTime(ms: number | string | Date, locale: Locale) {
  const d = new Date(ms), tag = LOCALE_TAGS[locale];
  const date = d.toLocaleDateString(tag, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const time = d.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} ${time}`;
}
