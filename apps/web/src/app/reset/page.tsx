"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AuthShell, Notice } from "@/components/AuthShell";
import { useT } from "@/i18n/client";
import { createClient } from "@/lib/supabase/client";
import { setNewPassword } from "../login/actions";

export default function ResetPage() {
  return <Suspense><View /></Suspense>;
}

// The reset email links here with ?code=...; the browser client exchanges it for a session on
// load. With a session, the user sets a new password; without one the link is invalid/expired.
function View() {
  const error = useSearchParams().get("error");
  const t = useT();
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    void createClient().auth.getSession().then(({ data }) => setOk(!!data.session));
  }, []);
  const errors: Record<string, string> = { mismatch: t.auth.errMismatch, weak: t.auth.errWeak, pwned: t.auth.errPwned, same: t.auth.errSamePassword, link: t.auth.errResetLink };
  if (ok === null) return null;
  return (
    <AuthShell mode="other">
      <div className="stack-sm">
        <h1>{t.auth.resetTitle}</h1>
      </div>
      {!ok ? (
        <>
          <Notice error={t.auth.errResetLink} />
          <Link className="btn-primary" href="/forgot/">{t.auth.sendLink}</Link>
        </>
      ) : (
        <>
          <Notice error={error ? errors[error] ?? t.common.errGeneric : undefined} />
          <form action={setNewPassword} className="stack">
            <label className="field">
              <span>{t.auth.newPassword}</span>
              <input className="input" name="password" type="password" required minLength={8} autoComplete="new-password" placeholder={t.auth.min8} />
            </label>
            <label className="field">
              <span>{t.auth.confirmPassword}</span>
              <input className="input" name="confirm" type="password" required minLength={8} autoComplete="new-password" placeholder={t.auth.retype} />
            </label>
            <button className="btn-primary">{t.auth.savePassword}</button>
          </form>
        </>
      )}
      <Link className="link small" href="/login/">{t.auth.backToSignIn}</Link>
    </AuthShell>
  );
}
