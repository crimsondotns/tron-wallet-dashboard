import ExcelJS from "exceljs";
import { RANGES, type Range } from "@/components/overview/ranges";
import { fmt, fmtDateTime, LOCALE_TAGS } from "@/i18n/config";
import { buildPdf } from "@/lib/export/pdf";
import type { Locale } from "@/i18n/config";
import type { Dict } from "@/i18n/dict";
import { addDays, dayIn, dayStartIso, toWallClock, tzOffsetLabel } from "@/i18n/tz";
import { explorerLink } from "@/lib/explorer";
import { createClient } from "@/lib/supabase/client";

// Overview export, built in the browser: format=xlsx|pdf plus the overview's filters (wallet,
// token, range, cp, min, max, sort, order). Optional start/end (ISO datetimes) override the range.
// Totals and top counterparties are computed from the exported transfers, so they match the
// filters. Runs as the signed-in user, so RLS limits it to their org.
//
// Transfers are read with keyset pagination on (ts, id) or (amount, id) — id is the unique
// tie-breaker, so no row repeats or goes missing between pages. Pass 1 aggregates totals and
// top counterparties; pass 2 writes every row into the XLSX workbook (held in memory).
export class ExportError extends Error {}
const MAX_ROWS = 100_000;
const BATCH = 1000; // PostgREST's default max rows per request
const PDF_MAX = 5000; // ~170 pages; the full list is in the Excel export
// amount comes back as text (numeric(78,18) does not fit a JS number exactly; the cursor must be exact).
type Row = { id: number; ts: string; dir: string; amount: string; token_symbol: string; from_addr: string; to_addr: string; tx_hash: string; status: string };

export async function exportOverview(sp: URLSearchParams, { t, locale, tz }: { t: Dict; locale: Locale; tz: string }): Promise<{ blob: Blob; name: string }> {
  const format = sp.get("format") === "pdf" ? "pdf" : "xlsx";
  const useNames = sp.get("names") !== "0";
  const tag = LOCALE_TAGS[locale];
  const supabase = createClient();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) throw new ExportError("Unauthorized");

  const { data: walletRows } = await supabase.from("wallets").select("id, org_id, address, label, chain_id").order("created_at");
  const wallets = walletRows ?? [];
  const w = wallets.find((x) => x.id === sp.get("wallet")) ?? wallets[0];
  if (!w) throw new ExportError("No wallet");

  const range: Range = (RANGES as readonly string[]).includes(sp.get("range") ?? "") ? (sp.get("range") as Range) : "all";
  const today = new Date();
  // Days and times in the user's time zone (Excel cells get that zone's wall-clock time).
  const tzName = `${tz} (${tzOffsetLabel(tz, today.getTime())})`;
  const to = dayIn(today, tz);
  const from = range === "all" ? "2015-01-01" : addDays(to, -(Number(range) - 1));
  const { data: summaryRaw } = await supabase.rpc("overview_summary", { p_from: from, p_to: to, p_token: sp.get("token") || null, p_wallets: [w.id] });
  const token = (summaryRaw as { token: string | null } | null)?.token;
  if (!token) throw new ExportError("No data");

  const num0 = (v: string | null) => (v && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);
  const cp = (sp.get("cp") ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 64);
  const min = num0(sp.get("min")), max = num0(sp.get("max"));
  const byAmount = sp.get("sort") === "amount", asc = sp.get("order") === "asc";
  const iso = (v: string | null) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
  const start = iso(sp.get("start")), end = iso(sp.get("end"));

  // Matching transfers in pages of BATCH, at most `limit` rows, keyset-paginated.
  const key = byAmount ? "amount" : "ts";
  const op = asc ? "gt" : "lt";
  async function* transfers(cols: string, limit: number): AsyncGenerator<Row[]> {
    let cursor: { k: string; id: number } | null = null;
    for (let got = 0; got < limit;) {
      let q = supabase.from("transfers").select(cols)
        .eq("wallet_id", w.id).eq("token_symbol", token!).gte("ts", start ?? dayStartIso(from, tz));
      if (end) q = q.lte("ts", end);
      if (min !== null) q = q.gte("amount", min);
      if (max !== null) q = q.lte("amount", max);
      // One top-level or() holding both conditions, so they AND together.
      const conds: string[] = [];
      if (cp) conds.push(`or(and(dir.eq.IN,from_addr.ilike.*${cp}*),and(dir.eq.OUT,to_addr.ilike.*${cp}*))`);
      if (cursor) conds.push(`or(${key}.${op}."${cursor.k}",and(${key}.eq."${cursor.k}",id.${op}.${cursor.id}))`);
      if (conds.length) q = q.or(`and(${conds.join(",")})`);
      const n = Math.min(BATCH, limit - got);
      const { data, error } = await q.order(key, { ascending: asc }).order("id", { ascending: asc }).limit(n);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as unknown as Row[];
      if (page.length) yield page;
      got += page.length;
      if (page.length < n) return;
      const last = page[page.length - 1];
      cursor = { k: byAmount ? last.amount : last.ts, id: last.id };
    }
  }
  const BASE = "id, ts, amount:amount::text, dir, from_addr, to_addr";
  const ROW = `${BASE}, token_symbol, tx_hash, status`;
  const other = (r: Pick<Row, "dir" | "from_addr" | "to_addr">) => (r.dir === "IN" ? r.from_addr : r.to_addr);

  // Names: labels looked up per page (in chunks to keep URLs short) and cached; our wallets win.
  const names = new Map<string, { name: string; type: string } | null>();
  if (useNames) for (const x of wallets) if (x.label) names.set(x.address, { name: x.label, type: "PERSON" });
  const resolveNames = async (addrs: string[]) => {
    const need = [...new Set(addrs)].filter((a) => !names.has(a));
    for (let i = 0; i < need.length; i += 200) {
      const chunk = need.slice(i, i + 200);
      const { data } = await supabase.from("address_labels").select("address, name, type").eq("org_id", w.org_id).in("address", chunk);
      for (const a of chunk) names.set(a, null);
      // Without labels, only public names (exchange/DEX/contract) remain; person labels are ours.
      for (const l of data ?? []) if (useNames || l.type !== "PERSON") names.set(l.address, { name: l.name, type: l.type });
    }
  };
  const nameOf = (a: string) => names.get(a) ?? undefined;
  const typeLabel = (ty?: string) => (ty ? (t.ov as Record<string, string>)[`type${ty}`] ?? ty : "");
  const statusLabel = (st: string) => (t.ov as Record<string, string>)[`txStatus${st}`] ?? st;
  const walletName = (useNames && w.label) || w.address;

  // Pass 1: totals + busiest counterparties from exactly what is exported. For PDF this pass
  // also keeps the first PDF_MAX full rows, so it needs no second pass.
  const keep = format === "pdf" ? PDF_MAX : 0;
  const kept: Row[] = [];
  const agg = new Map<string, { address: string; in: number; out: number; tx: number }>();
  let sIn = 0, sOut = 0, count = 0;
  {
    for await (const page of transfers(keep ? ROW : BASE, MAX_ROWS)) {
      for (const r of page) {
        const a = Number(r.amount), c = other(r);
        const g = agg.get(c) ?? { address: c, in: 0, out: 0, tx: 0 };
        if (r.dir === "IN") { sIn += a; g.in += a; } else { sOut += a; g.out += a; }
        g.tx++; agg.set(c, g);
        if (kept.length < keep) kept.push(r);
      }
      count += page.length;
    }
  }
  const capped = count >= MAX_ROWS;
  const s = { in: sIn, out: sOut, tx: count, top: [...agg.values()].sort((x, y) => y.in + y.out - (x.in + x.out)).slice(0, 20) };
  agg.clear();
  const fmtTs = (v: string) => fmtDateTime(v, locale, tz);
  const period = start || end ? `${start ? fmtTs(start) : "…"} – ${end ? fmtTs(end) : "…"}` : range === "all" ? t.ov.expAllTime : `${from} – ${to}`;
  await resolveNames(s.top.map((c) => c.address));
  const filters = cp || min !== null || max !== null
    ? [cp && `${t.test.colCounterparty}: ${cp}`, min !== null && `≥ ${min}`, max !== null && `≤ ${max}`].filter(Boolean).join(" · ") : null;
  const stamp = `${((useNames && w.label) || w.address.slice(0, 8)).replace(/[^\p{L}\p{N}_-]+/gu, "_")}_${token}_${to}`;

  if (format === "pdf") {
    await resolveNames(kept.map(other));
    const amt = (n: number) => n.toLocaleString(tag, { maximumFractionDigits: 6 });
    const net = s.in - s.out;
    const pdf = await buildPdf({
      locale,
      title: `${walletName} · ${token}`,
      meta: [
        [t.common.address, w.address],
        [t.ov.expRange, period],
        ...(filters ? [[t.ov.expFilters, filters] as [string, string]] : []),
        [t.ov.expCreated, fmtDateTime(today, locale, tz)],
        [t.common.timeZone, tzName],
      ],
      kpis: [[t.ov.kpiIn, `+${amt(s.in)}`], [t.ov.kpiOut, `−${amt(s.out)}`], [t.ov.kpiNet, `${net < 0 ? "−" : "+"}${amt(Math.abs(net))}`], [t.ov.tabTx, amt(s.tx)]],
      topTitle: t.ov.top,
      topHead: [t.ov.expCpName, t.ov.type, t.test.colCounterparty, t.ov.kpiIn, t.ov.kpiOut, t.ov.tabTx],
      top: s.top.map((c) => { const l = nameOf(c.address); return [l?.name || "—", typeLabel(l?.type), c.address, amt(c.in), amt(c.out), amt(c.tx)]; }),
      txTitle: t.ov.tabTx,
      txHead: [t.test.colTime, t.test.colDir, t.ov.expCpName, t.test.colCounterparty, `${t.test.colAmount} (${token})`, t.ov.expTx],
      lines: kept.map((r) => {
        const c = other(r);
        return { time: fmtDateTime(r.ts, locale, tz), dir: r.dir === "IN" ? "IN" : "OUT", dirLabel: r.dir === "IN" ? t.test.in : t.test.out, name: nameOf(c)?.name || "—", address: c,
          amount: Number(r.amount), amountText: `${r.dir === "IN" ? "+" : "−"}${amt(Number(r.amount))}`, tx: `${r.tx_hash.slice(0, 8)}…${r.tx_hash.slice(-6)}` };
      }),
      note: count > PDF_MAX ? fmt(t.ov.expCapped, { n: PDF_MAX.toLocaleString(tag) }) : undefined,
      footer: `XCap Insight · {page} / {pages}`,
    });
    return { blob: pdf, name: `${stamp}.pdf` };
  }

  // XLSX: summary sheet first (complete after pass 1), then pass 2 adds every transfer.
  const wb = new ExcelJS.Workbook();
  wb.creator = "XCap Insight";
  wb.created = today;
  const bold = { bold: true };
  const numFmt = "#,##0.######";

    // Sheet 1: summary + top counterparties.
    const sum = wb.addWorksheet(t.ov.tabSummary);
    sum.columns = [{ width: 28 }, { width: 24 }, { width: 44 }, { width: 18 }, { width: 18 }, { width: 12 }];
    sum.addRow([t.ov.colWallet, walletName]).getCell(1).font = bold;
    sum.addRow([t.common.address, w.address]).getCell(1).font = bold;
    sum.addRow([t.ov.token, token]).getCell(1).font = bold;
    sum.addRow([t.ov.expRange, period]).getCell(1).font = bold;
    sum.addRow([t.common.timeZone, tzName]).getCell(1).font = bold;
    if (filters) sum.addRow([t.ov.expFilters, filters]).getCell(1).font = bold;
    sum.addRow([]);
    for (const [k, v] of [[t.ov.kpiIn, s.in], [t.ov.kpiOut, s.out], [t.ov.kpiNet, s.in - s.out], [t.ov.tabTx, s.tx]] as const) {
      const r = sum.addRow([k, v]); r.getCell(1).font = bold; r.getCell(2).numFmt = numFmt;
    }
    sum.addRow([]);
    sum.addRow([t.ov.top]).getCell(1).font = { bold: true, size: 13 };
    sum.addRow([t.ov.expCpName, t.ov.type, t.test.colCounterparty, t.ov.kpiIn, t.ov.kpiOut, t.ov.tabTx]).font = bold;
    for (const c of s.top) {
      const l = nameOf(c.address);
      const r = sum.addRow([l?.name ?? "", typeLabel(l?.type), c.address, c.in, c.out, c.tx]);
      r.getCell(4).numFmt = numFmt; r.getCell(5).numFmt = numFmt;
    }

    // Sheet 2: every transfer.
    const head = [t.test.colTime, t.ov.colWallet, t.test.colDir, t.ov.expCpName, t.test.colCounterparty, t.ov.type, t.test.colAmount, t.ov.token, t.ov.expStatus, t.ov.expTx, t.ov.expLink];
    const tx = wb.addWorksheet(t.ov.tabTx, { views: [{ state: "frozen", ySplit: 1 }] });
    tx.columns = [{ width: 20 }, { width: 16 }, { width: 8 }, { width: 22 }, { width: 38 }, { width: 12 }, { width: 18 }, { width: 8 }, { width: 12 }, { width: 66 }, { width: 14 }];
    tx.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: head.length } };
    tx.addRow([`${head[0]} (${tz})`, ...head.slice(1)]).font = bold;
    for await (const page of transfers(ROW, count)) {
      await resolveNames(page.map(other));
      for (const r of page) {
        const c = other(r), l = nameOf(c);
        const amount = Number(r.amount) * (r.dir === "IN" ? 1 : -1);
        const ex = explorerLink(w.chain_id, "tx", r.tx_hash);
        const x = tx.addRow([toWallClock(Date.parse(r.ts), tz), walletName, r.dir === "IN" ? t.test.in : t.test.out, l?.name ?? "", c, typeLabel(l?.type), amount, r.token_symbol,
          statusLabel(r.status), r.tx_hash, ex ? { text: fmt(t.common.viewOn, { name: ex.name }), hyperlink: ex.url } : ""]);
        x.getCell(1).numFmt = "yyyy-mm-dd hh:mm:ss";
        x.getCell(7).numFmt = numFmt;
        x.getCell(7).font = { color: { argb: amount < 0 ? "FFE22134" : "FF1A7F37" } };
      }
    }
    if (capped) tx.addRow([fmt(t.ov.expCapped, { n: MAX_ROWS.toLocaleString(tag) })]).font = { italic: true };
  const buf = await wb.xlsx.writeBuffer();
  return { blob: new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name: `${stamp}.xlsx` };
}
