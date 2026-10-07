"use client";

import { useEffect, useRef } from "react";

// WebGL background for the auth brand panel: a thin hexagon lattice drifting upward,
// light waves rippling out from the logo, sparse cells glowing gold, and cells around the
// pointer lighting up gold. One still frame when reduced motion is on.
const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uPointer;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hexDist(vec2 p) { p = abs(p); return max(dot(p, normalize(vec2(1.0, 1.732))), p.x); }
// Returns (distance from cell edge, cell id) for a pointy hex lattice.
vec3 hexCell(vec2 uv) {
  vec2 r = vec2(1.0, 1.732), h = r * 0.5;
  vec2 a = mod(uv, r) - h, b = mod(uv - h, r) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  return vec3(0.5 - hexDist(gv), uv - gv);
}


void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;   // centred, height = 1
  vec2 m = (uPointer - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float t = uTime;

  vec2 g = p * 11.0 + vec2(0.0, t * 0.04);              // ~11 cells tall, drifting up slowly
  vec3 c = hexCell(g);
  float edge = 1.0 - smoothstep(0.0, 0.022, c.x);       // thin cell outline
  vec2 id = floor(c.yz * 2.0 + 0.5) / 2.0;               // snap: float noise must not split a cell
  vec2 cellPos = (id - vec2(0.0, t * 0.04)) / 11.0;     // cell centre back in p-space
  float d = length(cellPos);
  float rnd = hash(id);

  // A wide wave of light leaves the logo every ~9s.
  float wave = smoothstep(0.12, 0.0, abs(d - fract(t / 9.0) * 1.4));
  // Sparse cells glow gold, each on its own slow cycle.
  float lit = step(0.9, rnd) * pow(max(0.0, sin(t * 0.25 + rnd * 60.0)), 6.0);
  float near = smoothstep(0.2, 0.03, length(cellPos - m));   // ~2-cell radius around the pointer

  vec3 base = vec3(0.071);                               // #121212
  vec3 grey = vec3(0.325);                               // #535353
  vec3 gold = vec3(0.851, 0.698, 0.353);                 // #d9b25a (brand mark)

  vec3 col = base;
  col += grey * edge * (0.1 + 0.3 * wave + 0.4 * near);
  col += gold * edge * (0.5 * lit + 0.25 * wave * step(0.6, rnd));
  col += gold * edge * near * 0.95;                            // pointer: gold outlines
  col += gold * (1.0 - smoothstep(0.0, 0.5, c.x)) * (lit * 0.06 + near * 0.1);   // faint fill inside lit/pointer cells


  // Gold spotlight behind the logo; panel edges fall toward black.
  float r = length((uv - 0.5) * vec2(uRes.x / uRes.y, 1.0));
  col += gold * 0.07 * exp(-r * r * 14.0);
  col *= mix(1.0, 0.3, smoothstep(0.2, 0.8, r));
  gl_FragColor = vec4(col, 1.0);
}`;

const VERT = `attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

export function LiquidityField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const gl = canvas?.getContext("webgl", { antialias: false, premultipliedAlpha: false });
    if (!canvas || !gl) return; // CSS background stays as the fallback

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "uRes");
    const uTime = gl.getUniformLocation(prog, "uTime");
    const uPointer = gl.getUniformLocation(prog, "uPointer");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Start off-panel so nothing lights up until the pointer actually enters.
    const pointer = { x: -1, y: -1, tx: -1, ty: -1 };
    const start = performance.now();
    let frame = 0;

    const draw = (time: number) => {
      pointer.x += (pointer.tx - pointer.x) * 0.18;
      pointer.y += (pointer.ty - pointer.y) * 0.18;
      gl.uniform1f(uTime, time);
      gl.uniform2f(uPointer, pointer.x, pointer.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const resize = () => {
      // Full resolution: the hex outlines are thin and blur at lower scales.
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      if (reduce) draw(12);
    };
    const loop = () => {
      draw(12 + (performance.now() - start) / 1000);
      frame = requestAnimationFrame(loop);
    };
    const onMove = (e: PointerEvent) => {
      const b = canvas.getBoundingClientRect();
      pointer.tx = (e.clientX - b.left) / b.width;
      pointer.ty = 1 - (e.clientY - b.top) / b.height;
      if (pointer.x < 0) { pointer.x = pointer.tx; pointer.y = pointer.ty; } // first move: no sweep in from the corner
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    if (!reduce) {
      frame = requestAnimationFrame(loop);
      window.addEventListener("pointermove", onMove);
    }
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return <canvas ref={ref} className="liquidity-field" aria-hidden="true" />;
}
