import { hexToBase58 } from "../tronAddress";
import type { ChainProvider, Page, ProviderConfig, RawTransfer } from "../types";
import { ProviderError, providerFetch } from "./http";
import { tronscanClassify } from "./tronscan";

// TronGrid v1 API. Also served by QuickNode / GetBlock / Chainstack TRON endpoints that
// expose the same /v1/accounts and /wallet paths, so a custom endpoint URL works here.
const DEFAULT_BASE = "https://api.trongrid.io";
const PAGE = 50;
const MAX_LIMIT = 200;
type Row = { [k: string]: unknown };
const str = (v: unknown) => (v == null ? "" : String(v));

const base = (cfg: ProviderConfig) => (cfg.endpoint || DEFAULT_BASE).replace(/\/+$/, "");
const headers = (cfg: ProviderConfig): Record<string, string> => (cfg.apiKey ? { "TRON-PRO-API-KEY": cfg.apiKey } : {});

async function get(cfg: ProviderConfig, path: string) {
  const d = await providerFetch(cfg, base(cfg) + path, { headers: headers(cfg) }, "TronGrid");
  if (d && d.success === false) throw new ProviderError("rpcFailed", { name: "TronGrid", msg: str(d.error) || "success=false" }, 400);
  return d;
}

export const trongrid: ChainProvider = {
  id: "trongrid",
  label: "TronGrid",
  defaultEndpoint: DEFAULT_BASE,
  kinds: ["native", "token"],
  pageSize: PAGE,

  // TronGrid pages by fingerprint, not offset: emulate the engine's offset by over-fetching.
  async fetchPage(cfg, address, kind, { before, offset }): Promise<Page> {
    const limit = Math.min(MAX_LIMIT, offset + PAGE);
    const maxTs = before != null ? `&max_timestamp=${before}` : "";
    const q = `limit=${limit}&only_confirmed=true&order_by=block_timestamp,desc${maxTs}`;
    if (kind === "token") {
      const d = await get(cfg, `/v1/accounts/${address}/transactions/trc20?${q}`);
      const rows = ((d.data ?? []) as Row[]).slice(offset);
      const items = rows.map((t): RawTransfer => {
        const info = (t.token_info ?? {}) as Row;
        return {
          hash: str(t.transaction_id), log_index: 0, ts: Number(t.block_timestamp),
          from: str(t.from), to: str(t.to), token_symbol: str(info.symbol || info.address),
          token_address: str(info.address) || null, raw: str(t.value).split(".")[0] || "0",
          decimals: Number(info.decimals ?? 6), status: "SUCCESS",
        };
      });
      return { items, oldest: items.length ? Math.min(...items.map((r) => r.ts)) : null, exhausted: rows.length < PAGE };
    }
    const d = await get(cfg, `/v1/accounts/${address}/transactions?${q}&search_internal=false`);
    const rows = ((d.data ?? []) as Row[]).slice(offset);
    const out: RawTransfer[] = [];
    for (const t of rows) {
      const raw = (t.raw_data ?? {}) as Row;
      const contract = ((raw.contract ?? []) as Row[])[0] ?? {};
      if (contract.type !== "TransferContract") continue; // TRX transfers only; TRC20 comes from the token endpoint
      const v = (((contract.parameter ?? {}) as Row).value ?? {}) as Row;
      const ret = ((t.ret ?? []) as Row[])[0] ?? {};
      out.push({
        hash: str(t.txID), log_index: -1, ts: Number(t.block_timestamp),
        from: hexToBase58(str(v.owner_address)), to: hexToBase58(str(v.to_address)),
        token_symbol: "TRX", token_address: null, raw: str(v.amount) || "0", decimals: 6,
        status: str(ret.contractRet || "SUCCESS"),
      });
    }
    // Paging follows the unfiltered rows, so a page of contract calls still moves the cursor back.
    const ts = rows.map((t) => Number(t.block_timestamp));
    return { items: out, oldest: ts.length ? Math.min(...ts) : null, exhausted: rows.length < PAGE };
  },

  // TronGrid has no address tags; public tags come from keyless Tronscan (rate-limited per host).
  classifyAddress: (cfg, address) => tronscanClassify({ apiKey: null, endpoint: null, retries: cfg.retries }, address),

  async latestBlock(cfg) {
    const d = await providerFetch(cfg, base(cfg) + "/wallet/getnowblock", { method: "POST", headers: headers(cfg) }, "TronGrid");
    const h = ((d.block_header ?? {}) as Row).raw_data as Row | undefined;
    if (!h) throw new ProviderError("noBlock", {}, 400);
    return { number: Number(h.number), ts: Number(h.timestamp) };
  },
};
