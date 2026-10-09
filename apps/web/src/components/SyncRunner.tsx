"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { fmt } from "@/i18n/config";
import { useT } from "@/i18n/client";
import { createClient } from "@/lib/supabase/client";
import { providerErrorText, setRetryObserver } from "@/lib/sync/providers/http";
import { PROVIDERS, labelCounterparties, syncWallet, type SyncWallet } from "@/lib/sync/engine";
import { toast } from "./Toaster";
import { OtpDialog } from "./OtpDialog";
import { SyncLogPanel } from "./SyncLogPanel";
import { log } from "@/lib/sync/log";

const RUN_BUDGET_MS = 90_000;      // per run, then yield
const INTERVAL_MS = 5 * 60_000;    // re-run while the page stays open

// Ask the mounted SyncRunner to sync now (one wallet, or all when omitted).
export function requestSync(walletId?: string) {
  window.dispatchEvent(new CustomEvent<string | undefined>(SYNC_EVENT, { detail: walletId }));
}
// Broadcast while a run is in progress, so "Sync now" buttons can disable themselves.
export const SYNC_STATE_EVENT = "xcap:sync-state";
const SYNC_EVENT = "xcap:sync";
let syncBusy = false;
export const isSyncBusy = () => syncBusy;
const setBusy = (busy: boolean) => {
  syncBusy = busy;
  window.dispatchEvent(new CustomEvent<boolean>(SYNC_STATE_EVENT, { detail: busy }));
};

// Syncs this org's wallets from the browser while a page that mounts it is open: on load,
// every few minutes, when the tab becomes visible, and on demand via requestSync().
// Mount only for org admins/owners: the database refuses sync calls from viewers (42501) and
// asks for an email OTP step-up (P0401) before handing out the provider key or a lease.
export function SyncRunner({ wallets, email }: { wallets: SyncWallet[]; email: string }) {
  const router = useRouter();
  const t = useT();
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);
  const [status, setStatus] = useState<{ text: string; tone: "idle" | "busy" | "error" | "setup" | "otp" }>({ text: "", tone: "idle" });
  const [otp, setOtp] = useState(false);
  const running = useRef(false);
  const key = wallets.map((w) => w.id).join(",");

  useEffect(() => {
    if (!wallets.length) return;
    const db = createClient();
    let stopped = false;

    const run = async (only?: string) => {
      const t = tRef.current;
      if (running.current || (document.hidden && !only)) return;
      running.current = true;
      setBusy(true);
      const targets = only ? wallets.filter((w) => w.id === only) : wallets;
      const started = Date.now();
      const deadline = started + RUN_BUDGET_MS;
      const name = (w: SyncWallet) => w.label || w.address.slice(0, 8);
      const kindName = (k: string) => (k === "native" ? t.sync.kindNative : t.sync.kindToken);
      let current = "";
      let added = 0;
      const seen = new Map<string, number>(); // progress counts are cumulative per wallet+kind
      log("run", fmt(t.sync.logRun, { n: targets.length }));
      setRetryObserver((r) => log("wait", fmt(t.sync.logRetry, { name: current || r.name, status: r.status || "—", sec: Math.round(r.waitMs / 1000), attempt: r.attempt, of: r.of })));
      try {
        for (const chain of [...new Set(targets.map((w) => w.chain_id))]) {
          const { data, error } = await db.rpc("my_provider_key", { p_chain: chain });
          if (error?.code === "P0401") { // step-up needed: wait for the user to verify a code
            setStatus({ text: t.sync.otpNeeded, tone: "otp" });
            log("skip", t.sync.otpNeeded);
            return;
          }
          if (error?.code === "42501") { setStatus({ text: "", tone: "idle" }); return; } // not an admin: read-only
          if (error) throw error;
          const conn = data?.[0];
          const provider = conn && PROVIDERS[conn.provider];
          if (!provider) {
            setStatus({ text: fmt(t.sync.setup, { chain: chain.toUpperCase() }), tone: "setup" });
            log("skip", fmt(t.sync.logNoConn, { chain: chain.toUpperCase() }));
            continue;
          }
          for (const w of targets.filter((x) => x.chain_id === chain)) {
            if (stopped || Date.now() > deadline) break;
            current = name(w);
            log("run", fmt(t.sync.logWallet, { name: current }));
            setStatus({ text: fmt(t.sync.busy, { name: w.label || w.address.slice(0, 8) }), tone: "busy" });
            await syncWallet(db, w, provider, { apiKey: conn.api_key, endpoint: conn.endpoint_url }, {
              deadline,
              onProgress: (p) => {
                const k = `${p.wallet.id}:${p.kind}`;
                added += p.added - (seen.get(k) ?? 0);
                seen.set(k, p.added);
                setStatus({ text: fmt(t.sync.progress, { name: current, pages: p.pages, added: p.added }), tone: "busy" });
                // Show new data while a long backfill runs (each kind done, or every 10 pages).
                if (p.done || p.pages % 10 === 0) router.refresh();
                if (p.done) log("ok", fmt(t.sync.logDone, { name: current, kind: kindName(p.kind) }));
                else log("run", fmt(t.sync.logPage, { name: current, kind: kindName(p.kind), pages: p.pages, added: p.added }));
              },
            });
            const cfg = { apiKey: conn.api_key, endpoint: conn.endpoint_url };
            try {
              const r = await labelCounterparties(db, w, provider, cfg, { deadline });
              if (r.checked) log("ok", fmt(t.sync.logLabels, { name: current, named: r.named, checked: r.checked }));
            } catch {
              // naming is best effort (viewers can't write labels); never fail the sync for it
            }
            router.refresh();
          }
        }
        setStatus((s) => (s.tone === "setup" ? s : { text: Date.now() > deadline ? t.sync.partial : t.sync.done, tone: "idle" }));
        const sec = Math.round((Date.now() - started) / 1000);
        if (Date.now() > deadline) log("wait", fmt(t.sync.logPaused, { sec }));
        log("ok", fmt(t.sync.logFinish, { added, sec }));
      } catch (e) {
        setStatus({ text: fmt(t.sync.failed, { msg: providerErrorText(e, t) }), tone: "error" });
        log("fail", fmt(t.sync.logError, { name: current || "—", msg: providerErrorText(e, t) }));
      } finally {
        setRetryObserver(null);
        running.current = false;
        setBusy(false);
        router.refresh();
      }
    };

    run();
    const t = setInterval(() => run(), INTERVAL_MS);
    const onVisible = () => { if (!document.hidden) run(); };
    // Manual "Sync now": one run at a time (the lease also stops other tabs fetching the same wallet).
    const onRequest = (e: Event) => {
      if (running.current) { toast(tRef.current.sync.alreadyRunning); return; }
      run((e as CustomEvent<string | undefined>).detail);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(SYNC_EVENT, onRequest);
    return () => {
      stopped = true; clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(SYNC_EVENT, onRequest);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <>
    <SyncLogPanel status={status.text ? (
      <span className={`sync-status sync-${status.tone}`} role="status">
        {status.tone === "busy" && <span className="bar bar-busy"><b /></span>}
        {status.text}
        {status.tone === "setup" && <> · <Link className="link" href="/connections">{t.sync.setupLink}</Link></>}
        {status.tone === "otp" && <> · <button type="button" className="link link-btn" onClick={() => setOtp(true)}>{t.sync.otpVerify}</button></>}
      </span>
    ) : null} />
    <OtpDialog open={otp} email={email} onClose={() => setOtp(false)} onVerified={() => { setOtp(false); requestSync(); }} />
    </>
  );
}
