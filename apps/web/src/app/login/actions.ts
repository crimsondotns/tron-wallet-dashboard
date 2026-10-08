"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "@/i18n/server";
import { isTimeZone, TZ_COOKIE } from "@/i18n/tz";
import { createClient } from "@/lib/supabase/server";

function creds(form: FormData) {
  return { email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") };
}

export async function signIn(form: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(creds(form));
  if (error) {
    if (error.code === "invalid_credentials") redirect("/login?error=invalid");
    if (error.code === "email_not_confirmed") redirect("/login?error=not_confirmed");
    console.error("[auth] signIn failed:", error.code, error.message);
    redirect("/login?error=generic");
  }
  // Accounts created before language tracking (or on another device) get the current UI language,
  // which auth email templates read from user_metadata.locale.
  const locale = await getLocale();
  if (data.user?.user_metadata?.locale !== locale) await supabase.auth.updateUser({ data: { locale } });
  // A time zone chosen on another device follows the account (display preference only).
  const jar = await cookies(), tz = data.user?.user_metadata?.tz;
  if (!isTimeZone(jar.get(TZ_COOKIE)?.value) && isTimeZone(tz)) jar.set(TZ_COOKIE, tz, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  redirect("/");
}

export async function signUp(form: FormData) {
  if (form.get("password") !== form.get("confirm")) redirect("/register?error=mismatch");
  const supabase = await createClient();
  const origin = (await headers()).get("origin") ?? "";
  const { data, error } = await supabase.auth.signUp({
    ...creds(form),
    options: { emailRedirectTo: `${origin}/auth/callback`, data: { locale: await getLocale() } },
  });
  if (error) {
    if (error.code === "user_already_exists" || error.code === "email_exists") redirect("/register?error=exists");
    console.error("[auth] signUp failed:", error.code, error.message);
    redirect("/register?error=generic");
  }
  if (!data.session) redirect("/login?message=check-email");
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
