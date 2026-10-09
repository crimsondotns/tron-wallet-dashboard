"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { fmt } from "@/i18n/config";
import { useLocale, useT, useTimeZone } from "@/i18n/client";
import { toast } from "../Toaster";
import { dayEndIso, dayStartIso, toLocalInput } from "./TimeFilter";

// Export button → dialog: file type, date period, and whether to apply the table's
// filters (counterparty, amount range, sort). Builds the file in the browser and downloads it.
export function ExportMenu({ wallet, rangeStart }: { wallet: string; rangeStart: string | null }) {
  const t = useT();
  const tz = useTimeZone();
  const locale = useLocale();
  const params = useSearchParams();
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<"xlsx" | "pdf">("xlsx");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [useTable, setUseTable] = useState(true);
  const [useNames, setUseNames] = useState(true);

  // The table's active filters, as shown to the user.
  const cp = params.get("cp"), min = params.get("min"), max = params.get("max");
  const sortAmount = params.get("sort") === "amount", asc = params.get("order") === "asc";
  const tableFilters = [
    cp && `${t.test.colCounterparty}: ${cp.length > 14 ? `${cp.slice(0, 6)}…${cp.slice(-4)}` : cp}`,
    min && `${t.test.colAmount} ≥ ${min}`,
    max && `${t.test.colAmount} ≤ ${max}`,
    (sortAmount || asc) && `${t.ov.expSort}: ${sortAmount ? t.test.colAmount : t.test.colTime} ${asc ? "↑" : "↓"}`,
  ].filter(Boolean) as string[];

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { d.showModal(); d.focus(); document.documentElement.classList.add("modal-open"); }
    else if (!open && d.open) d.close();
    return () => document.documentElement.classList.remove("modal-open");
  }, [open]);

  const show = () => {
    // Prefill the period from the page's range (user's time zone); empty = no bound.
    // The Time column's filter wins over the page range.
    const ts = params.get("start"), te = params.get("end");
    setStart(ts ? toLocalInput(ts, tz) : rangeStart ?? "");
    setEnd(te ? toLocalInput(te, tz) : "");
    setOpen(true);
  };

  const download = async () => {
    setBusy(true);
    const p = new URLSearchParams();
    for (const k of ["token", "range"]) { const v = params.get(k); if (v) p.set(k, v); }
    if (useTable) for (const k of ["cp", "min", "max", "sort", "order"]) { const v = params.get(k); if (v) p.set(k, v); }
    p.set("wallet", wallet); p.set("format", format);
    if (!useNames) p.set("names", "0");
    // Dates are days in the user's time zone; send absolute instants (start of first day, end of last).
    if (start) p.set("start", dayStartIso(start, tz));
    if (end) p.set("end", dayEndIso(end, tz));
    try {
      // Built in the browser (no server on GitHub Pages); ExcelJS/pdfkit load only on first export.
      const { exportOverview } = await import("@/lib/export/overview");
      const { blob, name } = await exportOverview(p, { t, locale, tz });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setOpen(false);
    } catch {
      toast(t.ov.expFail);
    } finally {
      setBusy(false);
    }
  };
  const bad = !!(start && end && start > end);
  const icon = <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 2.5v7.5M4.8 7L8 10.2 11.2 7M3 13.5h10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;

  return (
    <>
      <button type="button" className="btn-tertiary btn-sm export-btn" aria-haspopup="dialog" onClick={show}>{icon}{t.ov.export}</button>
      <dialog ref={ref} className="confirm export-dialog" tabIndex={-1} aria-labelledby="export-title"
        onClose={() => { document.documentElement.classList.remove("modal-open"); setOpen(false); }}
        onClick={(e) => { if (e.target === ref.current) ref.current.close(); }}>
        <form className="confirm-body" onSubmit={(e) => { e.preventDefault(); if (!bad) void download(); }}>
          <h2 id="export-title">{t.ov.export}</h2>
          <p className="subdued small">{t.ov.expHint}</p>

          <fieldset className="exp-field">
            <legend>{t.ov.expFormat}</legend>
            <div className="exp-seg" role="radiogroup" aria-label={t.ov.expFormat}>
              {(["xlsx", "pdf"] as const).map((f) => (
                <button key={f} type="button" role="radio" aria-checked={format === f} onClick={() => setFormat(f)}>
                  {f === "xlsx" ? t.ov.expXlsx : t.ov.expPdf}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="exp-field">
            <legend>{t.ov.expPeriod}</legend>
            <div className="exp-range">
              <label><span>{t.ov.expFrom}</span><input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
              <label><span>{t.ov.expTo}</span><input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} placeholder={t.ov.expNow} /></label>
            </div>
            <p className={bad ? "error small" : "subdued caption"}>{bad ? t.ov.expBadRange : t.ov.expPeriodHint}</p>
          </fieldset>

          <fieldset className="exp-field">
            <legend>{t.ov.expTableFilters}</legend>
            {tableFilters.length ? (
              <label className="exp-check">
                <input type="checkbox" checked={useTable} onChange={(e) => setUseTable(e.target.checked)} />
                <span>{fmt(t.ov.expUseTable, { n: tableFilters.length })}</span>
              </label>
            ) : <p className="subdued caption">{t.ov.expNoTable}</p>}
            {tableFilters.length > 0 && (
              <ul className={`exp-chips${useTable ? "" : " is-off"}`}>{tableFilters.map((f) => <li key={f}>{f}</li>)}</ul>
            )}
          </fieldset>

          <fieldset className="exp-field">
            <legend>{t.ov.expNames}</legend>
            <label className="exp-check">
              <input type="checkbox" checked={useNames} onChange={(e) => setUseNames(e.target.checked)} />
              <span>{t.ov.expUseNames}</span>
            </label>
            <p className="subdued caption">{useNames ? t.ov.expNamesOn : t.ov.expNamesOff}</p>
          </fieldset>

          <div className="confirm-actions">
            <button type="button" className="btn-tertiary" onClick={() => ref.current?.close()}>{t.common.cancel}</button>
            <button className="btn-primary" disabled={busy || bad}>{busy ? t.ov.expBusy : t.ov.expDownload}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
