import Link from "next/link";
import { getT } from "@/i18n/server";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { LiquidityField } from "./LiquidityField";
import { LogoHero } from "./LogoHero";

export async function AuthShell({ mode, children }: { mode: "login" | "register"; children: React.ReactNode }) {
  const { t } = await getT();
  return (
    <main className="auth">
      <aside className="auth-brand">
        <LiquidityField />
        <LogoHero />
      </aside>

      <section className="auth-panel">
        <div className="auth-lang"><LanguageSwitcher /></div>
        <div className="auth-form stack">
          <span className="auth-logo auth-logo-mobile">XCap Insight</span>
          <nav className="auth-tabs" aria-label={t.auth.tabs}>
            <Link href="/login" aria-current={mode === "login" ? "page" : undefined}>{t.auth.signIn}</Link>
            <Link href="/register" aria-current={mode === "register" ? "page" : undefined}>{t.auth.signUp}</Link>
          </nav>
          {children}
        </div>
      </section>
    </main>
  );
}

export function Notice({ error, message }: { error?: string; message?: string }) {
  if (error) return <p className="error" role="alert">{error}</p>;
  if (message) return <p className="notice" role="status">{message}</p>;
  return null;
}
