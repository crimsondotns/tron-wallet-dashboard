"use client";

import { useLayoutEffect, type RefObject } from "react";

const GAP = 8, MARGIN = 8;

function place(el: HTMLElement, anchor: HTMLElement, prefer: "bottom" | "top") {
    Object.assign(el.style, { top: "", bottom: "", left: "", right: "", maxHeight: "" });
    const a = anchor.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const below = vh - a.bottom - GAP - MARGIN, above = a.top - GAP - MARGIN;
    const fits = (s: "bottom" | "top") => (s === "bottom" ? below : above) >= h;
    const other = prefer === "bottom" ? "top" : "bottom";
    const side = fits(prefer) ? prefer : fits(other) ? other : below >= above ? "bottom" : "top";
    const room = Math.max(120, side === "bottom" ? below : above);

    if (side === "bottom") { el.style.top = `calc(100% + ${GAP}px)`; el.style.bottom = "auto"; }
    else { el.style.bottom = `calc(100% + ${GAP}px)`; el.style.top = "auto"; }
    if (h > room) el.style.maxHeight = `${room}px`;
    el.style.setProperty("--pop-max", `${room}px`);

    // Horizontal: keep the popover's own CSS alignment unless that runs off screen.
    const r = el.getBoundingClientRect();
    if (r.left < MARGIN || r.right > vw - MARGIN) {
      if (a.left + w <= vw - MARGIN) { el.style.left = "0"; el.style.right = "auto"; }
      else if (a.right - w >= MARGIN) { el.style.right = "0"; el.style.left = "auto"; }
      else { el.style.left = `${Math.round(MARGIN - a.left)}px`; el.style.right = "auto"; }
    }
    el.dataset.side = side;
}

// Keeps a popover on screen. The popover is absolutely positioned inside its (relative)
// parent; on open and on resize/scroll this measures the room around the parent and picks
//  - side: below, or above when it doesn't fit below and there is more room above
//  - align: as styled; if that overflows, left edges together, else right edges, else shifted inside
// and caps the height to the room left (exposed as --pop-max for inner scrollers).
// Inline styles win over each popover's own CSS defaults.
export function usePopoverPlacement(pop: RefObject<HTMLElement | null>, open: boolean, prefer: "bottom" | "top" = "bottom") {
  useLayoutEffect(() => {
    const el = pop.current, anchor = el?.parentElement;
    if (!open || !el || !anchor) return;
    const run = () => place(el, anchor, prefer);
    run();
    window.addEventListener("resize", run);
    window.addEventListener("scroll", run, true);
    return () => { window.removeEventListener("resize", run); window.removeEventListener("scroll", run, true); };
  }, [pop, open, prefer]);
}
