import Link from "next/link";
import { AuthShell, Notice } from "@/components/AuthShell";
import { getT } from "@/i18n/server";
import { signIn } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const { error, message } = await searchParams;
  const { t } = await getT();
  const messages: Record<string, string> = { "check-email": t.auth.checkEmail };
  const errors: Record<string, string> = {
    // Supabase confirms the email before redirecting here, so a failed auto sign-in
    // (e.g. link opened in another browser) usually still leaves the account usable.
    confirm: t.auth.errConfirm,
    "Invalid login credentials": t.auth.errInvalid,
    "Email not confirmed": t.auth.errNotConfirmed,
  };
  return (
    <AuthShell mode="login">
      <div className="stack-sm">
        <h1>{t.auth.signIn}</h1>
        <p className="subdued small">{t.auth.noAccount} <Link className="link" href="/register">{t.auth.signUp}</Link></p>
      </div>
      <Notice error={error && (errors[error] ?? error)} message={message && messages[message]} />
      <form action={signIn} className="stack">
        <label className="field">
          <span>{t.auth.email}</span>
          <input className="input" name="email" type="email" required autoComplete="email" placeholder={t.auth.emailPh} />
        </label>
        <label className="field">
          <span>{t.auth.password}</span>
          <input className="input" name="password" type="password" required minLength={6} autoComplete="current-password" />
        </label>
        <button className="btn-primary">{t.auth.signIn}</button>
      </form>
    </AuthShell>
  );
}
