"use client";

import { useSyncExternalStore } from "react";
import { useT } from "@/i18n/client";
import { isSyncBusy, requestSync, SYNC_STATE_EVENT } from "./SyncRunner";

const subscribe = (cb: () => void) => {
  window.addEventListener(SYNC_STATE_EVENT, cb);
  return () => window.removeEventListener(SYNC_STATE_EVENT, cb);
};

// "Sync now" for one wallet (or all). Disabled while any sync run is in progress.
export function SyncNowButton({ walletId, className = "btn-tertiary btn-sm" }: { walletId?: string; className?: string }) {
  const t = useT();
  const busy = useSyncExternalStore(subscribe, isSyncBusy, () => false);
  return (
    <button type="button" className={`${className} sync-now`} onClick={() => requestSync(walletId)} disabled={busy} aria-busy={busy}>
      <svg className={busy ? "spin" : undefined} viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M13.5 8a5.5 5.5 0 01-9.6 3.7M2.5 8a5.5 5.5 0 019.6-3.7M12.5 2v2.6H9.9M3.5 14v-2.6h2.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {busy ? t.sync.syncing : t.sync.syncNow}
    </button>
  );
}
