"use client";

import { createClient } from "@/lib/supabase/client";
import { isLocale, LOCALE_COOKIE } from "./config";
import { writeCookie } from "./prefs";
import { isTimeZone, TZ_COOKIE } from "./tz";

export async function setLocale(locale: string) {
  if (!isLocale(locale)) return;
  writeCookie(LOCALE_COOKIE, locale);
  // Signed in: remember it on the account too, so auth emails (OTP, confirm) use this language.
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  if (data.session && data.session.user.user_metadata?.locale !== locale) await supabase.auth.updateUser({ data: { locale } });
}

// Display preference only (user_metadata is user-editable; never use it for authorization).
export async function setTimeZone(tz: string) {
  if (!isTimeZone(tz)) return;
  writeCookie(TZ_COOKIE, tz);
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  if (data.session && data.session.user.user_metadata?.tz !== tz) await supabase.auth.updateUser({ data: { tz } });
}
