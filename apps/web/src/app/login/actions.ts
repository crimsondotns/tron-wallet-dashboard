"use client";

import { currentLocale, savedTimeZone, writeCookie } from "@/i18n/prefs";
import { isTimeZone, TZ_COOKIE } from "@/i18n/tz";
import { asset } from "@/lib/base";
import { go } from "@/lib/nav";
import { createClient } from "@/lib/supabase/client";

function creds(form: FormData) {
  return { email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") };
}

export async function signIn(form: FormData) {
  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithPassword(creds(form));
  if (error) {
    if (error.code === "invalid_credentials") return go("/login/?error=invalid");
    if (error.code === "email_not_confirmed") return go("/login/?error=not_confirmed");
    console.error("[auth] signIn failed:", error.code, error.message);
    return go("/login/?error=generic");
  }
  // Accounts created before language tracking (or on another device) get the current UI language,
  // which auth email templates read from user_metadata.locale.
  const locale = currentLocale();
  if (data.user?.user_metadata?.locale !== locale) await supabase.auth.updateUser({ data: { locale } });
  // A time zone chosen on another device follows the account (display preference only).
  const tz = data.user?.user_metadata?.tz;
  if (!savedTimeZone() && isTimeZone(tz)) writeCookie(TZ_COOKIE, tz);
  go("/");
}

// Breached-password check against HIBP (k-anonymity: only the first 5 hex chars of the SHA-1
// leave the browser). Runs client-side now, so it guides users but can be bypassed. Fails open.
export async function isPwned(password: string) {
  try {
    const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(password));
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    const res = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!res.ok) return false;
    const suffix = hash.slice(5);
    return (await res.text()).split("\n").some((line) => {
      const [s, count] = line.trim().split(":");
      return s === suffix && Number(count) > 0;
    });
  } catch (e) {
    console.error("[auth] HIBP check skipped:", e);
    return false;
  }
}

export async function signUp(form: FormData) {
  const password = String(form.get("password") ?? "");
  if (password !== form.get("confirm")) return go("/register/?error=mismatch");
  if (password.length < 8) return go("/register/?error=weak");
  if (await isPwned(password)) return go("/register/?error=pwned");
  const supabase = createClient();
  const { data, error } = await supabase.auth.signUp({
    ...creds(form),
    options: { emailRedirectTo: `${location.origin}${asset("/auth/callback/")}`, data: { locale: currentLocale() } },
  });
  if (error) {
    if (error.code === "user_already_exists" || error.code === "email_exists") return go("/register/?error=exists");
    console.error("[auth] signUp failed:", error.code, error.message);
    return go("/register/?error=generic");
  }
  if (!data.session) return go("/login/?message=check-email");
  go("/");
}

export async function signOut() {
  await createClient().auth.signOut();
  go("/login/");
}

// Always reports "sent" so the form doesn't reveal which emails have accounts. The link (PKCE)
// works only in this browser, like the sign-up confirmation link.
export async function requestReset(form: FormData) {
  const email = String(form.get("email") ?? "").trim();
  const { error } = await createClient().auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${asset("/reset/")}` });
  if (error) console.error("[auth] resetPasswordForEmail failed:", error.code, error.message);
  go("/forgot/?message=sent");
}

// Runs on /reset/ after the browser client exchanged the email link's code for a session.
export async function setNewPassword(form: FormData) {
  const password = String(form.get("password") ?? "");
  if (password !== form.get("confirm")) return go("/reset/?error=mismatch");
  if (password.length < 8) return go("/reset/?error=weak");
  if (await isPwned(password)) return go("/reset/?error=pwned");
  const { error } = await createClient().auth.updateUser({ password });
  if (error) {
    if (error.code === "same_password") return go("/reset/?error=same");
    if (error.code === "weak_password") return go("/reset/?error=weak");
    console.error("[auth] updateUser(password) failed:", error.code, error.message);
    return go("/reset/?error=link");
  }
  go("/?message=password");
}
