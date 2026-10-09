"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ChainIcon } from "@/components/ChainIcon";
import { ChainPicker } from "@/components/ChainPicker";
import { ConnectionDetail, type ProviderOption } from "@/components/ConnectionDetail";
import { fmt } from "@/i18n/config";
import type { Dict } from "@/i18n/dict";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useT } from "@/i18n/client";
import { useAuth } from "@/components/AuthProvider";
import { PageLoader } from "@/components/PageLoader";
import { isSupportedChain } from "@/lib/sync/chains";
import { createClient } from "@/lib/supabase/client";

// Providers the browser sync supports today, per chain.
const supported = (t: Dict): Record<string, ProviderOption[]> => ({
  tron: [
    { value: "tronscan", label: "Tronscan", keyHint: t.conn.tronscanKey, endpointHint: t.conn.tronscanEndpoint },
    { value: "trongrid", label: t.conn.trongridLabel, keyHint: t.conn.trongridKey, endpointHint: t.conn.trongridEndpoint },
  ],
  solana: [
    { value: "solana_rpc", label: t.conn.solanaLabel, keyHint: t.conn.solanaKey, endpointHint: t.conn.solanaEndpoint },
  ],
  ...evmOptions(t),
});
// EVM: Routescan is keyless on Ethereum; Blockscout (REST v2) is keyless elsewhere.
// Etherscan V2's free key covers Ethereum, Polygon and Arbitrum only; BSC has no free option.
function evmOptions(t: Dict): Record<string, ProviderOption[]> {
  const routescan: ProviderOption = { value: "routescan", label: t.conn.routescanLabel, keyHint: t.conn.routescanKey, endpointHint: t.conn.routescanEndpoint };
  const blockscout: ProviderOption = { value: "blockscout", label: t.conn.blockscoutLabel, keyHint: t.conn.blockscoutKey, endpointHint: t.conn.blockscoutEndpoint };
  const etherscan: ProviderOption = { value: "etherscan", label: "Etherscan", keyHint: t.conn.etherscanKey, endpointHint: t.conn.etherscanEndpoint };
  return {
    ethereum: [routescan, blockscout, etherscan],
    optimism: [blockscout, etherscan], base: [blockscout, etherscan], arbitrum: [blockscout, etherscan], polygon: [blockscout, etherscan],
    bsc: [etherscan],
  };
}
const EVM_SAMPLE = "0x28c6c06298d514db089934071355e5743bf21d60"; // Binance hot wallet, busy on every EVM chain
const SAMPLE_ADDRESS: Record<string, string> = {
  tron: "TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G",
  solana: "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9",
  ethereum: EVM_SAMPLE, bsc: EVM_SAMPLE, polygon: EVM_SAMPLE, arbitrum: EVM_SAMPLE, base: EVM_SAMPLE, optimism: EVM_SAMPLE,
};

type Params = { chain?: string; error?: string; saved?: string; deleted?: string };

export default function Connections() {
  return <Suspense><View /></Suspense>;
}

function View() {
  const sp = useSearchParams();
  const t = useT();
  const email = useAuth()?.email ?? "";
  const p: Params = { chain: sp.get("chain") ?? undefined, error: sp.get("error") ?? undefined, saved: sp.get("saved") ?? undefined, deleted: sp.get("deleted") ?? undefined };
  return <PageLoader build={() => build(p, t, email)} deps={[sp.toString(), t, email]} fallback={<AppShell active="connections">{null}</AppShell>} />;
}

async function build({ chain: picked, error, saved, deleted }: Params, t: Dict, email: string) {
  const SUPPORTED = supported(t);
  const errors: Record<string, string> = { no_org: t.conn.errNoOrg, https: t.conn.errHttps, endpoint_host: t.conn.errEndpointHost, no_conn: t.conn.errNoConn, chain: t.conn.errChain };
  const supabase = createClient();
  const [{ data: chains, error: chainsErr }, { data: conns, error: connsErr }] = await Promise.all([
    supabase.from("chains").select("id, name").order("family", { ascending: false }).order("name"),
    supabase.from("provider_connections").select("chain_id, provider, endpoint_url, api_key_secret_id"),
  ]);
  const loadErr = chainsErr ?? connsErr;
  if (loadErr) console.error("[connections] load failed:", loadErr.code, loadErr.message);
  // Only chains with a sync provider are offered; the rest stay hidden until supported.
  const list = (chains ?? []).filter((c) => isSupportedChain(c.id) && SUPPORTED[c.id]).map((c) => {
    const conn = conns?.find((x) => x.chain_id === c.id);
    const options = SUPPORTED[c.id];
    const label = options?.find((o) => o.value === conn?.provider)?.label;
    const note = !options ? t.common.soon : conn ? `${label ?? conn.provider} · ${conn.api_key_secret_id ? t.conn.hasKey : t.conn.noKey}` : t.conn.notSet;
    return { ...c, conn, options, note };
  });
  const current = list.find((c) => c.id === picked) ?? list.find((c) => c.options) ?? list[0];
  const { data: wallets } = current
    ? await supabase.from("wallets").select("address, label").eq("chain_id", current.id).order("created_at")
    : { data: [] };

  return (
    <AppShell email={email} active="connections">
      <div className="stack-sm">
        <h1>{t.conn.title}</h1>
        <p className="subdued small">{t.conn.intro}</p>
      </div>
      {error && <p className="error" role="alert">{errors[error] ?? t.common.errGeneric}</p>}
      {saved && <p className="notice" role="status">{fmt(t.conn.saved, { chain: saved.toUpperCase() })}</p>}
      {deleted && <p className="notice" role="status">{fmt(t.conn.deleted, { chain: deleted.toUpperCase() })}</p>}

      {loadErr && <p className="error" role="alert">{t.common.errGeneric}</p>}
      {!loadErr && !conns?.length && !!list.length && (
        <section className="card stack-sm empty-conn">
          <h3>{t.conn.emptyTitle}</h3>
          <p className="subdued small">{t.conn.emptyBody}</p>
        </section>
      )}

      <div className="md">
        <nav className="md-list" aria-label={t.common.chain}>
          {list.map((c) => (
            <Link key={c.id} href={`/connections/?chain=${c.id}`} className={`md-item${c.options ? "" : " is-soon"}`} aria-current={c.id === current?.id ? "page" : undefined}>
              <ChainIcon chain={c.id} size={24} />
              <span className="md-item-text"><strong>{c.name}</strong><span className="caption">{c.note}</span></span>
              {c.conn && <i className="dot dot-on" aria-label={t.conn.connected} />}
            </Link>
          ))}
        </nav>
        <div className="md-picker"><ChainPicker chains={list.map(({ id, name, note }) => ({ id, name, note }))} current={current?.id ?? ""} /></div>

        {current && (
          <section className="md-detail" aria-labelledby="detail-title">
            <header className="md-head">
              <ChainIcon chain={current.id} size={40} />
              <div className="stack-sm" style={{ gap: 4 }}>
                <h2 id="detail-title">{current.name}</h2>
                <span className={`pill${current.conn ? " pill-on" : ""}`}>{current.options ? (current.conn ? t.conn.connected : t.conn.notSet) : t.common.soon}</span>
              </div>
            </header>
            {current.options ? (
              <ConnectionDetail
                key={current.id}
                chain={current.id}
                email={email}
                options={current.options}
                saved={current.conn ? { provider: current.conn.provider, endpoint: current.conn.endpoint_url, hasKey: !!current.conn.api_key_secret_id } : null}
                wallets={wallets ?? []}
                sampleAddress={SAMPLE_ADDRESS[current.id] ?? ""}
              />
            ) : (
              <p className="subdued">{fmt(t.conn.unsupported, { name: current.name })}</p>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}
