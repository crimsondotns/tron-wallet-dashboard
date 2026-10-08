"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isLocale, LOCALE_COOKIE } from "./config";

export async function setLocale(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  // Signed in: remember it on the account too, so auth emails (OTP, confirm) use this language.
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims && data.claims.user_metadata?.locale !== locale) await supabase.auth.updateUser({ data: { locale } });
}
