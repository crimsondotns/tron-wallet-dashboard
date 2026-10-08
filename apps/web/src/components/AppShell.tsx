import Image from "next/image";
import Link from "next/link";
import { getT } from "@/i18n/server";
import { AccountMenu } from "./AccountMenu";

type NavKey = "wallets" | "overview" | "connections" | "settings";
const NAV: { key: NavKey; href?: string }[] = [
  { key: "wallets", href: "/" },
  { key: "overview", href: "/overview" },
  { key: "connections", href: "/connections" },
  { key: "settings" },
];

export async function AppShell({ email, active, children }: { email?: string; active: NavKey; children: React.ReactNode }) {
  const { t } = await getT();
  return (
    <div className="shell">
      <aside className="side">
        <div className="side-brand">
          <Image src="/apple-icon.png" alt="" width={28} height={28} />
          XCap Insight
        </div>
        <nav className="side-nav" aria-label={t.nav.main}>
          {NAV.map((n) =>
            n.href ? (
              <Link key={n.key} href={n.href} aria-current={active === n.key ? "page" : undefined}>{t.nav[n.key]}</Link>
            ) : (
              <span key={n.key} aria-disabled="true" title={t.common.soon}>{t.nav[n.key]}</span>
            ),
          )}
        </nav>
        <AccountMenu email={email} />
      </aside>
      <main className="shell-main">{children}</main>
    </div>
  );
}
