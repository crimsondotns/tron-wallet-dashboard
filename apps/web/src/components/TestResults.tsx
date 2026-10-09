"use client";

import { fmt, fmtDateTime, LOCALE_TAGS } from "@/i18n/config";
import { useLocale, useT, useTimeZone } from "@/i18n/client";
import type { Report, Step } from "@/lib/sync/diagnose";
import { log, openConsole, type LogTag } from "@/lib/sync/log";
import { useEffect, useRef } from "react";

const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const fmtAmount = (raw: string, dec: number) => {
  const s = raw.padStart(dec + 1, "0");
  return Number(`${s.slice(0, s.length - dec)}.${s.slice(s.length - dec)}`).toLocaleString("en-US", { maximumFractionDigits: 4 });
};

const STEP_TAG: Record<string, LogTag> = { pass: "ok", warn: "wait", fail: "fail", skip: "skip" };
const VERDICT_TAG: Record<string, LogTag> = { ready: "ok", partial: "wait", failed: "fail" };

// Verdict + metrics and a sample of fetched rows. Each step is written to the Console card as it finishes.
export function TestResults({ report, steps, running, address, actions, command = "" }: {
  report: Report | null; steps: Step[]; running: boolean; address: string; actions?: React.ReactNode; command?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const tz = useTimeZone();
  const tag = LOCALE_TAGS[locale];
  const VERDICT = {
    ready: { title: t.test.readyTitle, text: t.test.readyText },
    partial: { title: t.test.partialTitle, text: t.test.partialText },
    failed: { title: t.test.failedTitle, text: t.test.failedText },
  };
  const done = steps.filter((s) => !["pending", "running"].includes(s.status)).length;

  const logged = useRef(new Set<string>());
  const wasRunning = useRef(false);
  useEffect(() => {
    if (running && !wasRunning.current) {
      logged.current = new Set();
      log("run", `xcap test ${command}`, "test");
      openConsole();
    }
    wasRunning.current = running;
    for (const s of steps) {
      if (!STEP_TAG[s.status] || logged.current.has(s.id)) continue;
      logged.current.add(s.id);
      const detail = [s.ms != null ? `${s.ms.toLocaleString()} ms` : "", s.detail, s.fix && `→ ${s.fix}`].filter(Boolean).join(" · ");
      log(STEP_TAG[s.status], s.title, "test", detail || undefined);
    }
    if (report?.verdict && !logged.current.has("#done")) {
      logged.current.add("#done");
      log(VERDICT_TAG[report.verdict], VERDICT[report.verdict].title, "test");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- VERDICT is derived from t
  }, [steps, running, report, command, t]);
  return (
    <div className="stack-lg" aria-live="polite">
      {report?.verdict ? (
        <div className={`verdict verdict-${report.verdict}`}>
          <div className="stack-sm">
            <h3>{VERDICT[report.verdict].title}</h3>
            <p className="subdued small">{VERDICT[report.verdict].text}</p>
          </div>
          <dl className="metrics">
            <div><dt>{t.test.block}</dt><dd>{report.block ? `#${report.block.number.toLocaleString(tag)}` : "—"}</dd></div>
            <div><dt>{t.test.lag}</dt><dd>{report.block ? fmt(t.test.lagValue, { n: report.block.lagSec }) : "—"}</dd></div>
            <div><dt>{t.test.avgSpeed}</dt><dd>{report.latency ? `${report.latency.p50} ms` : "—"}</dd></div>
            <div><dt>{t.test.rateLimited}</dt><dd>{report.latency ? `${report.latency.rateLimited}/${report.latency.samples}` : "—"}</dd></div>
          </dl>
          {actions}
        </div>
      ) : (
        <div className="verdict verdict-idle">
          <div className="stack-sm">
            <h3>{running ? fmt(t.test.running, { done, total: steps.length }) : t.test.idle}</h3>
            <p className="subdued small">{running ? t.test.runningText : t.test.idleText}</p>
          </div>
        </div>
      )}

      {!!report?.sample.length && (
        <div className="sample stack">
          <h3>{t.test.sample}</h3>
          <table>
            <thead><tr><th>{t.test.colTime}</th><th>{t.test.colDir}</th><th>{t.test.colAmount}</th><th>{t.test.colCounterparty}</th></tr></thead>
            <tbody>
              {report.sample.map((tr) => {
                const out = tr.from === address;
                return (
                  <tr key={`${tr.hash}-${tr.log_index}-${tr.token_symbol}`}>
                    <td className="small">{fmtDateTime(tr.ts, locale, tz)}</td>
                    <td>{out ? t.test.out : t.test.in}</td>
                    <td>{out ? "−" : "+"}{fmtAmount(tr.raw, tr.decimals)} {tr.token_symbol}</td>
                    <td className="mono" title={out ? tr.to : tr.from}>{short(out ? tr.to : tr.from)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
