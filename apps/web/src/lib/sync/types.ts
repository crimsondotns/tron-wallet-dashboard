export type SyncKind = "native" | "token";

// One transfer as pushed to ingest_transfers. Amounts stay as raw integer strings;
// the database scales by `decimals` so no precision is lost in JS.
export type RawTransfer = {
  hash: string;
  log_index: number;
  ts: number; // ms
  from: string;
  to: string;
  token_symbol: string;
  token_address: string | null;
  raw: string;
  decimals: number;
  status: string;
};

// retries: how many times to retry network/429/5xx (sync uses the default; diagnostics use 0).
export type ProviderConfig = { apiKey: string | null; endpoint: string | null; retries?: number };

// One newest-first page. `oldest` is the oldest timestamp the provider returned *before*
// filtering (so paging keeps moving even if every item was filtered out); `exhausted` means
// there is nothing older.
// `next` (optional): an opaque provider cursor for chains that page by id rather than by
// time (Solana signatures). When a provider returns it, the engine passes it back as
// `opts.cursor` and ignores `offset`.
export type Page = { items: RawTransfer[]; oldest: number | null; exhausted: boolean; next?: string };

export type LabelType = "PERSON" | "EXCHANGE" | "DEX" | "CONTRACT";
export type PublicLabel = { address: string; name: string; type: LabelType };

export interface ChainProvider {
  id: string;
  label: string;
  defaultEndpoint: string;
  kinds: SyncKind[];
  pageSize: number;
  // `before` = only items at or before this ms timestamp; `offset` pages within that timestamp.
  fetchPage(cfg: ProviderConfig, address: string, kind: SyncKind, opts: { before: number | null; offset: number; cursor?: string }): Promise<Page>;
  latestBlock(cfg: ProviderConfig): Promise<{ number: number; ts: number }>;
  // Public name/tag of an address from the explorer (exchange hot wallets, DEX routers, contracts).
  // Address format for this provider's chain (diagnostics); TRON base58 when omitted.
  addressPattern?: RegExp;
  classifyAddress?(cfg: ProviderConfig, address: string): Promise<PublicLabel>;
}
