import type { SupabaseClient } from "@supabase/supabase-js";
import { tronscan } from "./providers/tronscan";
import { trongrid } from "./providers/trongrid";
import { ProviderError } from "./providers/http";
import type { ChainProvider, ProviderConfig, PublicLabel, RawTransfer, SyncKind } from "./types";

// Browser sync, same strategy as scripts/sync.mjs: first pull anything newer than what we
// have, then keep paging backwards until the first transaction. Each page goes to
// ingest_transfers; the lease keeps other open browsers off this wallet meanwhile.
export const PROVIDERS: Record<string, ChainProvider> = { tronscan, trongrid };

export type SyncWallet = { id: string; chain_id: string; address: string; label: string };
export type Progress = { wallet: SyncWallet; kind: SyncKind; pages: number; added: number; done: boolean };
type Cursor = { before: number | null; offset: number };

export async function syncWallet(
  db: SupabaseClient,
  wallet: SyncWallet,
  provider: ChainProvider,
  cfg: ProviderConfig,
  { deadline, onProgress }: { deadline: number; onProgress?: (p: Progress) => void },
) {
  for (const kind of provider.kinds) {
    if (Date.now() > deadline) return;
    const { data: claimed, error } = await db.rpc("claim_sync", { p_wallet: wallet.id, p_kind: kind });
    if (error) throw error;
    const cur = claimed?.[0];
    if (!cur) continue; // another browser is syncing this one

    let added = 0, pages = 0, failure: string | null = null;
    const push = async (rows: RawTransfer[], cursor: Cursor | null, done: boolean) => {
      const { data: n, error: e } = await db.rpc("ingest_transfers", {
        p_wallet: wallet.id, p_kind: kind, p_rows: rows, p_backfill_cursor: cursor, p_done: done,
      });
      if (e) throw e;
      added += n ?? 0;
      pages++;
      onProgress?.({ wallet, kind, pages, added, done });
    };

    try {
      // 1) Newer than what we already have. newest_ts only moves (advance_sync_head) once this
      //    pass has reached it; if the run stops halfway, the next run re-fetches the whole gap.
      const knownUntil = cur.newest_ts ? Date.parse(cur.newest_ts) : null;
      if (knownUntil) {
        let newest = knownUntil, reached = false;
        for (let offset = 0; Date.now() < deadline; offset += provider.pageSize) {
          const page = await provider.fetchPage(cfg, wallet.address, kind, { before: null, offset });
          if (page.items.length) await push(page.items, null, false);
          for (const r of page.items) if (r.ts > newest) newest = r.ts;
          if (page.exhausted || page.oldest === null || page.oldest <= knownUntil) { reached = true; break; }
        }
        if (reached && newest > knownUntil) {
          const { error: e } = await db.rpc("advance_sync_head", {
            p_wallet: wallet.id, p_kind: kind, p_newest_ts: new Date(newest).toISOString(),
          });
          if (e) throw e;
        }
      }
      // 2) Backfill to the very first transaction. If a whole page shares one timestamp, page by offset.
      let c: Cursor = (cur.backfill_cursor as Cursor | null) ?? { before: null, offset: 0 };
      let done = cur.done as boolean;
      while (!done && Date.now() < deadline) {
        const page = await provider.fetchPage(cfg, wallet.address, kind, c);
        if (page.oldest === null) { done = true; await push([], c, true); break; }
        const oldest = page.oldest;
        c = c.before !== null && oldest >= c.before ? { before: c.before, offset: c.offset + provider.pageSize } : { before: oldest, offset: 0 };
        done = page.exhausted && c.offset === 0;
        await push(page.items, c, done);
      }
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      await db.rpc("release_sync", { p_wallet: wallet.id, p_kind: kind, p_error: failure });
    }
  }
}

// After syncing: look up public names (exchange / DEX / contract tags) for the busiest
// counterparties that have no label yet, a few per run. Stored as source = 'auto'; manual
// labels are never touched. Addresses with no tag are stored too, so they aren't asked again.
export const LABELS_PER_RUN = 15;

export async function labelCounterparties(
  db: SupabaseClient,
  wallet: SyncWallet,
  provider: ChainProvider,
  cfg: ProviderConfig,
  { deadline, limit = LABELS_PER_RUN }: { deadline: number; limit?: number },
) {
  if (!provider.classifyAddress) return { checked: 0, named: 0 };
  const { data: todo, error } = await db.rpc("unlabeled_counterparties", { p_wallet: wallet.id, p_limit: limit });
  if (error) throw error;
  const found: PublicLabel[] = [];
  for (const address of (todo ?? []) as string[]) {
    if (Date.now() > deadline) break;
    try {
      found.push(await provider.classifyAddress(cfg, address));
    } catch (e) {
      if (e instanceof ProviderError && (e.status === 429 || e.kind === "network")) break; // rate limited / offline: next run
      // one bad address shouldn't stop the rest
    }
  }
  if (found.length) {
    const { error: e } = await db.rpc("save_auto_labels", { p_wallet: wallet.id, p_rows: found });
    if (e) throw e;
  }
  return { checked: found.length, named: found.filter((l) => l.name || l.type !== "PERSON").length };
}
