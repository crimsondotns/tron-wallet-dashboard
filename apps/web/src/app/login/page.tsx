"use client";

import Link from "next/link";
import { AuthShell, Notice } from "@/components/AuthShell";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useT } from "@/i18n/client";
import { signIn } from "./actions";

export default function LoginPage() {
  return <Suspense><View /></Suspense>;
}

function View() {
  const sp = useSearchParams();
  const error = sp.get("error") ?? undefined, message = sp.get("message") ?? undefined;
  const t = useT();
  const messages: Record<string, string> = { "check-email": t.auth.checkEmail };
  const errors: Record<string, string> = {
    // Supabase confirms the email before redirecting here, so a failed auto sign-in
    // (e.g. link opened in another browser) usually still leaves the account usable.
    confirm: t.auth.errConfirm,
    invalid: t.auth.errInvalid,
    not_confirmed: t.auth.errNotConfirmed,
  };
  return (
    <AuthShell mode="login">
      <div className="stack-sm">
        <h1>{t.auth.signIn}</h1>
        <p className="subdued small">{t.auth.noAccount} <Link className="link" href="/register">{t.auth.signUp}</Link></p>
      </div>
      <Notice error={error && (errors[error] ?? t.common.errGeneric)} message={message && messages[message]} />
      <form action={signIn} className="stack">
        <label className="field">
          <span>{t.auth.email}</span>
          <input className="input" name="email" type="email" required autoComplete="email" placeholder={t.auth.emailPh} />
        </label>
        <label className="field">
          <span>{t.auth.password}</span>
          <input className="input" name="password" type="password" required minLength={6} autoComplete="current-password" placeholder={t.auth.passwordPh} />
        </label>
        <button className="btn-primary">{t.auth.signIn}</button>
      </form>
    </AuthShell>
  );
}
