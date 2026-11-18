import { CatmullRomCurve3, Vector3 } from 'three';
import { computeRacingLine } from './racingLine';
import { getTrackMeta } from './trackMetadata';
import { inRangeWrap, uDistance, wrapU } from './trackMath';
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

function projectCoordinates(coords: LonLat[]): Vector3[] {
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
    const inT = smoothstep((uUnwrapped - entryU) / 0.028);
    const outT = smoothstep(((1 + exitU) - uUnwrapped) / 0.035);
    const offset = pitWidth * inT * outT;
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

/** Full build: GeoJSON feature -> smooth, scaled, banked 3D circuit. */
export function buildTrack(feature: TrackFeature, metaOverride?: ReturnType<typeof getTrackMeta>): TrackData {
  const meta = metaOverride ?? getTrackMeta(feature.id, feature.name);
  const width = meta.width ?? 13;
  const projected = projectCoordinates(feature.coordinates);
  const curve = new CatmullRomCurve3(projected, true, 'centripetal', 0.5);
  const approxLength = Math.max(curve.getLength(), 500);
  const count = Math.max(500, Math.min(2400, Math.round(approxLength / SAMPLE_STEP)));
  const raw = curve.getSpacedPoints(count).slice(0, count);

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
    const minSep = n * 0.22;
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
    if (best < 30 && bestI >= 0) {
      const bridgeIndex = bestJ;
      const height = 7.5;
      const half = Math.round(65 / ds);
      for (let k = -half; k <= half; k++) {
        const idx = (bridgeIndex + k + n) % n;
        const t = Math.abs(k) / half;
        const bump = height * (0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, t)));
        points[idx].y += bump;
      }
      const p = points[bridgeIndex];
      overpass = {
        u: bridgeIndex / n,
        index: bridgeIndex,
        height: points[bridgeIndex].y - points[(bridgeIndex + half) % n].y,
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
      bankDeg,
      turnSign,
      curvature: smoothedK[i],
      radius: 1 / Math.max(1e-5, smoothedK[i]),
      sector,
      drs: false,
      kerb: smoothedK[i] > 1 / 210 || vehicleKerb(i, smoothedK, n),
    });
  }

  const drsZones: DRSZone[] = meta.drs
    ? meta.drs.map(([start, end]) => ({ start: wrapU(start), end: wrapU(end), detection: wrapU(start - 0.01) }))
    : autoDrsZones(points, smoothedK, length);
  for (const s of samples) {
    s.drs = drsZones.some((z) => inRangeWrap(s.u, z.start, z.end));
  }

  const pitEntryU = meta.pitEntry ?? 0.86;
  const pitExitU = meta.pitExit ?? 0.055;
  const pitBoxU = meta.pitBox ?? 0.972;
  const pitLane = buildPitLane(samples, pitEntryU, pitExitU, width / 2 + 7.5);

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
    width,
    night: Boolean(meta.night),
    samples,
    corners,
    drsZones,
    pitLane,
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
