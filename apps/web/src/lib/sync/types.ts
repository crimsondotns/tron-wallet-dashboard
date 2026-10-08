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
export type Page = { items: RawTransfer[]; oldest: number | null; exhausted: boolean };

export type LabelType = "PERSON" | "EXCHANGE" | "DEX" | "CONTRACT";
export type PublicLabel = { address: string; name: string; type: LabelType };

export interface ChainProvider {
  id: string;
  label: string;
  defaultEndpoint: string;
  kinds: SyncKind[];
  pageSize: number;
  // `before` = only items at or before this ms timestamp; `offset` pages within that timestamp.
  fetchPage(cfg: ProviderConfig, address: string, kind: SyncKind, opts: { before: number | null; offset: number }): Promise<Page>;
  latestBlock(cfg: ProviderConfig): Promise<{ number: number; ts: number }>;
  // Public name/tag of an address from the explorer (exchange hot wallets, DEX routers, contracts).
  classifyAddress?(cfg: ProviderConfig, address: string): Promise<PublicLabel>;
}
