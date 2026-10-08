import { fmt, fmtDateTime, LOCALE_TAGS } from "@/i18n/config";
import { useLocale, useT, useTimeZone } from "@/i18n/client";
import type { Report, Step } from "@/lib/sync/diagnose";

const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const fmtAmount = (raw: string, dec: number) => {
  const s = raw.padStart(dec + 1, "0");
  return Number(`${s.slice(0, s.length - dec)}.${s.slice(s.length - dec)}`).toLocaleString("en-US", { maximumFractionDigits: 4 });
};

const TAG = {
  label: { pass: "[ OK ]", warn: "[WARN]", fail: "[FAIL]", skip: "[SKIP]", running: "[ .. ]", pending: "" },
  done: { ready: "c-pass", partial: "c-warn", failed: "c-fail" },
} as const;

// One console line per finished/running step; consecutive skipped steps collapse into one line.
function consoleLines(steps: Step[]) {
  const out: React.ReactNode[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.status === "pending") continue;
    if (s.status === "skip") {
      const group = [s];
      while (steps[i + 1]?.status === "skip") group.push(steps[++i]);
      out.push(
        <div key={s.id} className="console-line c-dim">
          <span className="console-tag">[SKIP]</span> {group.map((g) => g.title).join(" · ")}
          {group[0].detail && <div className="console-sub">{group[0].detail}</div>}
        </div>,
      );
      continue;
    }
    out.push(
      <div key={s.id} className="console-line">
        <span className={`console-tag c-${s.status}`}>{TAG.label[s.status]}</span> <b>{s.title}</b>
        {s.ms != null && <span className="c-dim"> ({s.ms.toLocaleString()} ms)</span>}
        {s.detail && <div className={`console-sub${s.status === "fail" ? " c-fail" : ""}`}>{s.detail}</div>}
        {s.fix && <div className="console-sub">→ {s.fix}</div>}
      </div>,
    );
  }
  return out;
}

// Verdict + metrics, the step checklist and a sample of fetched rows.
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

      {(running || report) && (
        <div className="console" role="log" aria-label={t.test.log}>
          <div className="console-bar">$ xcap test {command}</div>
          <div className="console-body">
            {consoleLines(steps)}
            {report?.verdict
              ? <div className="console-line"><span className={`console-tag ${TAG.done[report.verdict]}`}>[DONE]</span> <b>{VERDICT[report.verdict].title}</b></div>
              : running && <div className="console-line"><span className="console-cursor" aria-hidden="true" /></div>}
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
