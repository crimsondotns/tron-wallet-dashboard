// XCap mark (from brand bimi.svg, 64×64 grid) as the auth panel's focal point.
// Intro: triangle draws, rays draw in, X and wordmark fade up. Then light pulses travel
// along the rays into the centre — every flow converging into one insight.
const OUTER = { top: [32, 5], right: [61, 56], left: [3, 56] } as const;
const INNER = "20.5,30 43.5,30 32,48";

// Each outer vertex fans 8 rays onto the inner triangle (same endpoints as the logo file).
const fan = (from: readonly [number, number], to: (i: number) => [number, number]) =>
  Array.from({ length: 8 }, (_, i) => ({ x1: from[0], y1: from[1], x2: to(i)[0], y2: to(i)[1] }));
const RAYS = [
  ...fan(OUTER.top, (i) => [23.06 + i * 2.555, 30]),
  ...fan(OUTER.right, (i) => [42.22 - i * 1.277, 32 + i * 2]),
  ...fan(OUTER.left, (i) => [30.72 - i * 1.277, 46 - i * 2]),
];

export function LogoHero() {
  return (
    <div className="logo-hero">
      <svg viewBox="0 0 64 64" className="logo-mark" role="img" aria-label="XCap Insight">
        <g fill="none" stroke="#d9b25a" strokeLinecap="round" strokeLinejoin="round">
          <polygon className="logo-draw" pathLength={1} points="32,5 61,56 3,56" strokeWidth="0.9" />
          <g strokeWidth="0.28">
            {RAYS.map((r, i) => (
              <line key={i} className="logo-ray" pathLength={1} {...r} style={{ animationDelay: `${0.9 + (i % 8) * 0.06 + Math.floor(i / 8) * 0.12}s` }} />
            ))}
          </g>
          <g className="logo-core">
            <polygon points={INNER} strokeWidth="0.55" />
            <path d="M29.2 33.2L34.8 40.2M34.8 33.2L29.2 40.2" strokeWidth="0.8" />
          </g>
          {/* Light pulses running from each vertex into the centre. */}
          <g stroke="#f3dc9f" strokeWidth="0.5">
            {RAYS.filter((_, i) => i % 2 === 0).map((r, i) => (
              <line key={i} className="logo-pulse" pathLength={1} {...r}
                style={{ animationDuration: `${5 + ((i * 7) % 5)}s`, animationDelay: `${3 + ((i * 11) % 9) * 0.7}s` }} />
            ))}
          </g>
        </g>
      </svg>
      <p className="logo-word">XCap Insight</p>
    </div>
  );
}
