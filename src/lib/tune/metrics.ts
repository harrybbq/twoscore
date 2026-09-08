/** Metric helpers, kept identical in spirit to the ones py/fit.py reports. */

export function mae(y: number[], p: number[]): number {
  if (!y.length) return NaN;
  return y.reduce((a, v, i) => a + Math.abs(v - p[i]), 0) / y.length;
}

function ranks(v: number[]): number[] {
  const idx = v.map((x, i) => [x, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array(v.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1; // average rank for ties
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

export function spearman(a: number[], b: number[]): number {
  if (a.length < 3) return NaN;
  const ra = ranks(a);
  const rb = ranks(b);
  const ma = ra.reduce((x, y) => x + y, 0) / ra.length;
  const mb = rb.reduce((x, y) => x + y, 0) / rb.length;
  let num = 0;
  let da = 0;
  let dbv = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    dbv += (rb[i] - mb) ** 2;
  }
  return da && dbv ? num / Math.sqrt(da * dbv) : NaN;
}

/** ROC-AUC via the rank identity — no sorting of pairs required. */
export function rocAuc(y: number[], p: number[]): number {
  const pos = y.reduce((a, v) => a + (v ? 1 : 0), 0);
  const neg = y.length - pos;
  if (!pos || !neg) return NaN;
  const r = ranks(p);
  let sumPos = 0;
  for (let i = 0; i < y.length; i++) if (y[i]) sumPos += r[i];
  return (sumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

export function precisionAtK(y: number[], p: number[], k = 20): number {
  const n = Math.min(k, y.length);
  if (!n) return NaN;
  const idx = p.map((v, i) => [v, i] as [number, number]).sort((a, b) => b[0] - a[0]).slice(0, n);
  return idx.reduce((a, [, i]) => a + (y[i] ? 1 : 0), 0) / n;
}

export interface CalibrationBin {
  bin: number;
  predicted: number;
  actual: number;
  n: number;
}

export function calibrationBins(y: number[], p: number[], bins = 10): CalibrationBin[] {
  const out: CalibrationBin[] = [];
  for (let i = 0; i < bins; i++) {
    const lo = i / bins;
    const hi = (i + 1) / bins;
    const idx: number[] = [];
    for (let j = 0; j < p.length; j++) {
      if (p[j] >= lo && (i === bins - 1 ? p[j] <= hi : p[j] < hi)) idx.push(j);
    }
    if (!idx.length) continue;
    out.push({
      bin: (lo + hi) / 2,
      predicted: idx.reduce((a, j) => a + p[j], 0) / idx.length,
      actual: idx.reduce((a, j) => a + y[j], 0) / idx.length,
      n: idx.length,
    });
  }
  return out;
}
