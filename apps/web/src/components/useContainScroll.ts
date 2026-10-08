"use client";

import { useEffect, type RefObject } from "react";

// Keeps wheel/touch scrolling inside a panel: once the inner scroller hits its top or
// bottom (or can't scroll at all), the gesture is swallowed instead of scrolling the page.
// CSS overscroll-behavior only covers elements that actually overflow; this covers the rest.
export function useContainScroll(panel: RefObject<HTMLElement | null>, scroller: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    const el = panel.current;
    if (!active || !el) return;
    const canScroll = (n: HTMLElement, dy: number) =>
      n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY) &&
      (dy < 0 ? n.scrollTop > 0 : n.scrollTop + n.clientHeight < n.scrollHeight - 1);
    const blocked = (dy: number, target: EventTarget | null) => {
      // A nested scroller (e.g. a Dropdown list inside this panel) that can still move wins.
      for (let n = target as HTMLElement | null; n && n !== el; n = n.parentElement) if (canScroll(n, dy)) return false;
      const s = scroller.current;
      if (!s) return true;
      return !canScroll(s, dy);
    };
    const onWheel = (e: WheelEvent) => {
      if (blocked(e.deltaY, e.target)) e.preventDefault();
    };
    let lastY = 0;
    const onTouchStart = (e: TouchEvent) => { lastY = e.touches[0].clientY; };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0].clientY;
      if (blocked(lastY - y, e.target)) e.preventDefault();
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
