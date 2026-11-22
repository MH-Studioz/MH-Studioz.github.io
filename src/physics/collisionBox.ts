/**
 * Car-to-car contact for oriented footprints.
 *
 * The old approximation used two circles per car. That shape is shorter and
 * narrower than the body it stands for (a 5.8 m open-wheeler lived inside a
 * 4.9 m capsule), so cars visibly passed through each other nose-to-tail and
 * overlapped wheel-to-wheel. Two oriented boxes with the real half lengths and
 * half widths separate exactly where the bodywork is, so nothing interpenetrates
 * and nothing stops short of a touch either.
 */

export interface CarFootprint {
  x: number;
  z: number;
  /** Heading in radians; forward is (sin, cos). */
  heading: number;
  /** Half of the body length, bumper to bumper. */
  halfLength: number;
  /** Half of the body width, wheel face to wheel face. */
  halfWidth: number;
  /** Longitudinal offset of the footprint centre from the car origin, forward positive. */
  centerOffset: number;
}

export interface CarContact {
  /** Unit normal pointing from `a` towards `b`. */
  nx: number;
  nz: number;
  /** Penetration depth along that normal, in metres. */
  overlap: number;
}

interface Axes {
  fx: number;
  fz: number;
  rx: number;
  rz: number;
  cx: number;
  cz: number;
}

function axesFor(box: CarFootprint, right: { x: number; z: number }): Axes {
  const fx = Math.sin(box.heading);
  const fz = Math.cos(box.heading);
  // Perpendicular to forward, with the sign of the track's own right vector so
  // a coincident pair still resolves to a stable, race-safe direction.
  const sign = fx * right.z - fz * right.x >= 0 ? 1 : -1;
  const rx = fz * sign;
  const rz = -fx * sign;
  return {
    fx,
    fz,
    rx,
    rz,
    cx: box.x + fx * box.centerOffset,
    cz: box.z + fz * box.centerOffset,
  };
}

/**
 * Separating-axis test between two car footprints.
 * Returns the shallowest contact (the axis to push apart on) or null when clear.
 */
export function carContact(a: CarFootprint, b: CarFootprint): CarContact | null {
  const right = { x: Math.cos(a.heading), z: -Math.sin(a.heading) };
  const A = axesFor(a, right);
  const B = axesFor(b, right);

  const dx = B.cx - A.cx;
  const dz = B.cz - A.cz;
  if (Math.abs(dx) > a.halfLength + a.halfWidth + b.halfLength + b.halfWidth + 0.001) return null;

  const testAxes: Array<[number, number]> = [
    [A.fx, A.fz],
    [A.rx, A.rz],
    [B.fx, B.fz],
    [B.rx, B.rz],
  ];

  let bestOverlap = Infinity;
  let bestX = 0;
  let bestZ = 0;
  for (const [ax, az] of testAxes) {
    const dist = dx * ax + dz * az;
    const ra =
      a.halfLength * Math.abs(A.fx * ax + A.fz * az) + a.halfWidth * Math.abs(A.rx * ax + A.rz * az);
    const rb =
      b.halfLength * Math.abs(B.fx * ax + B.fz * az) + b.halfWidth * Math.abs(B.rx * ax + B.rz * az);
    const overlap = ra + rb - Math.abs(dist);
    if (overlap <= 0) return null;
    if (overlap < bestOverlap) {
      bestOverlap = overlap;
      const sign = dist < 0 ? -1 : 1;
      bestX = ax * sign;
      bestZ = az * sign;
    }
  }

  if (!Number.isFinite(bestOverlap)) return null;
  return { nx: bestX, nz: bestZ, overlap: bestOverlap };
}
