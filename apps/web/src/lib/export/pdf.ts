import fs from "node:fs";
import path from "node:path";
import * as fontkit from "fontkit";
import PDFDocument from "pdfkit";

// Ledger PDF (A4 landscape).
export type PdfLine = { time: string; dir: "IN" | "OUT"; dirLabel: string; name: string; address: string; amount: number; amountText: string; tx: string };
export type PdfInput = {
  locale: string;
  title: string;
  meta: [string, string][];         // label/value pairs under the title
  kpis: [string, string][];
  topTitle: string;
  topHead: string[];
  top: string[][];
  txTitle: string;
  txHead: string[];
  lines: PdfLine[];
  note?: string;
  footer: string;                   // "{page} / {pages}" style, filled per page
};

// Bundled fonts (assets/fonts, SIL OFL; traced into the export route via next.config.ts).
// Per character: Noto Sans (Latin, − … ·), then Noto Sans Thai, then Noto Sans SC/JP (Han/kana
// and symbols like ≥ ≤ →), else an ASCII stand-in. pdfkit embeds only the glyphs used.
type Face = "latin" | "thai" | "cjk";
const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
const FILES = {
  latin: ["NotoSans-Regular.ttf", "NotoSans-Bold.ttf"],
  thai: ["NotoSansThai-Regular.ttf", "NotoSansThai-Bold.ttf"],
  sc: ["NotoSansSC-Regular.otf", "NotoSansSC-Bold.otf"],
  jp: ["NotoSansJP-Regular.otf", "NotoSansJP-Bold.otf"],
} as const;
type Loaded = { buf: [Buffer, Buffer]; has: (cp: number) => boolean };
const fontCache = new Map<string, Loaded>();
function load(key: keyof typeof FILES): Loaded {
  const hit = fontCache.get(key);
  if (hit) return hit;
  const buf = FILES[key].map((f) => fs.readFileSync(path.join(FONT_DIR, f))) as [Buffer, Buffer];
  const font = fontkit.create(buf[0]) as fontkit.Font;
  const v = { buf, has: (cp: number) => font.hasGlyphForCodePoint(cp) };
  fontCache.set(key, v);
  return v;
}
const ASCII: Record<string, string> = { "≥": ">=", "≤": "<=", "→": "->", "←": "<-", "−": "-", "–": "-", "—": "-", "…": "...", "·": "-" };

const C = { text: "#121212", sub: "#5f5f5f", line: "#e3e3e3", band: "#f6f6f6", gold: "#b8892c", in: "#1a7f37", out: "#c4122a" };

export async function buildPdf(d: PdfInput): Promise<Buffer> {
  const all = [d.title, ...d.meta.flat(), ...d.kpis.flat(), d.topTitle, ...d.topHead, ...d.top.flat(), d.txTitle, ...d.txHead,
    ...d.lines.flatMap((l) => [l.time, l.dirLabel, l.name, l.address, l.amountText, l.tx]), d.note ?? "", d.footer].join("");
  const latin = load("latin"), thai = load("thai");
  // CJK font only when some character needs it (it is the large one).
  let cjk: Loaded | null = null;
  for (const ch of new Set(all)) {
    const cp = ch.codePointAt(0)!;
    if (cp > 32 && !latin.has(cp) && !thai.has(cp)) { cjk = load(d.locale === "ja" ? "jp" : "sc"); break; }
  }

  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true, info: { Title: d.title, Creator: "XCap Insight" } });
  doc.registerFont("latin-r", latin.buf[0]); doc.registerFont("latin-b", latin.buf[1]);
  doc.registerFont("thai-r", thai.buf[0]); doc.registerFont("thai-b", thai.buf[1]);
  if (cjk) { doc.registerFont("cjk-r", cjk.buf[0]); doc.registerFont("cjk-b", cjk.buf[1]); }
  const faceOf = (ch: string): Face | null => {
    const cp = ch.codePointAt(0)!;
    return latin.has(cp) ? "latin" : thai.has(cp) ? "thai" : cjk?.has(cp) ? "cjk" : null;
  };
  // Split into runs that each need one font; spaces/combining marks stay with the current run.
  const runs = (str: string) => {
    const out: { s: string; face: Face }[] = [];
    for (const raw of str) {
      let ch = raw, face = faceOf(ch);
      if (!face) { ch = ASCII[raw] ?? "?"; face = "latin"; }
      const last = out[out.length - 1];
      if (last && (last.face === face || ch === " " || (last.face === "thai" && thai.has(ch.codePointAt(0)!)))) last.s += ch;
      else out.push({ s: ch, face });
    }
    return out;
  };
  const setFont = (face: Face, bold?: boolean) => doc.font(`${face}-${bold ? "b" : "r"}`);
  const measure = (str: string, size: number, bold?: boolean) =>
    runs(str).reduce((w, r) => w + setFont(r.face, bold).fontSize(size).widthOfString(r.s), 0);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((ok) => doc.on("end", () => ok(Buffer.concat(chunks))));

  const L = doc.page.margins.left, W = doc.page.width - L - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 16;
  // One line of text, cut with "…" to fit `width`, mixed fonts drawn run by run.
  const text = (str: string, x: number, y: number, o: { size?: number; bold?: boolean; color?: string; width?: number; align?: "left" | "right" } = {}) => {
    const size = o.size ?? 9;
    let t = str;
    if (o.width && measure(t, size, o.bold) > o.width) {
      const chars = [...t];
      while (chars.length && measure(chars.join("") + "…", size, o.bold) > o.width) chars.pop();
      t = chars.join("") + "…";
    }
    let cx = o.align === "right" && o.width ? x + o.width - measure(t, size, o.bold) : x;
    doc.fillColor(o.color ?? C.text);
    for (const r of runs(t)) {
      setFont(r.face, o.bold).fontSize(size).text(r.s, cx, y, { lineBreak: false });
      cx += doc.widthOfString(r.s);
    }
  };

  // Header
  doc.rect(L, 36, 4, 22).fill(C.gold);
  text(d.title, L + 12, 36, { size: 18, bold: true });
  let y = 66;
  for (const [k, v] of d.meta) { text(k, L, y, { size: 9, color: C.sub, width: 110 }); text(v, L + 110, y, { size: 9, width: W - 110 }); y += 14; }

  // KPI cards
  y += 8;
  const kw = (W - 8 * (d.kpis.length - 1)) / d.kpis.length;
  d.kpis.forEach(([k, v], i) => {
    const x = L + i * (kw + 8);
    doc.roundedRect(x, y, kw, 48, 6).fill(C.band);
    text(k, x + 12, y + 8, { size: 8, color: C.sub, width: kw - 24 });
    text(v, x + 12, y + 22, { size: 14, bold: true, width: kw - 24 });
  });
  y += 64;

  // Table helper (repeats its header on each new page).
  const table = (title: string, head: string[], widths: number[], rows: { cells: string[]; colors?: (string | undefined)[] }[], align: ("left" | "right")[]) => {
    const drawHead = () => {
      doc.rect(L, y, W, 20).fill(C.band);
      let x = L;
      head.forEach((h, i) => { text(h, x + 6, y + 6, { size: 8, bold: true, color: C.sub, width: widths[i] - 12, align: align[i] }); x += widths[i]; });
      y += 20;
    };
    if (y + 60 > bottom()) { doc.addPage(); y = 36; }
    text(title, L, y, { size: 12, bold: true }); y += 20;
    drawHead();
    for (const row of rows) {
      if (y + 18 > bottom()) { doc.addPage(); y = 36; drawHead(); }
      let x = L;
      row.cells.forEach((c, i) => { text(c, x + 6, y + 5, { size: 8.5, width: widths[i] - 12, align: align[i], color: row.colors?.[i] }); x += widths[i]; });
      y += 18;
      doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.5).strokeColor(C.line).stroke();
    }
    y += 16;
  };

  if (d.top.length) table(d.topTitle, d.topHead, [W * 0.22, W * 0.12, W * 0.36, W * 0.12, W * 0.12, W * 0.06], d.top.map((cells) => ({ cells })), ["left", "left", "left", "right", "right", "right"]);
  table(d.txTitle, d.txHead, [W * 0.2, W * 0.06, W * 0.17, W * 0.3, W * 0.14, W * 0.13],
    d.lines.map((l) => ({ cells: [l.time, l.dirLabel, l.name, l.address, l.amountText, l.tx], colors: [undefined, undefined, undefined, C.sub, l.dir === "IN" ? C.in : C.out, C.sub] })),
    ["left", "left", "left", "left", "right", "left"]);
  if (d.note) text(d.note, L, y, { size: 8, color: C.sub });

  // Footer: page numbers.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const f = d.footer.replace("{page}", String(i + 1)).replace("{pages}", String(range.count));
    text(f, L, doc.page.height - 30, { size: 7.5, color: C.sub, width: W, align: "right" });
  }
  doc.end();
  return done;
}
