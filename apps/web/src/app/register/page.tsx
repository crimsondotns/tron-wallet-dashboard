import Link from "next/link";
import { AuthShell, Notice } from "@/components/AuthShell";
import { getT } from "@/i18n/server";
import { signUp } from "../login/actions";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { t } = await getT();
  const errors: Record<string, string> = { mismatch: t.auth.errMismatch, exists: t.auth.errExists };
  return (
    <AuthShell mode="register">
      <div className="stack-sm">
        <h1>{t.auth.createAccount}</h1>
        <p className="subdued small">{t.auth.hasAccount} <Link className="link" href="/login">{t.auth.signIn}</Link></p>
      </div>
      <Notice error={error && (errors[error] ?? t.common.errGeneric)} />
      <form action={signUp} className="stack">
        <label className="field">
          <span>{t.auth.email}</span>
          <input className="input" name="email" type="email" required autoComplete="email" placeholder={t.auth.emailPh} />
        </label>
        <label className="field">
          <span>{t.auth.password}</span>
          <input className="input" name="password" type="password" required minLength={8} autoComplete="new-password" placeholder={t.auth.min8} />
        </label>
        <label className="field">
          <span>{t.auth.confirmPassword}</span>
          <input className="input" name="confirm" type="password" required minLength={8} autoComplete="new-password" placeholder={t.auth.retype} />
        </label>
        <button className="btn-primary">{t.auth.createAccount}</button>
        <p className="placeholder caption">{t.auth.afterSignUp}</p>
      </form>
    </AuthShell>
  );
}
