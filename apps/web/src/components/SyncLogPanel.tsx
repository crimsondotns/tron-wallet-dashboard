"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LOCALE_TAGS } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/client";
import { clearLog, getLog, getServerLog, subscribeLog, type LogTag } from "@/lib/sync/log";

const TAG: Record<LogTag, { label: string; cls: string }> = {
  run: { label: "[ .. ]", cls: "c-running" },
  ok: { label: "[ OK ]", cls: "c-pass" },
  wait: { label: "[WAIT]", cls: "c-warn" },
  fail: { label: "[FAIL]", cls: "c-fail" },
  skip: { label: "[SKIP]", cls: "c-dim" },
};

// Current sync status line plus a collapsible console of what the sync is doing.
export function SyncLogPanel({ status }: { status: React.ReactNode }) {
  const t = useT();
  const tag = LOCALE_TAGS[useLocale()];
  const lines = useSyncExternalStore(subscribeLog, getLog, getServerLog);
  const [open, setOpen] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const time = (ms: number) => new Date(ms).toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

  // Follow new lines while the user is at the bottom.
  useEffect(() => {
    const el = body.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 48) el.scrollTop = el.scrollHeight;
  }, [lines, open]);

  if (!status && !lines.length) return null;
  return (
    <section className="sync-panel">
      <div className="sync-panel-head">
        <div className="sync-panel-status">{status ?? <span className="caption subdued">{t.sync.logTitle}</span>}</div>
        <button type="button" className="log-toggle" aria-expanded={open} aria-controls="sync-log" onClick={() => setOpen((o) => !o)}
          aria-label={open ? t.sync.logHide : t.sync.logShow} title={t.sync.logTitle}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M3 4.5l3.5 3.5L3 11.5M8.5 12h4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {open && (
        <div className="console sync-console" id="sync-log">
          <div className="console-bar"><span>$ xcap sync</span>
            {!!lines.length && <button type="button" className="btn-ghost btn-sm" onClick={clearLog}>{t.sync.logClear}</button>}
          </div>
          <div className="console-body" ref={body} role="log" aria-label={t.sync.logTitle}>
            {!lines.length && <div className="console-line c-dim">{t.sync.logEmpty}</div>}
            {lines.map((l) => (
              <div key={l.id} className="console-line">
                <span className="c-dim">{time(l.ts)}</span> <span className={`console-tag ${TAG[l.tag].cls}`}>{TAG[l.tag].label}</span> {l.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
