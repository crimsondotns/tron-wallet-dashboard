import { AppShell } from "@/components/AppShell";
import { ChainIcon } from "@/components/ChainIcon";
import { CopyText } from "@/components/CopyText";
import { Dropdown } from "@/components/Dropdown";
import { ExplorerLink } from "@/components/ExplorerLink";
import { SyncRunner } from "@/components/SyncRunner";
import { WalletRowMenu } from "@/components/WalletRowMenu";
import { fmt as tf } from "@/i18n/config";
import { getT } from "@/i18n/server";
import { isAdminRole, myOrgs } from "@/lib/org";
import { isSupportedChain } from "@/lib/sync/chains";
import { createClient } from "@/lib/supabase/server";
import { addWallet } from "./actions";

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const short = (a: string) => (a.length > 16 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { t } = await getT();
  const errors: Record<string, string> = { bad_address: t.wallets.errBadAddress, duplicate: t.wallets.errDuplicate, chain: t.wallets.errChain, not_allowed: t.wallets.errNotAllowed };
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const email = claims?.claims.email as string | undefined;
  const since = daysAgo(30);

  const [memberships, { data: chains }, { data: wallets }, { data: cursors }, { data: flows }] = await Promise.all([
    myOrgs(supabase),
    supabase.from("chains").select("id, name, family").order("family", { ascending: false }).order("name"),
    supabase.from("wallets").select("id, org_id, chain_id, address, label").order("created_at"),
    supabase.from("sync_cursors").select("wallet_id, done"),
    supabase.from("daily_flows").select("wallet_id, token_symbol, amount_in, amount_out").gte("day", since),
  ]);
  // Only admins/owners add wallets and sync; viewers are read-only.
  const adminOrgs = memberships.filter((m) => isAdminRole(m.role)).map((m) => m.org_id);
  const org = adminOrgs[0] ? { id: adminOrgs[0] } : null;
  const syncable = (wallets ?? []).filter((w) => adminOrgs.includes(w.org_id));
  const chainName = (id: string) => chains?.find((c) => c.id === id)?.name ?? id;

  // 30-day totals per wallet, per token.
  const totals = new Map<string, Map<string, { in: number; out: number }>>();
  flows?.forEach((f) => {
    const byToken = totals.get(f.wallet_id) ?? new Map();
    const t = byToken.get(f.token_symbol) ?? { in: 0, out: 0 };
    t.in += Number(f.amount_in);
    t.out += Number(f.amount_out);
    byToken.set(f.token_symbol, t);
    totals.set(f.wallet_id, byToken);
  });
  const status = (walletId: string) => {
    const mine = cursors?.filter((c) => c.wallet_id === walletId) ?? [];
    if (!mine.length) return <span className="status">{t.wallets.statusWaiting}</span>;
    if (mine.every((c) => c.done)) return <span className="status">{t.wallets.statusDone}</span>;
    return <span className="status"><span className="bar bar-busy"><b /></span>{t.wallets.statusBusy}</span>;
  };
  const chainCount = new Set(wallets?.map((w) => w.chain_id)).size;

  return (
    <AppShell email={email} active="wallets">
      <div className="page-head">
        <h1>{t.nav.wallets}</h1>
        {!!wallets?.length && <span className="subdued small">{tf(t.wallets.count, { wallets: wallets.length, chains: chainCount })}</span>}
      </div>
      {!!syncable.length && <SyncRunner wallets={syncable} email={email ?? ""} />}

      {error && <p className="error" role="alert">{errors[error] ?? t.common.errGeneric}</p>}

      {!org ? (
        <p className="error">{t.wallets.noOrg}</p>
      ) : (
        <>
          <form action={addWallet} className="card row wrap">
            <input type="hidden" name="org_id" value={org.id} />
            <Dropdown
              name="chain_id"
              label={t.common.chain}
              defaultValue="tron"
              options={(chains ?? []).filter((c) => isSupportedChain(c.id)).map((c) => ({ value: c.id, label: c.name, icon: c.id }))}
            />
            <input className="input grow" name="address" placeholder={t.wallets.addressPh} required aria-label={t.common.address} />
            <input className="input" name="label" placeholder={t.wallets.labelPh} aria-label={t.wallets.label} />
            <button className="btn-primary">{t.wallets.add}</button>
          </form>

          <section className="card">
            {!wallets?.length ? (
              <p className="subdued">{t.wallets.empty}</p>
            ) : (
              <table>
                <thead>
                  <tr><th>{t.wallets.colName}</th><th>{t.common.chain}</th><th>{t.common.address}</th><th>{t.wallets.colFlow}</th><th>{t.wallets.colStatus}</th><th /></tr>
                </thead>
                <tbody>
                  {wallets.map((w) => {
                    const tok = [...(totals.get(w.id) ?? new Map()).entries()];
                    return (
                      <tr key={w.id}>
                        <td><strong>{w.label || <span className="placeholder">—</span>}</strong></td>
                        <td><span className="chain"><ChainIcon chain={w.chain_id} />{chainName(w.chain_id)}</span></td>
                        <td><span className="addr-cell"><CopyText text={w.address} display={short(w.address)} /><ExplorerLink chain={w.chain_id} kind="address" value={w.address} label={t.common.viewOn} /></span></td>
                        <td>
                          {!tok.length ? <span className="placeholder">—</span> : tok.map(([sym, v]) => (
                            <div key={sym}>+{fmt(v.in)} <span className="subdued">/ −{fmt(v.out)} {sym}</span></div>
                          ))}
                        </td>
                        <td>{status(w.id)}</td>
                        <td className="row-actions">
                          <WalletRowMenu id={w.id} label={w.label ?? ""} display={w.label || short(w.address)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </AppShell>
  );
}
