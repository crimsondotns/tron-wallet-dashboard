import type { ChainProvider, ProviderConfig, PublicLabel, RawTransfer } from "../types";
import { ProviderError, providerFetch } from "./http";

// Ported from scripts/sync.mjs (api / fetchPage). Tronscan allows browser CORS incl. TRON-PRO-API-KEY.
const DEFAULT_BASE = "https://apilist.tronscanapi.com/api";
const PAGE = 50;
type Row = { [k: string]: unknown };
const str = (v: unknown) => (v == null ? "" : String(v));

const api = (cfg: ProviderConfig, path: string) =>
  providerFetch(cfg, (cfg.endpoint || DEFAULT_BASE).replace(/\/+$/, "") + path,
    { headers: cfg.apiKey ? { "TRON-PRO-API-KEY": cfg.apiKey } : {} }, "Tronscan");

// Same keyword lists as scripts/sync.mjs.
const EXCHANGE_RE = /binance|okx|okex|huobi|htx|bybit|kucoin|gate\.?io|bitget|mexc|kraken|poloniex|bitfinex|coinbase|crypto\.com|bitkub|upbit|bithumb|hotbit|bingx|whitebit|exchange|hot ?wallet|deposit/i;
const DEX_RE = /sunswap|justswap|sun\.io|sunio|uniswap|pancake|swap|router|dex|liquidity|pool|lp token|curve|sunpump/i;

// Public tag from Tronscan (account tags; contract name for contracts). Ported from classify().
export async function tronscanClassify(cfg: ProviderConfig, address: string): Promise<PublicLabel> {
  const acc = await api(cfg, `/account?address=${address}`); // accountv2 now needs a key; account does not
  const tag = [acc.addressTag, acc.name].filter(Boolean).map(str).join(" ").trim();
  const isContract = acc.accountType === 2 || !!acc.contractInfo || !!acc.contract_type;
  if (EXCHANGE_RE.test(tag)) return { address, name: tag, type: "EXCHANGE" };
  if (DEX_RE.test(tag)) return { address, name: tag, type: "DEX" };
  if (!isContract) return { address, name: tag, type: "PERSON" };
  let name = "";
  try {
    const c = await api(cfg, `/contract?contract=${address}`);
    const row = ((c.data ?? []) as Row[])[0] ?? {};
    name = str(row.name || row.tag1);
  } catch { /* keep the account tag */ }
  name = name || tag;
  return { address, name, type: DEX_RE.test(name) ? "DEX" : "CONTRACT" };
}

export const tronscan: ChainProvider = {
  id: "tronscan",
  label: "Tronscan",
  defaultEndpoint: DEFAULT_BASE,
  kinds: ["native", "token"],
  pageSize: PAGE,

  async fetchPage(cfg, address, kind, { before, offset }) {
    const end = before != null ? `&end_timestamp=${before}` : "";
    let rows: Row[];
    let items: RawTransfer[];
    if (kind === "native") {
      const d = await api(cfg, `/transfer?address=${address}&sort=-timestamp&limit=${PAGE}&start=${offset}${end}`);
      rows = (d.data ?? []) as Row[];
      items = rows.map((t) => {
        const info = (t.tokenInfo ?? {}) as Row;
        const sym = str(info.tokenAbbr || "TRX");
        return {
          hash: str(t.transactionHash), log_index: -1, ts: Number(t.timestamp),
          from: str(t.transferFromAddress), to: str(t.transferToAddress),
          token_symbol: /^trx$/i.test(sym) ? "TRX" : sym, token_address: info.tokenId && info.tokenId !== "_" ? str(info.tokenId) : null,
          raw: str(t.amount).split(".")[0] || "0", decimals: Number(info.tokenDecimal ?? 6),
          status: t.confirmed ? "CONFIRMED" : "UNCONFIRMED",
        };
      });
    } else {
      const d = await api(cfg, `/token_trc20/transfers?relatedAddress=${address}&sort=-timestamp&limit=${PAGE}&start=${offset}${end}`);
      rows = (d.token_transfers ?? []) as Row[];
      items = rows.map((t) => {
        const info = (t.tokenInfo ?? {}) as Row;
        return {
          hash: str(t.transaction_id), log_index: Number(t.event_index ?? 0), ts: Number(t.block_ts),
          from: str(t.from_address), to: str(t.to_address),
          token_symbol: str(info.tokenAbbr || t.contract_address), token_address: str(t.contract_address) || null,
          raw: str(t.quant).split(".")[0] || "0", decimals: Number(info.tokenDecimal ?? 6),
          status: str(t.finalResult || (t.confirmed ? "CONFIRMED" : "UNCONFIRMED")),
        };
      });
    }
    return { items, oldest: items.length ? Math.min(...items.map((r) => r.ts)) : null, exhausted: rows.length < PAGE };
  },

  classifyAddress: tronscanClassify,

  async latestBlock(cfg) {
    const d = await api(cfg, `/block?sort=-number&limit=1&start=0`);
    const b = ((d.data ?? []) as Row[])[0];
    if (!b) throw new ProviderError("noBlock", {}, 400);
    return { number: Number(b.number), ts: Number(b.timestamp) };
  },
};
