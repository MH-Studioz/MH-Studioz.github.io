import type { RacingLine, TrackSample } from './types';

const GRAVITY = 9.81;
const TOP_SPEED = 93.5; // m/s, aero-limited on a long straight
const BRAKE_DECEL = 40; // m/s^2, ~4 g including aero drag

/** Keep the line off the white line / barrier by this much. */
const EDGE_MARGIN = 1.5;
/** Kerbs are part of the track through a real corner. */
const KERB_ALLOWANCE = 0.45;

/**
 * Relaxation scales in samples. Working from coarse to fine is what lets the
 * line straighten a whole complex (a chicane, the Ascari lakes) before it
 * starts resolving individual apexes; starting fine would lock in whatever
 * kinky shape the centreline happened to have.
 */
const SCALES = [40, 28, 19, 13, 9, 6, 4, 3, 2, 1];
const PASSES_PER_SCALE = 40;
const RELAX = 0.5;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Minimum-curvature racing line plus a speed profile with real braking points.
 *
 * The old version offset the line by a fixed 27% of the half width on the
 * inside of every corner. That is not a racing line: it turns a chicane into a
 * slalom, it puts the car on the inside kerb through a corner that should be
 * taken wide, and because the line was never measured, the apex speeds were
 * taken from the centreline radius instead.
 *
 * This relaxes the lateral offset until ∫κ² is stationary (a discrete
 * biharmonic solve) while the line stays inside the usable width, which is the
 * same construction the reference sim uses. The resulting path is the one the
 * AI drives, the overlay draws, and the speeds are measured from.
 */
export function computeRacingLine(samples: TrackSample[], trackLength: number): RacingLine {
  const n = samples.length;
  const ds = trackLength / n;
  const offsets = new Float32Array(n);
  const targetSpeed = new Float32Array(n);
  const braking = new Float32Array(n);
  const lineRadius = new Float32Array(n);

  // ------- usable corridor ------------------------------------------------
  const lo = new Float32Array(n);
  const hi = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const half = Math.max(2.5, s.width * 0.5 - EDGE_MARGIN);
    let low = -half;
    let high = half;
    if (s.kerb) {
      low -= KERB_ALLOWANCE;
      high += KERB_ALLOWANCE;
    }
    lo[i] = low;
    hi[i] = high;
  }

  // ------- multi-scale relaxation ----------------------------------------
  const px = new Float32Array(n);
  const pz = new Float32Array(n);
  const updatePositions = () => {
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      px[i] = s.pos.x + s.right.x * offsets[i];
      pz[i] = s.pos.z + s.right.z * offsets[i];
    }
  };

  offsets.fill(0);
  for (const k of SCALES) {
    if (4 * k >= n / 2) continue;
    const k2 = 2 * k;
    for (let pass = 0; pass < PASSES_PER_SCALE; pass++) {
      updatePositions();
      for (let i = 0; i < n; i++) {
        const a = (i - k + n) % n;
        const b = (i + k) % n;
        const c = (i - k2 + n) % n;
        const d = (i + k2) % n;
        // Stationary point of Σ|P''|²: P = (4(P₋₁+P₊₁) − (P₋₂+P₊₂)) / 6.
        const tx = (4 * (px[a] + px[b]) - (px[c] + px[d])) / 6;
        const tz = (4 * (pz[a] + pz[b]) - (pz[c] + pz[d])) / 6;
        const s = samples[i];
        const wanted = (tx - s.pos.x) * s.right.x + (tz - s.pos.z) * s.right.z;
        const next = clamp(wanted, lo[i], hi[i]);
        offsets[i] += RELAX * (next - offsets[i]);
      }
    }
  }
  // Remove the kinks the width clamp leaves behind.
  for (let pass = 0; pass < 4; pass++) {
    const copy = offsets.slice();
    for (let i = 0; i < n; i++) {
      const smooth = (copy[(i - 1 + n) % n] + 2 * copy[i] + copy[(i + 1) % n]) * 0.25;
      offsets[i] = clamp(smooth, lo[i], hi[i]);
    }
  }
  updatePositions();

  // ------- curvature of the line -----------------------------------------
  const segLen = new Float32Array(n);
  const heading = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = px[j] - px[i];
    const dz = pz[j] - pz[i];
    segLen[i] = Math.max(0.1, Math.hypot(dx, dz));
    heading[i] = Math.atan2(dx, dz);
  }
  const rawK = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let delta = heading[i] - heading[(i - 1 + n) % n];
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    rawK[i] = delta / ((segLen[(i - 1 + n) % n] + segLen[i]) * 0.5);
  }
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let weight = 0;
    for (let k = -3; k <= 3; k++) {
      const w = 1 - Math.abs(k) / 4;
      sum += Math.abs(rawK[(i + k + n) % n]) * w;
      weight += w;
    }
    const kappa = sum / weight;
    lineRadius[i] = kappa < 1e-5 ? 1e5 : 1 / kappa;
  }

  // ------- speed profile --------------------------------------------------
  for (let i = 0; i < n; i++) {
    const radius = Math.max(9, lineRadius[i]);
    targetSpeed[i] = Math.min(TOP_SPEED, Math.sqrt(1.62 * GRAVITY * radius) * 1.02);
  }
  // Backward braking pass over the closed loop, twice so it is continuous
  // across the start/finish line.
  for (let pass = 0; pass < 2; pass++) {
    for (let k = n - 1; k >= 0; k--) {
      const i = k;
      const next = (i + 1) % n;
      const limit = Math.sqrt(targetSpeed[next] * targetSpeed[next] + 2 * BRAKE_DECEL * segLen[i]);
      if (targetSpeed[i] > limit) targetSpeed[i] = limit;
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      const limit = Math.sqrt(targetSpeed[i] * targetSpeed[i] + 2 * 13 * segLen[i]);
      if (targetSpeed[next] > limit) targetSpeed[next] = limit;
    }
  }

  // Braking demand over the next ~90 m, for the red/yellow/green line colours.
  const lookahead = Math.max(4, Math.round(90 / ds));
  for (let i = 0; i < n; i++) {
    let minAhead = targetSpeed[i];
    for (let k = 1; k <= lookahead; k += 2) {
      const v = targetSpeed[(i + k) % n];
      if (v < minAhead) minAhead = v;
    }
    const demand = (targetSpeed[i] * targetSpeed[i] - minAhead * minAhead) / (2 * 90 * BRAKE_DECEL);
    braking[i] = clamp(demand, 0, 1);
  }

  return { offsets, targetSpeed, braking, lineRadius };
}
