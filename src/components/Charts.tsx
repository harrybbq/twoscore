'use client';

/**
 * Inline SVG plots. No chart library: these are four fixed shapes and a
 * dependency would be more code than the code.
 */

const AXIS = '#3b444f';
const GRID = '#1f242d';

interface Point {
  x: number;
  y: number;
  label?: string;
  weight?: number;
}

function scale(v: number, lo: number, hi: number, out0: number, out1: number): number {
  if (hi === lo) return (out0 + out1) / 2;
  return out0 + ((v - lo) / (hi - lo)) * (out1 - out0);
}

export function Scatter({
  points,
  xLabel,
  yLabel,
  domain,
  diagonal = true,
  height = 260,
}: {
  points: Point[];
  xLabel: string;
  yLabel: string;
  domain?: [number, number];
  diagonal?: boolean;
  height?: number;
}) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const lo = domain ? domain[0] : Math.min(...xs, ...ys, 0);
  const hi = domain ? domain[1] : Math.max(...xs, ...ys, 1);
  const W = 420;
  const H = height;
  const pad = 34;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${yLabel} against ${xLabel}`}>
      <rect x={pad} y={8} width={W - pad - 8} height={H - pad - 8} fill="none" stroke={GRID} />
      {diagonal && (
        <line
          x1={scale(lo, lo, hi, pad, W - 8)}
          y1={scale(lo, lo, hi, H - pad, 8)}
          x2={scale(hi, lo, hi, pad, W - 8)}
          y2={scale(hi, lo, hi, H - pad, 8)}
          stroke={AXIS}
          strokeDasharray="3 3"
        />
      )}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={scale(p.x, lo, hi, pad, W - 8)}
          cy={scale(p.y, lo, hi, H - pad, 8)}
          r={2.2}
          fill="#4fd1c5"
          fillOpacity={0.5}
        >
          {p.label && <title>{p.label}</title>}
        </circle>
      ))}
      <text x={W / 2} y={H - 6} fill="#5b6675" fontSize="10" textAnchor="middle">
        {xLabel}
      </text>
      <text x={10} y={H / 2} fill="#5b6675" fontSize="10" textAnchor="middle" transform={`rotate(-90 10 ${H / 2})`}>
        {yLabel}
      </text>
      <text x={pad} y={H - pad + 12} fill="#5b6675" fontSize="9">
        {lo.toFixed(1)}
      </text>
      <text x={W - 20} y={H - pad + 12} fill="#5b6675" fontSize="9">
        {hi.toFixed(1)}
      </text>
    </svg>
  );
}

export function ResidualPlot({ points, height = 200 }: { points: Point[]; height?: number }) {
  const W = 420;
  const H = height;
  const pad = 34;
  const xs = points.map((p) => p.x);
  const xlo = Math.min(...xs, 0.5);
  const xhi = Math.max(...xs, 5);
  const rmax = Math.max(...points.map((p) => Math.abs(p.y)), 0.5);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Residuals against prediction">
      <rect x={pad} y={8} width={W - pad - 8} height={H - pad - 8} fill="none" stroke={GRID} />
      <line x1={pad} y1={scale(0, -rmax, rmax, H - pad, 8)} x2={W - 8} y2={scale(0, -rmax, rmax, H - pad, 8)} stroke={AXIS} />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={scale(p.x, xlo, xhi, pad, W - 8)}
          cy={scale(p.y, -rmax, rmax, H - pad, 8)}
          r={2}
          fill={p.y > 0 ? '#f0a35e' : '#4fd1c5'}
          fillOpacity={0.5}
        >
          {p.label && <title>{p.label}</title>}
        </circle>
      ))}
      <text x={W / 2} y={H - 6} fill="#5b6675" fontSize="10" textAnchor="middle">
        predicted rating → residual (predicted − actual)
      </text>
      <text x={pad + 2} y={16} fill="#5b6675" fontSize="9">
        +{rmax.toFixed(1)}
      </text>
    </svg>
  );
}

export function LineChart({
  points,
  xLabel,
  yLabel,
  height = 180,
}: {
  points: { x: number; y: number }[];
  xLabel: string;
  yLabel: string;
  height?: number;
}) {
  const W = 420;
  const H = height;
  const pad = 34;
  if (points.length < 2) {
    return <p className="py-8 text-center text-2xs text-ink-600">Not enough feedback yet to plot drift.</p>;
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xlo = Math.min(...xs);
  const xhi = Math.max(...xs);
  const ylo = Math.min(...ys, 0);
  const yhi = Math.max(...ys);
  const d = points
    .map((p, i) => `${i ? 'L' : 'M'}${scale(p.x, xlo, xhi, pad, W - 8)},${scale(p.y, ylo, yhi, H - pad, 8)}`)
    .join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${yLabel} over ${xLabel}`}>
      <rect x={pad} y={8} width={W - pad - 8} height={H - pad - 8} fill="none" stroke={GRID} />
      <path d={d} fill="none" stroke="#4fd1c5" strokeWidth={1.5} />
      <text x={W / 2} y={H - 6} fill="#5b6675" fontSize="10" textAnchor="middle">
        {xLabel}
      </text>
      <text x={pad + 2} y={16} fill="#5b6675" fontSize="9">
        {yhi.toFixed(3)} {yLabel}
      </text>
      <text x={pad + 2} y={H - pad - 3} fill="#5b6675" fontSize="9">
        {ylo.toFixed(3)}
      </text>
    </svg>
  );
}

export function CalibrationCurve({
  bins,
  height = 240,
}: {
  bins: { bin: number; predicted: number; actual: number; n: number }[];
  height?: number;
}) {
  const W = 420;
  const H = height;
  const pad = 34;
  if (!bins.length) {
    return <p className="py-8 text-center text-2xs text-ink-600">No calibration bins.</p>;
  }
  const maxN = Math.max(...bins.map((b) => b.n));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Calibration curve">
      <rect x={pad} y={8} width={W - pad - 8} height={H - pad - 8} fill="none" stroke={GRID} />
      <line x1={pad} y1={H - pad} x2={W - 8} y2={8} stroke={AXIS} strokeDasharray="3 3" />
      <path
        d={bins
          .map(
            (b, i) =>
              `${i ? 'L' : 'M'}${scale(b.predicted, 0, 1, pad, W - 8)},${scale(b.actual, 0, 1, H - pad, 8)}`,
          )
          .join(' ')}
        fill="none"
        stroke="#4fd1c5"
        strokeWidth={1.5}
      />
      {bins.map((b, i) => (
        <circle
          key={i}
          cx={scale(b.predicted, 0, 1, pad, W - 8)}
          cy={scale(b.actual, 0, 1, H - pad, 8)}
          r={2 + (b.n / maxN) * 4}
          fill="#4fd1c5"
          fillOpacity={0.7}
        >
          <title>{`predicted ${(b.predicted * 100).toFixed(0)}% · observed ${(b.actual * 100).toFixed(0)}% · n=${b.n}`}</title>
        </circle>
      ))}
      <text x={W / 2} y={H - 6} fill="#5b6675" fontSize="10" textAnchor="middle">
        predicted probability → observed frequency (dot size = n)
      </text>
    </svg>
  );
}
