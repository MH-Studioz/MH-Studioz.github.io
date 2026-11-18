import { Vector3 } from 'three';
import type { TrackData, TrackSample } from './types';

export const TRACK_BARRIER_MARGIN = 6.15;

export function wrapU(u: number): number {
  return ((u % 1) + 1) % 1;
}

export function uDistance(a: number, b: number): number {
  const d = Math.abs(wrapU(a) - wrapU(b));
  return Math.min(d, 1 - d);
}

export function inRangeWrap(u: number, start: number, end: number): boolean {
  const x = wrapU(u);
  const s = wrapU(start);
  const e = wrapU(end);
  if (s <= e) return x >= s && x <= e;
  return x >= s || x <= e;
}

export function sampleAtU(track: TrackData, u: number): TrackSample {
  const n = track.samples.length;
  const idx = Math.round(wrapU(u) * n) % n;
  return track.samples[idx];
}

export function indexAtU(track: TrackData, u: number): number {
  const n = track.samples.length;
  return Math.round(wrapU(u) * n) % n;
}

/**
 * Local nearest-sample search. Physics calls this every substep, so the hint
 * window keeps it O(1) instead of scanning thousands of samples.
 */
export function nearestSampleIndex(track: TrackData, x: number, z: number, hint?: number, window = 45): number {
  const samples = track.samples;
  const n = samples.length;
  let best = -1;
  let bestD = Infinity;
  if (hint === undefined) {
    for (let i = 0; i < n; i++) {
      const p = samples[i].pos;
      const dx = p.x - x;
      const dz = p.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
  for (let k = -window; k <= window; k++) {
    const i = (hint + k + n) % n;
    const p = samples[i].pos;
    const dx = p.x - x;
    const dz = p.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  // If the car left the local window (respawn, teleport, huge physics step),
  // fall back to a global scan so it can never get lost.
  if (bestD > 400 * 400) {
    for (let i = 0; i < n; i++) {
      const p = samples[i].pos;
      const dx = p.x - x;
      const dz = p.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  return best;
}

export function lateralOffset(sample: TrackSample, x: number, z: number): number {
  return (x - sample.pos.x) * sample.right.x + (z - sample.pos.z) * sample.right.z;
}

/** Height of the banked surface at a lateral offset from the centerline. */
export function surfaceHeight(sample: TrackSample, lateral: number): number {
  return sample.pos.y + lateral * sample.right.y;
}

export function progressDelta(prevU: number, u: number): number {
  let d = u - prevU;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return d;
}

export function projectedForward(sample: TrackSample, out = new Vector3()): Vector3 {
  out.set(sample.tangent.x, 0, sample.tangent.z);
  if (out.lengthSq() < 1e-8) out.set(0, 0, 1);
  return out.normalize();
}

export function projectedRight(sample: TrackSample, out = new Vector3()): Vector3 {
  out.set(sample.right.x, 0, sample.right.z);
  if (out.lengthSq() < 1e-8) out.set(1, 0, 0);
  return out.normalize();
}
