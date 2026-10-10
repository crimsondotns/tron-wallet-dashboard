"use client";

import Link from "next/link";
import { Pagination } from "@/components/Pagination";
import { PAGE_SIZES } from "@/components/pageSizes";
import { AppShell } from "@/components/AppShell";
import { CopyText } from "@/components/CopyText";
import { TokenIcon } from "@/components/TokenIcon";
import { ChainIcon } from "@/components/ChainIcon";
import { ExplorerLink } from "@/components/ExplorerLink";
import { DailyBars, type Bucket } from "@/components/overview/DailyBars";
import { AmountFilter } from "@/components/overview/AmountFilter";
import { ExportMenu } from "@/components/overview/ExportMenu";
import { TimeFilter } from "@/components/overview/TimeFilter";
import { CounterpartyFilter } from "@/components/overview/CounterpartyFilter";
import { SyncNowButton } from "@/components/SyncNowButton";
import { SyncRunner } from "@/components/SyncRunner";
import { OverviewFilters } from "@/components/overview/OverviewFilters";
import { RadialMap, type GraphEdge, type Label } from "@/components/overview/RadialMap";
import { RANGES, type Range } from "@/components/overview/ranges";
import { fmt, fmtDateTime, LOCALE_TAGS } from "@/i18n/config";
import { addDays, dayIn, dayStartIso } from "@/i18n/tz";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useLocale, useT, useTimeZone } from "@/i18n/client";
import type { Locale } from "@/i18n/config";
import type { Dict } from "@/i18n/dict";
import { useAuth } from "@/components/AuthProvider";
import { PageLoader } from "@/components/PageLoader";
import { isAdminRole, roleIn } from "@/lib/org";
import { createClient } from "@/lib/supabase/client";
import { reportError } from "@/lib/sync/log";

type Summary = {
  token: string | null; tokens: string[]; last_day: string | null;
  in: number; out: number; tx: number; prev_in: number; prev_out: number; counterparties: number;
  daily: { day: string; in: number; out: number }[];
  top: { address: string; in: number; out: number; tx: number }[];
};
type Tab = "summary" | "map" | "tx";
const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

type Params = { tab?: string; wallet?: string; token?: string; range?: string; page?: string; size?: string; cp?: string; start?: string; end?: string; sort?: string; order?: string; min?: string; max?: string };

export default function Overview() {
  return <Suspense><View /></Suspense>;
}

function View() {
  const params = useSearchParams();
  const t = useT(), locale = useLocale(), tz = useTimeZone();
  const email = useAuth()?.email;
  const sp = Object.fromEntries(params.entries()) as Params;
  return <PageLoader build={() => build(sp, { t, locale, tz, email })} deps={[params.toString(), t, locale, tz, email]} fallback={<Loading t={t} />} />;
}

// Mirrors the overview layout (title, KPI row, chart card) inside the app shell while loading.
function Loading({ t }: { t: Dict }) {
  return (
    <AppShell active="overview">
      <div className="state-page state-page-wide" aria-busy="true" aria-label={t.common.loading}>
        <span className="skel skel-title" />
        <div className="skel-kpis">
          {[0, 1, 2, 3].map((i) => <span key={i} className="skel skel-kpi" />)}
        </div>
        <span className="skel skel-block" />
      </div>
    </AppShell>
  );
}

async function build(sp: Params, { t, locale, tz, email }: { t: Dict; locale: Locale; tz: string; email?: string }) {
  const tab: Tab = sp.tab === "map" || sp.tab === "tx" ? sp.tab : "summary";
  const range: Range = (RANGES as readonly string[]).includes(sp.range ?? "") ? (sp.range as Range) : "all"; // default: all time
  const page = Math.max(1, Number(sp.page) || 1);
  const PAGE = PAGE_SIZES.includes(Number(sp.size)) ? Number(sp.size) : 20;
  // Transactions tab: sort by time (default, newest first) or amount; optional amount range.
  const sort: "time" | "amount" = sp.sort === "amount" ? "amount" : "time";
  const asc = sp.order === "asc";
  const num0 = (v?: string) => (v && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);
  const cpQ = tab === "tx" ? (sp.cp ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 64) : "";
  const isoOrNull = (v?: string) => (tab === "tx" && v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
  const startTs = isoOrNull(sp.start), endTs = isoOrNull(sp.end);
  const minAmt = tab === "tx" ? num0(sp.min) : null, maxAmt = tab === "tx" ? num0(sp.max) : null;
  const tag = LOCALE_TAGS[locale];
  const num = (n: number) => Number(n).toLocaleString(tag, { maximumFractionDigits: 2 });

  const supabase = createClient();
  const { data: walletRows, error: walletsErr } = await supabase.from("wallets").select("id, org_id, address, label, chain_id").order("created_at");
  const wallets = walletRows ?? [];
  // Always one wallet: the one in the URL, else the first.
  const wallet = wallets.some((w) => w.id === sp.wallet) ? sp.wallet! : wallets[0]?.id ?? "";
  const selected = wallet ? wallets.filter((w) => w.id === wallet) : wallets;
  // Labels and role come from the selected wallet's workspace only.
  const orgId = selected[0]?.org_id ?? "";
  const canAdmin = !!orgId && isAdminRole(await roleIn(supabase, orgId));

  // Calendar days in the user's time zone, inclusive. "All time" starts far enough back to cover
  // any chain history. (The summary RPC still buckets by UTC day; raw transfers use exact instants.)
  const to = dayIn(new Date(), tz);
  const from = range === "all" ? "2015-01-01" : addDays(to, -(Number(range) - 1));

  const { data: summaryRaw, error: summaryErr } = wallets.length
    ? await supabase.rpc("overview_summary", { p_from: from, p_to: to, p_token: sp.token || null, p_wallets: wallet ? [wallet] : null })
    : { data: null, error: null };
  const s = summaryRaw as Summary | null;
  const token = s?.token ?? "";

  // Money map: per wallet × counterparty totals, plus names/types for every node.
  const { data: graphRaw, error: graphErr } = tab === "map" && token
    ? await supabase.rpc("overview_graph", { p_from: from, p_to: to, p_token: token, p_wallets: wallet ? [wallet] : null })
    : { data: null, error: null };
  const graph = (graphRaw ?? []) as GraphEdge[];
  const { data: graphLabels, error: graphLabelsErr } = graph.length
    ? await supabase.from("address_labels").select("address, name, type").eq("org_id", orgId).in("address", [...new Set(graph.map((e) => e.address))])
    : { data: [], error: null };

  // Transfers for the recent list (summary) or the paged table (transactions tab).
  const txLimit = tab === "tx" ? PAGE : 8;
  const txOffset = tab === "tx" ? (page - 1) * PAGE : 0;
  let txQuery = supabase.from("transfers")
    .select("id, ts, wallet_id, dir, amount, token_symbol, from_addr, to_addr, tx_hash", { count: tab === "tx" ? "exact" : undefined })
    .in("wallet_id", selected.map((w) => w.id)).eq("token_symbol", token)
    .gte("ts", dayStartIso(from, tz));
  // Counterparty = the other side of each transfer (sender for IN, receiver for OUT); partial match.
  if (cpQ) txQuery = txQuery.or(`and(dir.eq.IN,from_addr.ilike.*${cpQ}*),and(dir.eq.OUT,to_addr.ilike.*${cpQ}*)`);
  if (startTs) txQuery = txQuery.gte("ts", startTs);
  if (endTs) txQuery = txQuery.lte("ts", endTs);
  if (minAmt !== null) txQuery = txQuery.gte("amount", minAmt);
  if (maxAmt !== null) txQuery = txQuery.lte("amount", maxAmt);
  txQuery = tab === "tx" && sort === "amount"
    ? txQuery.order("amount", { ascending: asc }).order("ts", { ascending: false })
    : txQuery.order("ts", { ascending: tab === "tx" && asc });
  const { data: txs, count: txCount, error: txErr } = token && tab !== "map"
    ? await txQuery.range(txOffset, txOffset + txLimit - 1)
    : { data: [], count: 0, error: null };
  const rows = txs ?? [];
  const totalPages = Math.max(1, Math.ceil((txCount ?? 0) / PAGE));

  // Names for every counterparty shown on this page.
  const shown = [...new Set([...(s?.top ?? []).map((c) => c.address), ...rows.map((r) => (r.dir === "IN" ? r.from_addr : r.to_addr))])];
  const { data: labelRows, error: labelsErr } = shown.length
    ? await supabase.from("address_labels").select("address, name, type").eq("org_id", orgId).in("address", shown)
    : { data: [], error: null };
  // Choices for the counterparty filter: our wallets, then named labels.
  const { data: namedRows, error: namedErr } = tab === "tx"
    ? await supabase.from("address_labels").select("address, name").eq("org_id", orgId).neq("name", "").order("name").limit(500)
    : { data: [], error: null };
  // Any failed query shows an error state instead of a misleading "no data" state.
  const loadErr = walletsErr ?? summaryErr ?? graphErr ?? graphLabelsErr ?? txErr ?? labelsErr ?? namedErr;
  if (loadErr) reportError("overview: query failed", loadErr);
  const cpNamed = [
    ...wallets.filter((w) => w.label && !selected.some((x) => x.id === w.id)).map((w) => ({ address: w.address, name: w.label })),
    ...(namedRows ?? []).filter((l) => !wallets.some((w) => w.address === l.address)),
  ];
  const labels = new Map((labelRows ?? []).map((l) => [l.address, l]));
  const chainOf = (id: string) => wallets.find((w) => w.id === id)?.chain_id ?? "tron";
  const walletChain = (id: string) => wallets.find((x) => x.id === id)?.chain_id;
  const walletName = (id: string) => { const w = wallets.find((x) => x.id === id); return w ? w.label || short(w.address) : "—"; };
  const typeLabel = (type: string) => (t.ov as Record<string, string>)[`type${type}`] ?? type;
  const Counterparty = ({ address, chain }: { address: string; chain: string }) => {
    const l = labels.get(address);
    const own = wallets.find((w) => w.address === address);
    return (
      <span className="cp">
        {own?.label || l?.name ? <CopyText text={address} display={(own?.label || l?.name)!} name /> : <CopyText text={address} display={short(address)} />}
        {l && l.type !== "PERSON" && <span className={`tag tag-${l.type.toLowerCase()}`}>{typeLabel(l.type)}</span>}
        <ExplorerLink chain={chain} kind="address" value={address} label={t.common.viewOn} />
      </span>
    );
  };

  // Buckets: days up to ~3 months, then weeks, so "all time" stays readable.
  const daily = s?.daily ?? [];
  const byWeek = daily.length > 92;
  const bucketMap = new Map<string, Bucket>();
  for (const d of daily) {
    const day = new Date(`${d.day}T00:00:00Z`);
    if (byWeek) day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
    const label = day.toLocaleDateString(tag, { day: "numeric", month: "short", ...(byWeek ? { year: "2-digit" } : {}), timeZone: "UTC" });
    const b = bucketMap.get(label) ?? { label, in: 0, out: 0 };
    b.in += Number(d.in); b.out += Number(d.out);
    bucketMap.set(label, b);
  }
  const buckets = [...bucketMap.values()];

  const change = (now: number, prev: number) => {
    if (range === "all" || !prev) return <em className="kpi-note">{t.ov.noPrev}</em>;
    const pct = Math.round(((now - prev) / prev) * 100);
    return <em className={`kpi-note ${pct >= 0 ? "trend-up" : "trend-down"}`}>{fmt(t.ov.vsPrev, { pct: Math.abs(pct) })}</em>;
  };
  const tabHref = (k: Tab) => {
    const p = new URLSearchParams(Object.entries(sp).filter(([key, v]) => v && key !== "tab" && key !== "page") as [string, string][]);
    if (k !== "summary") p.set("tab", k);
    return `/overview/${p.size ? `?${p}` : ""}`;
  };
  const rangeHref = (r: Range) => {
    const p = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]);
    p.set("range", r);
    return `/overview/?${p}`;
  };
  const max = Math.max(1, ...(s?.top ?? []).map((c) => Number(c.in) + Number(c.out)));
  const net = Number(s?.in ?? 0) - Number(s?.out ?? 0);

  // Same empty state on every tab: point to the last activity when the range is just too recent.
  const emptyState = s?.last_day && range !== "all" ? (
    <div className="empty-range">
      <p className="subdued">{fmt(t.ov.emptyRange, { token, date: new Date(`${s.last_day}T00:00:00Z`).toLocaleDateString(tag, { dateStyle: "medium", timeZone: "UTC" }) })}</p>
      <Link className="btn-tertiary btn-sm" href={rangeHref("all")}>{t.ov.viewAllTime}</Link>
    </div>
  ) : (
    <p className="subdued">{t.ov.empty}</p>
  );

  // Sort header (transactions tab only): click toggles direction; a new column starts descending.
  const sortHref = (col: "time" | "amount") => {
    const p = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]);
    const nextAsc = sort === col ? !asc : false;
    p.set("tab", "tx");
    if (col === "time") p.delete("sort"); else p.set("sort", col);
    if (nextAsc) p.set("order", "asc"); else p.delete("order");
    return `/overview/?${p}`;
  };
  const sortLink = (col: "time" | "amount", label: string) => {
    const on = sort === col;
    return (
      <Link className={`th-sort${on ? " is-active" : ""}`} href={sortHref(col)} aria-label={fmt(t.ov.sortBy, { col: label })} scroll={false}>
        {label}
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M5 6.5L8 3.5l3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity={on && asc ? 1 : 0.35} />
          <path d="M5 9.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity={on && !asc ? 1 : 0.35} />
        </svg>
      </Link>
    );
  };
  const ariaSort = (col: "time" | "amount") => (sort === col ? (asc ? "ascending" : "descending") : "none");
  const sortable = tab === "tx";

  const txTable = (
    <table>
      <thead><tr>
        {sortable ? <th aria-sort={ariaSort("time")}><span className="th-cp">{sortLink("time", t.test.colTime)}<TimeFilter start={startTs ?? ""} end={endTs ?? ""} /></span></th> : <th>{t.test.colTime}</th>}
        <th>{t.ov.colWallet}</th><th><span className="th-cp">{t.test.colCounterparty}<CounterpartyFilter value={cpQ} named={cpNamed} /></span></th>
        {sortable ? (
          <th className="num" aria-sort={ariaSort("amount")}>
            <span className="th-amount"><AmountFilter min={sp.min ?? ""} max={sp.max ?? ""} />{sortLink("amount", t.test.colAmount)}</span>
          </th>
        ) : <th className="num">{t.test.colAmount}</th>}
        <th>{t.ov.colTx}</th>
      </tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="subdued nowrap">{fmtDateTime(r.ts, locale, tz)}</td>
            <td><span className="chain">{walletName(r.wallet_id)}{walletChain(r.wallet_id) && <ChainIcon chain={walletChain(r.wallet_id)!} />}</span></td>
            <td><Counterparty address={r.dir === "IN" ? r.from_addr : r.to_addr} chain={chainOf(r.wallet_id)} /></td>
            <td className={`num nowrap ${r.dir === "IN" ? "" : "subdued"}`}><span className="amount">{r.dir === "IN" ? "+" : "−"}{num(r.amount)} <TokenIcon symbol={r.token_symbol} chain={chainOf(r.wallet_id)} size={16} /> {r.token_symbol}</span></td>
            <td><span className="addr-cell"><CopyText text={r.tx_hash} display={short(r.tx_hash)} /><ExplorerLink chain={chainOf(r.wallet_id)} kind="tx" value={r.tx_hash} label={t.common.viewOn} /></span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <AppShell email={email} active="overview">
      <div className="page-head">
        <h1>{t.ov.title}</h1>
        <nav className="tabs" aria-label={t.ov.title}>
          {(["summary", "map", "tx"] as Tab[]).map((k) => (
            <Link key={k} href={tabHref(k)} aria-current={tab === k ? "page" : undefined}>
              {k === "summary" ? t.ov.tabSummary : k === "map" ? t.ov.tabMap : t.ov.tabTx}
            </Link>
          ))}
        </nav>
      </div>

      {loadErr ? (
        <p className="error" role="alert">{t.ov.errLoad}</p>
      ) : !wallets.length ? (
        <p className="card subdued">{t.ov.noWallets} <Link className="link" href="/">{t.nav.wallets}</Link></p>
      ) : (
        <>
          {/* Only the selected wallet: opening Overview must not start a sync of every wallet. */}
          {canAdmin && <SyncRunner key={wallet} wallets={selected} email={email ?? ""} />}
          <div className="ov-bar">
            <OverviewFilters wallets={wallets.map((w) => ({ id: w.id, label: w.label || short(w.address) }))}
              wallet={wallet} tokens={s?.tokens ?? []} token={token} range={range} chain={selected[0]?.chain_id ?? "tron"} />
            <div className="ov-actions">
              {canAdmin && <SyncNowButton walletId={wallet} />}
              {token && <ExportMenu wallet={wallet} rangeStart={range === "all" ? null : from} />}
            </div>
          </div>

          {tab === "map" ? (
            <section className="card">
              <RadialMap
                wallets={selected.map((w) => ({ id: w.id, address: w.address, chain: w.chain_id, name: w.label || short(w.address) }))}
                others={wallets.filter((w) => !selected.some((x) => x.id === w.id)).map((w) => w.address)}
                edges={graph}
                from={range === "all" ? undefined : from}
                labels={Object.fromEntries([
                  ...(graphLabels ?? []).map((l) => [l.address, { name: l.name, type: l.type } as Label]),
                  // our other wallets show their wallet name, same as the transactions table
                  ...wallets.filter((w) => w.label).map((w) => [w.address, { name: w.label, type: "PERSON" } as Label]),
                ])}
                token={token}
                canEdit={canAdmin}
              />
            </section>
          ) : tab === "tx" ? (
            <section className="card stack">
              {rows.length || cpQ || startTs || endTs || minAmt !== null || maxAmt !== null ? txTable : emptyState}
              {(txCount ?? 0) > 0 && <Pagination page={Math.min(page, totalPages)} total={totalPages} size={PAGE} />}
            </section>
          ) : (
            <>
              <div className="kpis">
                <div className="kpi"><span className="kpi-label">{t.ov.kpiIn}</span><strong>{num(s?.in ?? 0)}</strong>{change(Number(s?.in ?? 0), Number(s?.prev_in ?? 0))}</div>
                <div className="kpi"><span className="kpi-label">{t.ov.kpiOut}</span><strong>{num(s?.out ?? 0)}</strong>{change(Number(s?.out ?? 0), Number(s?.prev_out ?? 0))}</div>
                <div className="kpi"><span className="kpi-label">{t.ov.kpiNet}</span><strong>{net >= 0 ? "+" : "−"}{num(Math.abs(net))}</strong><em className="kpi-note kpi-token">{token && <TokenIcon symbol={token} chain={selected[0]?.chain_id ?? "tron"} size={16} />}{token}</em></div>
                <div className="kpi"><span className="kpi-label">{t.ov.kpiCps}</span><strong>{num(s?.counterparties ?? 0)}</strong><em className="kpi-note">{fmt(t.ov.txCount, { n: num(s?.tx ?? 0) })}</em></div>
              </div>

              {!buckets.length ? (
                <section className="card">{emptyState}</section>
              ) : (
                <div className="ov-grid">
                  <section className="card stack">
                    <div className="card-head">
                      <h3>{t.ov.daily}</h3>
                      <span className="legend caption subdued"><i className="dot-in" />{t.test.in}<i className="dot-out" />{t.test.out}</span>
                    </div>
                    <DailyBars data={buckets} fmt={num} labels={{ in: t.test.in, out: t.test.out }} />
                  </section>
                  <section className="card stack">
                    <div className="card-head"><h3>{t.ov.top}</h3><span className="caption subdued">{t.ov.byVolume}</span></div>
                    <ol className="top-list">
                      {(s?.top ?? []).map((c) => (
                        <li key={c.address}>
                          <div className="top-row"><Counterparty address={c.address} chain={selected[0]?.chain_id ?? "tron"} /><span className="num">{num(Number(c.in) + Number(c.out))}</span></div>
                          <div className="split-bar" aria-hidden="true">
                            <i className="bar-in" style={{ width: `${(Number(c.in) / max) * 100}%` }} />
                            <i className="bar-out" style={{ width: `${(Number(c.out) / max) * 100}%` }} />
                          </div>
                        </li>
                      ))}
                    </ol>
                  </section>
                </div>
              )}

              {!!rows.length && (
                <section className="card stack">
                  <div className="card-head"><h3>{t.ov.recent}</h3><Link className="link small" href={tabHref("tx")}>{t.ov.seeAll} →</Link></div>
                  {txTable}
                </section>
              )}
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
