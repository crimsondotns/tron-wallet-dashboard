import { fmt } from "@/i18n/config";
import type { Dict } from "@/i18n/dict";
import { en } from "@/i18n/dict/en";
import type { ProviderConfig } from "../types";

export type ErrorKind = "network" | "cors" | "auth" | "rate" | "server" | "bad_response" | "http";
export type ErrorCode = keyof Dict["err"];
type Vars = Record<string, string | number>;

// `code` + `vars` pick the user-facing text from the dictionary (see providerErrorText);
// `message` stays English for logs.
export class ProviderError extends Error {
  status?: number;
  kind: ErrorKind;
  code: ErrorCode;
  vars: Vars;
  constructor(code: ErrorCode, vars: Vars = {}, status?: number, kind: ErrorKind = "http") {
    super(fmt(en.err[code], vars));
    this.code = code;
    this.vars = vars;
    this.status = status;
    this.kind = kind;
  }
}

export const providerErrorText = (e: unknown, t: Dict) =>
  e instanceof ProviderError ? fmt(t.err[e.code], e.vars) : e instanceof Error ? e.message : String(e);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Optional observer for retries (rate limits, server errors, network), used by the sync log.
export type RetryInfo = { name: string; status: number; waitMs: number; attempt: number; of: number };
let onRetry: ((r: RetryInfo) => void) | null = null;
export function setRetryObserver(fn: ((r: RetryInfo) => void) | null) { onRetry = fn; }
const GAP_MS = 400; // keyless Tronscan allows 3 req/s and suspends the IP for 120 s when exceeded
const lastCall = new Map<string, number>();

// Quota pacing: hosts that report x-ratelimit-remaining / x-ratelimit-reset (Blockscout, in ms)
// are left alone until the window resets once the quota is nearly used, so we wait instead of
// collecting 429s. Waits longer than MAX_QUOTA_WAIT_MS end the run; the next run resumes.
const MAX_QUOTA_WAIT_MS = 90_000;
const readyAt = new Map<string, number>();
function quotaResetMs(h: Headers): number | null {
  const reset = Number(h.get("x-ratelimit-reset"));
  return h.has("x-ratelimit-reset") && reset > 0 && reset <= 3_600_000 ? reset : null; // ignore epoch-style values
}
function noteQuota(host: string, h: Headers) {
  const remaining = Number(h.get("x-ratelimit-remaining"));
  const reset = quotaResetMs(h);
  if (h.has("x-ratelimit-remaining") && remaining <= 1 && reset !== null) readyAt.set(host, Date.now() + reset + 250);
}

// fetch() rejects with a bare TypeError for both CORS blocks and unreachable hosts.
// A no-cors probe tells them apart: it resolves (opaque) if the server answered at all.
async function classifyNetworkError(url: string): Promise<ProviderError> {
  try {
    await fetch(url, { mode: "no-cors" });
    return new ProviderError("cors", {}, 0, "cors");
  } catch {
    return new ProviderError("network", {}, 0, "network");
  }
}

// Shared JSON fetch for providers: per-host spacing, retry with backoff on network/429/5xx,
// and errors classified so the UI can explain them. `gapMs` = minimum spacing per host.
export async function providerFetch(cfg: ProviderConfig, url: string, init: RequestInit, name: string, gapMs = GAP_MS) {
  const host = new URL(url).host;
  const retries = cfg.retries ?? 4;
  let last: ProviderError | null = null;
  for (let i = 0; i <= retries; i++) {
    const quotaWait = (readyAt.get(host) ?? 0) - Date.now();
    if (quotaWait > MAX_QUOTA_WAIT_MS) throw new ProviderError("rate", { name, status: 429 }, 429, "rate");
    const wait = Math.max(quotaWait, (lastCall.get(host) ?? 0) + gapMs - Date.now());
    if (wait > 0) await sleep(wait);
    lastCall.set(host, Date.now());
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch {
      last = await classifyNetworkError(url);
      if (last.kind === "cors") throw last;
      if (i < retries) { onRetry?.({ name, status: 0, waitMs: 1500 * 2 ** i, attempt: i + 1, of: retries }); await sleep(1500 * 2 ** i); }
      continue;
    }
    noteQuota(host, res.headers);
    if (res.ok) {
      try {
        return await res.json();
      } catch {
        throw new ProviderError("notJson", { name }, res.status, "bad_response");
      }
    }
    if (res.status === 401 || res.status === 403) throw new ProviderError("auth", { name, status: res.status }, res.status, "auth");
    if (res.status === 429 || res.status >= 500) {
      last = new ProviderError(res.status === 429 ? "rate" : "server", { name, status: res.status },
        res.status, res.status === 429 ? "rate" : "server");
      const ra = Number(res.headers.get("retry-after"));
      const reset = res.status === 429 ? quotaResetMs(res.headers) : null;
      const waitMs = reset !== null ? reset + 250 : ra > 0 ? ra * 1000 : Math.min(1500 * 2 ** i, 20000);
      if (waitMs > MAX_QUOTA_WAIT_MS) throw last;
      if (i < retries) { onRetry?.({ name, status: res.status, waitMs, attempt: i + 1, of: retries }); await sleep(waitMs); }
      continue;
    }
    if (res.status === 404) throw new ProviderError("notFound", { name }, 404, "http");
    throw new ProviderError("http", { name, status: res.status }, res.status, "http");
  }
  throw last ?? new ProviderError("noResponse", { name }, 0, "network");
}
