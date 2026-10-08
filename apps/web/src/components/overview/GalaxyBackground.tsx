"use client";

import { useEffect, useRef } from "react";
import type { View } from "./useZoomPan";

// Animated backdrop for the money map: a slowly turning three-arm spiral galaxy and a small
// black hole that slowly orbit the bubble cluster on opposite sides (the centre stays clear),
// three star layers that drift at different speeds as the map is panned/zoomed (parallax), and
// an occasional shooting star. Drawn in the map's viewBox units, so it lines up with the SVG on
// top (same "meet" fit). Static frame under prefers-reduced-motion.
const W = 1000, H = 640;

type Star = { x: number; y: number; r: number; a: number; tw: number; sp: number };
type Dust = { d: number; a: number; r: number; c: number };

function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
function stars(n: number, seed: number): Star[] {
  const r = seeded(seed);
  return Array.from({ length: n }, () => ({ x: r() * W * 1.6 - W * 0.3, y: r() * H * 1.6 - H * 0.3, r: r() * 1.2 + 0.25, a: r() * 0.8 + 0.2, tw: r() * 6.28, sp: 0.5 + r() * 2 }));
}
function dust(): Dust[] {
  const r = seeded(5);
  return Array.from({ length: 2400 }, (_, i) => {
    const d = Math.pow(r(), 0.6) * 380;
    return { d, a: (i % 3) * 2.094 + d * 0.018 + (r() - 0.5) * 0.5, r: r() * 1.2 + 0.3, c: r() };
  });
}

// Nebula: hundreds of soft round light clouds laid along the spiral arms (added together, so
// overlaps glow), plus dark dust lanes. Computed per pixel in floating point rather than with
// canvas radial gradients: the browser dithers every gradient with the same ordered pattern,
// and hundreds of faint overlapping gradients add that pattern up into a visible grid. Our own
// random dither is applied once at the end. Rendered once, then rotated each frame.
const NEB = 1200;         // nebula canvas covers NEB × NEB viewBox units around the wallet
const NEB_PX = 1024;      // the clouds are soft, so this upscales without visible pixels
function buildNebula(): HTMLCanvasElement {
  const P = NEB_PX, k = P / NEB, r = seeded(77);
  const cr = new Float32Array(P * P), cg = new Float32Array(P * P), cb = new Float32Array(P * P), dim = new Float32Array(P * P).fill(1);
  // Soft falloff (≈ the old gradient: full at the centre, ~45% at mid radius, 0 at the edge).
  const blob = (x: number, y: number, rad: number, rgb: [number, number, number], a: number) => {
    const px = P / 2 + x * k, py = P / 2 + y * k, pr = rad * k;
    const x0 = Math.max(0, Math.floor(px - pr)), x1 = Math.min(P - 1, Math.ceil(px + pr));
    const y0 = Math.max(0, Math.floor(py - pr)), y1 = Math.min(P - 1, Math.ceil(py + pr));
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      const t = Math.hypot(xx - px, yy - py) / pr;
      if (t >= 1) continue;
      const w = a * (1 - t) * (1 - t) * (1 + t); // smooth, 0 at the edge
      const i = yy * P + xx;
      cr[i] += rgb[0] * w; cg[i] += rgb[1] * w; cb[i] += rgb[2] * w;
    }
  };
  const lane = (x: number, y: number, rad: number, a: number) => {
    const px = P / 2 + x * k, py = P / 2 + y * k, pr = rad * k;
    for (let yy = Math.max(0, Math.floor(py - pr)); yy <= Math.min(P - 1, Math.ceil(py + pr)); yy++)
      for (let xx = Math.max(0, Math.floor(px - pr)); xx <= Math.min(P - 1, Math.ceil(px + pr)); xx++) {
        const t = Math.hypot(xx - px, yy - py) / pr;
        if (t < 1) dim[yy * P + xx] *= 1 - a * (1 - t) * (1 - t);
      }
  };
  // Core glow.
  blob(0, 0, 190, [255, 236, 205], 0.18);
  blob(0, 0, 360, [200, 195, 215], 0.08);
  // Each arm = a dense trail of overlapping clouds that hugs the spiral (so the arms read as
  // continuous bands). Muted, real-galaxy tones: warm cream near the core, pale blue-white
  // arms, and only the odd faint pink star-forming knot.
  for (let arm = 0; arm < 3; arm++) {
    for (let i = 0; i < 220; i++) {
      const f = i / 220, d = 30 + f * 400;
      const a = arm * 2.094 + d * 0.018 + (r() - 0.5) * 0.18;
      const x = Math.cos(a) * d + (r() - 0.5) * 22, y = Math.sin(a) * d + (r() - 0.5) * 22;
      const rgb: [number, number, number] = d < 120 ? [240, 225, 200] : r() < 0.06 ? [215, 165, 185] : r() < 0.5 ? [185, 195, 225] : [160, 175, 215];
      blob(x, y, (70 + r() * 50) * (1 - f * 0.55), rgb, 0.032 * (1 - f * 0.6));
    }
  }
  // Fine dark dust lane along the inner edge of each arm.
  for (let arm = 0; arm < 3; arm++) {
    for (let i = 0; i < 90; i++) {
      const f = i / 90, d = 70 + f * 300, a = arm * 2.094 + d * 0.018 - 0.22;
      lane(Math.cos(a) * d, Math.sin(a) * d, 26 * (1 - f * 0.4), 0.12);
    }
  }
  // Light as premultiplied colour → straight colour + alpha, with a random dither.
  const c = document.createElement("canvas");
  c.width = c.height = P;
  const g = c.getContext("2d")!;
  const im = g.createImageData(P, P), d = im.data, nr = seeded(91);
  for (let i = 0; i < P * P; i++) {
    const R = Math.min(255, cr[i] * dim[i]), G = Math.min(255, cg[i] * dim[i]), B = Math.min(255, cb[i] * dim[i]);
    const A = Math.max(R, G, B);
    if (A <= 0.01) continue;
    const o = i * 4, n = nr() - 0.5;
    d[o] = (R / A) * 255 + n; d[o + 1] = (G / A) * 255 + n; d[o + 2] = (B / A) * 255 + n;
    d[o + 3] = A + (nr() - 0.5) * 1.5;
  }
  g.putImageData(im, 0, 0);
  return c;
}

// Black hole, ray-traced once into an offscreen canvas. Units: Schwarzschild radius = 1.
// Each pixel's light ray is marched backwards from the camera and bent with the standard
// photon-orbit approximation a = -1.5·h²·r̂/r⁴; where it crosses the disk plane between the
// inner and outer radius it picks up disk light (hotter and whiter inside, Doppler-boosted on
// the approaching side, redshifted near the hole). Rays that fall inside r = 1 stay black: the
// shadow. Bending is what lifts the far side of the disk over the top of the shadow and under
// its bottom. A cheap bloom pass (blurred, upscaled copy added on top) gives the glow.
const BH_R = 30;          // apparent shadow radius in viewBox units
const BH_VIEW = 13;       // half-width of the rendered view, in Schwarzschild radii
const BH_SHADOW = 2.6;    // apparent shadow radius (critical impact parameter 3√3/2)
// Returns a `step(budgetMs)` that traces some rows and reports progress, so the work is spread
// over animation frames instead of freezing the page; `canvas` is filled in when it finishes.
// Pass 1 traces one ray per pixel at roughly the on-screen resolution; pass 2 re-traces 4 rays
// per pixel only where neighbours differ a lot (shadow edge, photon ring), for crisp edges.
function buildBlackHole(): { step: (budgetMs: number) => boolean; canvas: HTMLCanvasElement } {
  const N = 640;
  const D = 30, tilt = 0.07; // camera distance; angle above the disk (nearly edge-on, like Gargantua)
  const cam = [0, D * Math.sin(tilt), -D * Math.cos(tilt)];
  const fwd = [-cam[0] / D, -cam[1] / D, -cam[2] / D];
  const right = [1, 0, 0];
  const up = [fwd[1] * right[2] - fwd[2] * right[1], fwd[2] * right[0] - fwd[0] * right[2], fwd[0] * right[1] - fwd[1] * right[0]];
  const th = BH_VIEW / D;
  const RIN = 3, ROUT = 13;
  const px = new Float32Array(N * N * 4); // tone-mapped r, g, b, alpha in 0..1
  const res = [0, 0, 0, 0];

  // One ray through image coordinates (fx, fy) in pixels; writes into `res`.
  const trace = (fx: number, fy: number) => {
    const u = (fx / (N - 1)) * 2 - 1, v = 1 - (fy / (N - 1)) * 2;
    let dx = fwd[0] + (u * right[0] + v * up[0]) * th, dy = fwd[1] + (u * right[1] + v * up[1]) * th, dz = fwd[2] + (u * right[2] + v * up[2]) * th;
    const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
    let x = cam[0], y = cam[1], z = cam[2];
    // h² = |p × v|² (conserved).
    const cx = y * dz - z * dy, cy = z * dx - x * dz, cz = x * dy - y * dx;
    const h2 = cx * cx + cy * cy + cz * cz;
    let R = 0, G = 0, B = 0, A = 0, escaped = false;
    for (let i = 0; i < 1500 && A < 0.99; i++) {
      const r2 = x * x + y * y + z * z, r = Math.sqrt(r2);
      if (r < 1) { A = 1; break; }                                  // fell in: shadow
      if (r > D + 8 && x * dx + y * dy + z * dz > 0) { escaped = true; break; }
      const dt = Math.min(0.5, Math.max(0.008, 0.03 * (r - 0.9) * r)); // fine steps near the photon sphere
      const k = (-1.5 * h2) / (r2 * r2 * r);
      dx += x * k * dt; dy += y * k * dt; dz += z * k * dt;
      const nx = x + dx * dt, ny = y + dy * dt, nz = z + dz * dt;
      if ((y > 0) !== (ny > 0)) {                                    // crossed the disk plane
        const f = y / (y - ny), hx = x + (nx - x) * f, hz = z + (nz - z) * f, rr = Math.hypot(hx, hz);
        if (rr > RIN && rr < ROUT) {
          const tt = (rr - RIN) / (ROUT - RIN);
          // Keplerian speed (M = ½), softened so the receding side still shows.
          const beta = Math.min(0.45, Math.sqrt(0.5 / rr) * 0.8);
          const vl = Math.hypot(dx, dy, dz);
          const cosT = ((-hz / rr) * -dx + (hx / rr) * -dz) / vl;
          const g = Math.sqrt(1 - beta * beta) / (1 - beta * cosT) * Math.sqrt(1 - 1 / rr);
          const ph = Math.atan2(hz, hx);
          const tex = 0.88 + 0.12 * Math.sin(rr * 5 + Math.sin(ph * 3 + rr) * 1.5);
          const I = Math.min(4, Math.pow(RIN / rr, 1.8) * Math.pow(g, 3) * tex * (1 - tt * tt) * 1.6);
          // Hot inner disk white-gold, outer orange; redshift (g < 1) pushes it redder.
          const warm = Math.min(1, tt + (1 - g) * 0.8);
          const cr = 1, cg = 0.92 - warm * 0.42, cb = 0.78 - warm * 0.62;
          R += (1 - A) * cr * I; G += (1 - A) * cg * I; B += (1 - A) * cb * I;
          A += (1 - A) * Math.min(0.92, I);
        }
      }
      x = nx; y = ny; z = nz;
    }
    if (!escaped && A < 0.99) A = 1; // still circling the photon sphere: part of the shadow
    res[0] = 1 - Math.exp(-R * 1.4); res[1] = 1 - Math.exp(-G * 1.4); res[2] = 1 - Math.exp(-B * 1.4);
    res[3] = Math.min(1, Math.max(A, (res[0] + res[1] + res[2]) / 3));
  };
  const put = (i: number) => { px[i] = res[0]; px[i + 1] = res[1]; px[i + 2] = res[2]; px[i + 3] = res[3]; };

  const out = document.createElement("canvas");
  out.width = out.height = N;
  let row = 0, pass = 1;
  const rowPass1 = (py: number) => { for (let x = 0; x < N; x++) { trace(x, py); put((py * N + x) * 4); } };
  const rowPass2 = (py: number) => {
    for (let x = 0; x < N - 1; x++) {
      const i = (py * N + x) * 4, j = i + 4, k = i + N * 4;
      const lum = (o: number) => px[o] + px[o + 1] + px[o + 2] + px[o + 3];
      const edge = Math.abs(lum(i) - lum(j)) > 0.35 || (py < N - 1 && Math.abs(lum(i) - lum(k)) > 0.35);
      if (!edge) continue;
      let r = 0, g = 0, b = 0, a = 0;
      for (const [ox, oy] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
        trace(x + ox, py + oy); r += res[0]; g += res[1]; b += res[2]; a += res[3];
      }
      px[i] = r / 4; px[i + 1] = g / 4; px[i + 2] = b / 4; px[i + 3] = a / 4;
    }
  };
  const finish = () => {
    const img = new ImageData(N, N);
    for (let i = 0; i < px.length; i++) img.data[i] = Math.round(px[i] * 255);
    const base = document.createElement("canvas");
    base.width = base.height = N;
    const bg = base.getContext("2d")!;
    bg.putImageData(img, 0, 0);
    // Photon ring. Up the centre column the trace goes: shadow → a sub-pixel photon ring →
    // a thin see-through gap → the lensed disk light. That inner ring and gap read as a broken
    // circle at this size, so: find where the lensed light starts (bright and staying bright),
    // make everything inside it that isn't disk light a clean black shadow, and draw one
    // whole ring on that edge, brighter on the approaching (left) side.
    const c0 = Math.round((N - 1) / 2);
    const lumAt = (y: number) => { const o = (y * N + c0) * 4; return px[o] + px[o + 1] + px[o + 2]; };
    let ringR = (BH_SHADOW / BH_VIEW) * (N / 2) * 1.25;
    for (let d = 2; d < N / 2 - 4; d++) {
      if (lumAt(c0 - d) > 0.5 && lumAt(c0 - d - 4) > 0.5) { ringR = d; break; }
    }
    // The upward walk is above the disk band, which crosses the centre horizontally.
    const shadowData = bg.getImageData(0, 0, N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = x - c0, dy = y - c0;
      if (dx * dx + dy * dy >= ringR * ringR) continue;
      const o = (y * N + x) * 4, d = shadowData.data;
      if (d[o] + d[o + 1] + d[o + 2] < 90) { d[o] = d[o + 1] = d[o + 2] = 0; d[o + 3] = 255; } // dim → shadow
    }
    bg.putImageData(shadowData, 0, 0);
    const lg = bg.createLinearGradient(N / 2 - ringR, 0, N / 2 + ringR, 0);
    lg.addColorStop(0, "rgba(255,244,222,0.95)"); lg.addColorStop(0.5, "rgba(255,214,160,0.7)"); lg.addColorStop(1, "rgba(220,140,80,0.45)");
    bg.strokeStyle = lg; bg.lineWidth = 1.6;
    bg.beginPath(); bg.arc(c0, c0, ringR, 0, Math.PI * 2); bg.stroke();
    // Bloom: small copies scaled back up and added on top (kept light so the edges stay sharp).
    const o2 = out.getContext("2d")!;
    o2.drawImage(base, 0, 0);
    o2.globalCompositeOperation = "lighter";
    o2.imageSmoothingQuality = "high";
    for (const [div, a] of [[8, 0.32], [20, 0.28]] as const) {
      const sm = document.createElement("canvas");
      sm.width = sm.height = Math.round(N / div);
      const sg = sm.getContext("2d")!;
      sg.imageSmoothingQuality = "high";
      sg.drawImage(base, 0, 0, sm.width, sm.height);
      o2.globalAlpha = a;
      o2.drawImage(sm, 0, 0, N, N);
    }
    o2.globalAlpha = 1;
  };
  const step = (budgetMs: number) => {
    if (pass > 2) return true;
    const end = performance.now() + budgetMs;
    while (pass <= 2 && performance.now() < end) {
      (pass === 1 ? rowPass1 : rowPass2)(row++);
      if (row >= N) { row = 0; pass++; if (pass > 2) finish(); }
    }
    return pass > 2;
  };
  return { step, canvas: out };
}

export function GalaxyBackground({ view, cx, cy }: { view: View; cx: number; cy: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const layers = [stars(900, 21), stars(380, 22), stars(120, 23)];
    const arms = dust();
    const nebula = buildNebula();
    const blackHole = buildBlackHole();
    let bhReady = 0; // 0 → 1 fade-in once traced
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const meteors: { x: number; y: number; l: number; v: number }[] = [];
    let raf = 0;

    const size = () => {
      const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.max(1, Math.round(r.width * dpr));
      cv.height = Math.max(1, Math.round(r.height * dpr));
    };

    const frame = (t: number) => {
      const v = viewRef.current;
      // viewBox → canvas pixels, same as the SVG's preserveAspectRatio="xMidYMid meet".
      const s = Math.min(cv.width / W, cv.height / H);
      const ox = (cv.width - W * s) / 2, oy = (cv.height - H * s) / 2;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#08080d"; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.setTransform(s, 0, 0, s, ox, oy);

      // Far → near star layers: each follows the pan/zoom by a fraction (parallax).
      layers.forEach((L, i) => {
        const f = [0.08, 0.18, 0.32][i];
        const k = 1 + (v.k - 1) * f;
        for (const st of L) {
          const x = (st.x - W / 2) * k + W / 2 + v.x * f, y = (st.y - H / 2) * k + H / 2 + v.y * f;
          const a = st.a * (still ? 0.8 : 0.6 + 0.4 * Math.sin((t / 900) * st.sp + st.tw));
          ctx.fillStyle = i === 2 ? `rgba(250,244,232,${a})` : `rgba(255,255,255,${a * (0.5 + i * 0.25)})`;
          ctx.beginPath(); ctx.arc(x, y, st.r * (1 + i * 0.5), 0, 6.283); ctx.fill();
        }
      });

      // Spiral galaxy around the wallet, moving with the map itself.
      ctx.setTransform(s * v.k, 0, 0, s * v.k, ox + v.x * s, oy + v.y * s);
      const rot = still ? 0 : (t / 1000) * 0.035;
      // The galaxy and the black hole slowly orbit the cluster on an ellipse, on opposite
      // sides, so the centre always stays clear for the bubbles (one lap ≈ 4 minutes).
      const orbit = -0.5 + (still ? 0 : (t / 1000) * 0.026);
      const gx = cx + Math.cos(orbit) * 400, gy = cy + Math.sin(orbit) * 230, gs = 0.7;
      const bx = cx + Math.cos(orbit + Math.PI) * 400, by = cy + Math.sin(orbit + Math.PI) * 230;
      // Nebula clouds: squashed to the same ellipse as the arms, turning with them.
      ctx.save();
      ctx.translate(gx, gy); ctx.scale(1.35 * gs, 0.8 * gs); ctx.rotate(rot);
      ctx.globalAlpha = 0.4; // backdrop only: keep it well under the bubbles
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(nebula, -NEB / 2, -NEB / 2, NEB, NEB);
      ctx.globalAlpha = 1;
      ctx.restore();
      for (const p of arms) {
        const a = p.a + rot, x = gx + Math.cos(a) * p.d * 1.35 * gs, y = gy + Math.sin(a) * p.d * 0.8 * gs;
        const al = (1 - p.d / 390) * 0.35;
        ctx.fillStyle = p.c > 0.92 ? `rgba(240,225,195,${al})` : p.c > 0.6 ? `rgba(200,210,240,${al * 0.8})` : `rgba(255,255,255,${al * 0.7})`;
        ctx.beginPath(); ctx.arc(x, y, p.r * 0.6, 0, 6.283); ctx.fill();
      }

      // Black hole, opposite the galaxy on the same orbit (ray-traced once, see buildBlackHole);
      // its glow breathes a little.
      if (bhReady < 1 && blackHole.step(8)) bhReady = Math.min(1, bhReady + (still ? 1 : 0.02));
      if (bhReady > 0) {
        const size = (BH_R / BH_SHADOW) * BH_VIEW * 2;
        ctx.save();
        ctx.translate(bx, by); ctx.rotate(-0.12);
        ctx.globalAlpha = bhReady * (still ? 0.8 : 0.72 + 0.08 * Math.sin(t / 1400));
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(blackHole.canvas, -size / 2, -size / 2, size, size);
        ctx.restore();
      }

      // Shooting stars (screen space).
      if (!still) {
        ctx.setTransform(s, 0, 0, s, ox, oy);
        // Up to 4 at a time, a new one roughly every second or two.
        if (meteors.length < 4 && Math.random() < 0.015) meteors.push({ x: Math.random() * W * 1.1 - W * 0.1, y: Math.random() * H * 0.6 - 40, l: 0, v: 0.7 + Math.random() * 0.8 });
        for (let i = meteors.length - 1; i >= 0; i--) {
          const m = meteors[i], len = 110 + m.v * 90;
          m.l += 14 * m.v;
          const fade = Math.min(1, m.l / 60) * Math.max(0, 1 - m.l / 320);
          const g = ctx.createLinearGradient(m.x, m.y, m.x - len, m.y - len * 0.45);
          g.addColorStop(0, `rgba(255,255,255,${0.85 * fade})`); g.addColorStop(1, "rgba(255,255,255,0)");
          ctx.strokeStyle = g; ctx.lineWidth = 1 + m.v * 0.6;
          ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x - len, m.y - len * 0.45); ctx.stroke();
          m.x += 10 * m.v; m.y += 4.5 * m.v;
          if (m.l > 320) meteors.splice(i, 1);
        }
      }
      if (!still) raf = requestAnimationFrame(frame);
    };

    size();
    const ro = new ResizeObserver(() => { size(); if (still) frame(0); });
    ro.observe(cv);
    raf = requestAnimationFrame(frame);
    // Re-draw the static frame when the view changes.
    const onView = () => { if (still) frame(0); };
    const id = still ? window.setInterval(onView, 200) : 0;
    return () => { cancelAnimationFrame(raf); ro.disconnect(); if (id) clearInterval(id); };
  }, [cx, cy]);

  return <canvas ref={canvas} className="map-galaxy" aria-hidden="true" />;
}
