/**
 * Raycast vehicle primitives, ported from Bullet Physics' `btRaycastVehicle`
 * through the TypeScript port in cannon-es (`src/objects/RaycastVehicle.ts`,
 * MIT licence, https://github.com/pmndrs/cannon-es).
 *
 * The maths below are the same spring/damper and impulse arithmetic Bullet
 * uses. The only change is that the chassis moves on the track plane instead
 * of in free 3D space, because this game resolves the car against the circuit
 * surface (elevation, banking, kerbs) rather than a triangle soup.
 *
 * - `suspensionForce` follows `btRaycastVehicle::updateSuspension`.
 * - `clampFrictionCircle` follows the `maximp` / `skidInfo` block of
 *   `btRaycastVehicle::updateFriction`.
 */

export interface SuspensionInput {
  /** Spring stiffness in Bullet's per-chassis-mass units. */
  stiffness: number;
  dampingCompression: number;
  dampingRelaxation: number;
  /** Suspension length at rest, metres. */
  restLength: number;
  /** Current suspension length, metres. */
  length: number;
  /** Rate of change of length, m/s (positive = extending). */
  lengthVelocity: number;
  chassisMass: number;
  /** Hard stop so a kerb strike cannot launch the car into orbit. */
  maxForce: number;
}

/** Bullet: force = stiffness * (rest - current) * mass - damping * relVel. */
export function suspensionForce(input: SuspensionInput): number {
  const lengthDiff = input.restLength - input.length;
  const clippedInvContactDot = 1; // contact is vertical in the track frame
  let force = input.stiffness * lengthDiff * clippedInvContactDot * input.chassisMass;
  const damping = input.lengthVelocity < 0 ? input.dampingCompression : input.dampingRelaxation;
  force -= damping * input.lengthVelocity * input.chassisMass;
  if (force < 0) return 0;
  return Math.min(force, input.maxForce);
}

export interface FrictionResult {
  forward: number;
  side: number;
  /** 1 = full grip, <1 = the tyre is sliding. */
  skidInfo: number;
  sliding: boolean;
}

/**
 * Bullet's friction circle: the requested forward and side impulses are
 * compared with `suspensionForce * dt * frictionSlip`; once the combined
 * request exceeds it, both are scaled back by the same factor and the wheel is
 * marked as sliding.
 */
export function clampFrictionCircle(
  forward: number,
  side: number,
  maxImpulse: number,
  forwardAcceleration = 1,
  sideAcceleration = 1,
): FrictionResult {
  const x = forward / Math.max(0.05, forwardAcceleration);
  const y = side / Math.max(0.05, sideAcceleration);
  const squared = x * x + y * y;
  const limit = Math.max(1e-9, maxImpulse);
  if (squared <= limit * limit) return { forward, side, skidInfo: 1, sliding: false };
  const factor = limit / Math.sqrt(squared);
  return { forward: forward * factor, side: side * factor, skidInfo: factor, sliding: true };
}
