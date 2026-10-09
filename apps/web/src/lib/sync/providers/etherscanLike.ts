import { EVM_CHAIN_IDS } from "../address";
import type { ChainProvider, LabelType, Page, ProviderConfig, PublicLabel, RawTransfer, SyncKind } from "../types";
import { ProviderError, providerFetch } from "./http";

// EVM history through the Etherscan-style account API (module=account&action=txlist|tokentx),
// which Blockscout (keyless), Etherscan V2 (free key) and Routescan all serve. Plain JSON-RPC
// can't list an address's history, so this is the only shape used for EVM.
const PAGE = 100;
type Row = { [k: string]: unknown };
const str = (v: unknown) => (v == null ? "" : String(v));

const NATIVE: Record<string, string> = { ethereum: "ETH", bsc: "BNB", polygon: "POL", arbitrum: "ETH", base: "ETH", optimism: "ETH" };

// Public Blockscout instances (CORS: *). Keyless works but is tightly rate-limited per IP
// (10 requests per ~45 min observed); a free Blockscout key lifts that. BSC has none.
export const BLOCKSCOUT_DEFAULTS: Record<string, string> = {
  ethereum: "https://eth.blockscout.com/api",
  optimism: "https://explorer.optimism.io/api",
  base: "https://base.blockscout.com/api",
  arbitrum: "https://arbitrum.blockscout.com/api",
  polygon: "https://polygon.blockscout.com/api",
};
const ETHERSCAN_V2 = "https://api.etherscan.io/v2/api";
// Routescan: keyless 2 req/s, 10k calls/day (free key: 5 req/s, 100k/day). Of our chains it only serves Ethereum.
const ROUTESCAN = (chainId: number) => `https://api.routescan.io/v2/network/mainnet/evm/${chainId}/etherscan/api`;

const EXCHANGE_RE = /binance|okx|okex|huobi|htx|bybit|kucoin|gate\.?io|bitget|mexc|kraken|poloniex|bitfinex|coinbase|crypto\.com|bitkub|upbit|bithumb|bingx|whitebit|gemini|exchange|hot ?wallet|deposit/i;
const DEX_RE = /uniswap|pancake|sushi|curve|balancer|1inch|0x: exchange|aerodrome|velodrome|camelot|quickswap|swap|router|dex|liquidity|pool/i;

// Synthetic, provider-independent log index for token transfers: Blockscout's tokentx has no
// logIndex, and the dedup key already includes hash/symbol/from/to, so contract+value is enough.
function tokenLogIndex(contract: string, value: string) {
  let h = 2166136261;
  for (const c of contract + ":" + value) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h % 1_000_000_000;
}

type Flavor = { id: string; label: string; defaultBase: (chain: string) => string | null; chainParam: boolean };

function makeProvider(f: Flavor): ChainProvider {
  const base = (cfg: ProviderConfig) => {
    const b = cfg.endpoint || f.defaultBase(cfg.chain ?? "");
    if (!b) throw new ProviderError("noEndpoint", { name: f.label }, 0, "http");
    return b.replace(/\/+$/, "");
  };
  async function call(cfg: ProviderConfig, params: Record<string, string | number>) {
    const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    const chainId = EVM_CHAIN_IDS[cfg.chain ?? ""];
    if (f.chainParam && chainId) q.set("chainid", String(chainId));
    if (cfg.apiKey) q.set("apikey", cfg.apiKey);
    const b = base(cfg);
    const d = await providerFetch(cfg, `${b}${b.includes("?") ? "&" : "?"}${q}`, {}, f.label);
    if (d && str(d.status) === "0" && !Array.isArray(d.result)) {
      const msg = str(typeof d.result === "string" ? d.result : d.message) || "status=0";
      if (/rate limit/i.test(msg)) throw new ProviderError("rate", { name: f.label, status: 429 }, 429, "rate");
      if (/api ?key/i.test(msg)) throw new ProviderError("auth", { name: f.label, status: 401 }, 401, "auth");
      throw new ProviderError("rpcFailed", { name: f.label, msg }, 400);
    }
    return d;
  }

  // Engine cursors are timestamps; the API pages by block, so map `before` to the block at or before it.
  const blockAt = new Map<string, number>();
  const blockKey = (cfg: ProviderConfig, sec: number) => `${base(cfg)}|${cfg.chain}|${sec}`;
  async function blockBefore(cfg: ProviderConfig, ms: number) {
    const sec = Math.floor(ms / 1000);
    const k = blockKey(cfg, sec);
    if (!blockAt.has(k)) {
      const d = await call(cfg, { module: "block", action: "getblocknobytime", timestamp: sec, closest: "before" });
      const r = d.result as Row | string;
      const n = Number(typeof r === "object" && r ? r.blockNumber : r);
      if (!Number.isFinite(n)) throw new ProviderError("noBlock", {}, 400);
      blockAt.set(k, n);
    }
    return blockAt.get(k)!;
  }

  return {
    id: f.id,
    label: f.label,
    defaultEndpoint: f.defaultBase("ethereum") ?? "",
    defaultEndpointFor: (chain) => f.defaultBase(chain),
    kinds: ["native", "token"] as SyncKind[],
    pageSize: PAGE,

    async fetchPage(cfg, address, kind, { before, offset }): Promise<Page> {
      const addr = address.toLowerCase();
      const endblock = before != null ? await blockBefore(cfg, before) : 99_999_999_999;
      const d = await call(cfg, {
        module: "account", action: kind === "native" ? "txlist" : "tokentx", address: addr,
        startblock: 0, endblock, page: Math.floor(offset / PAGE) + 1, offset: PAGE, sort: "desc",
      });
      const rows = (Array.isArray(d.result) ? d.result : []) as Row[];
      const items: RawTransfer[] = [];
      for (const t of rows) {
        const from = str(t.from).toLowerCase(), to = str(t.to).toLowerCase();
        if (!from || !to) continue; // contract creation
        const ts = Number(t.timeStamp) * 1000;
        if (kind === "native") {
          const raw = str(t.value);
          if (!/^[0-9]+$/.test(raw) || /^0+$/.test(raw)) continue; // plain contract calls move no native coin
          const failed = str(t.isError) === "1" || str(t.txreceipt_status) === "0";
          items.push({ hash: str(t.hash), log_index: -1, ts, from, to, token_symbol: NATIVE[cfg.chain ?? ""] ?? "ETH",
            token_address: null, raw, decimals: 18, status: failed ? "FAILED" : "SUCCESS" });
        } else {
          const raw = str(t.value), contract = str(t.contractAddress).toLowerCase();
          if (!/^[0-9]+$/.test(raw)) continue;
          items.push({ hash: str(t.hash), log_index: tokenLogIndex(contract, raw), ts, from, to,
            token_symbol: str(t.tokenSymbol).trim().slice(0, 32) || contract, token_address: contract || null,
            raw, decimals: Number(t.tokenDecimal) || 0, status: "SUCCESS" });
        }
      }
      // Paging follows the unfiltered rows, so a page of zero-value calls still moves the cursor back.
      const ts = rows.map((t) => Number(t.timeStamp) * 1000).filter(Number.isFinite);
      // Remember the oldest row's block: the next page's `before` is its timestamp, so this saves a
      // getblocknobytime call (and is exact on chains with several blocks per second).
      const last = rows[rows.length - 1];
      if (last && Number(last.blockNumber) > 0) {
        const k = blockKey(cfg, Number(last.timeStamp));
        if (!blockAt.has(k)) blockAt.set(k, Number(last.blockNumber));
      }
      return { items, oldest: ts.length ? Math.min(...ts) : null, exhausted: rows.length < PAGE };
    },

    async latestBlock(cfg) {
      // A little in the past: explorers reject timestamps newer than their last indexed block.
      const n = await blockBefore(cfg, Date.now() - 20_000);
      const d = await call(cfg, { module: "block", action: "getblockreward", blockno: n });
      const ts = Number((d.result as Row | null)?.timeStamp) * 1000;
      if (!ts) throw new ProviderError("noBlock", {}, 400);
      return { number: n, ts };
    },

    // Public tags come from Blockscout's v2 API (keyless) on chains that have a default instance.
    async classifyAddress(cfg, address) {
      const b = BLOCKSCOUT_DEFAULTS[cfg.chain ?? ""];
      if (!b) return { address, name: "", type: "PERSON" };
      return blockscoutClassify({ apiKey: null, endpoint: null, retries: 0 }, b, address);
    },
  };
}

async function blockscoutClassify(cfg: ProviderConfig, apiBase: string, address: string): Promise<PublicLabel> {
  const a = (await providerFetch(cfg, `${apiBase}/v2/addresses/${address}`, {}, "Blockscout")) as Row;
  const tags = [
    ...((a.public_tags ?? []) as Row[]).map((x) => str(x.display_name || x.label)),
    ...(((a.metadata as Row | null)?.tags ?? []) as Row[]).map((x) => str(x.name)),
  ];
  const name = [str(a.name), ...tags].filter(Boolean).join(" ").trim().slice(0, 120);
  let type: LabelType = a.is_contract ? "CONTRACT" : "PERSON";
  if (EXCHANGE_RE.test(name)) type = "EXCHANGE";
  else if (DEX_RE.test(name)) type = "DEX";
  return { address, name, type };
}

export const blockscout = makeProvider({ id: "blockscout", label: "Blockscout", defaultBase: (c) => BLOCKSCOUT_DEFAULTS[c] ?? null, chainParam: false });
export const routescan = makeProvider({ id: "routescan", label: "Routescan", defaultBase: (c) => (c === "ethereum" ? ROUTESCAN(EVM_CHAIN_IDS[c]) : null), chainParam: false });
export const etherscan = makeProvider({ id: "etherscan", label: "Etherscan", defaultBase: () => ETHERSCAN_V2, chainParam: true });
