"use client";

import { useEffect, useRef, useState } from "react";

type Toast = { id: number; text: string };
const EVENT = "xcap:toast";
const VISIBLE_MS = 2000;

// Fire-and-forget notice from anywhere on the client: toast("Copied").
export function toast(text: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: text }));
}

// Mounted once in the root layout. Newest toast replaces the previous one.
// It's a manual popover so it renders in the browser's top layer: above everything,
// including open modal <dialog>s, which no z-index can beat. Re-showing it on each toast
// moves it to the top of that layer.
export function Toaster() {
  const [current, setCurrent] = useState<Toast | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const on = (e: Event) => setCurrent({ id: Date.now(), text: (e as CustomEvent<string>).detail });
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!current) { if (el.matches(":popover-open")) el.hidePopover(); return; }
    if (el.matches(":popover-open")) el.hidePopover();
    el.showPopover();
    const id = setTimeout(() => setCurrent(null), VISIBLE_MS);
    return () => clearTimeout(id);
  }, [current]);

  return (
    <div ref={ref} popover="manual" className="toaster" role="status" aria-live="polite">
      {current && (
        <div key={current.id} className="toast">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="var(--brand-green)" /><path d="M4.8 8.3l2.2 2.2 4.2-4.6" fill="none" stroke="#121212" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {current.text}
        </div>
      )}
    </div>
  );
}
