// Inflow/outflow per bucket as paired bars. Plain SVG (server-rendered, no chart library);
// each bucket has a <title> for the hover tooltip.
export type Bucket = { label: string; in: number; out: number };

export function DailyBars({ data, fmt, labels }: { data: Bucket[]; fmt: (n: number) => string; labels: { in: string; out: string } }) {
  const H = 160, gap = 2;
  const max = Math.max(1, ...data.map((d) => Math.max(d.in, d.out)));
  const w = 100 / Math.max(1, data.length);
  return (
    <div className="bars-chart">
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" role="img" aria-label={`${labels.in} / ${labels.out}`}>
        {data.map((d, i) => {
          const hi = (d.in / max) * (H - 4), ho = (d.out / max) * (H - 4);
          const x = i * w, bw = Math.max(0.2, (w - gap * (w / 10)) / 2);
          return (
            <g key={d.label}>
              <title>{`${d.label}\n${labels.in} ${fmt(d.in)}\n${labels.out} ${fmt(d.out)}`}</title>
              <rect x={x} y={0} width={w} height={H} fill="transparent" />
              <rect className="bar-in" x={x + w * 0.1} y={H - hi} width={bw} height={hi} />
              <rect className="bar-out" x={x + w * 0.1 + bw} y={H - ho} width={bw} height={ho} />
            </g>
          );
        })}
      </svg>
      <div className="bars-axis caption subdued"><span>{data[0]?.label}</span><span>{data.at(-1)?.label}</span></div>
    </div>
  );
}
