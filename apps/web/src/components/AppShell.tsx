import Image from "next/image";
import Link from "next/link";
import { AccountMenu } from "./AccountMenu";

const NAV = [
  { href: "/", label: "Wallets" },
  { label: "ภาพรวม" },
  { label: "การเชื่อมต่อ" },
  { label: "ตั้งค่า" },
];

export function AppShell({ email, active, children }: { email?: string; active: string; children: React.ReactNode }) {
  return (
    <div className="shell">
      <aside className="side">
        <div className="side-brand">
          <Image src="/apple-icon.png" alt="" width={28} height={28} />
          XCap Insight
        </div>
        <nav className="side-nav" aria-label="เมนูหลัก">
          {NAV.map((n) =>
            n.href ? (
              <Link key={n.label} href={n.href} aria-current={active === n.label ? "page" : undefined}>{n.label}</Link>
            ) : (
              <span key={n.label} aria-disabled="true" title="เร็ว ๆ นี้">{n.label}</span>
            ),
          )}
        </nav>
        <AccountMenu email={email} />
      </aside>
      <main className="shell-main">{children}</main>
    </div>
  );
}
