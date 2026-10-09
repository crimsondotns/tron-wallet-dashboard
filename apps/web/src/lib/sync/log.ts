// In-memory app log shown in the Console card (bottom right): sync progress, connection tests
// and app errors. Kept across client navigation, last 200 lines.
// Read with useSyncExternalStore(subscribeLog, getLog, getServerLog).
export type LogTag = "run" | "ok" | "wait" | "fail" | "skip";
export type LogSource = "sync" | "test" | "app";
export type LogLine = { id: number; ts: number; tag: LogTag; text: string; source: LogSource; detail?: string };

const MAX = 200;
const EMPTY: LogLine[] = [];
let lines: LogLine[] = EMPTY;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function log(tag: LogTag, text: string, source: LogSource = "sync", detail?: string) {
  lines = [...lines.slice(-(MAX - 1)), { id: ++seq, ts: Date.now(), tag, text, source, detail }];
  emit();
}
export function clearLog() {
  lines = EMPTY;
  emit();
}
export const getLog = () => lines;
export const getServerLog = () => EMPTY;
export function subscribeLog(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

// An app error: still goes to the browser console, and to the Console card.
export function reportError(where: string, error?: unknown) {
  const e = error as { code?: string; message?: string } | undefined;
  const msg = [e?.code, e?.message ?? (error instanceof Error ? error.message : error != null ? String(error) : "")].filter(Boolean).join(" · ");
  console.error(`[${where}]`, error);
  log("fail", where, "app", msg || undefined);
}

// Ask the Console card to expand (e.g. when a connection test starts).
export const CONSOLE_OPEN_EVENT = "xcap:console-open";
export const openConsole = () => window.dispatchEvent(new Event(CONSOLE_OPEN_EVENT));
