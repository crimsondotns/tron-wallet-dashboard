"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/i18n/client";
import { Dropdown } from "../Dropdown";
import { TokenIcon } from "../TokenIcon";
import { RANGES, type Range } from "./ranges";


// Wallet / token / range filters. State lives in the URL so views are shareable and the
// server renders the result (no client fetching).
export function OverviewFilters({ wallets, wallet, tokens, token, range, chain }: {
  wallets: { id: string; label: string; chain: string }[]; wallet: string; tokens: string[]; token: string; range: Range; chain: string;
}) {
  const t = useT();
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const href = (patch: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    p.delete("page");
    return `${path}?${p}`;
  };
  const rangeLabel = { "7": t.ov.d7, "30": t.ov.d30, "90": t.ov.d90, all: t.ov.all };

  return (
    <div className="ov-filters">
      <Dropdown key={`w-${wallet}`} name="wallet" label={t.common.wallet} defaultValue={wallet}
        options={wallets.map((w) => ({ value: w.id, label: w.label, icon: w.chain }))}
        onChange={(v) => router.push(href({ wallet: v }))} />
      {tokens.length > 0 && (
        <Dropdown key={`t-${token}`} name="token" label={t.ov.token} defaultValue={token}
          options={tokens.map((s) => ({ value: s, label: s, iconNode: <TokenIcon symbol={s} chain={chain} size={18} /> }))}
          onChange={(v) => router.push(href({ token: v }))} />
      )}
      <nav className="seg" aria-label={t.ov.range}>
        {RANGES.map((r) => (
          <Link key={r} href={href({ range: r === "all" ? "" : r })} aria-current={r === range ? "true" : undefined}>{rangeLabel[r]}</Link>
        ))}
      </nav>
    </div>
  );
}
