"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { Dropdown } from "../Dropdown";
import { useContainScroll } from "../useContainScroll";
import { usePopoverPlacement } from "../usePopoverPlacement";

// Funnel button in the Counterparty header: type (part of) an address, or pick a named
// counterparty / one of our wallets. Writes ?cp= to the URL.
export function CounterpartyFilter({ value, named }: { value: string; named: { address: string; name: string }[] }) {
  const t = useT();
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  usePopoverPlacement(pop, open);
  useContainScroll(pop, pop, open);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Node;
      if (!root.current?.contains(el)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    pop.current?.querySelector<HTMLInputElement>("input.input")?.focus();
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const go = (cp: string) => {
    const p = new URLSearchParams(params);
    const v = cp.replace(/[^A-Za-z0-9]/g, "");
    if (v) p.set("cp", v); else p.delete("cp");
    p.delete("page");
    setOpen(false);
    router.push(`${path}?${p}`);
  };
  const picked = named.find((n) => n.address === value);

  return (
    <div className="th-filter" ref={root}>
      <button type="button" className={`th-icon${value ? " is-active" : ""}`} aria-haspopup="dialog" aria-expanded={open}
        aria-label={t.ov.filterCp} title={t.ov.filterCp} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2.5 3.5h11l-4.2 5v4l-2.6 1.2V8.5z" fill={value ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div ref={pop} className="th-pop th-pop-left" role="dialog" aria-label={t.ov.filterCp}
          onKeyDown={(e) => { if (e.key === "Escape" && !(e.target as Element).closest(".dropdown")) setOpen(false); }}>
          <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); go(String(new FormData(e.currentTarget).get("cp") ?? "")); }}>
            <span className="th-pop-title">{t.ov.filterCp}</span>
            <input className="input" name="cp" defaultValue={picked ? "" : value} placeholder={t.ov.cpPh} aria-label={t.common.address}
              autoComplete="off" spellCheck={false} maxLength={64} />
            {named.length > 0 && (
              <Dropdown name="cp_label" label={t.ov.cpByName} placeholder={t.ov.cpByName} defaultValue={picked?.address ?? ""}
                options={named.map((n) => ({ value: n.address, label: n.name }))} onChange={(v) => go(v)}
                searchable searchPlaceholder={t.ov.cpSearch} />
            )}
            <div className="th-pop-actions">
              <button type="button" className="btn-ghost btn-sm" onClick={() => go("")}>{t.ov.clear}</button>
              <button className="btn-primary btn-sm">{t.ov.apply}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
