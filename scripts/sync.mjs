/**
 * ดึงรายการ TRX + TRC20 ของทุก wallet จาก Tronscan ให้ครบตั้งแต่รายการแรก แล้วเขียน site/data/dashboard.json
 * รันใน GitHub Actions (ดู .github/workflows/sync.yml) หรือรันเองในเครื่อง:
 *   TRONSCAN_API_KEY=... GAS_URL=... node scripts/sync.mjs
 *
 * รอบแรก: ดึงย้อนหลังจนหมด (ถ้าเกินเวลา SYNC_BUDGET_MIN จะเก็บตำแหน่งไว้ใน data/state.json แล้วรอบถัดไปทำต่อ)
 * รอบถัดไป: ดึงเฉพาะรายการใหม่ + จัดประเภท address คู่ค้าที่ยังไม่รู้จัก
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const KEY = process.env.TRONSCAN_API_KEY;
const GAS_URL = process.env.GAS_URL;
const GAS_READ_KEY = process.env.GAS_READ_KEY || '';
// ตั้ง DASH_PASSWORD แล้วข้อมูลที่ขึ้นเว็บ/commit จะถูกเข้ารหัส (AES-256-GCM) อ่านได้เฉพาะคนที่มีรหัส
const PASS = process.env.DASH_PASSWORD || '';
const BUDGET_MS = (Number(process.env.SYNC_BUDGET_MIN) || 25) * 60 * 1000;
const CLASSIFY_MAX = Number(process.env.CLASSIFY_MAX) || 150;
const BASE = process.env.TRONSCAN_BASE || 'https://apilist.tronscanapi.com/api';
const PAGE = 50;
const API_GAP_MS = 250;
const OUT_FILE = 'site/data/dashboard';
const STATE_FILE = 'data/state';
const EXCHANGE_RE = /binance|okx|okex|huobi|htx|bybit|kucoin|gate\.?io|bitget|mexc|kraken|poloniex|bitfinex|coinbase|crypto\.com|bitkub|upbit|bithumb|hotbit|bingx|whitebit|exchange|hot ?wallet|deposit/i;
const DEX_RE = /sunswap|justswap|sun\.io|sunio|uniswap|pancake|swap|router|dex|liquidity|pool|lp token|curve|sunpump/i;

const t0 = Date.now();
const timeLeft = () => BUDGET_MS - (Date.now() - t0);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...a);
const fmtTs = ts => new Date(ts).toISOString().slice(0, 16).replace('T', ' ');

if (!KEY) { console.error('ไม่พบ TRONSCAN_API_KEY (ตั้งใน GitHub > Settings > Secrets and variables > Actions)'); process.exit(1); }
if (!GAS_URL) { console.error('ไม่พบ GAS_URL (ตั้งใน GitHub > Settings > Secrets and variables > Actions > Variables)'); process.exit(1); }

// ---------- Tronscan ----------
let lastCall = 0;
async function api(p) {
  for (let i = 0; i < 6; i++) {
    const wait = lastCall + API_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    let res;
    try { res = await fetch(BASE + p, { headers: { 'TRON-PRO-API-KEY': KEY } }); }
    catch (e) { log(`network error retry ${i + 1}: ${e.message}`); await sleep(2000 * 2 ** i); continue; }
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get('retry-after'));
      const backoff = ra > 0 ? ra * 1000 : Math.min(2000 * 2 ** i, 30000);
      log(`HTTP ${res.status} retry ${i + 1}/6 รอ ${backoff}ms`);
      await sleep(backoff);
      continue;
    }
    throw new Error(`Tronscan ${res.status}: ${(await res.text()).slice(0, 200)} (${p})`);
  }
  const err = new Error('Tronscan: retries exhausted ' + p);
  err.rateLimited = true;
  throw err;
}

async function fetchPage(kind, address, start, end) {
  const endQ = end != null ? `&end_timestamp=${end}` : '';
  if (kind === 'trx') {
    const d = await api(`/transfer?address=${address}&sort=-timestamp&limit=${PAGE}&start=${start}${endQ}`);
    return (d.data || []).map(t => {
      const dec = t.tokenInfo && t.tokenInfo.tokenDecimal != null ? t.tokenInfo.tokenDecimal : 6;
      return { hash: t.transactionHash, ts: t.timestamp, from: t.transferFromAddress, to: t.transferToAddress,
        token: String((t.tokenInfo && t.tokenInfo.tokenAbbr) || 'TRX').replace(/^trx$/i, 'TRX'),
        amount: Number(t.amount) / 10 ** dec, type: 'TRX', status: t.confirmed ? 'CONFIRMED' : 'UNCONFIRMED' };
    });
  }
  const d = await api(`/token_trc20/transfers?relatedAddress=${address}&sort=-timestamp&limit=${PAGE}&start=${start}${endQ}`);
  return (d.token_transfers || []).map(t => {
    const info = t.tokenInfo || {};
    const dec = info.tokenDecimal != null ? info.tokenDecimal : 6;
    return { hash: t.transaction_id, ts: t.block_ts, from: t.from_address, to: t.to_address,
      token: info.tokenAbbr || t.contract_address, amount: Number(t.quant) / 10 ** dec, type: 'TRC20',
      status: t.finalResult || (t.confirmed ? 'CONFIRMED' : 'UNCONFIRMED') };
  });
}

async function classify(address) {
  const acc = await api(`/accountv2?address=${address}`);
  const tag = [acc.addressTag, acc.name].filter(Boolean).join(' ');
  const isContract = acc.accountType === 2 || !!acc.contractInfo || !!acc.contract_type;
  if (EXCHANGE_RE.test(tag)) return { name: tag, type: 'EXCHANGE' };
  if (DEX_RE.test(tag)) return { name: tag, type: 'DEX' };
  if (!isContract) return { name: tag, type: 'PERSON' };
  try {
    const c = await api(`/contract?contract=${address}`);
    const name = (c.data && c.data[0] && (c.data[0].name || c.data[0].tag1)) || '';
    return { name: name || tag, type: DEX_RE.test(name) ? 'DEX' : 'CONTRACT' };
  } catch { return { name: tag, type: 'CONTRACT' }; }
}

// ---------- ไฟล์ ----------
// ไฟล์เข้ารหัส: "TWD1" + salt(16) + iv(12) + AES-256-GCM(gzip(JSON)) + tag(16)  ตรงกับฝั่งเว็บ (site/gas-shim.js)
const MAGIC = Buffer.from('TWD1');
const ITER = 310000;
const deriveKey = salt => crypto.pbkdf2Sync(PASS, salt, ITER, 32, 'sha256');
function encrypt(obj) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', deriveKey(salt), iv);
  const body = Buffer.concat([c.update(zlib.gzipSync(JSON.stringify(obj))), c.final(), c.getAuthTag()]);
  return Buffer.concat([MAGIC, salt, iv, body]);
}
function decrypt(buf) {
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error('ไฟล์เข้ารหัสไม่ถูกรูปแบบ');
  const salt = buf.subarray(4, 20), iv = buf.subarray(20, 32), body = buf.subarray(32);
  const d = crypto.createDecipheriv('aes-256-gcm', deriveKey(salt), iv);
  d.setAuthTag(body.subarray(body.length - 16));
  return JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()])));
}

/* base = path ไม่มีนามสกุล: มีรหัสใช้ base.bin (เข้ารหัส) ไม่มีรหัสใช้ base.json */
async function readData(base, fallback) {
  try {
    const bin = await fs.readFile(base + '.bin');
    if (!PASS) throw new Error(`พบ ${base}.bin แต่ไม่ได้ตั้ง DASH_PASSWORD`);
    try { return decrypt(bin); } catch (e) { throw new Error(`ถอดรหัส ${base}.bin ไม่ได้ (DASH_PASSWORD ไม่ตรงกับตอนเข้ารหัส?): ${e.message}`); }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  try { return JSON.parse(await fs.readFile(base + '.json', 'utf8')); } catch { return fallback; }
}
async function writeData(base, obj, pretty) {
  await fs.mkdir(path.dirname(base), { recursive: true });
  if (PASS) {
    await fs.writeFile(base + '.bin', encrypt(obj));
    await fs.rm(base + '.json', { force: true });
  } else {
    await fs.writeFile(base + '.json', JSON.stringify(obj, null, pretty ? 2 : 0) + '\n');
    await fs.rm(base + '.bin', { force: true });
  }
}

// ---------- main ----------
async function main() {
  // 1) รายชื่อ wallet + AddressBook จาก Google Sheet (ผ่าน GAS Web App)
  // GAS ตอบ 404/5xx ชั่วคราวได้บ้าง จึงลองใหม่ก่อนยอมแพ้
  let cfgRes;
  for (let i = 0; i < 4; i++) {
    cfgRes = await fetch(`${GAS_URL.trim()}?action=config&key=${encodeURIComponent(GAS_READ_KEY)}`, { redirect: 'follow' }).catch(e => ({ ok: false, status: e.message }));
    if (cfgRes.ok) break;
    log(`GAS config HTTP ${cfgRes.status} ลองใหม่ ${i + 1}/4`);
    await sleep(5000 * (i + 1));
  }
  if (!cfgRes.ok) throw new Error(`อ่าน config จาก GAS ไม่ได้: HTTP ${cfgRes.status} (ตรวจ GAS_URL = ${GAS_URL.trim().slice(0, 45)}… ต้องลงท้าย /exec และ deployment ยังไม่ถูกลบ)`);
  const cfg = await cfgRes.json().catch(() => { throw new Error('GAS ไม่ได้ตอบเป็น JSON: ตรวจว่า Deploy เป็น Web App (Anyone) และ code.gs เป็นเวอร์ชันล่าสุด'); });
  if (cfg.error === 'bad_key') throw new Error('GAS ปฏิเสธ: GAS_READ_KEY (GitHub Secret) ไม่ตรงกับ READ_KEY ใน Script Properties ของ GAS');
  const wallets = (cfg.wallets || []).filter(w => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(w.address));
  log(`wallets=${wallets.length}, addressBook=${Object.keys(cfg.book || {}).length}`);

  // 2) ข้อมูลเดิม
  const prev = await readData(OUT_FILE, { txs: [] });
  const state = await readData(STATE_FILE, { wallets: {}, auto: {} });
  const txs = prev.txs || [];
  const keyOf = t => [t.wallet, t.hash, t.token, t.from, t.to, t.amount].join('|');
  const seen = new Set(txs.map(keyOf));
  let added = 0;
  const add = (w, r) => {
    const dir = r.from === w.address && r.to === w.address ? 'SELF' : r.to === w.address ? 'IN' : 'OUT';
    const row = { ts: r.ts, label: w.label, wallet: w.address, dir, type: r.type, token: r.token, amount: r.amount,
      from: r.from, to: r.to, status: r.status, hash: r.hash };
    const k = keyOf(row);
    if (!r.hash || !Number.isFinite(r.ts) || seen.has(k)) return false;
    seen.add(k); txs.push(row); added++;
    return true;
  };

  // 3) ดึงรายการ: ใหม่ก่อน แล้วค่อยย้อนหลังจนหมด
  let outOfTime = false;
  for (const w of wallets) {
    for (const kind of ['trx', 'trc20']) {
      const ws = (state.wallets[w.address] ||= {});
      const s = (ws[kind] ||= { newest: 0, done: false, cursor: null, offset: 0, pages: 0 });
      // 3a) รายการใหม่ตั้งแต่รอบที่แล้ว
      if (s.newest) {
        const knownUntil = s.newest;
        for (let start = 0; timeLeft() > 60000; start += PAGE) {
          const page = await fetchPage(kind, w.address, start, null);
          if (!page.length) break;
          page.forEach(r => add(w, r));
          const times = page.map(r => r.ts);
          s.newest = Math.max(s.newest, ...times);
          /* หยุดเมื่อถึงรายการที่เคยดึงแล้ว (หรือหน้าสุดท้าย) */
          if (page.length < PAGE || Math.min(...times) <= knownUntil) break;
        }
      }
      // 3b) ย้อนหลังจนถึงรายการแรก (เลื่อน end_timestamp ลง ถ้าเวลาเท่าเดิมทั้งหน้าใช้ offset แทน)
      while (!s.done) {
        if (timeLeft() < 60000) { outOfTime = true; break; }
        const page = await fetchPage(kind, w.address, s.offset, s.cursor);
        s.pages++;
        if (!page.length) { s.done = true; break; }
        page.forEach(r => add(w, r));
        const oldest = Math.min(...page.map(r => r.ts));
        s.newest = Math.max(s.newest, ...page.map(r => r.ts));
        if (s.cursor !== null && oldest >= s.cursor) s.offset += PAGE;
        else { s.cursor = oldest; s.offset = 0; }
        if (page.length < PAGE && s.offset === 0) s.done = true;
      }
      log(`[${w.label}] ${kind.toUpperCase()} ${s.done ? 'ครบแล้ว' : 'ยังไม่ครบ'} · ย้อนถึง ${s.cursor ? fmtTs(s.cursor) : '-'} · ${s.pages} หน้า`);
      if (outOfTime) break;
    }
    if (outOfTime) break;
  }

  // 4) จัดประเภท address คู่ค้าที่ยังไม่รู้จัก (ใช้บ่อยก่อน)
  const tracked = new Set(wallets.map(w => w.address));
  const known = new Set([...Object.keys(cfg.book || {}), ...Object.keys(state.auto)]);
  const freq = new Map();
  txs.forEach(t => [t.from, t.to].forEach(a => { if (a && !tracked.has(a) && !known.has(a)) freq.set(a, (freq.get(a) || 0) + 1); }));
  const todo = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, CLASSIFY_MAX).map(e => e[0]);
  let classified = 0;
  for (const a of todo) {
    if (timeLeft() < 30000) break;
    try { state.auto[a] = await classify(a); classified++; }
    catch (e) { if (e.rateLimited) break; log(`classify ${a}: ${e.message}`); }
  }

  // 5) เขียนผล (เฉพาะ wallet ที่ยังอยู่ในชีต · ใช้ label ล่าสุดจากชีต)
  const labelOf = new Map(wallets.map(w => [w.address, w.label]));
  const outTxs = txs.filter(t => labelOf.has(t.wallet)).map(t => ({ ...t, label: labelOf.get(t.wallet) }))
    .sort((a, b) => a.ts - b.ts);
  const book = {};
  Object.entries(state.auto).forEach(([a, v]) => { book[a] = { name: v.name || '', type: v.type || 'PERSON' }; });
  Object.entries(cfg.book || {}).forEach(([a, v]) => { book[a] = { name: v.name || '', type: v.type || 'PERSON' }; });
  const pending = wallets.flatMap(w => ['trx', 'trc20'].filter(k => !(state.wallets[w.address] && state.wallets[w.address][k] && state.wallets[w.address][k].done)).map(k => `${w.label}/${k}`));
  const diag = { sheetRows: outTxs.length, read: outTxs.length, sent: outTxs.length, capped: 0, noHash: 0, badDate: 0,
    badDateRows: [], noHashRows: [], zeroAmount: outTxs.filter(t => !(t.amount > 0)).length, blankRows: 0,
    walletInvalid: (cfg.wallets || []).filter(w => !tracked.has(w.address)).map(w => `${w.label}: ${w.address}`),
    walletDup: [], walletBlank: 0, backfillPending: pending, source: 'github' };
  await writeData(OUT_FILE, { wallets: wallets.map(w => ({ label: w.label, address: w.address })), txs: outTxs, book, diag, generatedAt: Date.now() });
  await writeData(STATE_FILE, state, true);
  log(`เสร็จ: เพิ่ม ${added} รายการ · รวม ${outTxs.length} · จัดประเภท ${classified}/${todo.length} · ` +
    (pending.length ? `ยังดึงย้อนหลังไม่ครบ: ${pending.join(', ')} (รอบหน้าทำต่อ)` : 'ประวัติครบทุก wallet'));
}

main().catch(e => { console.error(e); process.exit(1); });
