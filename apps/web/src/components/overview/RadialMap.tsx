"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { fmt, fmtDateTime, LOCALE_TAGS } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/client";
import { CopyText } from "../CopyText";
import { ExplorerLink } from "../ExplorerLink";
import { Dropdown } from "../Dropdown";
import { saveLabel } from "@/app/overview/actions";
import { toast } from "../Toaster";
import { usePopoverPlacement } from "../usePopoverPlacement";
import { forceCollide, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import { GalaxyBackground } from "./GalaxyBackground";
import { toBlob } from "html-to-image";
import { useZoomPan, type View } from "./useZoomPan";

export type GraphEdge = { wallet: string; address: string; in: number; out: number; tx: number; internal: boolean };
export type Label = { name: string; type: string };
type Zone = "EXCHANGE" | "DEX" | "CONTRACT" | "PERSON";
type Node = { id: string; address: string; chain: string; name: string; zone: Zone | "wallet"; own?: boolean; named?: boolean; in: number; out: number; tx: number; x: number; y: number; r: number };

const W = 1000, H = 640, CX = W / 2, CY = H / 2;
const ZONES: Zone[] = ["EXCHANGE", "DEX", "CONTRACT", "PERSON"];
// Server (Node) and browser Math.cos can differ in the last digit; round so hydration matches.
const q = (n: number) => Math.round(n * 10) / 10;
// Logo marks for well-known names (initials in brand colour); other tagged nodes get their initial.
const BRANDS: [RegExp, string, string][] = [
  [/binance/i, "B", "#f0b90b"], [/okx|okex/i, "OK", "#ffffff"], [/htx|huobi/i, "H", "#2ca6e0"], [/bybit/i, "BY", "#f7a600"],
  [/kucoin/i, "K", "#23af91"], [/gate/i, "G", "#2354e6"], [/bitget/i, "BG", "#00c8d7"], [/mexc/i, "M", "#2b6ef7"],
  [/bitkub/i, "BK", "#4cba64"], [/kraken/i, "KR", "#7b61ff"], [/coinbase/i, "C", "#0052ff"], [/bitfinex/i, "BF", "#16b157"],
  [/sun ?swap|sun\.io|sunio|sunpump/i, "S", "#ff8a3d"], [/justlend|justswap/i, "J", "#2dd4bf"], [/tether|usdt/i, "₮", "#26a17b"],
];
const ZONE_COLOR: Record<string, string> = { EXCHANGE: "#4f7ac7", DEX: "#a77bd6", CONTRACT: "#3fb5b5" };
function markOf(n: Node): { text: string; color: string } | null {
  if (n.zone === "wallet" || n.own || n.zone === "PERSON" || n.r < 9) return null;
  const b = BRANDS.find(([re]) => re.test(n.name));
  if (b) return { text: b[1], color: b[2] };
  const ch = n.name.match(/[A-Za-z0-9\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF]/)?.[0];
  return ch && n.name !== short(n.address) ? { text: ch.toUpperCase(), color: ZONE_COLOR[n.zone] ?? "#b3b3b3" } : null;
}
// Fullscreen (Safari < 16.4 only has the webkit-prefixed API).
type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };
const fsElement = () => (document as FsDoc).fullscreenElement ?? (document as FsDoc).webkitFullscreenElement ?? null;
const fsSubscribe = (cb: () => void) => {
  document.addEventListener("fullscreenchange", cb);
  document.addEventListener("webkitfullscreenchange", cb);
  return () => { document.removeEventListener("fullscreenchange", cb); document.removeEventListener("webkitfullscreenchange", cb); };
};
const NO_OTHERS: string[] = []; // stable default: a fresh [] would re-run the layout every render
const short = (a: string) => (a.length > 14 ? `${a.slice(0, 5)}…${a.slice(-4)}` : a);

// A name split into k lines at spaces (words are never broken); null when it has fewer than k words.
function nameLines(name: string, k: number): string[] | null {
  if (k === 1) return [name];
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= k) {
    const per = name.length / k, lines: string[] = [""];
    for (const w of words) {
      const cur = lines[lines.length - 1];
      if (cur && lines.length < k && cur.length + w.length / 2 > per) lines.push(w); else lines[lines.length - 1] = cur ? `${cur} ${w}` : w;
    }
    return lines;
  }
  return null;
}
const splits = (name: string) => [1, 2, 3].flatMap((k) => { const l = nameLines(name, k); return l ? [l] : []; });
// Font fit for a name block: room = usable width, max = font cap. Picks the 1–3 line split with the largest font.
function fitName(name: string, room: number, max: number) {
  return splits(name).map((lines) => {
    const longest = Math.max(...lines.map((l) => [...l].length));
    return { lines, fs: Math.min(max, room / (longest * 0.62), (room * 0.85) / (lines.length * 1.15)) };
  }).reduce((a, b) => (b.fs > a.fs + 0.5 ? b : a));
}
// Smallest radius that holds the name at a readable 11px (logo bubbles keep the top half for the logo).
const NAME_FS = 11;
function nameRadius(name: string, mark: boolean) {
  return Math.min(...splits(name).map((lines) => {
    const w = Math.max(...lines.map((l) => [...l].length)) * 0.62 * NAME_FS, h = lines.length * 1.15 * NAME_FS;
    return mark ? Math.max(w / 1.3, h / 0.84) : Math.max(w / 1.6, h / (1.6 * 0.85));
  })) + 2;
}

// Bubble map: our wallet in the middle, counterparties as bubbles sized by volume, packed by a
// force layout that pulls each type (Exchange / DEX / Contract / Person) to its own side.
// d3-force uses its own seeded random, so the server and browser compute the same layout.
// Hover = spotlight + sparks along the links; drag a bubble to move it; click for details.
export function RadialMap({ wallets, others = NO_OTHERS, edges, labels, token, canEdit, from }: {
  wallets: { id: string; address: string; name: string; chain: string }[];
  others?: string[]; // addresses of our other (unselected) wallets: drawn as hollow gold rings
  edges: GraphEdge[];
  labels: Record<string, Label>;
  token: string;
  canEdit: boolean;
  from?: string; // range start (YYYY-MM-DD) for the node card's transfer list
}) {
  const t = useT();
  const tag = LOCALE_TAGS[useLocale()];
  const num = (n: number) => Number(n).toLocaleString(tag, { maximumFractionDigits: 2 });
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Zone[]>([]);
  const [labeledOnly, setLabeledOnly] = useState(false);
  const [spread, setSpread] = useState(false); // "Spread out": roomier layout so bubbles and links don't pile up
  const toggleZone = (z: Zone) => setHidden((h) => (h.includes(z) ? h.filter((x) => x !== z) : [...h, z]));
  const [tipAt, setTipAt] = useState<{ x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const isFull = useSyncExternalStore(fsSubscribe, () => !!fsElement() && fsElement() === boxRef.current, () => false);
  const toggleFull = () => {
    const d = document as FsDoc, el = boxRef.current as FsEl | null;
    if (fsElement()) { if (d.exitFullscreen) void d.exitFullscreen(); else d.webkitExitFullscreen?.(); return; }
    if (!el) return;
    if (el.requestFullscreen) void el.requestFullscreen().then(() => setTimeout(fit, 50));
    else { el.webkitRequestFullscreen?.(); setTimeout(fit, 50); }
  };
  const moveTip = (e: React.MouseEvent) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (r) setTipAt({ x: e.clientX - r.left + 14, y: e.clientY - r.top + 14 });
  };
  const svgRef = useRef<SVGSVGElement>(null);

  const { nodes: baseNodes, links: baseLinks } = useMemo(() => {
    // Wallets: small circle in the middle (one wallet sits exactly at the centre).
    const used = wallets.filter((w) => edges.some((e) => e.wallet === w.id || (e.internal && e.address === w.address)));
    const ws = used.length ? used : wallets.slice(0, 1);
    const wr = ws.length === 1 ? 0 : Math.min(80, 30 + ws.length * 10);
    const walletNodes: Node[] = ws.map((w, i) => {
      const a = (i / ws.length) * Math.PI * 2 - Math.PI / 2;
      const tot = edges.filter((e) => e.wallet === w.id && !e.internal);
      return { id: w.id, address: w.address, chain: w.chain, name: w.name, zone: "wallet", x: q(CX + Math.cos(a) * wr), y: q(CY + Math.sin(a) * wr), r: 22,
        in: tot.reduce((s, e) => s + Number(e.in), 0), out: tot.reduce((s, e) => s + Number(e.out), 0), tx: tot.reduce((s, e) => s + Number(e.tx), 0) };
    });

    // Counterparties: totals across wallets.
    const cps = new Map<string, Node>();
    const chainOf = new Map(wallets.map((w) => [w.id, w.chain]));
    for (const e of edges) {
      if (e.internal) continue;
      const l = labels[e.address];
      const zone: Zone = l && ZONES.includes(l.type as Zone) ? (l.type as Zone) : "PERSON";
      if ((hidden.includes(zone) || (labeledOnly && !l)) && !others.includes(e.address)) continue; // our own wallets are never filtered out
      const n = cps.get(e.address) ?? { id: e.address, address: e.address, chain: chainOf.get(e.wallet) ?? "", name: l?.name || short(e.address), zone, own: others.includes(e.address), named: !!l?.name, in: 0, out: 0, tx: 0, x: 0, y: 0, r: 0 };
      n.in += Number(e.in); n.out += Number(e.out); n.tx += Number(e.tx);
      cps.set(e.address, n);
    }
    const list = [...cps.values()];
    const maxVol = Math.max(1, ...list.map((n) => n.in + n.out));

    // Bubble radius by volume; force layout with one anchor per type around the centre.
    const zoneAngle: Record<Zone, number> = { EXCHANGE: -0.6, DEX: 0.9, CONTRACT: 2.4, PERSON: 3.6 };
    type Sim = SimulationNodeDatum & { n: Node; ax: number; ay: number };
    const simNodes: Sim[] = [
      ...walletNodes.map((n) => { n.r = Math.max(ws.length === 1 ? 40 : 28, nameRadius(n.name, false)); return { n, x: n.x, y: n.y, fx: n.x, fy: n.y, ax: n.x, ay: n.y }; }),
      ...list.map((n, i) => {
        // Volume sets the size; a named bubble grows until its whole name fits inside.
        n.r = q(Math.max(6 + Math.sqrt((n.in + n.out) / maxVol) * 46, n.named || n.own ? nameRadius(n.name, !!markOf(n)) : 0));
        const a = n.own ? 1.6 : zoneAngle[n.zone as Zone], d = 150 + (i % 5) * 12;
        // People (usually most of them) wrap around the wallet; named types sit on their own side.
        // Spread: every counterparty gets its own spot on rings around the wallet (golden angle), so links fan out.
        const out = spread ? 240 + (i % 3) * 90 : n.zone === "PERSON" && !n.own ? 0 : 210;
        const sa = spread ? (n.zone === "PERSON" && !n.own ? i * 2.39996 : a + ((i % 7) - 3) * 0.12) : a;
        const ax = CX + Math.cos(sa) * out * 1.2, ay = CY + Math.sin(sa) * out * 0.85;
        return { n, x: CX + Math.cos(a + i * 0.37) * d, y: CY + Math.sin(a + i * 0.37) * d, ax, ay };
      }),
    ];
    forceSimulation(simNodes)
      .force("x", forceX<Sim>((d) => d.ax).strength(0.07))
      .force("y", forceY<Sim>((d) => d.ay).strength(0.09))
      .force("collide", forceCollide<Sim>((d) => d.n.r + (spread ? 22 : 3)).iterations(2))
      .force("charge", forceManyBody<Sim>().strength(spread ? -40 : -6))
      .stop()
      .tick(300);
    // Centre the cluster in the viewBox and shrink it if it would spill over the edges.
    const xs = simNodes.map((d) => [(d.x ?? CX) - d.n.r, (d.x ?? CX) + d.n.r]).flat(), ys = simNodes.map((d) => [(d.y ?? CY) - d.n.r, (d.y ?? CY) + d.n.r - 0, (d.y ?? CY) + d.n.r + 18]).flat();
    const bx = (Math.min(...xs) + Math.max(...xs)) / 2, by = (Math.min(...ys) + Math.max(...ys)) / 2;
    const k = Math.min(1, (W - 80) / (Math.max(...xs) - Math.min(...xs)), (H - 80) / (Math.max(...ys) - Math.min(...ys)));
    for (const d of simNodes) {
      d.n.x = q(CX + ((d.x ?? CX) - bx) * k); d.n.y = q(CY + ((d.y ?? CY) - by) * k); d.n.r = q(d.n.r * k);
    }

    const byId = new Map([...walletNodes, ...list].map((n) => [n.id, n]));
    const walletByAddr = new Map(walletNodes.map((n) => [n.address, n]));
    const maxEdge = Math.max(1, ...edges.map((e) => Number(e.in) + Number(e.out)));
    const links = edges.flatMap((e) => {
      const from = byId.get(e.wallet);
      const to = e.internal ? walletByAddr.get(e.address) : byId.get(e.address);
      if (!from || !to || from === to) return [];
      if (e.internal && Number(e.out) === 0) return []; // draw each internal move once, from the sender
      const vol = Number(e.in) + Number(e.out);
      return [{ key: `${e.wallet}-${e.address}`, from, to, internal: e.internal, net: Number(e.in) - Number(e.out), w: q(1 + Math.sqrt(vol / maxEdge) * 7) }];
    });
    return { nodes: [...list, ...walletNodes], links };
  }, [wallets, others, edges, labels, hidden, labeledOnly, spread]);

  // Dragged bubbles keep their new spot (until the data/filters change).
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({});
  const [movedFor, setMovedFor] = useState(baseNodes);
  if (movedFor !== baseNodes) { setMovedFor(baseNodes); setMoved({}); }
  const { nodes, links } = useMemo(() => {
    const ns = baseNodes.map((n) => (moved[n.id] ? { ...n, ...moved[n.id] } : n));
    const by = new Map(ns.map((n) => [n.id, n]));
    return { nodes: ns, links: baseLinks.map((l) => ({ ...l, from: by.get(l.from.id) ?? l.from, to: by.get(l.to.id) ?? l.to })) };
  }, [baseNodes, baseLinks, moved]);
  const dragRef = useRef<{ id: string; px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  const svgPoint = (e: React.PointerEvent) => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const nodeDown = (e: React.PointerEvent, n: Node) => {
    if (e.button !== 0) return;
    const p = svgPoint(e);
    dragRef.current = { id: n.id, px: p.x, py: p.y, x: n.x, y: n.y, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const nodeMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const p = svgPoint(e), dx = (p.x - d.px) / view.k, dy = (p.y - d.py) / view.k;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    d.moved = true;
    setMoved((m) => ({ ...m, [d.id]: { x: q(d.x + dx), y: q(d.y + dy) } }));
  };
  const nodeUp = (e: React.PointerEvent, n: Node) => {
    const d = dragRef.current;
    dragRef.current = null;
    if ((e.currentTarget as Element).hasPointerCapture(e.pointerId)) (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    if (d && !d.moved) setSelected(n.id);
  };

  // Fit = the nodes' bounding box (plus room for labels) scaled into the viewBox.
  const fitView = useCallback((): View => {
    if (!nodes.length) return { k: 1, x: 0, y: 0 };
    const x0 = Math.min(...nodes.map((n) => n.x - n.r - 40)), x1 = Math.max(...nodes.map((n) => n.x + n.r + 40));
    const y0 = Math.min(...nodes.map((n) => n.y - n.r - 12)), y1 = Math.max(...nodes.map((n) => n.y + n.r + 34));
    const k = Math.min(4, Math.min((W - 48) / (x1 - x0), (H - 48) / (y1 - y0)));
    return { k, x: W / 2 - ((x0 + x1) / 2) * k, y: H / 2 - ((y0 + y1) / 2) * k };
  }, [nodes]);
  const { view, fit, zoomCenter, handlers } = useZoomPan(svgRef, fitView);

  // Camera button → menu: copy the map as PNG, or download it.
  const [shotOpen, setShotOpen] = useState(false);
  const shotRoot = useRef<HTMLDivElement>(null);
  const shotMenu = useRef<HTMLDivElement>(null);
  usePopoverPlacement(shotMenu, shotOpen, "top");
  useEffect(() => {
    if (!shotOpen) return;
    const onDown = (e: PointerEvent) => { if (!shotRoot.current?.contains(e.target as globalThis.Node)) setShotOpen(false); };
    document.addEventListener("pointerdown", onDown);
    shotMenu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener("pointerdown", onDown);
  }, [shotOpen]);
  // Right-click on the map → small menu at the cursor (kept inside the map box).
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  const ctxMenu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ctx) return;
    const onDown = (e: PointerEvent) => { if (!ctxMenu.current?.contains(e.target as globalThis.Node)) setCtx(null); };
    document.addEventListener("pointerdown", onDown);
    ctxMenu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener("pointerdown", onDown);
  }, [ctx]);
  const openCtx = (e: React.MouseEvent) => {
    e.preventDefault();
    const r = boxRef.current?.getBoundingClientRect();
    if (!r) return;
    const MW = 216, MH = 200; // menu size incl. padding
    setCtx({ x: Math.max(8, Math.min(e.clientX - r.left, r.width - MW - 8)), y: Math.max(8, Math.min(e.clientY - r.top, r.height - MH - 8)) });
  };
  const ctxKey = (e: React.KeyboardEvent) => {
    const items = [...(ctxMenu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") items[(i + 1) % items.length]?.focus();
    else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length]?.focus();
    else if (e.key === "Escape" || e.key === "Tab") setCtx(null);
    else return;
    if (e.key !== "Tab") e.preventDefault();
  };
  // The image is what's on screen: the map box with its spotlight, chips, legend and open node card; toolbars and menus left out.
  const mapPng = () => toBlob(boxRef.current!, {
    pixelRatio: 2, backgroundColor: "#08080d",
    filter: (el) => !(el instanceof HTMLElement && (el.classList.contains("map-tools") || el.classList.contains("map-ctx") || el.classList.contains("map-tip"))),
  }).then((b) => { if (!b) throw new Error("encode failed"); return b; });
  const downloadImage = async (png = mapPng()) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await png);
    a.download = `xcap-money-map-${token}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(t.ov.imageSaved);
  };
  const copyImage = () => {
    if (!boxRef.current) return;
    const png = mapPng();
    // Pass the promise straight to ClipboardItem: Safari requires write() inside the click.
    navigator.clipboard.write([new ClipboardItem({ "image/png": png })])
      .then(() => toast(t.ov.imageCopied))
      .catch(() => downloadImage(png)); // clipboard blocked: fall back to a file
  };
  const shotKey = (e: React.KeyboardEvent) => {
    const items = [...(shotMenu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") items[(i + 1) % items.length]?.focus();
    else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length]?.focus();
    else if (e.key === "Escape" || e.key === "Tab") setShotOpen(false);
    else return;
    if (e.key !== "Tab") e.preventDefault();
  };

  const zoneCount = useMemo(() => {
    const seen = new Map<string, Zone>();
    for (const e of edges) {
      if (e.internal || others.includes(e.address)) continue;
      const ty = labels[e.address]?.type as Zone;
      seen.set(e.address, ZONES.includes(ty) ? ty : "PERSON");
    }
    return ZONES.map((z) => ({ z, n: [...seen.values()].filter((v) => v === z).length }));
  }, [edges, labels, others]);
  const labeledCount = useMemo(() => new Set(edges.filter((e) => !e.internal && !others.includes(e.address) && labels[e.address]).map((e) => e.address)).size, [edges, labels, others]);

  const galaxyAt = baseNodes.find((n) => n.zone === "wallet") ?? { x: CX, y: CY };
  const sel = nodes.find((n) => n.id === selected) ?? null;
  const focus = hover ?? selected;
  const linked = (id: string) => !focus || id === focus || links.some((l) => (l.from.id === focus && l.to.id === id) || (l.to.id === focus && l.from.id === id));
  // Name inside a bubble, white, never truncated (bubbles are sized to hold it; see nameRadius).
  const nameIn = (n: Node, y: number, room: number, max: number) => {
    const best = fitName(n.name, room, max);
    const lh = best.fs * 1.15, top = y - ((best.lines.length - 1) * lh) / 2;
    return (
      <text x={n.x} textAnchor="middle" className="map-name-text" style={{ fontSize: q(best.fs) }}>
        {best.lines.map((l, i) => <tspan key={i} x={n.x} y={q(top + i * lh)} dy="0.35em">{l}</tspan>)}
      </text>
    );
  };
  const zoneName = (z: Zone) => (t.ov as Record<string, string>)[`type${z}`];

  if (!edges.length) return <p className="card subdued">{t.ov.empty}</p>;

  return (
    <div className="map" ref={boxRef}>
      <div className="map-stage">
      <GalaxyBackground view={view} cx={galaxyAt.x} cy={galaxyAt.y} />
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${t.ov.tabMap} · ${t.ov.mapHint}`} tabIndex={0}
        className="map-canvas" onContextMenu={openCtx}
        onPointerDown={handlers.onPointerDown} onPointerMove={handlers.onPointerMove}
        onPointerUp={(e) => { const dragged = handlers.onPointerUp(e); if (!dragged && !(e.target as Element).closest("[data-node]")) setSelected(null); }}
        onDoubleClick={handlers.onDoubleClick} onKeyDown={(e) => { if (e.key === "f" || e.key === "F") { e.preventDefault(); toggleFull(); } else if (e.key === "s" || e.key === "S") { e.preventDefault(); setSpread((v) => !v); } else handlers.onKeyDown(e); }}>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
        <defs>
          <filter id="map-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          {links.map((l, i) => (
            <linearGradient key={l.key} id={`map-lg-${i}`} gradientUnits="userSpaceOnUse" x1={l.from.x} y1={l.from.y} x2={l.to.x} y2={l.to.y}>
              <stop offset="0" className={l.internal ? "lg-stop-own" : "lg-stop-wallet"} />
              <stop offset="1" className={l.internal ? "lg-stop-own" : l.net >= 0 ? "lg-stop-in" : "lg-stop-out"} />
            </linearGradient>
          ))}
        </defs>
        {links.map((l, i) => {
          // Links stop at the bubbles' edges (4px gap) instead of running into their centres.
          const dx = l.to.x - l.from.x, dy = l.to.y - l.from.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
          const a = Math.min(l.from.r + 4, len / 2), b = Math.min(l.to.r + 4, len / 2);
          const d = `M${q(l.from.x + ux * a)},${q(l.from.y + uy * a)}L${q(l.to.x - ux * b)},${q(l.to.y - uy * b)}`;
          const lit = !!focus && (l.from.id === focus || l.to.id === focus);
          // money moves towards the wallet for inflow, away from it for outflow
          const toWallet = !l.internal && l.net >= 0;
          return (
            <g key={l.key} className={`map-link${l.internal ? " internal" : ""}${lit ? " is-lit" : ""}`} opacity={!focus || lit ? 1 : 0.06}>
              <path d={d} stroke={`url(#map-lg-${i})`} strokeWidth={l.w} filter={lit ? "url(#map-glow)" : undefined} />
              {lit && [0, 1, 2].map((k) => (
                <circle key={k} r={2 + l.w / 4} className={`map-spark ${l.internal ? "own" : toWallet ? "in" : "out"}`}>
                  <animateMotion dur="1.6s" begin={`${-k * 0.53}s`} repeatCount="indefinite" path={d}
                    keyPoints={toWallet ? "1;0" : "0;1"} keyTimes="0;1" calcMode="linear" />
                </circle>
              ))}
            </g>
          );
        })}
        {nodes.map((n) => {
          const mark = markOf(n);
          // Outline colour = net flow: green when more came in than went out, red otherwise.
          const net = n.zone === "wallet" || n.own ? "" : n.in >= n.out ? " net-in" : " net-out";
          const showName = n.zone === "wallet" || n.own || n.named || (!mark && n.r >= 22);
          return (
            <g key={n.id} data-node className={`map-node z-${n.zone.toLowerCase()}${n.own ? " is-own" : ""}${mark ? " has-mark" : ""}${selected === n.id ? " is-selected" : ""}${focus === n.id ? " is-focus" : ""}${net}`} opacity={linked(n.id) ? 1 : 0.15}
              onMouseEnter={(e) => { setHover(n.id); moveTip(e); }} onMouseMove={moveTip} onMouseLeave={() => { setHover(null); setTipAt(null); }}
              onPointerDown={(e) => nodeDown(e, n)} onPointerMove={nodeMove} onPointerUp={(e) => nodeUp(e, n)}
              tabIndex={0} role="button" aria-label={n.name} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(n.id); } }}>
              {n.zone === "wallet" && <circle cx={n.x} cy={n.y} r={n.r} className="map-pulse" />}
              <circle cx={n.x} cy={n.y} r={n.r} className="map-bubble" />
              {mark && <text x={n.x} y={q(n.y - (n.r >= 16 ? n.r * 0.12 : 0) + Math.min(n.r, 22) * 0.36)} textAnchor="middle" className="map-mark" fill={mark.color}
                fontSize={q(Math.min(n.r, 22) * (n.r >= 16 ? 0.75 : 1) * (mark.text.length > 1 ? 0.8 : 1.05))}>{mark.text}</text>}
              {/* Logo bubbles: logo up top, name under it; others: name centred. */}
              {mark ? nameIn(n, n.y + n.r * 0.48, n.r * 1.3, 11) : showName && nameIn(n, n.y, n.r * 1.6, n.zone === "wallet" ? 14 : 12)}
            </g>
          );
        })}
        </g>
      </svg>
      </div>

      {(
        <div className="map-filter" role="group" aria-label={t.ov.mapFilter}>
          {zoneCount.map(({ z, n }) => (
            <button key={z} type="button" className={`map-chip z-${z.toLowerCase()}`} aria-pressed={n > 0 && !hidden.includes(z)} disabled={n === 0} onClick={() => toggleZone(z)}>
              <i aria-hidden="true" />{zoneName(z)}<span className="map-chip-n">{n}</span>
            </button>
          ))}
          <span className="map-tools-sep" aria-hidden="true" />
          <button type="button" className="map-chip" aria-pressed={labeledOnly} onClick={() => setLabeledOnly((v) => !v)} title={t.ov.labeledOnlyHint}>
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M2.5 2.5h5.2l5.8 5.8-5.2 5.2-5.8-5.8z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><circle cx="5.5" cy="5.5" r="1" fill="currentColor" /></svg>
            {t.ov.labeledOnly}<span className="map-chip-n">{labeledCount}</span>
          </button>
        </div>
      )}

      <div className="map-tools" role="toolbar" aria-label={t.ov.tabMap}>
        <button type="button" className="icon-btn" onClick={() => zoomCenter(1.25)} aria-label={t.ov.zoomIn} title={`${t.ov.zoomIn} (+)`}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
        <button type="button" className="icon-btn" onClick={() => zoomCenter(1 / 1.25)} aria-label={t.ov.zoomOut} title={`${t.ov.zoomOut} (−)`}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
        <button type="button" className="icon-btn" onClick={() => setSpread((v) => !v)} aria-pressed={spread} aria-label={spread ? t.ov.compact : t.ov.spread} title={`${spread ? t.ov.compact : t.ov.spread} (S)`}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">{spread
            ? <><circle cx="8" cy="8" r="2" fill="currentColor" /><path d="M8 2.5v2.5M8 11v2.5M2.5 8H5M11 8h2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>
            : <><circle cx="8" cy="8" r="1.6" fill="currentColor" /><circle cx="2.8" cy="3.5" r="1.3" fill="currentColor" /><circle cx="13.2" cy="3.5" r="1.3" fill="currentColor" /><circle cx="2.8" cy="12.5" r="1.3" fill="currentColor" /><circle cx="13.2" cy="12.5" r="1.3" fill="currentColor" /><path d="M6.6 6.8L4 4.6M9.4 6.8L12 4.6M6.6 9.2L4 11.4M9.4 9.2L12 11.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></>}</svg>
        </button>
        <button type="button" className="icon-btn" onClick={fit} aria-label={t.ov.fit} title={`${t.ov.fit} (0)`}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button type="button" className="icon-btn" onClick={toggleFull} aria-pressed={isFull} aria-label={isFull ? t.ov.exitFullscreen : t.ov.fullscreen} title={`${isFull ? t.ov.exitFullscreen : t.ov.fullscreen} (F)`}>
          {isFull
            ? <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M6 2.5V6H2.5M10 2.5V6h3.5M13.5 10H10v3.5M2.5 10H6v3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            : <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2.5 2.5l4 4M13.5 2.5l-4 4M13.5 13.5l-4-4M2.5 13.5l4-4M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </button>
        <span className="map-tools-sep" aria-hidden="true" />
        <div className="row-menu" ref={shotRoot}>
          <button type="button" className="icon-btn" aria-haspopup="menu" aria-expanded={shotOpen} onClick={() => setShotOpen((o) => !o)} aria-label={t.ov.screenshot} title={t.ov.screenshot}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="1.8" y="3.8" width="12.4" height="9.4" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" /><circle cx="8" cy="8.5" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M5.5 3.8l1-1.6h3l1 1.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
          </button>
          {shotOpen && (
            <div ref={shotMenu} role="menu" aria-label={t.ov.screenshot} className="row-menu-pop" onKeyDown={shotKey}>
              <button type="button" role="menuitem" tabIndex={-1} className="menu-item" onClick={() => { setShotOpen(false); copyImage(); }}>
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M10.5 3.5v-.5A1.5 1.5 0 009 1.5H4A1.5 1.5 0 002.5 3v5A1.5 1.5 0 004 9.5h.5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
                <span>{t.ov.copyImage}</span>
              </button>
              <button type="button" role="menuitem" tabIndex={-1} className="menu-item" onClick={() => { setShotOpen(false); void downloadImage(); }}>
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 2.5v7.5M4.8 7L8 10.2 11.2 7M3 13.5h10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span>{t.ov.downloadImage}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {ctx && (
        <div ref={ctxMenu} role="menu" aria-label={t.ov.tabMap} className="row-menu-pop map-ctx" style={{ left: ctx.x, top: ctx.y }} onKeyDown={ctxKey} onContextMenu={(e) => e.preventDefault()}>
          <button type="button" role="menuitem" tabIndex={-1} className="menu-item" onClick={() => { setCtx(null); fit(); }}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>{t.ov.fit}</span>
          </button>
          <button type="button" role="menuitem" tabIndex={-1} className="menu-item" onClick={() => { setCtx(null); setSpread((v) => !v); }}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="1.6" fill="currentColor" /><circle cx="2.8" cy="3.5" r="1.3" fill="currentColor" /><circle cx="13.2" cy="3.5" r="1.3" fill="currentColor" /><circle cx="2.8" cy="12.5" r="1.3" fill="currentColor" /><circle cx="13.2" cy="12.5" r="1.3" fill="currentColor" /></svg>
            <span>{spread ? t.ov.compact : t.ov.spread}</span>
          </button>
          <button type="button" role="menuitem" tabIndex={-1} className="menu-item" onClick={() => { setCtx(null); copyImage(); }}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M10.5 3.5v-.5A1.5 1.5 0 009 1.5H4A1.5 1.5 0 002.5 3v5A1.5 1.5 0 004 9.5h.5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
            <span>{t.ov.copyImage}</span>
          </button>
          <button type="button" role="menuitem" tabIndex={-1} className="menu-item" onClick={() => { setCtx(null); toggleFull(); }}>
            {isFull
              ? <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M6 2.5V6H2.5M10 2.5V6h3.5M13.5 10H10v3.5M2.5 10H6v3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              : <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2.5 2.5l4 4M13.5 2.5l-4 4M13.5 13.5l-4-4M2.5 13.5l4-4M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            <span>{isFull ? t.ov.exitFullscreen : t.ov.fullscreen}</span>
          </button>
        </div>
      )}

      {hover && tipAt && (() => {
        const n = nodes.find((x) => x.id === hover);
        return n && n.id !== selected ? (
          <div className="map-tip" style={{ left: tipAt.x, top: tipAt.y }} role="tooltip">
            <strong>{n.name}</strong>
            {n.in > 0 && <span className="amt-in">+{num(n.in)} {token}</span>}
            {n.out > 0 && <span className="amt-out">−{num(n.out)} {token}</span>}
            <span className="subdued">{num(n.tx)} {t.ov.tabTx}</span>
          </div>
        ) : null;
      })()}
      <div className="map-legend caption">
        <span><i className="lg-wallet" />{t.ov.ourWallets}</span>
        {others.length > 0 && nodes.some((n) => n.own) && <span><i className="lg-own" />{t.ov.otherWallets}</span>}
        <span><i className="lg-in" />{t.test.in}</span>
        <span><i className="lg-out" />{t.test.out}</span>
        <span><i className="lg-internal" />{t.ov.internal}</span>
      </div>

      {sel && (
        <NodeCard key={sel.id} node={sel} token={token} num={num} walletIds={wallets.map((w) => w.id)} from={from} label={labels[sel.address]} canEdit={canEdit && sel.zone !== "wallet" && !sel.own} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

type CardTx = { ts: string; dir: string; amount: number; tx_hash: string };
const CARD_TX = 20;

function NodeCard({ node, token, num, label, canEdit, onClose, walletIds, from }: {
  node: Node; token: string; num: (n: number) => string; label?: Label; canEdit: boolean; onClose: () => void; walletIds: string[]; from?: string;
}) {
  const t = useT();
  const locale = useLocale();
  // Latest transfers between our wallet(s) and this node (for a wallet node: its own latest).
  const [txs, setTxs] = useState<CardTx[] | null>(null);
  const ids = walletIds.join(","); // stable across parent re-renders (hover etc.)
  useEffect(() => {
    let off = false;
    let q = createClient().from("transfers").select("ts, dir, amount, tx_hash").eq("token_symbol", token);
    q = node.zone === "wallet"
      ? q.eq("wallet_id", node.id)
      : q.in("wallet_id", ids.split(",")).or(`and(dir.eq.IN,from_addr.eq.${node.address}),and(dir.eq.OUT,to_addr.eq.${node.address})`);
    if (from) q = q.gte("ts", `${from}T00:00:00Z`);
    void q.order("ts", { ascending: false }).limit(CARD_TX).then(({ data }) => { if (!off) setTxs((data ?? []) as CardTx[]); });
    return () => { off = true; };
  }, [node.id, node.zone, node.address, token, from, ids]);
  return (
    <aside className="map-card" aria-label={node.name}>
      <div className="map-card-head">
        <strong>{node.name}</strong>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t.common.close}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </div>
      <span className="addr-cell"><CopyText text={node.address} display={short(node.address)} /><ExplorerLink chain={node.chain} kind="address" value={node.address} label={t.common.viewOn} /></span>
      <dl className="map-card-stats">
        <div><dt>{t.ov.kpiIn}</dt><dd>+{num(node.in)} {token}</dd></div>
        <div><dt>{t.ov.kpiOut}</dt><dd>−{num(node.out)} {token}</dd></div>
        <div><dt>{t.ov.tabTx}</dt><dd>{num(node.tx)}</dd></div>
      </dl>
      <div className="map-card-tx">
        <span className="map-card-sub">{t.ov.latestTx}</span>
        {txs === null ? <p className="caption subdued">{t.ov.loading}</p>
          : !txs.length ? <p className="caption subdued">—</p>
          : <ul>
              {txs.map((x) => (
                <li key={x.tx_hash + x.dir + x.ts}>
                  <span className="map-card-time">{fmtDateTime(x.ts, locale)}</span>
                  <span className={`map-card-amt ${x.dir === "IN" ? "in" : "out"}`}>{x.dir === "IN" ? "+" : "−"}{num(Number(x.amount))}</span>
                  <span className="map-card-hash"><CopyText text={x.tx_hash} display={`${x.tx_hash.slice(0, 6)}…${x.tx_hash.slice(-4)}`} /><ExplorerLink chain={node.chain} kind="tx" value={x.tx_hash} label={t.common.viewOn} /></span>
                </li>
              ))}
            </ul>}
        {txs && txs.length >= CARD_TX && <p className="caption subdued">{fmt(t.ov.latestN, { n: CARD_TX })}</p>}
      </div>
      {canEdit && (
        <form action={saveLabel} className="stack-sm">
          <input type="hidden" name="address" value={node.address} />
          <input type="hidden" name="chain_id" value={node.chain} />
          <input className="input" name="name" defaultValue={label?.name ?? ""} maxLength={80} placeholder={t.ov.namePh} aria-label={t.wallets.label} />
          <Dropdown name="type" label={t.ov.type} defaultValue={label?.type ?? "PERSON"}
            options={ZONES.map((z) => ({ value: z, label: (t.ov as Record<string, string>)[`type${z}`] }))} />
          <button className="btn-primary btn-sm">{t.common.save}</button>
        </form>
      )}
    </aside>
  );
}
