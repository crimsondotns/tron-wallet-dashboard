import Link from "next/link";
import { LiquidityField } from "./LiquidityField";
import { LogoHero } from "./LogoHero";

export function AuthShell({ mode, children }: { mode: "login" | "register"; children: React.ReactNode }) {
  return (
    <main className="auth">
      <aside className="auth-brand">
        <LiquidityField />
        <LogoHero />
      </aside>

      <section className="auth-panel">
        <div className="auth-form stack">
          <span className="auth-logo auth-logo-mobile">XCap Insight</span>
          <nav className="auth-tabs" aria-label="เลือกการเข้าใช้งาน">
            <Link href="/login" aria-current={mode === "login" ? "page" : undefined}>เข้าสู่ระบบ</Link>
            <Link href="/register" aria-current={mode === "register" ? "page" : undefined}>สมัครสมาชิก</Link>
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
