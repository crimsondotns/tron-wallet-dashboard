"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LOCALE_TAGS } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/client";
import { clearLog, CONSOLE_OPEN_EVENT, getLog, getServerLog, reportError, subscribeLog, type LogLine, type LogTag } from "@/lib/sync/log";
import { toast } from "./Toaster";
import { useContainScroll } from "./useContainScroll";

const TAG: Record<LogTag, { label: string; cls: string }> = {
  run: { label: "[ .. ]", cls: "c-running" },
  ok: { label: "[ OK ]", cls: "c-pass" },
  wait: { label: "[WAIT]", cls: "c-warn" },
  fail: { label: "[FAIL]", cls: "c-fail" },
  skip: { label: "[SKIP]", cls: "c-dim" },
};

// Floating console (bottom right, every page): sync progress, connection tests and app errors.
// Hidden until something is logged; collapses to a pill that shows a dot for unseen errors.
export function ConsoleCard() {
  const t = useT();
  const tag = LOCALE_TAGS[useLocale()];
  const lines = useSyncExternalStore(subscribeLog, getLog, getServerLog);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0); // last line id when the card was closed
  const card = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useContainScroll(card, body, open);
  const time = (ms: number) => new Date(ms).toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const source = (l: LogLine) => (l.source === "test" ? `${t.console.test} · ` : l.source === "app" ? `${t.console.app} · ` : "");

  // Uncaught errors land here too.
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportError("uncaught", e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => reportError("unhandled promise", e.reason);
    const onOpen = () => setOpen(true);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener(CONSOLE_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener(CONSOLE_OPEN_EVENT, onOpen);
    };
  }, []);

  const last = lines[lines.length - 1]?.id ?? 0;
  const close = () => { setOpen(false); setSeen(last); };
  // Follow new lines while the user is at the bottom.
  useEffect(() => {
    const el = body.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 48) el.scrollTop = el.scrollHeight;
  }, [lines, open]);

  const copy = async () => {
    const text = lines.map((l) => `${time(l.ts)} ${TAG[l.tag].label} ${source(l)}${l.text}${l.detail ? `\n${l.detail}` : ""}`).join("\n");
    await navigator.clipboard.writeText(text);
    toast(t.common.copied);
  };

  if (!lines.length) return null;
  const unseenError = !open && lines.some((l) => l.tag === "fail" && l.id > seen);
  const icon = (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M3 4.5l3.5 3.5L3 11.5M8.5 12h4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  if (!open) {
    return (
      <button type="button" className="console-fab" onClick={() => setOpen(true)} aria-label={unseenError ? `${t.console.show} · ${t.console.newErrors}` : t.console.show}>
        {icon}<span>{t.console.title}</span>
        {unseenError && <i className="console-fab-dot" aria-hidden="true" />}
      </button>
    );
  }
  return (
    <section ref={card} className="console-card" aria-label={t.console.title}>
      <header className="console-card-head">
        <span className="console-card-title">{icon}{t.console.title}</span>
        <span className="console-card-actions">
          <button type="button" className="btn-ghost btn-sm" onClick={copy}>{t.common.copy}</button>
          <button type="button" className="btn-ghost btn-sm" onClick={clearLog}>{t.sync.logClear}</button>
          <button type="button" className="icon-btn" onClick={close} aria-label={t.console.hide}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </span>
      </header>
      <div className="console console-card-body" ref={body} role="log" aria-label={t.console.title}>
        <div className="console-body">
          {lines.map((l) => (
            <div key={l.id} className="console-line">
              <span className="c-dim">{time(l.ts)}</span> <span className={`console-tag ${TAG[l.tag].cls}`}>{TAG[l.tag].label}</span> {source(l)}{l.text}
              {l.detail && <div className={`console-sub${l.tag === "fail" ? " c-fail" : ""}`}>{l.detail}</div>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
