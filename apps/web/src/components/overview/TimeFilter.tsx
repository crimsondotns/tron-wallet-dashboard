"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useT, useTimeZone } from "@/i18n/client";
import { dayEndIso, dayIn, dayStartIso } from "@/i18n/tz";
import { useContainScroll } from "../useContainScroll";
import { usePopoverPlacement } from "../usePopoverPlacement";

// ISO instant ↔ <input type="date"> value, as a calendar day in the user's time zone. A start
// date means 00:00 of that day and an end date the end of that day, both in that zone.
export const toLocalInput = (iso: string | null, tz: string) => (!iso || Number.isNaN(Date.parse(iso)) ? "" : dayIn(iso, tz));
export { dayEndIso, dayStartIso };

// Funnel button in the Time header: from/to date popover that writes ?start=&end= (ISO).
export function TimeFilter({ start, end }: { start: string; end: string }) {
  const t = useT();
  const tz = useTimeZone();
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [bad, setBad] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  usePopoverPlacement(pop, open);
  useContainScroll(pop, pop, open);
  const active = !!(start || end);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    pop.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const go = (a: string, b: string) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of [["start", a], ["end", b]] as const) { if (v) p.set(k, v); else p.delete(k); }
    p.delete("page");
    setOpen(false);
    router.push(`${path}?${p}`);
  };

  return (
    <div className="th-filter" ref={root}>
      <button type="button" className={`th-icon${active ? " is-active" : ""}`} aria-haspopup="dialog" aria-expanded={open}
        aria-label={t.ov.filterTime} title={t.ov.filterTime} onClick={() => { setBad(false); setOpen((o) => !o); }}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2.5 3.5h11l-4.2 5v4l-2.6 1.2V8.5z" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div ref={pop} className="th-pop th-pop-left th-pop-time" role="dialog" aria-label={t.ov.filterTime}
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
          <form className="stack-sm" onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const a = dayStartIso(String(f.get("start") ?? ""), tz), b = dayEndIso(String(f.get("end") ?? ""), tz);
            if (a && b && a > b) { setBad(true); return; }
            go(a, b);
          }}>
            <span className="th-pop-title">{t.ov.filterTime}</span>
            <label className="th-pop-dt"><span>{t.ov.expFrom}</span><input className="input" type="date" name="start" defaultValue={toLocalInput(start, tz)} /></label>
            <label className="th-pop-dt"><span>{t.ov.expTo}</span><input className="input" type="date" name="end" defaultValue={toLocalInput(end, tz)} /></label>
            <p className={bad ? "error small" : "subdued caption"}>{bad ? t.ov.expBadRange : t.ov.expPeriodHint}</p>
            <div className="th-pop-actions">
              <button type="button" className="btn-ghost btn-sm" onClick={() => go("", "")}>{t.ov.clear}</button>
              <button className="btn-primary btn-sm">{t.ov.apply}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
