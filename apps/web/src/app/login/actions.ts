"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "@/i18n/server";
import { createClient } from "@/lib/supabase/server";

function creds(form: FormData) {
  return { email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") };
}

export async function signIn(form: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(creds(form));
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  // Accounts created before language tracking (or on another device) get the current UI language,
  // which auth email templates read from user_metadata.locale.
  const locale = await getLocale();
  if (data.user?.user_metadata?.locale !== locale) await supabase.auth.updateUser({ data: { locale } });
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
  if (error) redirect(`/register?error=${encodeURIComponent(error.message)}`);
  if (!data.session) redirect("/login?message=check-email");
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
