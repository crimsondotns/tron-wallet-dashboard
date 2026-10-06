/**
 * Tron Wallet Tracker (Google Apps Script)
 * บันทึก TRX + TRC20 transfers ของ wallet ลง Google Sheet (กันข้อมูลซ้ำด้วย tx hash)
 */

// ===== CONFIG =====
// รายชื่อ wallet อ่านจากชีต 'Wallet' (A = Label, B = Address, แถว 1 = header)
const WALLET_SHEET_NAME = 'Wallet';
const SHEET_NAME = 'Transactions';
// สมุดที่อยู่: A=Address, B=Name, C=Type (EXCHANGE/DEX/CONTRACT/PERSON), D=Source (auto/manual), E=Updated
// แก้ Type/Name เองได้ แล้วตั้ง Source = manual เพื่อไม่ให้ระบบเขียนทับ
const BOOK_SHEET_NAME = 'AddressBook';
const CLASSIFY_PER_RUN = 15; // จำนวน address ใหม่ที่จัดประเภทต่อรอบ (กัน rate limit)
const API_MIN_INTERVAL_MS = 400; // เว้นระยะระหว่าง request
const API_MAX_RETRIES = 5;
const EXCHANGE_RE = /binance|okx|okex|huobi|htx|bybit|kucoin|gate\.?io|bitget|mexc|kraken|poloniex|bitfinex|coinbase|crypto\.com|bitkub|upbit|bithumb|hotbit|bingx|whitebit|exchange|hot ?wallet|deposit/i;
const DEX_RE = /sunswap|justswap|sun\.io|sunio|uniswap|pancake|swap|router|dex|liquidity|pool|lp token|curve|sunpump/i;
const PAGE_LIMIT = 50;   // รายการต่อ request
const MAX_PAGES  = 4;    // ดึงย้อนหลังสูงสุดต่อรอบ (50 x 4 = 200 รายการ/ประเภท)
const BASE = 'https://apilist.tronscanapi.com/api';

const HEADERS = ['Time (UTC+7)', 'Label', 'Wallet', 'Direction', 'Type', 'Token',
                 'Amount', 'From', 'To', 'Status', 'Tx Hash', 'Link'];

// ===== SETUP: รันครั้งแรกครั้งเดียว =====
function setup() {
  // เก็บ API key ไว้ใน Script Properties (ไม่ต้อง hardcode ในโค้ด)
  PropertiesService.getScriptProperties()
    .setProperty('TRONSCAN_API_KEY', 'ใส่ TRONSCAN API KEY ตรงนี้ (อย่า commit key จริง)');

  getSheet_();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'trackAll')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('trackAll').timeBased().everyMinutes(5).create();
  trackAll();
}

// ===== MAIN =====
function trackAll() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { log_('WARN', 'trackAll', 'รอบก่อนยังไม่จบ ข้ามรอบนี้', true); return; }
  const t0 = Date.now();
  try {
    const wallets = getWallets_();
    log_('INFO', 'trackAll', 'เริ่มรอบ (' + wallets.length + ' wallets)', true);
    const sheet = getSheet_();
    const seen = getSeenKeys_(sheet);
    const rows = [];
    let errors = 0;

    wallets.forEach(w => {
      try {
        const trx = fetchTrxTransfers_(w);
        const trc20 = fetchTrc20Transfers_(w);
        let added = 0;
        trx.concat(trc20).forEach(r => {
          const key = r.hash + '|' + r.token + '|' + r.from + '|' + r.to + '|' + r.amount;
          if (seen.has(key)) return;
          seen.add(key);
          const row = toRow_(w, r);
          rows.push(row);
          added++;
          log_('INFO', 'newTx', `[${w.label}] ${row[3]} ${r.amount} ${r.token} ${r.hash}`);
        });
        log_('INFO', 'wallet', `[${w.label}] fetched TRX=${trx.length}, TRC20=${trc20.length}, new=${added}`);
      } catch (e) {
        errors++;
        log_('ERROR', 'wallet', `[${w.label}] ${e.message}`);
      }
    });
    toast_(`ดึงข้อมูลครบ ${wallets.length} wallets แล้ว กำลังจัดประเภท address…`, 'Tron Tracker', 5);

    if (rows.length) {
      rows.sort((a, b) => a[0] - b[0]); // เก่า -> ใหม่
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
    }
    try { classifyCounterparties_(sheet, wallets); }
    catch (e) { errors++; log_('ERROR', 'classify', e.message); }
    try { backfillEnsure_(wallets); }
    catch (e) { log_('WARN', 'backfill', 'ตั้งคิวดึงประวัติไม่ได้: ' + e.message); }
    log_(errors ? 'WARN' : 'INFO', 'trackAll',
      `จบรอบ: new=${rows.length}, errors=${errors}, ${Date.now() - t0}ms`, false);
    toast_(`เสร็จแล้ว: รายการใหม่ ${rows.length}` + (errors ? ` · error ${errors} (ดู Executions)` : '') +
      ` · ${((Date.now() - t0) / 1000).toFixed(1)}s`, errors ? 'Tron Tracker (มี error)' : 'Tron Tracker', errors ? 10 : 5);
  } catch (e) {
    log_('ERROR', 'trackAll', e.message + '\n' + (e.stack || ''));
    throw e;
  } finally {
    lock.releaseLock();
  }
}

// TRX (native) transfers
function fetchTrxTransfers_(w) {
  const out = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const url = `${BASE}/transfer?address=${w.address}&sort=-timestamp&limit=${PAGE_LIMIT}&start=${p * PAGE_LIMIT}`;
    const data = (api_(url).data) || [];
    data.forEach(t => {
      const dec = (t.tokenInfo && t.tokenInfo.tokenDecimal != null) ? t.tokenInfo.tokenDecimal : 6;
      out.push({
        hash: t.transactionHash,
        ts: t.timestamp,
        from: t.transferFromAddress,
        to: t.transferToAddress,
        token: String((t.tokenInfo && t.tokenInfo.tokenAbbr) || 'TRX').replace(/^trx$/i, 'TRX'),
        amount: Number(t.amount) / Math.pow(10, dec),
        type: 'TRX',
        status: t.confirmed ? 'CONFIRMED' : 'UNCONFIRMED',
      });
    });
    if (data.length < PAGE_LIMIT) break;
  }
  return out;
}

// TRC20 transfers (USDT ฯลฯ)
function fetchTrc20Transfers_(w) {
  const out = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const url = `${BASE}/token_trc20/transfers?relatedAddress=${w.address}&sort=-timestamp&limit=${PAGE_LIMIT}&start=${p * PAGE_LIMIT}`;
    const data = (api_(url).token_transfers) || [];
    data.forEach(t => {
      const info = t.tokenInfo || {};
      const dec = info.tokenDecimal != null ? info.tokenDecimal : 6;
      out.push({
        hash: t.transaction_id,
        ts: t.block_ts,
        from: t.from_address,
        to: t.to_address,
        token: info.tokenAbbr || t.contract_address,
        amount: Number(t.quant) / Math.pow(10, dec),
        type: 'TRC20',
        status: t.finalResult || (t.confirmed ? 'CONFIRMED' : 'UNCONFIRMED'),
      });
    });
    if (data.length < PAGE_LIMIT) break;
  }
  return out;
}

// ===== HELPERS =====
function getWallets_(stats) {
  stats = stats || {};
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(WALLET_SHEET_NAME);
  if (!sh) throw new Error(`ไม่พบชีต '${WALLET_SHEET_NAME}'`);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const seen = new Set();
  stats.walletRows = n; stats.walletInvalid = []; stats.walletDup = []; stats.walletBlank = 0;
  return sh.getRange(2, 1, n, 2).getValues()
    .map(([label, address]) => ({ label: String(label).trim(), address: String(address).trim() }))
    .filter(w => {
      if (!w.address) { stats.walletBlank++; return false; }
      if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(w.address)) {
        log_('WARN', 'wallet', `ข้าม address ไม่ถูกต้อง: '${w.address}' (${w.label})`);
        stats.walletInvalid.push(`${w.label || '-'}: ${w.address}`);
        return false;
      }
      if (seen.has(w.address)) { stats.walletDup.push(`${w.label || '-'}: ${w.address}`); return false; }
      seen.add(w.address);
      if (!w.label) w.label = w.address.slice(0, 6) + '…' + w.address.slice(-4);
      return true;
    });
}

let lastApiCall_ = 0;
function api_(url) {
  const key = PropertiesService.getScriptProperties().getProperty('TRONSCAN_API_KEY');
  if (!key) throw new Error('ไม่พบ TRONSCAN_API_KEY ใน Script Properties (รัน setup() ก่อน)');
  for (let i = 0; i < API_MAX_RETRIES; i++) {
    const wait = lastApiCall_ + API_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) Utilities.sleep(wait);
    lastApiCall_ = Date.now();
    const res = UrlFetchApp.fetch(url, {
      headers: { 'TRON-PRO-API-KEY': key },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code === 200) return JSON.parse(res.getContentText());
    if (code === 429 || code >= 500) {
      const ra = Number(res.getHeaders()['Retry-After'] || res.getHeaders()['retry-after']);
      const backoff = ra > 0 ? ra * 1000 : Math.min(2000 * Math.pow(2, i), 20000);
      log_('WARN', 'api', `HTTP ${code} retry ${i + 1}/${API_MAX_RETRIES} รอ ${backoff}ms: ${url}`);
      Utilities.sleep(backoff);
      continue;
    }
    throw new Error(`Tronscan ${code}: ${res.getContentText().slice(0, 200)}`);
  }
  const err = new Error('Tronscan: retries exhausted ' + url);
  err.rateLimited = true;
  throw err;
}

function toRow_(w, r) {
  const me = w.address;
  const dir = r.from === me && r.to === me ? 'SELF' : (r.to === me ? 'IN' : 'OUT');
  return [new Date(r.ts), w.label, me, dir, r.type, r.token, r.amount,
          r.from, r.to, r.status, r.hash, 'https://tronscan.org/#/transaction/' + r.hash];
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sh.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  }
  return sh;
}

function getSeenKeys_(sh) {
  const set = new Set();
  const n = sh.getLastRow() - 1;
  if (n < 1) return set;
  // From(H), To(I), Token(F), Amount(G), Hash(K)
  sh.getRange(2, 1, n, HEADERS.length).getValues().forEach(r => {
    set.add(r[10] + '|' + r[5] + '|' + r[7] + '|' + r[8] + '|' + r[6]);
  });
  return set;
}

// ===== จัดประเภท address (Exchange / DEX / Contract / Person) =====
function getBookSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(BOOK_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(BOOK_SHEET_NAME);
    sh.appendRow(['Address', 'Name', 'Type', 'Source', 'Updated']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 5).setFontWeight('bold');
    sh.getRange('C2:C').setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(['EXCHANGE', 'DEX', 'CONTRACT', 'PERSON'], true).build());
  }
  return sh;
}

function getBook_() {
  const sh = getBookSheet_();
  const map = new Map();
  const n = sh.getLastRow() - 1;
  if (n < 1) return map;
  sh.getRange(2, 1, n, 4).getValues().forEach(([address, name, type, source]) => {
    if (address) map.set(String(address).trim(), { name: String(name), type: String(type || 'PERSON'), source: String(source) });
  });
  return map;
}

function classifyCounterparties_(sheet, wallets) {
  const book = getBook_();
  const tracked = new Set(wallets.map(w => w.address));
  const n = sheet.getLastRow() - 1;
  if (n < 1) return;
  // นับความถี่ address คู่ค้า แล้วจัดประเภทตัวที่ใช้บ่อยก่อน
  const freq = new Map();
  sheet.getRange(2, 8, n, 2).getValues().forEach(([from, to]) => {
    [from, to].forEach(a => {
      if (a && !tracked.has(a) && !book.has(a)) freq.set(a, (freq.get(a) || 0) + 1);
    });
  });
  const todo = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, CLASSIFY_PER_RUN).map(e => e[0]);
  if (!todo.length) return;

  // จัดทีละตัว: ถ้าโดน rate limit ให้หยุดแล้วบันทึกเท่าที่ทำได้ รอบหน้าค่อยทำต่อ
  const rows = [];
  for (const a of todo) {
    try {
      const c = classifyAddress_(a);
      rows.push([a, c.name, c.type, 'auto', new Date()]);
    } catch (e) {
      if (e.rateLimited) { log_('WARN', 'classify', 'โดน rate limit หยุดไว้ก่อน ทำต่อรอบหน้า'); break; }
      log_('ERROR', 'classify', `${a}: ${e.message}`);
    }
  }
  if (!rows.length) return;
  const sh = getBookSheet_();
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
  const counts = rows.reduce((m, r) => (m[r[2]] = (m[r[2]] || 0) + 1, m), {});
  log_('INFO', 'classify', `จัดประเภท ${rows.length} address: ${JSON.stringify(counts)} (เหลือ ${freq.size - rows.length})`, true);
}

function classifyAddress_(address) {
  const acc = api_(`${BASE}/accountv2?address=${address}`);
  const tag = [acc.addressTag, acc.name].filter(Boolean).join(' ');
  const isContract = acc.accountType === 2 || !!acc.contractInfo || !!acc.contract_type;
  let type = 'PERSON';
  if (EXCHANGE_RE.test(tag)) type = 'EXCHANGE';
  else if (DEX_RE.test(tag)) type = 'DEX';
  else if (isContract) {
    // ลองดูชื่อ contract เพิ่มเติม
    try {
      const c = api_(`${BASE}/contract?contract=${address}`);
      const name = (c.data && c.data[0] && (c.data[0].name || (c.data[0].tag1 || ''))) || '';
      if (DEX_RE.test(name)) return { name: name || tag, type: 'DEX' };
      return { name: name || tag, type: 'CONTRACT' };
    } catch (e) { type = 'CONTRACT'; }
  }
  return { name: tag, type };
}

// ===== BACKFILL: ดึงประวัติทั้งหมดตั้งแต่ wallet เริ่มมีรายการ =====
// ดึงย้อนหลังทีละหน้า (ใหม่ -> เก่า) โดยเลื่อน end_timestamp ลงไปเรื่อย ๆ จนกว่า API จะไม่มีรายการเหลือ
// Apps Script รันได้ครั้งละ ~6 นาที จึงเก็บตำแหน่งไว้ใน Script Properties แล้วตั้ง trigger ให้มารันต่อเองจนครบ
const BACKFILL_KEY = 'BACKFILL_STATE';
const BACKFILL_DONE_KEY = 'BACKFILL_DONE';      // address ที่ดึงประวัติครบแล้ว (ใช้ตรวจ wallet ใหม่)
const BACKFILL_BUDGET_MS = 4.5 * 60 * 1000;     // เผื่อเวลาเขียนชีตก่อนชนเพดาน 6 นาที
const BACKFILL_FLUSH_ROWS = 500;                // เขียนลงชีตทุก ๆ กี่แถว

function backfillStart() {
  const wallets = getWallets_();
  if (!wallets.length) { toast_('ไม่มี wallet ในชีต Wallet', 'ดึงประวัติ', 8); return; }
  const state = { startedAt: Date.now(), added: 0, jobs: [] };
  wallets.forEach(w => ['trx', 'trc20'].forEach(kind =>
    state.jobs.push({ address: w.address, label: w.label, kind, cursor: null, offset: 0, pages: 0, done: false })));
  backfillSave_(state);
  log_('INFO', 'backfill', `เริ่มดึงประวัติทั้งหมด ${wallets.length} wallets (${state.jobs.length} งาน)`, true);
  backfillRun();
}

function backfillStop() {
  backfillClearTriggers_();
  PropertiesService.getScriptProperties().deleteProperty(BACKFILL_KEY);
  log_('INFO', 'backfill', 'หยุดดึงประวัติแล้ว (รายการที่ดึงมาแล้วยังอยู่ในชีต)', true);
}

function backfillStatus() {
  const st = backfillLoad_();
  if (!st) { toast_('ไม่มีงานดึงประวัติที่ค้างอยู่', 'ดึงประวัติ', 6); return; }
  const done = st.jobs.filter(j => j.done).length;
  const cur = st.jobs.find(j => !j.done);
  toast_(`เสร็จ ${done}/${st.jobs.length} งาน · เพิ่ม ${st.added} แถว` +
    (cur ? ` · กำลังทำ ${cur.label} (${cur.kind.toUpperCase()}) ถึง ${cur.cursor ? fmtTs_(cur.cursor) : 'ล่าสุด'}` : ''), 'ดึงประวัติ', 10);
}

// รันจากเมนู หรือจาก trigger (ทำต่อจากจุดที่ค้าง)
function backfillRun() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { backfillSchedule_(); return; }   // trackAll กำลังรัน: ไว้รอบหน้า
  const t0 = Date.now();
  let st;
  try {
    st = backfillLoad_();
    if (!st) { backfillClearTriggers_(); return; }
    const sheet = getSheet_();
    const seen = getSeenKeys_(sheet);
    let buffer = [];
    const flush = () => {
      if (!buffer.length) return;
      sheet.getRange(sheet.getLastRow() + 1, 1, buffer.length, HEADERS.length).setValues(buffer);
      st.added += buffer.length; buffer = [];
    };
    for (const job of st.jobs) {
      if (job.done) continue;
      while (!job.done && Date.now() - t0 < BACKFILL_BUDGET_MS) {
        const page = backfillPage_(job);
        job.pages++;
        if (!page.length) { job.done = true; break; }
        const w = { address: job.address, label: job.label };
        page.forEach(r => {
          const key = r.hash + '|' + r.token + '|' + r.from + '|' + r.to + '|' + r.amount;
          if (seen.has(key)) return;
          seen.add(key); buffer.push(toRow_(w, r));
        });
        const oldest = Math.min(...page.map(r => r.ts));
        // ถ้าทั้งหน้ามีเวลาเท่ากับ cursor เดิม (รายการเวลาเดียวกันเยอะ) ให้เลื่อนด้วย offset แทน กันวนไม่จบ
        if (job.cursor !== null && oldest >= job.cursor) job.offset += PAGE_LIMIT;
        else { job.cursor = oldest; job.offset = 0; }
        if (page.length < PAGE_LIMIT && job.offset === 0) job.done = true;
        if (buffer.length >= BACKFILL_FLUSH_ROWS) { flush(); backfillSave_(st); }
      }
      if (job.done) log_('INFO', 'backfill', `[${job.label}] ${job.kind.toUpperCase()} ครบแล้ว (${job.pages} หน้า, ย้อนถึง ${job.cursor ? fmtTs_(job.cursor) : '-'})`);
      if (Date.now() - t0 >= BACKFILL_BUDGET_MS) break;
    }
    flush();
    const remaining = st.jobs.filter(j => !j.done).length;
    if (remaining) {
      backfillSave_(st);
      backfillSchedule_();
      log_('INFO', 'backfill', `รอบนี้เพิ่ม ${st.added} แถวสะสม · เหลือ ${remaining} งาน · จะทำต่ออัตโนมัติใน 1 นาที`, true);
    } else {
      backfillFinish_(sheet, st);
    }
  } catch (e) {
    log_('ERROR', 'backfill', e.message + (e.rateLimited ? ' (จะลองใหม่รอบหน้า)' : ''));
    if (st) { backfillSave_(st); backfillSchedule_(); }
  } finally {
    lock.releaseLock();
  }
}

function backfillPage_(job) {
  const end = job.cursor !== null ? `&end_timestamp=${job.cursor}` : '';
  const start = `&start=${job.offset}`;
  if (job.kind === 'trx') {
    const url = `${BASE}/transfer?address=${job.address}&sort=-timestamp&limit=${PAGE_LIMIT}${start}${end}`;
    return ((api_(url).data) || []).map(t => {
      const dec = (t.tokenInfo && t.tokenInfo.tokenDecimal != null) ? t.tokenInfo.tokenDecimal : 6;
      return { hash: t.transactionHash, ts: t.timestamp, from: t.transferFromAddress, to: t.transferToAddress,
        token: String((t.tokenInfo && t.tokenInfo.tokenAbbr) || 'TRX').replace(/^trx$/i, 'TRX'),
        amount: Number(t.amount) / Math.pow(10, dec), type: 'TRX', status: t.confirmed ? 'CONFIRMED' : 'UNCONFIRMED' };
    });
  }
  const url = `${BASE}/token_trc20/transfers?relatedAddress=${job.address}&sort=-timestamp&limit=${PAGE_LIMIT}${start}${end}`;
  return ((api_(url).token_transfers) || []).map(t => {
    const info = t.tokenInfo || {};
    const dec = info.tokenDecimal != null ? info.tokenDecimal : 6;
    return { hash: t.transaction_id, ts: t.block_ts, from: t.from_address, to: t.to_address,
      token: info.tokenAbbr || t.contract_address, amount: Number(t.quant) / Math.pow(10, dec), type: 'TRC20',
      status: t.finalResult || (t.confirmed ? 'CONFIRMED' : 'UNCONFIRMED') };
  });
}

function backfillFinish_(sheet, st) {
  // แถวที่ดึงย้อนหลังถูกต่อท้ายชีต จึงเรียงใหม่ตามเวลา (เก่า -> ใหม่) ให้ Dashboard อ่านแถวล่าสุดได้ถูก
  const n = sheet.getLastRow() - 1;
  if (n > 1) sheet.getRange(2, 1, n, HEADERS.length).sort({ column: 1, ascending: true });
  const props = PropertiesService.getScriptProperties();
  const done = new Set(JSON.parse(props.getProperty(BACKFILL_DONE_KEY) || '[]'));
  st.jobs.forEach(j => done.add(j.address));
  props.setProperty(BACKFILL_DONE_KEY, JSON.stringify([...done]));
  props.deleteProperty(BACKFILL_KEY);
  backfillClearTriggers_();
  const mins = ((Date.now() - st.startedAt) / 60000).toFixed(1);
  log_('INFO', 'backfill', `ดึงประวัติครบทุก wallet แล้ว · เพิ่มทั้งหมด ${st.added} แถว · ใช้เวลา ${mins} นาที`, true);
}

// เรียกจาก trackAll: ถ้ามี wallet ใหม่ที่ยังไม่เคยดึงประวัติครบ ให้ตั้งคิวดึงให้อัตโนมัติ
function backfillEnsure_(wallets) {
  const props = PropertiesService.getScriptProperties();
  const done = new Set(JSON.parse(props.getProperty(BACKFILL_DONE_KEY) || '[]'));
  const todo = wallets.filter(w => !done.has(w.address));
  if (!todo.length) return;
  const st = backfillLoad_() || { startedAt: Date.now(), added: 0, jobs: [] };
  const queued = new Set(st.jobs.map(j => j.address + '|' + j.kind));
  let n = 0;
  todo.forEach(w => ['trx', 'trc20'].forEach(kind => {
    if (queued.has(w.address + '|' + kind)) return;
    st.jobs.push({ address: w.address, label: w.label, kind, cursor: null, offset: 0, pages: 0, done: false }); n++;
  }));
  if (!n) return;
  backfillSave_(st);
  backfillSchedule_();
  log_('INFO', 'backfill', `พบ wallet ที่ยังไม่มีประวัติครบ ${todo.length} ตัว ตั้งคิวดึงประวัติให้แล้ว`, true);
}

function backfillLoad_() {
  const raw = PropertiesService.getScriptProperties().getProperty(BACKFILL_KEY);
  return raw ? JSON.parse(raw) : null;
}
function backfillSave_(st) {
  PropertiesService.getScriptProperties().setProperty(BACKFILL_KEY, JSON.stringify(st));
}
function backfillSchedule_() {
  backfillClearTriggers_();
  ScriptApp.newTrigger('backfillRun').timeBased().after(60 * 1000).create();
}
function backfillClearTriggers_() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'backfillRun').forEach(t => ScriptApp.deleteTrigger(t));
}
function fmtTs_(ts) {
  return Utilities.formatDate(new Date(ts), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm');
}

// ===== DASHBOARD =====
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Tron Tracker')
    .addItem('เปิด Dashboard', 'showDashboard')
    .addItem('ดึงข้อมูลตอนนี้', 'trackAll')
    .addSeparator()
    .addItem('ดึงประวัติทั้งหมด (ตั้งแต่เปิด wallet)', 'backfillStart')
    .addItem('ดูความคืบหน้าการดึงประวัติ', 'backfillStatus')
    .addItem('หยุดดึงประวัติ', 'backfillStop')
    .addToUi();
}

function showDashboard() {
  const html = HtmlService.createHtmlOutputFromFile('Dashboard').setWidth(1400).setHeight(850);
  SpreadsheetApp.getUi().showModalDialog(html, 'Tron Wallet Dashboard');
}

// เปิดเป็น Web App ได้ด้วย (Deploy > New deployment > Web app · Execute as: Me · Who has access: Anyone)
// ?action=config = ส่งรายชื่อ wallet + AddressBook ให้ GitHub Actions (scripts/sync.mjs)
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'config') {
    /* ตั้ง READ_KEY ใน Script Properties แล้ว ต้องส่ง &key= ให้ตรง (ใส่ค่าเดียวกันใน GitHub Secret GAS_READ_KEY) */
    const readKey = PropertiesService.getScriptProperties().getProperty('READ_KEY');
    if (readKey && e.parameter.key !== readKey) return jsonOut_({ error: 'bad_key' });
    const book = {};
    getBook_().forEach((v, k) => { book[k] = { name: v.name, type: v.type, source: v.source }; });
    return jsonOut_({ wallets: getWallets_().map(w => ({ label: w.label, address: w.address })), book });
  }
  return HtmlService.createHtmlOutputFromFile('Dashboard')
    .setTitle('Tron Wallet Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ส่งข้อมูลให้หน้า Dashboard (ล่าสุดไม่เกิน 5,000 รายการ)
// ส่งกลับเป็น JSON string: google.script.run ส่ง object ที่มี Date/NaN ไม่ได้ (ฝั่งหน้าเว็บจะได้ null หรือค้าง)
function getDashboardData() {
  return JSON.stringify(getDashboardData_());
}

const DASHBOARD_MAX_ROWS = 20000;
function getDashboardData_() {
  const diag = { sheetRows: 0, read: 0, capped: 0, noHash: 0, badDate: 0, badDateRows: [], noHashRows: [],
                 zeroAmount: 0, blankRows: 0 };
  const wallets = getWallets_(diag);
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const txs = [];
  if (!sh) diag.noSheet = SHEET_NAME;
  if (sh && sh.getLastRow() > 1) {
    const n = sh.getLastRow() - 1;
    const take = Math.min(n, DASHBOARD_MAX_ROWS);
    const first = n - take + 2;
    diag.sheetRows = n; diag.read = take; diag.capped = n - take;
    sh.getRange(first, 1, take, HEADERS.length).getValues().forEach((r, i) => {
      const rowNo = first + i;
      if (r.every(v => v === '' || v == null)) { diag.blankRows++; return; }
      if (!r[10]) { diag.noHash++; if (diag.noHashRows.length < 10) diag.noHashRows.push(rowNo); return; }
      const ts = r[0] instanceof Date ? r[0].getTime() : new Date(r[0]).getTime();
      if (!isFinite(ts)) { diag.badDate++; if (diag.badDateRows.length < 10) diag.badDateRows.push(`${rowNo}: ${r[0]}`); return; }
      if (!(Number(r[6]) > 0)) diag.zeroAmount++;
      const str = v => String(v == null ? '' : v).trim();
      txs.push({
        ts, label: str(r[1]), wallet: str(r[2]), dir: str(r[3]), type: str(r[4]), token: str(r[5]),
        amount: Number(r[6]) || 0, from: str(r[7]), to: str(r[8]), status: str(r[9]), hash: str(r[10]),
      });
    });
  }
  const book = {};
  getBook_().forEach((v, k) => book[k] = { name: v.name, type: v.type });
  diag.sent = txs.length;
  log_(diag.capped || diag.noHash || diag.badDate ? 'WARN' : 'INFO', 'dashboard',
    `ชีตมี ${diag.sheetRows} แถว · อ่าน ${diag.read} · ส่ง ${diag.sent} · เกินเพดาน ${diag.capped} · ` +
    `ไม่มี hash ${diag.noHash} · วันที่ผิด ${diag.badDate} · แถวว่าง ${diag.blankRows}`, false);
  return { wallets, txs, book, diag, generatedAt: Date.now() };
}

// เรียกจาก Dashboard บน GitHub Pages (site/gas-shim.js): ต้องส่งรหัส EDIT_KEY ที่ตั้งไว้ใน Script Properties
function doPost(e) {
  try {
    const b = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const en = b.lang === 'en' || (b.payload && /"lang":"en"/.test(b.payload));
    const key = PropertiesService.getScriptProperties().getProperty('EDIT_KEY');
    if (!key) return jsonOut_({ error: 'no_key', message: en ? 'EDIT_KEY is not set in Script Properties' : 'ยังไม่ได้ตั้ง EDIT_KEY ใน Script Properties' });
    if (b.key !== key) return jsonOut_({ error: 'bad_key', message: en ? 'Wrong edit key' : 'รหัสแก้ไขไม่ถูกต้อง' });
    if (b.action === 'label') return jsonOut_({ result: setAddressLabel(b.address, b.name, b.type, b.lang) });
    if (b.action === 'export') return jsonOut_({ result: exportTxs(b.payload) });
    return jsonOut_({ error: 'unknown_action', message: 'Unknown action: ' + b.action });
  } catch (err) {
    log_('ERROR', 'doPost', err.message);
    return jsonOut_({ error: 'server', message: err.message });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ใช้ GitHub Actions ดึงข้อมูลแทน: ลบ trigger ของ trackAll / backfill ใน GAS (รันครั้งเดียวหลัง GitHub sync ทำงานแล้ว)
function useGithubSync() {
  ScriptApp.getProjectTriggers()
    .filter(t => ['trackAll', 'backfillRun'].includes(t.getHandlerFunction()))
    .forEach(t => ScriptApp.deleteTrigger(t));
  PropertiesService.getScriptProperties().deleteProperty(BACKFILL_KEY);
  log_('INFO', 'github', 'ปิดการดึงข้อมูลใน GAS แล้ว ตอนนี้ใช้ GitHub Actions ดึงแทน', true);
}

// เรียกจาก Dashboard: ตั้งชื่อ/ประเภท address ใน AddressBook (Source = manual, ระบบจะไม่เขียนทับ)
function setAddressLabel(address, name, type, lang) {
  const en = lang === 'en';
  address = String(address || '').trim();
  name = String(name || '').trim();
  type = String(type || 'PERSON').trim().toUpperCase();
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) throw new Error(en ? 'Invalid address' : 'Address ไม่ถูกต้อง');
  if (!['EXCHANGE', 'DEX', 'CONTRACT', 'PERSON'].includes(type)) throw new Error(en ? 'Invalid type' : 'Type ไม่ถูกต้อง');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = getBookSheet_();
    const n = sh.getLastRow() - 1;
    const row = [address, name, type, 'manual', new Date()];
    let idx = -1;
    if (n > 0) idx = sh.getRange(2, 1, n, 1).getValues().findIndex(r => String(r[0]).trim() === address);
    if (idx >= 0) sh.getRange(idx + 2, 1, 1, 5).setValues([row]);
    else sh.getRange(sh.getLastRow() + 1, 1, 1, 5).setValues([row]);
    log_('INFO', 'addressBook', `${idx >= 0 ? 'update' : 'add'} ${address} = ${name} (${type})`, true);
    return { address, name, type };
  } finally {
    lock.releaseLock();
  }
}

// ===== EXPORT =====
// เรียกจาก Dashboard: สร้าง Google Sheet ชั่วคราวจากรายการ แล้วคืนลิงก์ดาวน์โหลด .xlsx / .pdf
const EXPORT_FOLDER_NAME = 'Tron Dashboard Exports';
function exportTxs(payload) {
  const p = JSON.parse(payload);
  const format = p.format === 'pdf' ? 'pdf' : 'xlsx';
  const en = p.lang === 'en';
  const lb = p.labels || {};
  if (!Array.isArray(p.rows) || !p.rows.length) throw new Error(en ? 'No transactions to export' : 'ไม่มีรายการให้ Export');
  const t0 = Date.now();
  const name = `${p.fileTitle || p.title || 'Transactions'} ${Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HHmm')}`;
  const ss = SpreadsheetApp.create(name);
  const sh = ss.getSheets()[0].setName(en ? 'Transactions' : 'รายการ');
  writeLedger_(sh, p, format, lb);
  SpreadsheetApp.flush();

  const folders = DriveApp.getFoldersByName(EXPORT_FOLDER_NAME);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(EXPORT_FOLDER_NAME);
  DriveApp.getFileById(ss.getId()).moveTo(folder);

  let url = `https://docs.google.com/spreadsheets/d/${ss.getId()}/export?format=${format}`;
  if (format === 'pdf') url += '&size=A4&portrait=false&fitw=true&gridlines=false&sheetnames=false&printtitle=false' +
    '&fzr=true&pagenum=RIGHT&top_margin=0.5&bottom_margin=0.5&left_margin=0.5&right_margin=0.5&horizontal_alignment=CENTER';
  log_('INFO', 'export', `${format} ${p.rows.length} แถว -> ${name} (${Date.now() - t0}ms)`, true);
  return url;
}

// แบบ A · Ledger: หัวกระดาษ (ชื่อ + ตัวกรอง) → ตารางแถวสลับสี (เข้าเขียว / ออกแดง) → แถวรวมท้ายตาราง
const LEDGER = { ink: '#1a1a1a', muted: '#6b6b6b', zebra: '#f6f6f4', in: '#138a48', out: '#c23b3b', font: 'Sarabun' };
function writeLedger_(sh, p, format, lb) {
  const pdf = format === 'pdf';
  const scan = 'https://tronscan.org/#/transaction/';
  const shortHash = h => h.slice(0, 6) + '…' + h.slice(-4);
  const amountHead = `${lb.amount || 'Amount'} (${p.token})`;
  // PDF: คอลัมน์กระชับให้อ่านบนกระดาษ · Excel: ครบทุกช่องเพื่อเอาไปใช้ต่อ
  const header = pdf
    ? [lb.time, lb.from, lb.to, amountHead, 'Tx Hash']
    : [lb.time, lb.from, lb.fromAddr, lb.to, lb.toAddr, amountHead, 'Tx Hash', 'Link'];
  const amtCol = pdf ? 4 : 6;          // 1-based
  const hashCol = pdf ? 5 : 8;         // คอลัมน์ที่เป็นลิงก์
  const cols = header.length;
  const rows = p.rows.map(r => pdf
    ? [r.time, r.fromN, r.toN, r.amt, '']
    : [r.time, r.fromN, r.from, r.toN, r.to, r.amt, r.hash, '']);

  const HEAD = 5, first = HEAD + 1, n = rows.length, last = HEAD + n, totalRow = last + 1;
  const all = sh.getRange(1, 1, totalRow, cols);
  all.setFontFamily(LEDGER.font).setFontSize(10).setFontColor(LEDGER.ink).setVerticalAlignment('middle');

  // หัวกระดาษ
  sh.getRange(1, 1).setValue(p.title).setFontSize(16).setFontWeight('bold');
  sh.getRange(2, 1).setValue(p.subtitle || '').setFontColor(LEDGER.muted);
  sh.getRange(3, 1).setValue((p.meta || []).map(m => `${m[0]}: ${m[1]}`).join('   ·   ')).setFontSize(9).setFontColor(LEDGER.muted);
  sh.getRange(3, 1, 1, cols).setBorder(null, null, true, null, null, null, LEDGER.ink, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sh.setRowHeight(1, 30);
  sh.setRowHeight(4, 8);

  // หัวตาราง
  sh.getRange(HEAD, 1, 1, cols).setValues([header]).setFontWeight('bold').setFontSize(9).setFontColor(LEDGER.muted)
    .setBorder(null, null, true, null, null, null, LEDGER.ink, SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(HEAD, amtCol).setHorizontalAlignment('right');

  // ข้อมูล
  sh.getRange(first, 1, n, cols).setValues(rows);
  sh.getRange(first, hashCol, n, 1).setFormulas(p.rows.map(r =>
    [`=HYPERLINK("${scan}${r.hash}","${pdf ? shortHash(r.hash) : 'tronscan'}")`]));
  sh.getRange(first, hashCol, n, 1).setFontColor(LEDGER.muted).setFontFamily('Roboto Mono').setFontSize(9);
  if (!pdf) sh.getRange(first, 7, n, 1).setFontFamily('Roboto Mono').setFontSize(9);
  const amt = sh.getRange(first, amtCol, n, 1);
  amt.setNumberFormat('+#,##0.######;-#,##0.######;0').setHorizontalAlignment('right')
    .setFontColors(p.rows.map(r => [r.dir === 'IN' ? LEDGER.in : r.dir === 'OUT' ? LEDGER.out : LEDGER.ink]));
  sh.getRange(first, 1, n, cols).setBackgrounds(rows.map((_, i) => Array(cols).fill(i % 2 ? LEDGER.zebra : null)));
  sh.setRowHeights(first, n, 22);

  // แถวรวม
  const sumIn = p.rows.filter(r => r.dir === 'IN').reduce((a, r) => a + Math.abs(r.amt), 0);
  const sumOut = p.rows.filter(r => r.dir === 'OUT').reduce((a, r) => a + Math.abs(r.amt), 0);
  const fmtN = v => { const [i, d] = String(Math.round(v * 1e6) / 1e6).split('.'); return i.replace(/\B(?=(\d{3})+$)/g, ',') + (d ? '.' + d : ''); };
  sh.getRange(totalRow, 1).setValue(`${lb.total}  ·  ${lb.inflow} ${fmtN(sumIn)}  ·  ${lb.outflow} ${fmtN(sumOut)}`);
  sh.getRange(totalRow, amtCol).setFormula(`=SUMIF(${columnLetter_(amtCol)}${first}:${columnLetter_(amtCol)}${last},"<>")`)
    .setNumberFormat('+#,##0.######;-#,##0.######;0').setHorizontalAlignment('right');
  if (amtCol + 1 <= cols) sh.getRange(totalRow, amtCol + 1).setValue(lb.net).setFontColor(LEDGER.muted);
  sh.getRange(totalRow, 1, 1, cols).setFontWeight('bold')
    .setBorder(true, null, null, null, null, null, LEDGER.ink, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sh.setRowHeight(totalRow, 26);

  // ความกว้างคอลัมน์ / ตรึงหัว / ตัวกรอง
  sh.setHiddenGridlines(true);
  sh.setFrozenRows(HEAD);
  sh.autoResizeColumns(1, cols);
  for (let c = 1; c <= cols; c++) sh.setColumnWidth(c, Math.min(Math.max(sh.getColumnWidth(c) + 16, 90), 320));
  sh.setColumnWidth(1, Math.max(sh.getColumnWidth(1), 200));
  if (!pdf) sh.getRange(HEAD, 1, n + 1, cols).createFilter();
  if (sh.getMaxColumns() > cols) sh.deleteColumns(cols + 1, sh.getMaxColumns() - cols);
  if (sh.getMaxRows() > totalRow) sh.deleteRows(totalRow + 1, sh.getMaxRows() - totalRow);
}

function columnLetter_(c) {
  let s = '';
  for (; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + (c - 1) % 26) + s;
  return s;
}

// รันใน Editor เพื่อตรวจว่า Dashboard ได้ข้อมูลอะไร และใช้เวลาเท่าไร
function testDashboardData() {
  const t0 = Date.now();
  const d = JSON.parse(getDashboardData());
  const tokens = {};
  d.txs.forEach(t => tokens[t.token] = (tokens[t.token] || 0) + 1);
  const latest = d.txs.reduce((m, t) => Math.max(m, t.ts || 0), 0);
  log_('INFO', 'test', `wallets=${d.wallets.length}, txs=${d.txs.length}, book=${Object.keys(d.book).length}, ` +
    `size=${getDashboardData().length} bytes, ${Date.now() - t0}ms`);
  log_('INFO', 'test', 'tokens=' + JSON.stringify(tokens));
  log_('INFO', 'test', 'latest tx=' + (latest ? new Date(latest) : '-'));
  log_('INFO', 'test', 'sample=' + JSON.stringify(d.txs[0] || null));
}

// ===== LOGGING =====
// เขียน log ลง Executions / Cloud Logging และแสดง Toast ในชีต
// toast: true = แสดงเสมอ, false = ไม่แสดง, ไม่ระบุ = แสดงเฉพาะ ERROR
function log_(level, source, msg, toast) {
  const line = `[${level}] ${source}: ${msg}`;
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);
  if (toast === true || (toast === undefined && level === 'ERROR')) {
    const icon = level === 'ERROR' ? '[ERROR] ' : level === 'WARN' ? '[WARN] ' : '';
    toast_(icon + msg, `Tron Tracker · ${source}`, level === 'ERROR' ? 10 : 5);
  }
}

// Toast มุมขวาล่างของชีต (แสดงเฉพาะตอนเปิดชีตอยู่ ถ้ารันจาก trigger/web app จะข้ามเงียบ ๆ)
function toast_(msg, title, seconds) {
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(String(msg).slice(0, 300), title || 'Tron Tracker', seconds || 5);
  } catch (e) { /* ไม่มีชีตที่เปิดอยู่ */ }
}
