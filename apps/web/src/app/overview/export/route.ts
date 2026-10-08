import ExcelJS from "exceljs";
import { RANGES, type Range } from "@/components/overview/ranges";
import { fmt, fmtDateTime, LOCALE_TAGS } from "@/i18n/config";
import { buildPdf } from "@/lib/export/pdf";
import { getT, getTimeZone } from "@/i18n/server";
import { addDays, dayIn, dayStartIso, toWallClock, tzOffsetLabel } from "@/i18n/tz";
import { explorerLink } from "@/lib/explorer";
import { createClient } from "@/lib/supabase/server";

// GET /overview/export?format=xlsx|pdf plus the overview's filters (wallet, token, range, cp,
// min, max, sort, order). Optional start/end (ISO datetimes) override the range. Totals and top
// counterparties are computed from the exported transfers, so they match the filters. Runs as the signed-in user, so RLS limits it to their org.
const MAX_ROWS = 100_000;
const BATCH = 1000; // PostgREST's default max rows per request
type Row = { ts: string; wallet_id: string; dir: string; amount: number; token_symbol: string; from_addr: string; to_addr: string; tx_hash: string; status: string };

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const format = sp.get("format") === "pdf" ? "pdf" : "xlsx";
  const useNames = sp.get("names") !== "0";
  const { t, locale } = await getT();
  const tag = LOCALE_TAGS[locale];
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) return new Response("Unauthorized", { status: 401 });

  const { data: walletRows } = await supabase.from("wallets").select("id, address, label, chain_id").order("created_at");
  const wallets = walletRows ?? [];
  const w = wallets.find((x) => x.id === sp.get("wallet")) ?? wallets[0];
  if (!w) return new Response("No wallet", { status: 404 });

  const range: Range = (RANGES as readonly string[]).includes(sp.get("range") ?? "") ? (sp.get("range") as Range) : "all";
  const today = new Date();
  // Days and times in the user's time zone (Excel cells get that zone's wall-clock time).
  const tz = await getTimeZone();
  const tzName = `${tz} (${tzOffsetLabel(tz, today.getTime())})`;
  const to = dayIn(today, tz);
  const from = range === "all" ? "2015-01-01" : addDays(to, -(Number(range) - 1));
  const { data: summaryRaw } = await supabase.rpc("overview_summary", { p_from: from, p_to: to, p_token: sp.get("token") || null, p_wallets: [w.id] });
  const token = (summaryRaw as { token: string | null } | null)?.token;
  if (!token) return new Response("No data", { status: 404 });

  const num0 = (v: string | null) => (v && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);
  const cp = (sp.get("cp") ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 64);
  const min = num0(sp.get("min")), max = num0(sp.get("max"));
  const byAmount = sp.get("sort") === "amount", asc = sp.get("order") === "asc";
  const iso = (v: string | null) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
  const start = iso(sp.get("start")), end = iso(sp.get("end"));

  // All matching transfers, in batches.
  const rows: Row[] = [];
  for (let off = 0; off < MAX_ROWS; off += BATCH) {
    let q = supabase.from("transfers").select("ts, wallet_id, dir, amount, token_symbol, from_addr, to_addr, tx_hash, status")
      .eq("wallet_id", w.id).eq("token_symbol", token).gte("ts", start ?? dayStartIso(from, tz));
    if (end) q = q.lte("ts", end);
    if (cp) q = q.or(`and(dir.eq.IN,from_addr.ilike.*${cp}*),and(dir.eq.OUT,to_addr.ilike.*${cp}*)`);
    if (min !== null) q = q.gte("amount", min);
    if (max !== null) q = q.lte("amount", max);
    q = byAmount ? q.order("amount", { ascending: asc }).order("ts", { ascending: false }) : q.order("ts", { ascending: asc }).order("tx_hash");
    const { data, error } = await q.range(off, off + BATCH - 1);
    if (error) return new Response(error.message, { status: 500 });
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < BATCH) break;
  }

  // Totals + busiest counterparties from exactly what is exported.
  const other0 = (r: Row) => (r.dir === "IN" ? r.from_addr : r.to_addr);
  const agg = new Map<string, { address: string; in: number; out: number; tx: number }>();
  let sIn = 0, sOut = 0;
  for (const r of rows) {
    const a = Number(r.amount), c = other0(r);
    const g = agg.get(c) ?? { address: c, in: 0, out: 0, tx: 0 };
    if (r.dir === "IN") { sIn += a; g.in += a; } else { sOut += a; g.out += a; }
    g.tx++; agg.set(c, g);
  }
  const s = { in: sIn, out: sOut, tx: rows.length, top: [...agg.values()].sort((x, y) => y.in + y.out - (x.in + x.out)).slice(0, 20) };
  const fmtTs = (v: string) => fmtDateTime(v, locale, tz);
  const period = start || end ? `${start ? fmtTs(start) : "…"} – ${end ? fmtTs(end) : "…"}` : range === "all" ? t.ov.expAllTime : `${from} – ${to}`;

  // Names: our wallets first, then labels (looked up in chunks to keep URLs short).
  const other = (r: Row) => (r.dir === "IN" ? r.from_addr : r.to_addr);
  const addrs = [...new Set([...rows.map(other), ...(s?.top ?? []).map((c) => c.address)])];
  const names = new Map<string, { name: string; type: string }>();
  for (let i = 0; i < addrs.length; i += 200) {
    const { data } = await supabase.from("address_labels").select("address, name, type").in("address", addrs.slice(i, i + 200));
    // Without labels, only public names (exchange/DEX/contract) remain; person labels are ours.
    for (const l of data ?? []) if (useNames || l.type !== "PERSON") names.set(l.address, { name: l.name, type: l.type });
  }
  if (useNames) for (const x of wallets) if (x.label) names.set(x.address, { name: x.label, type: "PERSON" });
  const typeLabel = (ty?: string) => (ty ? (t.ov as Record<string, string>)[`type${ty}`] ?? ty : "");
  const walletName = (useNames && w.label) || w.address;

  const head = [t.test.colTime, t.ov.colWallet, t.test.colDir, t.ov.expCpName, t.test.colCounterparty, t.ov.type, t.test.colAmount, t.ov.token, t.ov.expStatus, t.ov.expTx, t.ov.expLink];
  const line = (r: Row) => {
    const c = other(r), l = names.get(c);
    const amount = Number(r.amount) * (r.dir === "IN" ? 1 : -1);
    return [toWallClock(Date.parse(r.ts), tz), walletName, r.dir === "IN" ? t.test.in : t.test.out, l?.name ?? "", c, typeLabel(l?.type), amount, r.token_symbol, r.status, r.tx_hash, explorerLink(w.chain_id, "tx", r.tx_hash)?.url ?? ""] as const;
  };
  const stamp = `${((useNames && w.label) || w.address.slice(0, 8)).replace(/[^\p{L}\p{N}_-]+/gu, "_")}_${token}_${to}`;

  if (format === "pdf") {
    const PDF_MAX = 5000; // ~170 pages; the full list is in the Excel export
    const amt = (n: number) => n.toLocaleString(tag, { maximumFractionDigits: 6 });
    const net = Number(s?.in ?? 0) - Number(s?.out ?? 0);
    const pdf = await buildPdf({
      locale,
      title: `${walletName} · ${token}`,
      meta: [
        [t.common.address, w.address],
        [t.ov.expRange, period],
        ...(cp || min !== null || max !== null ? [[t.ov.expFilters, [cp && `${t.test.colCounterparty}: ${cp}`, min !== null && `≥ ${min}`, max !== null && `≤ ${max}`].filter(Boolean).join(" · ")] as [string, string]] : []),
        [t.ov.expCreated, fmtDateTime(today, locale, tz)],
        [t.common.timeZone, tzName],
      ],
      kpis: [[t.ov.kpiIn, `+${amt(Number(s?.in ?? 0))}`], [t.ov.kpiOut, `−${amt(Number(s?.out ?? 0))}`], [t.ov.kpiNet, `${net < 0 ? "−" : "+"}${amt(Math.abs(net))}`], [t.ov.tabTx, amt(Number(s?.tx ?? 0))]],
      topTitle: t.ov.top,
      topHead: [t.ov.expCpName, t.ov.type, t.test.colCounterparty, t.ov.kpiIn, t.ov.kpiOut, t.ov.tabTx],
      top: (s?.top ?? []).map((c) => { const l = names.get(c.address); return [l?.name || "—", typeLabel(l?.type), c.address, amt(Number(c.in)), amt(Number(c.out)), amt(Number(c.tx))]; }),
      txTitle: t.ov.tabTx,
      txHead: [t.test.colTime, t.test.colDir, t.ov.expCpName, t.test.colCounterparty, `${t.test.colAmount} (${token})`, t.ov.expTx],
      lines: rows.slice(0, PDF_MAX).map((r) => {
        const c = other(r);
        return { time: fmtDateTime(r.ts, locale, tz), dir: r.dir === "IN" ? "IN" : "OUT", dirLabel: r.dir === "IN" ? t.test.in : t.test.out, name: names.get(c)?.name || "—", address: c,
          amount: Number(r.amount), amountText: `${r.dir === "IN" ? "+" : "−"}${amt(Number(r.amount))}`, tx: `${r.tx_hash.slice(0, 8)}…${r.tx_hash.slice(-6)}` };
      }),
      note: rows.length > PDF_MAX ? fmt(t.ov.expCapped, { n: PDF_MAX.toLocaleString(tag) }) : undefined,
      footer: `XCap Insight · {page} / {pages}`,
    });
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(stamp)}.pdf`, "Cache-Control": "no-store" },
    });
  }

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
  if (cp || min !== null || max !== null) sum.addRow([t.ov.expFilters, [cp && `${t.test.colCounterparty}: ${cp}`, min !== null && `≥ ${min}`, max !== null && `≤ ${max}`].filter(Boolean).join(" · ")]).getCell(1).font = bold;
  sum.addRow([]);
  for (const [k, v] of [[t.ov.kpiIn, Number(s?.in ?? 0)], [t.ov.kpiOut, Number(s?.out ?? 0)], [t.ov.kpiNet, Number(s?.in ?? 0) - Number(s?.out ?? 0)], [t.ov.tabTx, Number(s?.tx ?? 0)]] as const) {
    const r = sum.addRow([k, v]); r.getCell(1).font = bold; r.getCell(2).numFmt = numFmt;
  }
  sum.addRow([]);
  sum.addRow([t.ov.top]).getCell(1).font = { bold: true, size: 13 };
  const th = sum.addRow([t.ov.expCpName, t.ov.type, t.test.colCounterparty, t.ov.kpiIn, t.ov.kpiOut, t.ov.tabTx]);
  th.font = bold;
  for (const c of s?.top ?? []) {
    const l = names.get(c.address);
    const r = sum.addRow([l?.name ?? "", typeLabel(l?.type), c.address, Number(c.in), Number(c.out), Number(c.tx)]);
    r.getCell(4).numFmt = numFmt; r.getCell(5).numFmt = numFmt;
  }

  // Sheet 2: every transfer.
  const tx = wb.addWorksheet(t.ov.tabTx, { views: [{ state: "frozen", ySplit: 1 }] });
  tx.columns = [{ width: 20 }, { width: 16 }, { width: 8 }, { width: 22 }, { width: 38 }, { width: 12 }, { width: 18 }, { width: 8 }, { width: 12 }, { width: 66 }, { width: 14 }];
  tx.addRow([`${head[0]} (${tz})`, ...head.slice(1)]).font = bold;
  tx.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: head.length } };
  for (const r of rows) {
    const v = line(r);
    const ex = explorerLink(w.chain_id, "tx", r.tx_hash);
    const x = tx.addRow([...v.slice(0, 10), ex ? { text: fmt(t.common.viewOn, { name: ex.name }), hyperlink: ex.url } : ""]);
    x.getCell(1).numFmt = "yyyy-mm-dd hh:mm:ss";
    x.getCell(7).numFmt = numFmt;
    x.getCell(7).font = { color: { argb: v[6] < 0 ? "FFE22134" : "FF1A7F37" } };
  }
  if (rows.length >= MAX_ROWS) tx.addRow([fmt(t.ov.expCapped, { n: MAX_ROWS.toLocaleString(tag) })]).font = { italic: true };

  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(stamp)}.xlsx`,
      "Cache-Control": "no-store",
    },
  });
}
