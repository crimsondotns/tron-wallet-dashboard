import { fmt, fmtDateTime, LOCALE_TAGS, type Locale } from "@/i18n/config";
import type { Dict } from "@/i18n/dict";
import { ProviderError, providerErrorText } from "./providers/http";
import type { ChainProvider, ProviderConfig, RawTransfer } from "./types";

export type StepStatus = "pending" | "running" | "pass" | "warn" | "fail" | "skip";
export type Step = { id: string; title: string; status: StepStatus; ms?: number; detail?: string; fix?: string };
export type Verdict = "ready" | "partial" | "failed";
export type Report = {
  steps: Step[];
  verdict: Verdict | null;
  block?: { number: number; lagSec: number };
  latency?: { p50: number; p95: number; rateLimited: number; samples: number };
  sample: RawTransfer[];
};

const STEP_IDS = ["config", "reach", "chain", "native", "token", "paging", "speed"] as const;
const STEP_TITLE = { config: "stepConfig", reach: "stepReach", chain: "stepChain", native: "stepNative", token: "stepToken", paging: "stepPaging", speed: "stepSpeed" } as const;
export const stepDefs = (t: Dict) => STEP_IDS.map((id) => ({ id, title: t.diag[STEP_TITLE[id]] }));

// Plain-language fix for each error kind, shown under a failed step.
function fixFor(e: unknown, provider: ChainProvider, t: Dict): string {
  const d = t.diag;
  if (!(e instanceof ProviderError)) return d.fixGeneric;
  switch (e.kind) {
    case "cors":
      // Known providers send CORS headers; a CORS failure there is a 429 without them.
      return provider.id === "trongrid" || provider.id === "tronscan" ? fmt(d.fixCorsKnown, { provider: provider.label }) : d.fixCors;
    case "network":
      return d.fixNetwork;
    case "auth":
      return d.fixAuth;
    case "rate":
      return provider.id === "trongrid" || provider.id === "tronscan" ? d.fixRateKey : d.fixRate;
    case "bad_response":
    case "http":
      return fmt(d.fixBadResponse, { provider: provider.label });
    case "server":
      return d.fixServer;
  }
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
};

// Runs every check in order, reporting each step as it finishes. Later steps are skipped
// once the endpoint is unreachable, since they would all fail for the same reason.
export async function diagnose(
  provider: ChainProvider,
  cfg: ProviderConfig,
  address: string,
  onUpdate: (r: Report) => void,
  { t, locale }: { t: Dict; locale: Locale },
): Promise<Report> {
  const d = t.diag;
  const date = (ms: number) => fmtDateTime(ms, locale);
  const fast: ProviderConfig = { ...cfg, retries: 0 };
  const r: Report = { steps: stepDefs(t).map((s) => ({ ...s, status: "pending" })), verdict: null, sample: [] };
  const emit = () => onUpdate({ ...r, steps: r.steps.map((s) => ({ ...s })) });
  const step = (id: string) => r.steps.find((s) => s.id === id)!;
  const run = async (id: string, fn: () => Promise<Partial<Step> | void>) => {
    const s = step(id);
    s.status = "running";
    emit();
    const t0 = performance.now();
    try {
      Object.assign(s, { status: "pass" }, (await fn()) ?? {});
    } catch (e) {
      Object.assign(s, { status: "fail", detail: providerErrorText(e, t), fix: fixFor(e, provider, t) });
    }
    s.ms = Math.round(performance.now() - t0);
    emit();
    return s.status;
  };
  const skipRest = (from: string, why: string) => {
    let on = false;
    for (const s of r.steps) {
      if (s.id === from) on = true;
      if (on && s.status === "pending") Object.assign(s, { status: "skip", detail: why });
    }
  };

  await run("config", async () => {
    const url = cfg.endpoint || provider.defaultEndpoint;
    let u: URL;
    try { u = new URL(url); } catch { throw new Error(fmt(d.badUrl, { url })); }
    if (u.protocol !== "https:") throw new Error(d.httpsOnly);
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) throw new Error(d.badAddress);
    if (!cfg.apiKey && !/[?/][A-Za-z0-9_-]{20,}/.test(u.pathname + u.search))
      return { status: "warn", detail: fmt(d.noKey, { host: u.host }), fix: d.noKeyFix };
    return { detail: u.host };
  });
  if (step("config").status === "fail") { skipRest("reach", d.skipConfig); r.verdict = "failed"; emit(); return r; }

  let blockTs = 0;
  await run("reach", async () => {
    const b = await provider.latestBlock(fast);
    blockTs = b.ts;
    r.block = { number: b.number, lagSec: Math.max(0, Math.round((Date.now() - b.ts) / 1000)) };
    return { detail: fmt(d.reachOk, { n: b.number.toLocaleString(LOCALE_TAGS[locale]) }) };
  });
  if (step("reach").status === "fail") { skipRest("chain", d.skipReach); r.verdict = "failed"; emit(); return r; }

  await run("chain", async () => {
    const lag = r.block!.lagSec;
    if (!blockTs || r.block!.number < 1_000_000) throw new Error(d.notMainnet);
    if (lag > 600) return { status: "fail", detail: fmt(d.staleFail, { min: Math.round(lag / 60) }), fix: d.staleFailFix };
    if (lag > 60) return { status: "warn", detail: fmt(d.staleWarn, { sec: lag }), fix: d.staleWarnFix };
    return { detail: fmt(d.chainOk, { sec: lag }) };
  });

  let oldestNative: number | null = null;
  await run("native", async () => {
    const p = await provider.fetchPage(fast, address, "native", { before: null, offset: 0 });
    oldestNative = p.oldest;
    r.sample.push(...p.items);
    if (!p.items.length && p.oldest === null) return { status: "warn", detail: d.nativeNone, fix: d.nativeNoneFix };
    return { detail: fmt(d.got, { n: p.items.length }) + (p.items.length ? fmt(d.latest, { date: date(Math.max(...p.items.map((i) => i.ts))) }) : "") };
  });

  await run("token", async () => {
    const p = await provider.fetchPage(fast, address, "token", { before: null, offset: 0 });
    r.sample.push(...p.items);
    if (!p.items.length) return { status: "warn", detail: d.tokenNone };
    const syms = [...new Set(p.items.map((i) => i.token_symbol))].slice(0, 4).join(", ");
    return { detail: `${fmt(d.got, { n: p.items.length })} · ${syms}` };
  });
  r.sample = r.sample.sort((a, b) => b.ts - a.ts).slice(0, 5);

  await run("paging", async () => {
    if (oldestNative === null) return { status: "skip", detail: d.pagingSkip };
    const p = await provider.fetchPage(fast, address, "native", { before: oldestNative, offset: 0 });
    if (p.oldest !== null && p.oldest > oldestNative) throw new Error(d.pagingWrong);
    return { detail: p.oldest === null ? d.pagingFirst : fmt(d.pagingBack, { date: date(p.oldest) }) };
  });

  await run("speed", async () => {
    const times: number[] = [];
    let limited = 0;
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      try { await provider.latestBlock(fast); times.push(performance.now() - t); }
      catch (e) { if (e instanceof ProviderError && e.kind === "rate") limited++; else throw e; }
    }
    if (!times.length) throw new ProviderError("rate", { name: provider.label }, 429, "rate");
    r.latency = { p50: pct(times, 50), p95: pct(times, 95), rateLimited: limited, samples: 5 };
    const det = fmt(d.speed, { p50: r.latency.p50, p95: r.latency.p95 }) + (limited ? fmt(d.speedLimited, { n: limited }) : "");
    if (limited) return { status: "warn", detail: det, fix: d.speedLimitedFix };
    if (r.latency.p95 > 3000) return { status: "warn", detail: det, fix: d.speedSlowFix };
    return { detail: det };
  });

  const st = r.steps.map((s) => s.status);
  r.verdict = st.includes("fail") ? (step("native").status === "pass" ? "partial" : "failed") : st.includes("warn") ? "partial" : "ready";
  emit();
  return r;
}

export function reportText(r: Report, meta: { provider: string; endpoint: string; address: string; hasKey: boolean }, t: Dict, locale: Locale): string {
  const d = t.diag;
  const icon: Record<StepStatus, string> = { pass: "✓", warn: "!", fail: "✗", skip: "–", pending: "·", running: "…" };
  const verdict = { ready: t.test.readyTitle, partial: t.test.partialTitle, failed: t.test.failedTitle };
  return [
    d.reportTitle,
    fmt(d.reportTime, { time: new Date().toLocaleString(LOCALE_TAGS[locale]) }),
    fmt(d.reportMeta, { provider: meta.provider, endpoint: meta.endpoint, key: meta.hasKey ? d.yes : d.no }),
    fmt(d.reportAddress, { address: meta.address }),
    fmt(d.reportVerdict, { verdict: r.verdict ? verdict[r.verdict] : "-" }),
    "",
    ...r.steps.map((s) => `${icon[s.status]} ${s.title}${s.ms != null ? ` (${s.ms} ms)` : ""}${s.detail ? ` — ${s.detail}` : ""}${s.fix ? `\n    ${fmt(d.reportFix, { fix: s.fix })}` : ""}`),
  ].join("\n");
}
