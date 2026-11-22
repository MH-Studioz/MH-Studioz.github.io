import type { Vector3 } from 'three';

/**
 * Track geometry built the way TORCS and Speed Dreams describe a circuit: an
 * ordered chain of straights and constant-radius arcs. Real circuits are
 * designed that way, and the representation has a property a spline does not:
 * two consecutive segments share a tangent, so the ribbon can never kink,
 * overshoot or fold back on itself.
 *
 * The source circuit data is a coarse polygon (roughly 45 m between points on
 * a 5.8 km lap), which is far too sparse for a Catmull-Rom spline: the spline
 * overshoots every corner, and a 20 m chicane ends up inside a 13 m wide road.
 * Cutting a circular fillet at each polygon vertex produces the arc/straight
 * chain instead. The fillet always stays inside the polygon, so the result
 * follows the real layout without inventing geometry.
 */

interface P {
  x: number;
  z: number;
}

const TAU = Math.PI * 2;

function sub(a: P, b: P): P {
  return { x: a.x - b.x, z: a.z - b.z };
}

function len(a: P): number {
  return Math.hypot(a.x, a.z);
}

function norm(a: P): P {
  const l = len(a);
  return l < 1e-9 ? { x: 0, z: 0 } : { x: a.x / l, z: a.z / l };
}

function dist(a: P, b: P): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Perpendicular distance from p to the segment a-b. */
function pointSegmentDistance(p: P, a: P, b: P): number {
  const ab = sub(b, a);
  const l2 = ab.x * ab.x + ab.z * ab.z;
  if (l2 < 1e-9) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.z - a.z) * ab.z) / l2));
  return Math.hypot(p.x - (a.x + ab.x * t), p.z - (a.z + ab.z * t));
}

/**
 * Drop duplicate and near-collinear vertices. Collinear noise is what makes a
 * fillet flicker between segments, and duplicate points create a zero-length
 * edge whose tangent is undefined.
 */
function simplifyRing(input: P[], tolerance: number): P[] {
  let pts = input.slice();
  // Remove points that repeat their neighbour.
  pts = pts.filter((p, i) => dist(p, pts[(i + 1) % pts.length]) > 0.75);
  for (let pass = 0; pass < 4; pass++) {
    let removed = 0;
    const out: P[] = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const next = pts[(i + 1) % pts.length];
      if (pts.length > 8 && pointSegmentDistance(pts[i], prev, next) < tolerance) {
        removed++;
        continue;
      }
      out.push(pts[i]);
    }
    pts = out;
    if (removed === 0) break;
  }
  return pts;
}

/**
 * Signed angle change at vertex b travelling a -> b -> c. Positive turns right
 * (towards +right / clockwise seen from above), matching the game's sign
 * convention where positive curvature bends towards `sample.right`.
 */
function deflection(a: P, b: P, c: P): { angle: number; dir: P; dir2: P } {
  const dir = norm(sub(b, a));
  const dir2 = norm(sub(c, b));
  const cross = dir.x * dir2.z - dir.z * dir2.x;
  const dot = dir.x * dir2.x + dir.z * dir2.z;
  return { angle: Math.atan2(cross, dot), dir, dir2 };
}

export interface ArcChain {
  /** Closed ring sampled at a fixed arc-length step. */
  points: P[];
  /** Exact lap length of the chain, metres. */
  length: number;
  /** Radius of the tightest arc in the chain, metres. */
  minRadius: number;
}

/**
 * Build the arc/straight chain. `minRadius` is the tightest geometry the road
 * can legally describe: a centreline tighter than half the road width plus a
 * margin makes the inside edge of the ribbon cross itself.
 */
export function buildArcChain(points: Vector3[], step: number, minRadius: number): ArcChain {
  // The tolerance has to stay well below the chord sagitta of a real corner.
  // At 0.9 m an entire 20 m radius bend was erased (its sagitta over a 46 m
  // gap is only 0.4 m), which flattened Monza's chicanes and Monaco's hairpin.
  const ring = simplifyRing(
    points.map((p) => ({ x: p.x, z: p.z })),
    0.15,
  );
  const n = ring.length;
  if (n < 4) {
    const flat = points.map((p) => ({ x: p.x, z: p.z }));
    return { points: resampleRing(flat, step), length: ringLength(flat), minRadius };
  }

  const fillets: Array<{
    start: P;
    end: P;
    center: P;
    radius: number;
    from: number;
    sweep: number;
  }> = [];

  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n];
    const here = ring[i];
    const next = ring[(i + 1) % n];
    const { angle, dir, dir2 } = deflection(prev, here, next);
    const turn = Math.abs(angle);
    if (turn < 0.035) {
      fillets.push({ start: here, end: here, center: here, radius: Infinity, from: 0, sweep: 0 });
      continue;
    }
    // Each vertex may consume at most 45% of the shorter adjoining edge, so
    // two neighbouring fillets can never overlap on the same edge.
    const maxTangent = 0.45 * Math.min(dist(prev, here), dist(here, next));
    const wantRadius = maxTangent / Math.tan(turn / 2);
    const radius = Math.max(minRadius, Math.min(wantRadius, 900));
    const tangent = Math.min(maxTangent, radius * Math.tan(turn / 2));
    const start = { x: here.x - dir.x * tangent, z: here.z - dir.z * tangent };
    const end = { x: here.x + dir2.x * tangent, z: here.z + dir2.z * tangent };
    const sign = Math.sign(angle) || 1;
    // Centre sits on the inside of the turn: rotate the incoming direction by
    // +/- 90 degrees and step one radius to that side.
    const nx = -dir.z * sign;
    const nz = dir.x * sign;
    const center = { x: start.x + nx * radius, z: start.z + nz * radius };
    const from = Math.atan2(start.z - center.z, start.x - center.x);
    fillets.push({ start, end, center, radius, from, sweep: angle });
  }

  // Walk the chain: straight into each fillet, then the arc itself.
  const out: P[] = [];
  const push = (p: P) => {
    const last = out[out.length - 1];
    if (!last || dist(last, p) > 1e-6) out.push(p);
  };
  for (let i = 0; i < n; i++) {
    const f = fillets[i];
    if (!Number.isFinite(f.radius)) {
      push({ x: f.start.x, z: f.start.z });
      continue;
    }
    const steps = Math.max(2, Math.ceil((Math.abs(f.sweep) * f.radius) / Math.min(step, 2)));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const a = f.from + f.sweep * t;
      push({ x: f.center.x + Math.cos(a) * f.radius, z: f.center.z + Math.sin(a) * f.radius });
    }
  }

  out.push(out[0]);
  const resampled = resampleRing(out, step);
  const minR = fillets.reduce((m, f) => Math.min(m, f.radius), Infinity);
  return { points: resampled, length: ringLength(resampled), minRadius: minR };
}

function ringLength(points: P[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    total += dist(points[i], points[(i + 1) % points.length]);
  }
  return total;
}

/** Resample a closed polyline at a constant arc-length step. */
function resampleRing(points: P[], step: number): P[] {
  const n = points.length;
  if (n < 3) return points.slice();
  const total = ringLength(points);
  const count = Math.max(16, Math.round(total / Math.max(0.5, step)));
  const ds = total / count;
  const out: P[] = [];
  let target = 0;
  let travelled = 0;
  let i = 0;
  for (let k = 0; k < count; k++) {
    while (i < n) {
      const a = points[i];
      const b = points[(i + 1) % n];
      const segLen = dist(a, b);
      if (travelled + segLen >= target || segLen < 1e-9) {
        const t = segLen < 1e-9 ? 0 : (target - travelled) / segLen;
        out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
        break;
      }
      travelled += segLen;
      i++;
    }
    target += ds;
  }
  return out;
}

export type { P as ArcPoint };
export const ARC_TAU = TAU;
