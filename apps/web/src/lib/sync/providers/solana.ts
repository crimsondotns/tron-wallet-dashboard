import type { ChainProvider, Page, ProviderConfig, RawTransfer } from "../types";
import { ProviderError, providerFetch } from "./http";
import { associatedTokenAddress, SOLANA_ADDRESS_RE, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from "../solanaAddress";

// Any Solana JSON-RPC endpoint (Helius, QuickNode, Alchemy, Triton, ...). The keyless default is
// PublicNode: CORS enabled, but one getTransaction per batch and getTokenAccountsByOwner blocked.
// api.mainnet-beta.solana.com is not usable here: it answers 403 to any request with a browser
// Origin header (and to batches).
const DEFAULT_RPC = "https://solana-rpc.publicnode.com";
const PAGE = 25; // signatures per page; each costs one getTransaction call
const MAX_TOKEN_ACCOUNTS = 40; // bounds the per-page getSignaturesForAddress batch for SPL history
const SOL_RE = SOLANA_ADDRESS_RE;

// Well-known mints: symbol (no on-chain metadata lookup; other mints show a short form) and
// token program, used to derive ATAs when the RPC won't list a wallet's token accounts.
const KNOWN_MINTS: Record<string, { symbol: string; program?: string }> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC" },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT" },
  So11111111111111111111111111111111111111112: { symbol: "WSOL" },
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: { symbol: "JUP" },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { symbol: "BONK" },
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: { symbol: "WIF" },
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: { symbol: "MSOL" },
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: { symbol: "JITOSOL" },
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": { symbol: "RAY" },
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo": { symbol: "PYUSD", program: TOKEN_2022_PROGRAM },
};
export const solSymbol = (mint: string) => KNOWN_MINTS[mint]?.symbol ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`;

type Row = { [k: string]: unknown };
type Sig = { signature: string; slot: number; blockTime: number | null; transactionIndex?: number; err: unknown };
const str = (v: unknown) => (v == null ? "" : String(v));

// A key is sent as `?api-key=` (Helius style) unless the URL already carries it.
function url(cfg: ProviderConfig) {
  const u = new URL(cfg.endpoint || DEFAULT_RPC);
  if (cfg.apiKey && !u.searchParams.has("api-key")) u.searchParams.set("api-key", cfg.apiKey);
  return u.toString();
}

const GAP_MS = 50; // PublicNode served 10 parallel getTransaction calls (~40/s) without a 429
const PARALLEL = 4;
const post = (cfg: ProviderConfig, body: unknown) => providerFetch(cfg, url(cfg), {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}, "Solana RPC", GAP_MS);

async function rpc<T>(cfg: ProviderConfig, method: string, params: unknown[]): Promise<T> {
  const d = await post(cfg, { jsonrpc: "2.0", id: 1, method, params });
  if (d?.error) throw rpcError(d.error);
  return d.result as T;
}

function rpcError(e: unknown): ProviderError {
  const err = (e ?? {}) as Row;
  const code = Number(err.code);
  if (code === 429 || code === -32429) return new ProviderError("rate", { name: "Solana RPC", status: 429 }, 429, "rate");
  if (code === 401 || code === 403) return new ProviderError("auth", { name: "Solana RPC", status: code }, code, "auth");
  return new ProviderError("rpcFailed", { name: "Solana RPC", msg: str(err.message) || "error" }, 400);
}

// Calls one by one, a few in flight. Used for getTransaction: most keyless and free plans
// (PublicNode, Helius free) refuse it in a batch.
async function many<T>(cfg: ProviderConfig, calls: { method: string; params: unknown[] }[]): Promise<T[]> {
  const out: T[] = new Array(calls.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLEL, calls.length) }, async () => {
    while (next < calls.length) {
      const i = next++;
      out[i] = await rpc<T>(cfg, calls[i].method, calls[i].params);
    }
  }));
  return out;
}

const noBatch = new Set<string>(); // endpoints that rejected a JSON-RPC batch

// Cheap calls (signature lists, token accounts) in one HTTP request; falls back to `many`.
async function batch<T>(cfg: ProviderConfig, calls: { method: string; params: unknown[] }[]): Promise<T[]> {
  if (!calls.length) return [];
  const target = url(cfg);
  if (calls.length > 1 && !noBatch.has(target)) {
    let d: unknown;
    try {
      d = await post(cfg, calls.map((c, id) => ({ jsonrpc: "2.0", id, ...c })));
    } catch (e) {
      if (!(e instanceof ProviderError && e.status === 400)) throw e;
      d = null; // HTTP 400: batch not allowed here
    }
    if (Array.isArray(d)) {
      const byId = new Map<number, Row>(d.map((x: Row) => [Number(x.id), x]));
      return calls.map((_, i) => {
        const r = byId.get(i);
        if (!r) throw new ProviderError("rpcFailed", { name: "Solana RPC", msg: "missing batch item" }, 400);
        if (r.error) throw rpcError(r.error);
        return r.result as T;
      });
    }
    noBatch.add(target);
  }
  return many<T>(cfg, calls);
}

const sigsParams = (address: string, before?: string | null) =>
  [address, { limit: PAGE, commitment: "finalized", ...(before ? { before } : {}) }];
const txParams = (sig: string) => [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "finalized" }];
const msOf = (s: Sig) => (s.blockTime ?? 0) * 1000;

// Every parsed instruction (top level, then its inner ones) with a stable per-tx index.
function instructions(tx: Row): { ix: Row; index: number }[] {
  const msg = ((tx.transaction as Row)?.message ?? {}) as Row;
  const meta = (tx.meta ?? {}) as Row;
  const inner = new Map<number, Row[]>();
  for (const g of (meta.innerInstructions ?? []) as Row[]) inner.set(Number(g.index), (g.instructions ?? []) as Row[]);
  const out: { ix: Row; index: number }[] = [];
  ((msg.instructions ?? []) as Row[]).forEach((ix, i) => {
    out.push({ ix, index: i * 1000 });
    (inner.get(i) ?? []).forEach((x, j) => out.push({ ix: x, index: i * 1000 + j + 1 }));
  });
  return out;
}

// SOL (system program) and SPL (token / token-2022) transfers of one finalized transaction.
// The native kind (wallet's own signatures) yields both, the token kind (token-account
// signatures) only SPL; a row seen by both has the same dedup key, so it is stored once.
function parseTx(tx: Row | null, sig: Sig, kind: "native" | "token"): RawTransfer[] {
  if (!tx) return [];
  const meta = (tx.meta ?? {}) as Row;
  const ts = Number(tx.blockTime ?? sig.blockTime ?? 0) * 1000;
  const status = meta.err == null ? "SUCCESS" : "FAILED";
  const out: RawTransfer[] = [];
  // token account -> { owner, mint, decimals }, from the balance snapshots
  const accounts = (((tx.transaction as Row)?.message as Row)?.accountKeys ?? []) as Row[];
  const tokenAcc = new Map<string, { owner: string; mint: string; decimals: number }>();
  for (const b of [...((meta.preTokenBalances ?? []) as Row[]), ...((meta.postTokenBalances ?? []) as Row[])]) {
    const key = str(accounts[Number(b.accountIndex)]?.pubkey);
    if (key && b.owner) tokenAcc.set(key, { owner: str(b.owner), mint: str(b.mint), decimals: Number((b.uiTokenAmount as Row)?.decimals ?? 0) });
  }
  for (const { ix, index } of instructions(tx)) {
    const parsed = ix.parsed as Row | undefined;
    if (!parsed || typeof parsed !== "object") continue;
    const type = str(parsed.type);
    const info = (parsed.info ?? {}) as Row;
    if (kind === "native" && ix.program === "system" && (type === "transfer" || type === "transferWithSeed")) {
      out.push({
        hash: sig.signature, log_index: index, ts, from: str(info.source), to: str(info.destination),
        token_symbol: "SOL", token_address: null, raw: str(info.lamports) || "0", decimals: 9, status,
      });
    } else if ((ix.program === "spl-token" || ix.program === "spl-token-2022")
      && (type === "transfer" || type === "transferChecked")) {
      const src = tokenAcc.get(str(info.source)), dst = tokenAcc.get(str(info.destination));
      const mint = str(info.mint) || src?.mint || dst?.mint;
      if (!mint) continue;
      const amt = (info.tokenAmount ?? {}) as Row;
      out.push({
        hash: sig.signature, log_index: index, ts,
        // owners, not token accounts, so rows match the wallet; fall back to the authority / raw account
        from: src?.owner || str(info.authority || info.multisigAuthority) || str(info.source),
        to: dst?.owner || str(info.destination),
        token_symbol: solSymbol(mint), token_address: mint,
        raw: str(info.amount ?? amt.amount) || "0",
        decimals: Number(amt.decimals ?? src?.decimals ?? dst?.decimals ?? 0), status,
      });
    }
  }
  return out.filter((r) => SOL_RE.test(r.from) && SOL_RE.test(r.to) && /^[0-9]+$/.test(r.raw));
}

async function transfers(cfg: ProviderConfig, sigs: Sig[], kind: "native" | "token") {
  const txs = await many<Row | null>(cfg, sigs.map((s) => ({ method: "getTransaction", params: txParams(s.signature) })));
  return sigs.flatMap((s, i) => parseTx(txs[i], s, kind));
}

// Incoming SPL transfers touch the wallet's token accounts, not the wallet address, so the
// token kind merges the signature lists of its token accounts, newest first. Cursor = JSON
// { token account -> last signature taken } for accounts that still have older history.
// Endpoints that list token accounts (Helius, QuickNode, ...) cover every open account; keyless
// ones that block the call fall back to the derived ATAs of the well-known mints (a closed ATA
// keeps its signature history, so those are covered too). Other mints still arrive through the
// native kind whenever the wallet itself is in the transaction (sends, swaps, ATA creation).
const knownAtas = (owner: string) =>
  Promise.all(Object.entries(KNOWN_MINTS).map(([mint, m]) => associatedTokenAddress(owner, mint, m.program ?? TOKEN_PROGRAM)));

async function tokenAccounts(cfg: ProviderConfig, owner: string): Promise<string[]> {
  let listed: string[] = [];
  try {
    const lists = await batch<{ value: Row[] }>(cfg, [TOKEN_PROGRAM, TOKEN_2022_PROGRAM].map((programId) => ({
      method: "getTokenAccountsByOwner", params: [owner, { programId }, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }],
    })));
    listed = lists.flatMap((l) => (l?.value ?? []).map((a) => str(a.pubkey)));
  } catch (e) {
    // "Request blocked" / not on this plan: use the derived ATAs only
    if (!(e instanceof ProviderError) || (e.code !== "rpcFailed" && e.kind !== "auth")) throw e;
  }
  return [...new Set([...listed, ...(await knownAtas(owner))])].slice(0, MAX_TOKEN_ACCOUNTS);
}

async function tokenPage(cfg: ProviderConfig, address: string, cursor?: string): Promise<Page> {
  let state: Record<string, string | null>;
  if (cursor) state = JSON.parse(cursor);
  else state = Object.fromEntries((await tokenAccounts(cfg, address)).map((a) => [a, null]));
  const accs = Object.keys(state);
  const lists = await batch<Sig[]>(cfg, accs.map((a) => ({ method: "getSignaturesForAddress", params: sigsParams(a, state[a]) })));
  const all = accs.flatMap((a, i) => (lists[i] ?? []).map((s) => ({ a, s })));
  all.sort((x, y) => y.s.slot - x.s.slot || (y.s.transactionIndex ?? 0) - (x.s.transactionIndex ?? 0) || (x.s.signature < y.s.signature ? 1 : -1));
  const picked = new Map<string, Sig>();
  let taken = 0;
  for (const { s } of all) {
    if (!picked.has(s.signature) && picked.size === PAGE) break;
    picked.set(s.signature, s);
    taken++;
  }
  const consumed = all.slice(0, taken);
  const next: Record<string, string | null> = {};
  accs.forEach((a, i) => {
    const got = lists[i] ?? [];
    const mine = consumed.filter((x) => x.a === a);
    const last = mine.length ? mine[mine.length - 1].s.signature : state[a];
    if (mine.length < got.length || got.length === PAGE) next[a] = last; // still has older history
  });
  const sigs = [...picked.values()];
  const items = await transfers(cfg, sigs, "token");
  const times = sigs.map(msOf).filter((t) => t > 0);
  const exhausted = Object.keys(next).length === 0;
  return { items, oldest: times.length ? Math.min(...times) : null, exhausted, next: exhausted ? "" : JSON.stringify(next) };
}

export const solanaRpc: ChainProvider = {
  id: "solana_rpc",
  label: "Solana RPC",
  defaultEndpoint: DEFAULT_RPC,
  kinds: ["native", "token"],
  pageSize: PAGE,
  addressPattern: SOL_RE,

  // Pages by signature (`cursor` = last signature seen); `before` / `offset` are not used.
  async fetchPage(cfg, address, kind, { cursor }): Promise<Page> {
    if (kind === "token") return tokenPage(cfg, address, cursor);
    const sigs = await rpc<Sig[]>(cfg, "getSignaturesForAddress", sigsParams(address, cursor || null));
    const items = await transfers(cfg, sigs, "native");
    const times = sigs.map(msOf).filter((t) => t > 0);
    return {
      items, oldest: times.length ? Math.min(...times) : null, exhausted: sigs.length < PAGE,
      next: sigs.length ? sigs[sigs.length - 1].signature : (cursor ?? ""),
    };
  },

  async latestBlock(cfg) {
    const slot = await rpc<number>(cfg, "getSlot", [{ commitment: "finalized" }]);
    const t = await rpc<number | null>(cfg, "getBlockTime", [slot]);
    if (!slot) throw new ProviderError("noBlock", {}, 400);
    return { number: slot, ts: t ? t * 1000 : Date.now() };
  },
};
