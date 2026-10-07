"use client";

import { useEffect, type RefObject } from "react";

// Keeps wheel/touch scrolling inside a panel: once the inner scroller hits its top or
// bottom (or can't scroll at all), the gesture is swallowed instead of scrolling the page.
// CSS overscroll-behavior only covers elements that actually overflow; this covers the rest.
export function useContainScroll(panel: RefObject<HTMLElement | null>, scroller: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    const el = panel.current;
    if (!active || !el) return;
    const blocked = (dy: number) => {
      const s = scroller.current;
      if (!s) return true;
      const atTop = s.scrollTop <= 0;
      const atBottom = s.scrollTop + s.clientHeight >= s.scrollHeight - 1;
      return (dy < 0 && atTop) || (dy > 0 && atBottom);
    };
    const onWheel = (e: WheelEvent) => {
      if (blocked(e.deltaY)) e.preventDefault();
    };
    let lastY = 0;
    const onTouchStart = (e: TouchEvent) => { lastY = e.touches[0].clientY; };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0].clientY;
      if (blocked(lastY - y)) e.preventDefault();
      lastY = y;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, [panel, scroller, active]);
}
