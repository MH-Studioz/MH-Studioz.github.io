import type { RacingLine, TrackSample } from './types';

const GRAVITY = 9.81;
const TOP_SPEED = 93; // m/s, aero-limited on a long straight
const BRAKE_DECEL = 42; // m/s^2, ~4.3 g including aero drag

/**
 * Produces a smooth inside-apex line plus a speed profile with real braking
 * points. The AI uses it, the 3D racing-line overlay draws it, and the
 * braking-distance boards are derived from it.
 */
export function computeRacingLine(samples: TrackSample[], trackLength: number): RacingLine {
  const n = samples.length;
  const offsets = new Float32Array(n);
  const targetSpeed = new Float32Array(n);
  const braking = new Float32Array(n);
  const ds = trackLength / n;

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    // Aim for the inside of anything tighter than a fast kink.
    const weight = Math.max(0, Math.min(1, (320 - s.radius) / 220));
    const direction = s.turnSign === 0 ? 0 : -s.turnSign;
    offsets[i] = direction * s.width * 0.27 * weight;
  }

  // Smooth the lateral target so the car does not dart between kerbs.
  for (let pass = 0; pass < 3; pass++) {
    const copy = offsets.slice();
    const radius = 9;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += copy[(i + k + n) % n];
      offsets[i] = sum / (radius * 2 + 1);
    }
  }

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const radius = Math.max(18, s.radius);
    // Effective lateral grip includes downforce at speed; the sqrt(R) relation
    // gives believable 60 km/h hairpins and 280 km/h sweepers.
    const cornerSpeed = Math.sqrt(1.82 * GRAVITY * radius) * 1.06;
    targetSpeed[i] = Math.min(TOP_SPEED, cornerSpeed);
  }

  // Backward braking pass, three laps around the closed loop so the profile
  // converges across the start/finish line.
  for (let pass = 0; pass < 3; pass++) {
    for (let k = 0; k < n; k++) {
      const i = n - 1 - k;
      const next = (i + 1) % n;
      const limit = Math.sqrt(targetSpeed[next] * targetSpeed[next] + 2 * BRAKE_DECEL * ds);
      if (targetSpeed[i] > limit) targetSpeed[i] = limit;
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      const accelLimit = Math.sqrt(targetSpeed[i] * targetSpeed[i] + 2 * 13 * ds);
      if (targetSpeed[next] > accelLimit) targetSpeed[next] = accelLimit;
    }
  }

  // Braking demand looking 90 m ahead, for the red/yellow/green line colours.
  const lookahead = Math.max(4, Math.round(90 / ds));
  for (let i = 0; i < n; i++) {
    let minAhead = targetSpeed[i];
    for (let k = 1; k <= lookahead; k += 2) {
      const v = targetSpeed[(i + k) % n];
      if (v < minAhead) minAhead = v;
    }
    const demand = (targetSpeed[i] * targetSpeed[i] - minAhead * minAhead) / (2 * 90 * BRAKE_DECEL);
    braking[i] = Math.max(0, Math.min(1, demand));
  }

  return { offsets, targetSpeed, braking };
}
