import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ChainIcon } from "@/components/ChainIcon";
import { ChainPicker } from "@/components/ChainPicker";
import { ConnectionDetail, type ProviderOption } from "@/components/ConnectionDetail";
import { fmt } from "@/i18n/config";
import type { Dict } from "@/i18n/dict";
import { getT } from "@/i18n/server";
import { createClient } from "@/lib/supabase/server";

// Providers the browser sync supports today, per chain.
const supported = (t: Dict): Record<string, ProviderOption[]> => ({
  tron: [
    { value: "tronscan", label: "Tronscan", keyHint: t.conn.tronscanKey, endpointHint: t.conn.tronscanEndpoint },
    { value: "trongrid", label: t.conn.trongridLabel, keyHint: t.conn.trongridKey, endpointHint: t.conn.trongridEndpoint },
  ],
});
const SAMPLE_ADDRESS: Record<string, string> = { tron: "TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G" };

export default async function Connections({ searchParams }: { searchParams: Promise<{ chain?: string; error?: string; saved?: string; deleted?: string }> }) {
  const { chain: picked, error, saved, deleted } = await searchParams;
  const { t } = await getT();
  const SUPPORTED = supported(t);
  const errors: Record<string, string> = { no_org: t.conn.errNoOrg, https: t.conn.errHttps, no_conn: t.conn.errNoConn };
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const email = (claims?.claims.email as string | undefined) ?? "";
  const [{ data: chains }, { data: conns }] = await Promise.all([
    supabase.from("chains").select("id, name").order("family", { ascending: false }).order("name"),
    supabase.from("provider_connections").select("chain_id, provider, endpoint_url, api_key_secret_id"),
  ]);
  const list = (chains ?? []).map((c) => {
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
      {error && <p className="error" role="alert">{errors[error] ?? error}</p>}
      {saved && <p className="notice" role="status">{fmt(t.conn.saved, { chain: saved.toUpperCase() })}</p>}
      {deleted && <p className="notice" role="status">{fmt(t.conn.deleted, { chain: deleted.toUpperCase() })}</p>}

      <div className="md">
        <nav className="md-list" aria-label={t.common.chain}>
          {list.map((c) => (
            <Link key={c.id} href={`/connections?chain=${c.id}`} className={`md-item${c.options ? "" : " is-soon"}`} aria-current={c.id === current?.id ? "page" : undefined}>
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
