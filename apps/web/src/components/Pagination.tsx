"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { fmt } from "@/i18n/config";
import { useT } from "@/i18n/client";
import { Dropdown } from "./Dropdown";

import { PAGE_SIZES } from "./pageSizes";

// Page numbers with ellipses: 1 … 4 5 [6] 7 8 … 500
function pageList(page: number, total: number): (number | "gap-l" | "gap-r")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const from = Math.max(2, Math.min(page - 2, total - 5)), to = Math.min(total - 1, Math.max(page + 2, 6));
  return [1, ...(from > 2 ? ["gap-l" as const] : []), ...Array.from({ length: to - from + 1 }, (_, i) => from + i), ...(to < total - 1 ? ["gap-r" as const] : []), total];
}

export function Pagination({ page, total, size }: { page: number; total: number; size: number }) {
  const t = useT();
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [jump, setJump] = useState("");
  const href = (changes: Record<string, string>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(changes)) p.set(k, v);
    return `${path}?${p}`;
  };
  const go = (n: number) => href({ page: String(Math.min(total, Math.max(1, n))) });
  const arrow = (d: string) => <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;

  return (
    <nav className="pagination" aria-label={fmt(t.ov.page, { n: page })}>
      <div className="pg-pages">
        {page > 1
          ? <Link className="pg-btn" href={go(page - 1)} aria-label={t.ov.prev}>{arrow("M10 3.5L5.5 8l4.5 4.5")}</Link>
          : <span className="pg-btn" aria-disabled="true">{arrow("M10 3.5L5.5 8l4.5 4.5")}</span>}
        {pageList(page, total).map((n) => typeof n === "number"
          ? <Link key={n} className="pg-btn" href={go(n)} aria-current={n === page ? "page" : undefined}>{n}</Link>
          : <Link key={n} className="pg-btn pg-gap" href={go(n === "gap-l" ? page - 5 : page + 5)} aria-label={n === "gap-l" ? t.ov.prev5 : t.ov.next5} title={n === "gap-l" ? t.ov.prev5 : t.ov.next5}>
              <span className="pg-dots">···</span><span className="pg-jump">{n === "gap-l" ? "«" : "»"}</span>
            </Link>)}
        {page < total
          ? <Link className="pg-btn" href={go(page + 1)} aria-label={t.ov.next}>{arrow("M6 3.5L10.5 8 6 12.5")}</Link>
          : <span className="pg-btn" aria-disabled="true">{arrow("M6 3.5L10.5 8 6 12.5")}</span>}
      </div>
      <div className="pg-size">
        <Dropdown name="size" label={t.ov.perPage} defaultValue={String(size)}
          options={PAGE_SIZES.map((n) => ({ value: String(n), label: fmt(t.ov.perPageN, { n }) }))}
          onChange={(v) => router.push(href({ size: v, page: "1" }))} />
      </div>
      <form className="pg-goto" onSubmit={(e) => { e.preventDefault(); const n = Number(jump); if (n >= 1) { router.push(go(n)); setJump(""); } }}>
        <label htmlFor="pg-goto">{t.ov.goTo}</label>
        <input id="pg-goto" className="input" inputMode="numeric" value={jump} onChange={(e) => setJump(e.target.value.replace(/\D/g, ""))} placeholder={String(total)} />
        <span>{t.ov.pageWord}</span>
      </form>
    </nav>
  );
}
