"use client";

import { useEffect } from "react";

// Marks <thead> as data-stuck while its table has scrolled under the top of the viewport,
// so the sticky header only casts a shadow while it is actually floating over rows.
// (scroll fires at most once per frame, and there are only a few tables, so no throttling.)
export function StickyHeaders() {
  useEffect(() => {
    const update = () => {
      document.querySelectorAll("thead").forEach((head) => {
        const table = head.closest("table");
        const th = head.querySelector("th");
        if (!table || !th) return;
        const top = parseFloat(getComputedStyle(th).top) || 0;
        const r = table.getBoundingClientRect();
        const stuck = r.top < top && r.bottom > top + head.offsetHeight;
        if (stuck !== head.hasAttribute("data-stuck")) head.toggleAttribute("data-stuck", stuck);
      });
    };
    addEventListener("scroll", update, { passive: true, capture: true });
    addEventListener("resize", update, { passive: true });
    update();
    return () => {
      removeEventListener("scroll", update, { capture: true });
      removeEventListener("resize", update);
    };
  }, []);
  return null;
}
