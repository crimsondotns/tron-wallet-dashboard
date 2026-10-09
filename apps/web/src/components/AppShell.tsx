"use client";

import Image from "next/image";
import Link from "next/link";
import { useT } from "@/i18n/client";
import { asset } from "@/lib/base";
import { useAuth } from "./AuthProvider";
import { AccountMenu } from "./AccountMenu";

type NavKey = "wallets" | "overview" | "connections" | "settings";
const NAV: { key: NavKey; href?: string }[] = [
  { key: "wallets", href: "/" },
  { key: "overview", href: "/overview" },
  { key: "connections", href: "/connections" },
  { key: "settings" },
];

export function AppShell({ active, children }: { email?: string; active: NavKey; children: React.ReactNode }) {
  const t = useT();
  const email = useAuth()?.email;
  return (
    <div className="shell">
      <aside className="side">
        <div className="side-brand">
          <Image src={asset("/apple-icon.png")} alt="" width={28} height={28} />
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
