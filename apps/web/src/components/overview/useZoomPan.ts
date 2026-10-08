"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type View = { k: number; x: number; y: number };
const MIN = 0.4, MAX = 8;
const IDENTITY: View = { k: 1, x: 0, y: 0 };
const clampK = (k: number) => Math.min(MAX, Math.max(MIN, k));

// Zoom/pan for an SVG with a viewBox. The returned `view` is applied as
// `translate(x,y) scale(k)` on a <g> inside the SVG.
//  - Wheel (mouse notches, Magic Mouse swipes) and trackpad pinch (wheel + ctrlKey) zoom
//    around the pointer. The step is proportional to the delta, so a Magic Mouse's many
//    small pixel deltas zoom as smoothly as a wheel's large notches.
//  - Drag on empty space pans; double-click zooms in; + / − / 0 keys when focused.
export function useZoomPan(svgRef: React.RefObject<SVGSVGElement | null>, fitView: () => View) {
  const [view, setView] = useState<View>(IDENTITY);
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  const drag = useRef<{ id: number; sx: number; sy: number; v: View; moved: boolean } | null>(null);

  // Pointer position in viewBox units.
  const toSvg = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }, [svgRef]);

  const zoomAt = useCallback((factor: number, px: number, py: number) => {
    setView((v) => {
      const k = clampK(v.k * factor);
      const f = k / v.k;
      return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
    });
  }, []);

  const zoomCenter = useCallback((factor: number) => {
    const vb = svgRef.current?.viewBox.baseVal;
    zoomAt(factor, (vb?.width ?? 0) / 2, (vb?.height ?? 0) / 2);
  }, [svgRef, zoomAt]);

  const fit = useCallback(() => setView(fitView()), [fitView]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); // keep the page from scrolling while over the map
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1; // lines/pages → px
      const dy = Math.max(-120, Math.min(120, e.deltaY * unit));         // tame big wheel notches
      const speed = e.ctrlKey ? 0.012 : 0.0025;                          // pinch deltas are small
      const p = toSvg(e.clientX, e.clientY);
      zoomAt(Math.exp(-dy * speed), p.x, p.y);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [svgRef, toSvg, zoomAt]);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || (e.target as Element).closest("[data-node]")) return;
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, v: viewRef.current, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const a = toSvg(d.sx, d.sy), b = toSvg(e.clientX, e.clientY);
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true;
    setView({ ...d.v, x: d.v.x + (b.x - a.x), y: d.v.y + (b.y - a.y) });
  };
  // Returns true when the gesture was a drag (so the caller can ignore the click).
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const moved = !!drag.current?.moved;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    return moved;
  };
  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest("[data-node]")) return;
    const p = toSvg(e.clientX, e.clientY);
    zoomAt(e.shiftKey ? 1 / 1.8 : 1.8, p.x, p.y);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "+" || e.key === "=") zoomCenter(1.25);
    else if (e.key === "-" || e.key === "_") zoomCenter(1 / 1.25);
    else if (e.key === "0") fit();
    else return;
    e.preventDefault();
  };

  return { view, fit, zoomCenter, handlers: { onPointerDown, onPointerMove, onPointerUp, onDoubleClick, onKeyDown } };
}
