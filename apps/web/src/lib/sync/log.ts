// In-memory sync log shared by the runner and the log panel (kept across client navigation,
// last 200 lines). Read with useSyncExternalStore(subscribeLog, getLog, getServerLog).
export type LogTag = "run" | "ok" | "wait" | "fail" | "skip";
export type LogLine = { id: number; ts: number; tag: LogTag; text: string };

const MAX = 200;
const EMPTY: LogLine[] = [];
let lines: LogLine[] = EMPTY;
let seq = 0;
const listeners = new Set<() => void>();

export function log(tag: LogTag, text: string) {
  lines = [...lines.slice(-(MAX - 1)), { id: ++seq, ts: Date.now(), tag, text }];
  listeners.forEach((l) => l());
}
export function clearLog() {
  lines = EMPTY;
  listeners.forEach((l) => l());
}
export const getLog = () => lines;
export const getServerLog = () => EMPTY;
export function subscribeLog(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
