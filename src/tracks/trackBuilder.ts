import { Vector3 } from 'three';
import { buildArcChain } from './arcChain';
import { computeRacingLine } from './racingLine';
import { getTrackMeta } from './trackMetadata';
import { inRangeWrap, TRACK_BARRIER_MARGIN, uDistance, wrapU } from './trackMath';
import type {
  Corner,
  DRSZone,
  ElevationPoint,
  LonLat,
  Overpass,
  TrackData,
  TrackFeature,
  TrackSample,
} from './types';

const EARTH_RADIUS = 6371000;
const SAMPLE_STEP = 5; // metres between physics samples
const UP = new Vector3(0, 1, 0);

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function projectCoordinates(input: LonLat[]): Vector3[] {
  // The GeoJSON is a closed ring, so its last point repeats the first. Feeding
  // that duplicate into the closed spline creates a zero-length segment at the
  // start/finish line, which the arc-length lookup turns into a kink.
  const eps = 1e-9;
  const coords =
    input.length > 2 &&
    Math.abs(input[0][0] - input[input.length - 1][0]) < eps &&
    Math.abs(input[0][1] - input[input.length - 1][1]) < eps
      ? input.slice(0, -1)
      : input;
  let lat0 = 0;
  let lon0 = 0;
  for (const [lon, lat] of coords) {
    lat0 += lat;
    lon0 += lon;
  }
  lat0 = (lat0 / coords.length) * (Math.PI / 180);
  lon0 /= coords.length;
  const points = coords.map(([lon, lat]) => {
    const x = EARTH_RADIUS * (lon - lon0) * (Math.PI / 180) * Math.cos(lat0);
    const z = -EARTH_RADIUS * (lat * (Math.PI / 180) - lat0);
    return new Vector3(x, 0, z);
  });
  // Center on the bounding box so every circuit sits near the world origin.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  for (const p of points) {
    p.x -= cx;
    p.z -= cz;
  }
  return points;
}

function polygonLength(points: Vector3[]): number {
  let len = 0;
  for (let i = 0; i < points.length; i++) {
    len += points[i].distanceTo(points[(i + 1) % points.length]);
  }
  return len;
}

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function elevationAt(profile: ElevationPoint[], u: number): number {
  const pts = profile.slice().sort((a, b) => a.at - b.at);
  if (pts.length === 0) return 0;
  if (pts[0].at > 0) pts.unshift({ at: 0, height: pts[0].height });
  if (pts[pts.length - 1].at < 1) pts.push({ at: 1, height: pts[pts.length - 1].height });
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (u >= a.at && u <= b.at) {
      const span = b.at - a.at || 1;
      const t = (u - a.at) / span;
      return a.height + (b.height - a.height) * (0.5 - 0.5 * Math.cos(Math.PI * t));
    }
  }
  return pts[pts.length - 1].height;
}

function baseElevation(id: string, u: number, profile?: ElevationPoint[]): number {
  if (profile && profile.length > 1) return elevationAt(profile, u);
  const seed = (hashString(id) % 1000) / 1000;
  // Gentle natural roll for circuits without an authored profile.
  return (
    3.2 * Math.sin(u * Math.PI * 2 * 1.7 + seed * 6.28) +
    1.7 * Math.sin(u * Math.PI * 2 * 3.3 + seed * 3.14) +
    0.8 * Math.sin(u * Math.PI * 2 * 5.9 + seed * 1.57)
  );
}

function detectCorners(samplesXZ: Vector3[], smoothedK: number[], turnSigns: number[], ds: number): Corner[] {
  const n = samplesXZ.length;
  const corners: Corner[] = [];
  const threshold = 1 / 165;
  let i = 0;
  let guard = 0;
  while (i < n && guard < n * 2) {
    guard++;
    if (smoothedK[i] < threshold) {
      i++;
      continue;
    }
    let best = i;
    let bestK = smoothedK[i];
    let j = i;
    let steps = 0;
    while (j < i + Math.ceil(180 / ds) && j < i + n && steps < n) {
      const idx = j % n;
      if (smoothedK[idx] < threshold * 0.62 && j > i + 3) break;
      if (smoothedK[idx] > bestK) {
        bestK = smoothedK[idx];
        best = idx;
      }
      j++;
      steps++;
    }
    if (bestK > threshold) {
      corners.push({
        index: best,
        u: best / n,
        radius: 1 / bestK,
        direction: turnSigns[best] >= 0 ? 1 : -1,
      });
      i = j + Math.round(12 / ds);
    } else {
      i = j + 1;
    }
  }
  // Add dominant corners the scan may have merged.
  for (let k = 0; k < n; k += 2) {
    if (smoothedK[k] > 1 / 55) {
      const near = corners.some((c) => uDistance(c.u, k / n) < 0.012);
      if (!near) {
        corners.push({
          index: k,
          u: k / n,
          radius: 1 / smoothedK[k],
          direction: turnSigns[k] >= 0 ? 1 : -1,
        });
      }
    }
  }
  corners.sort((a, b) => a.u - b.u);
  return corners;
}

function autoDrsZones(samplesXZ: Vector3[], smoothedK: number[], length: number): DRSZone[] {
  const n = samplesXZ.length;
  const ds = length / n;
  const runs: Array<{ start: number; end: number }> = [];
  let start = -1;
  for (let i = 0; i < n; i++) {
    const straight = smoothedK[i] < 1 / 620;
    if (straight && start === -1) start = i;
    if (!straight && start !== -1) {
      if ((i - start) * ds > 320) runs.push({ start, end: i });
      start = -1;
    }
  }
  if (start !== -1 && (n - start) * ds > 320) runs.push({ start, end: n - 1 });
  runs.sort((a, b) => b.end - b.start - (a.end - a.start));
  return runs.slice(0, 2).map((r) => {
    const rawStart = r.start / n + 0.012;
    const rawEnd = r.end / n - 0.012;
    const s = wrapU(rawStart);
    const e = wrapU(Math.max(rawStart + 0.02, rawEnd));
    return { start: s, end: e, detection: wrapU(s - 0.012) };
  });
}

function buildPitLane(
  samples: TrackSample[],
  entryU: number,
  exitU: number,
  pitWidth: number,
  side: 1 | -1,
): Vector3[] {
  const n = samples.length;
  const span = 1 + exitU - entryU;
  const steps = 220;
  const lane: Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const uUnwrapped = entryU + t * span;
    const u = wrapU(uUnwrapped);
    const idx = Math.round(u * n) % n;
    const s = samples[idx];
    // Keep the lane centre outside the racing surface for its full length.
    // The offset uses the barrier distance so a narrowed section still has
    // room for the lane between the racing surface and the wall.
    const offset = Math.min(pitWidth, s.barrier + 2.4) * side;
    lane.push(
      new Vector3(
        s.pos.x + s.right.x * offset,
        s.pos.y + s.right.y * offset + 0.12,
        s.pos.z + s.right.z * offset,
      ),
    );
  }
  return lane;
}

/**
 * Smallest distance from the pit lane to a part of the circuit that is not the
 * straight it runs beside. Buddh's lane used to cut straight across another
 * section of the lap because the side was hard-coded to the right.
 */
function pitClearance(samples: TrackSample[], lane: Vector3[]): number {
  const n = samples.length;
  const localSkip = Math.max(20, Math.round(n * 0.055));
  let min = Infinity;
  for (let i = 0; i < lane.length; i += 3) {
    const p = lane[i];
    let nearest = 0;
    let nearestDist = Infinity;
    for (let j = 0; j < n; j++) {
      const d = Math.hypot(samples[j].pos.x - p.x, samples[j].pos.z - p.z);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = j;
      }
    }
    for (let j = 0; j < n; j++) {
      const idx = Math.min(Math.abs(j - nearest), n - Math.abs(j - nearest));
      if (idx <= localSkip) continue;
      const d = Math.hypot(samples[j].pos.x - p.x, samples[j].pos.z - p.z);
      if (d < min) min = d;
    }
  }
  return min;
}

/**
 * Narrow the ribbon where the circuit runs beside itself and lower the barrier
 * onto the shared edge. Figure-of-eight bridges are skipped by height, so
 * Suzuka keeps its full width across the overpass.
 */
function applyWidthTaper(samples: TrackSample[], baseWidth: number, ds: number, runOff: number): void {
  const n = samples.length;
  const skip = Math.max(24, Math.round(170 / ds));
  const separation = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = samples[i];
    let sep = Infinity;
    for (let k = skip; k <= n - skip; k++) {
      const b = samples[(i + k) % n];
      if (Math.abs(a.pos.y - b.pos.y) > 4.5) continue;
      const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
      if (d < sep) sep = d;
    }
    separation[i] = sep;
  }

  let widths = new Float32Array(n);
  const floor = Math.min(baseWidth, 6.4);
  for (let i = 0; i < n; i++) {
    const sep = separation[i];
    widths[i] = sep < baseWidth + 5 ? Math.max(floor, Math.min(baseWidth, sep - 3.4)) : baseWidth;
  }
  for (let pass = 0; pass < 4; pass++) {
    const copy = widths.slice();
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -7; k <= 7; k++) sum += copy[(i + k + n) % n];
      widths[i] = sum / 15;
    }
  }

  for (let i = 0; i < n; i++) {
    const w = widths[i];
    const open = w / 2 + TRACK_BARRIER_MARGIN * runOff;
    const shared = separation[i] < baseWidth + 5 ? Math.max(w / 2 + 0.25, separation[i] / 2 - 0.9) : open;
    samples[i].width = w;
    samples[i].barrier = Math.min(open, shared);
  }
}

/** Full build: GeoJSON feature -> smooth, scaled, banked 3D circuit. */
export function buildTrack(feature: TrackFeature, metaOverride?: ReturnType<typeof getTrackMeta>): TrackData {
  const meta = metaOverride ?? getTrackMeta(feature.id, feature.name);
  const width = meta.width ?? 13;
  const surface = meta.surface ?? 'asphalt';
  const projected = projectCoordinates(feature.coordinates);
  // A Catmull-Rom spline through the source polygon overshoots every corner:
  // the data is ~45 m apart on a 5.8 km lap, so a 20 m chicane cannot be
  // represented and the spline folds the ribbon into itself. Build the TORCS /
  // Speed Dreams representation instead - straights joined by constant-radius
  // arcs - which is tangent-continuous by construction and never leaves the
  // polygon.
  const chain = buildArcChain(projected, SAMPLE_STEP, width / 2 + 1.2);
  const raw = chain.points.map((p) => new Vector3(p.x, 0, p.z));

  // Scale to the real-world length in the GeoJSON's `length` property.
  const len2d = polygonLength(raw);
  const scale = feature.length / Math.max(1, len2d);
  const points = raw.map((p) => new Vector3(p.x * scale, 0, p.z * scale));
  const n = points.length;
  const length = polygonLength(points);
  const ds = length / n;

  // Elevation.
  for (let i = 0; i < n; i++) {
    points[i].y = baseElevation(feature.id, i / n, meta.elevation);
  }

  // Figure-of-eight overpass (Suzuka): find the nearest non-local crossing and
  // lift the later branch onto a bridge.
  let overpass: Overpass | null = null;
  if (meta.overpass) {
    let best = Infinity;
    let bestI = -1;
    let bestJ = -1;
    // Keep the separation an integer: adding a fractional offset to the
    // sample index makes points[j] undefined on figure-of-eight circuits.
    // A figure-of-eight's two passages can be only ~200 m apart along the lap,
    // so the search window has to be shorter than that or the real crossing is
    // skipped and some unrelated parallel straight gets lifted instead.
    const minSep = Math.max(16, Math.ceil(n * 0.02));
    for (let i = 0; i < n; i += 2) {
      for (let j = i + minSep; j < n; j += 2) {
        const a = points[i];
        const b = points[j];
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d < best) {
          best = d;
          bestI = i;
          bestJ = j;
        }
      }
    }
    if (best < 40 && bestI >= 0) {
      const bridgeIndex = bestJ;
      // High enough that the two branches are clear of each other well before
      // the ramps come back down; a low bridge left the crossing roads at
      // almost the same height for 30 m either side and the ribbons overlapped.
      // The elevation profile can already have the lower leg higher than the
      // leg we are lifting (Suzuka's profile climbs into the crossover), which
      // made a fixed 9 m bridge only 3.7 m clear in practice. Lift until the
      // bridge is genuinely above the road it crosses.
      const height = Math.max(9.2, points[bestI].y + 8.5 - points[bridgeIndex].y);
      // How far the two legs of the eight run beside each other varies a lot:
      // at Suzuka they share ground for several hundred metres, so a fixed
      // window either left them overlapping or lifted half the circuit. Walk
      // out from the crossing while the branches are still close and hold full
      // height over that whole run, then ramp down where they have separated.
      const separation = new Float32Array(n);
      const minGap = Math.ceil(n * 0.06);
      for (let i = 0; i < n; i++) {
        const a = points[i];
        let nearest = Infinity;
        for (let k = minGap; k <= n - minGap; k++) {
          const b = points[(i + k) % n];
          const d = Math.hypot(a.x - b.x, a.z - b.z);
          if (d < nearest) nearest = d;
        }
        separation[i] = nearest;
      }
      const conflict = 26;
      let startIdx = bridgeIndex;
      let endIdx = bridgeIndex;
      for (let k = 1; k < n; k++) {
        if (separation[(bridgeIndex - k + n) % n] >= conflict) break;
        startIdx = (bridgeIndex - k + n) % n;
      }
      for (let k = 1; k < n; k++) {
        if (separation[(bridgeIndex + k) % n] >= conflict) break;
        endIdx = (bridgeIndex + k) % n;
      }
      const spanLength = ((endIdx - startIdx + n) % n) / ds;
      const ramp = Math.round(Math.min(160, Math.max(80, spanLength * 0.8)) / ds);
      const ease = (t: number) => {
        const x = Math.max(0, Math.min(1, t));
        return x * x * (3 - 2 * x);
      };
      // Ramp up before the conflict zone, hold full height across it, ramp down
      // after: the low ends are then well clear of the other leg.
      for (let k = 1; k <= ramp; k++) {
        points[(startIdx - k + n) % n].y += height * (1 - ease(k / ramp));
        points[(endIdx + k) % n].y += height * (1 - ease(k / ramp));
      }
      let i = startIdx;
      while (i !== endIdx) {
        points[i].y += height;
        i = (i + 1) % n;
      }
      points[endIdx].y += height;
      const p = points[bridgeIndex];
      overpass = {
        u: bridgeIndex / n,
        index: bridgeIndex,
        height: points[bridgeIndex].y - points[(endIdx + ramp + 2) % n].y,
        point: p.clone(),
      };
    }
  }

  // Horizontal tangents, signed curvature and corner direction.
  const xzTangent: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[(i - 1 + n) % n];
    const b = points[(i + 1) % n];
    xzTangent.push(new Vector3(b.x - a.x, 0, b.z - a.z).normalize());
  }
  const rawK = new Float32Array(n);
  const turnSigns = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    const prev = xzTangent[(i - 1 + n) % n];
    const next = xzTangent[(i + 1) % n];
    const cross = prev.x * next.z - prev.z * next.x;
    const dot = Math.max(-1, Math.min(1, prev.x * next.x + prev.z * next.z));
    const angle = Math.abs(Math.atan2(cross, dot));
    rawK[i] = angle / (2 * ds);
    turnSigns[i] = cross > 0.0004 ? 1 : cross < -0.0004 ? -1 : 0;
  }
  const smoothedK = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let w = 0;
    for (let k = -6; k <= 6; k++) {
      const weight = 1 - Math.abs(k) / 7;
      sum += rawK[(i + k + n) % n] * weight;
      w += weight;
    }
    smoothedK[i] = sum / w;
  }
  // The smoothed curvature is what the ribbon, kerbs and racing line use, but
  // averaging over ~30 m halves the apparent tightness of a chicane. Apex
  // speeds must use the sharpest curvature nearby or every slow corner is
  // driven in far too fast.
  const peakK = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let peak = smoothedK[i];
    for (let k = -4; k <= 4; k++) peak = Math.max(peak, rawK[(i + k + n) % n]);
    // Cap how much sharper than the smoothed value a single raw sample can
    // make the corner: GPS kinks would otherwise halve the speed of a whole
    // circuit.
    peakK[i] = Math.min(peak, smoothedK[i] * 1.35);
  }

  const corners = detectCorners(points, smoothedK, Array.from(turnSigns), ds);

  // Resolve banking peaks (snap Zandvoort's Turn 3 / Turn 14 onto real corners).
  const bankCenters: Array<{ at: number; deg: number; spread: number }> = [];
  for (const b of meta.banking ?? []) {
    let at = b.at;
    if (b.snapWindow) {
      let best = b.snapWindow;
      for (const c of corners) {
        const d = uDistance(c.u, b.at);
        if (d < best && d < b.snapWindow) {
          best = d;
          at = c.u;
        }
      }
    }
    bankCenters.push({ at, deg: b.deg, spread: Math.max(0.012, b.spread) });
  }

  const samples: TrackSample[] = [];
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const pos = points[i];
    const tangent = new Vector3(
      points[(i + 1) % n].x - points[(i - 1 + n) % n].x,
      points[(i + 1) % n].y - points[(i - 1 + n) % n].y,
      points[(i + 1) % n].z - points[(i - 1 + n) % n].z,
    ).normalize();
    const rightFlat = new Vector3().crossVectors(UP, tangent).normalize();
    const upFlat = new Vector3().crossVectors(tangent, rightFlat).normalize();
    const turnSign = turnSigns[i];
    let bankDeg = 0;
    for (const b of bankCenters) {
      const d = uDistance(u, b.at);
      bankDeg += b.deg * Math.exp(-(d * d) / (b.spread * b.spread));
    }
    bankDeg = Math.min(20, bankDeg);
    const bankSigned = -turnSign * (bankDeg * Math.PI) / 180;
    const cosB = Math.cos(bankSigned);
    const sinB = Math.sin(bankSigned);
    const up = new Vector3()
      .copy(upFlat)
      .multiplyScalar(cosB)
      .addScaledVector(rightFlat, sinB)
      .normalize();
    const lateral = new Vector3()
      .copy(rightFlat)
      .multiplyScalar(cosB)
      .addScaledVector(upFlat, -sinB)
      .normalize();
    const sector: 1 | 2 | 3 = u < 1 / 3 ? 1 : u < 2 / 3 ? 2 : 3;
    samples.push({
      index: i,
      pos,
      tangent,
      right: lateral,
      up,
      u,
      width,
      barrier: width / 2 + TRACK_BARRIER_MARGIN,
      bankDeg,
      turnSign,
      curvature: smoothedK[i],
      radius: 1 / Math.max(1e-5, smoothedK[i]),
      peakRadius: 1 / Math.max(1e-5, peakK[i]),
      sector,
      drs: false,
      kerb: surface === 'asphalt' && (smoothedK[i] > 1 / 210 || vehicleKerb(i, smoothedK, n)),
    });
  }

  // Narrow any stretch that runs right beside another part of the lap and put
  // the barrier on the shared edge, so ribbons never overlap each other.
  applyWidthTaper(samples, width, ds, surface === 'gravel' ? 1.85 : 1);

  const drsZones: DRSZone[] =
    surface === 'gravel'
      ? []
      : meta.drs
        ? meta.drs.map(([start, end]) => ({ start: wrapU(start), end: wrapU(end), detection: wrapU(start - 0.01) }))
        : autoDrsZones(points, smoothedK, length);
  for (const s of samples) {
    s.drs = drsZones.some((z) => inRangeWrap(s.u, z.start, z.end));
  }

  const pitEntryU = meta.pitEntry ?? 0.86;
  const pitExitU = meta.pitExit ?? 0.055;
  const pitBoxU = meta.pitBox ?? 0.972;
  // Rally stages are point-to-point in spirit; a service park is not a
  // raceable pit lane, so do not project one onto the stage surface.
  let pitLane: Vector3[] = [];
  let pitSide: 1 | -1 = 1;
  if (surface !== 'gravel') {
    const laneOffset = width / 2 + 4.6;
    const rightLane = buildPitLane(samples, pitEntryU, pitExitU, laneOffset, 1);
    const leftLane = buildPitLane(samples, pitEntryU, pitExitU, laneOffset, -1);
    const rightClearance = pitClearance(samples, rightLane);
    const leftClearance = pitClearance(samples, leftLane);
    pitSide = leftClearance > rightClearance + 0.5 ? -1 : 1;
    pitLane = pitSide === 1 ? rightLane : leftLane;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const s of samples) {
    minX = Math.min(minX, s.pos.x);
    maxX = Math.max(maxX, s.pos.x);
    minZ = Math.min(minZ, s.pos.z);
    maxZ = Math.max(maxZ, s.pos.z);
  }

  const racingLine = computeRacingLine(samples, length);

  return {
    id: feature.id,
    name: feature.name,
    location: feature.location,
    opened: feature.opened,
    length,
    surface,
    width,
    night: Boolean(meta.night),
    samples,
    corners,
    drsZones,
    pitLane,
    pitSide,
    pitEntryU,
    pitExitU,
    pitBoxU,
    overpass,
    center: new Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2),
    bounds: { minX, maxX, minZ, maxZ },
    sectorMarks: [1 / 3, 2 / 3],
    racingLine,
  };
}

function vehicleKerb(i: number, k: number[], n: number): boolean {
  // Kerbs also line the exit of slow corners, where curvature is already low
  // but it was high a few car lengths ago.
  const lookBack = 13;
  let peak = 0;
  for (let j = 1; j <= lookBack; j++) peak = Math.max(peak, k[(i - j + n) % n]);
  return peak > 1 / 120;
}
