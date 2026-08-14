// Shared SVG path math for the site's two multi-series charts — the Earnings
// equity curve (lib/earnings-model.js) and the Rankings climb
// (lib/rankings-model.js). Lifted out of earnings-model.js when the climb
// landed and needed the identical curve.

/**
 * Monotone cubic Hermite interpolation (Fritsch-Carlson) through `points`.
 *
 * Chosen over a Catmull-Rom spline because it cannot overshoot: the curve
 * between two points always stays within their values. Both callers depend on
 * that for correctness rather than looks — a cumulative winnings curve must
 * never dip below a total it actually reached, and a rank curve must never
 * bulge past a finish nobody had.
 *
 * Zero-width segments (a repeated x) are legal and are load-bearing for the
 * Earnings toggle, which pads every series to the same command count so the two
 * views can interpolate command-for-command. dx === 0 forces that segment's
 * slope to 0 rather than dividing by zero, and collapses its two control points
 * onto the point itself — a valid, invisible command holding the series' place.
 *
 * @param {{x: number, y: number}[]} points
 * @returns {string} an SVG path `d` attribute
 */
export function monotonePath(points) {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M${points[0].x} ${points[0].y}`;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const dx = [];
  const slope = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(xs[i + 1] - xs[i]);
    slope.push(dx[i] === 0 ? 0 : (ys[i + 1] - ys[i]) / dx[i]);
  }
  const m = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    const same = slope[i - 1] !== 0 && slope[i] !== 0 && (slope[i - 1] < 0) === (slope[i] < 0);
    m[i] = same ? (slope[i - 1] + slope[i]) / 2 : 0;
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) continue; // m[i] and m[i + 1] are already 0 here by construction
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      const tau = 3 / h;
      m[i] = tau * a * slope[i];
      m[i + 1] = tau * b * slope[i];
    }
  }
  let d = `M${+xs[0].toFixed(2)} ${+ys[0].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const x1 = +(xs[i] + dx[i] / 3).toFixed(2);
    const y1 = +(ys[i] + (m[i] * dx[i]) / 3).toFixed(2);
    const x2 = +(xs[i + 1] - dx[i] / 3).toFixed(2);
    const y2 = +(ys[i + 1] - (m[i + 1] * dx[i]) / 3).toFixed(2);
    d += ` C${x1} ${y1} ${x2} ${y2} ${+xs[i + 1].toFixed(2)} ${+ys[i + 1].toFixed(2)}`;
  }
  return d;
}
