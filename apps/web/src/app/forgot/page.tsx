"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AuthShell, Notice } from "@/components/AuthShell";
import { useT } from "@/i18n/client";
import { requestReset } from "../login/actions";

export default function ForgotPage() {
  return <Suspense><View /></Suspense>;
}

function View() {
  const sent = useSearchParams().get("message") === "sent";
  const t = useT();
  return (
    <AuthShell mode="other">
      <div className="stack-sm">
        <h1>{t.auth.forgotTitle}</h1>
        <p className="subdued small">{t.auth.forgotBody}</p>
      </div>
      <Notice message={sent ? t.auth.resetSent : undefined} />
      <form action={requestReset} className="stack">
        <label className="field">
          <span>{t.auth.email}</span>
          <input className="input" name="email" type="email" required autoComplete="email" placeholder={t.auth.emailPh} />
        </label>
        <button className="btn-primary">{t.auth.sendLink}</button>
      </form>
      <Link className="link small" href="/login/">{t.auth.backToSignIn}</Link>
    </AuthShell>
  );
}
