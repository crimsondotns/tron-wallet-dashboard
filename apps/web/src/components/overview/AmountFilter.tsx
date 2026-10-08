"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { useContainScroll } from "../useContainScroll";
import { usePopoverPlacement } from "../usePopoverPlacement";

// Funnel button in the Amount header: min/max popover that writes ?min=&max= to the URL.
export function AmountFilter({ min, max }: { min: string; max: string }) {
  const t = useT();
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  usePopoverPlacement(pop, open);
  useContainScroll(pop, pop, open);
  const active = !!(min || max);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    pop.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const go = (lo: string, hi: string) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of [["min", lo], ["max", hi]] as const) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    p.delete("page");
    setOpen(false);
    router.push(`${path}?${p}`);
  };
  const clean = (v: FormDataEntryValue | null) => {
    const n = Number(String(v ?? "").replace(/,/g, ""));
    return String(v ?? "").trim() && Number.isFinite(n) && n >= 0 ? String(n) : "";
  };

  return (
    <div className="th-filter" ref={root}>
      <button type="button" className={`th-icon${active ? " is-active" : ""}`} aria-haspopup="dialog" aria-expanded={open}
        aria-label={t.ov.filterAmount} title={t.ov.filterAmount} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2.5 3.5h11l-4.2 5v4l-2.6 1.2V8.5z" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div ref={pop} className="th-pop" role="dialog" aria-label={t.ov.filterAmount}
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
          <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); go(clean(f.get("min")), clean(f.get("max"))); }}>
            <span className="th-pop-title">{t.ov.filterAmount}</span>
            <div className="th-pop-range">
              <input className="input" name="min" inputMode="decimal" defaultValue={min} placeholder={t.ov.min} aria-label={t.ov.min} />
              <span aria-hidden="true">–</span>
              <input className="input" name="max" inputMode="decimal" defaultValue={max} placeholder={t.ov.max} aria-label={t.ov.max} />
            </div>
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
