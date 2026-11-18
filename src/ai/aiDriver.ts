import { CAR_CLASSES } from '../garage/carConfig';
import type { DriverInput, RaceCar } from '../physics/vehicle';
import type { TrackData } from '../tracks/types';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

/**
 * A line-following AI that uses the same vehicle physics as the player.
 *
 * The old version aimed at a sample a short distance ahead and braked against
 * a single speed value. That made it lunge into hairpins, clip barriers and
 * get stuck. This version uses a proper braking-distance envelope, pure
 * pursuit with cross-track correction, class-specific pace and a traffic
 * avoidance window.
 */
export class AIDriver {
  readonly car: RaceCar;
  readonly name: string;
  readonly team: string;
  readonly pace: number;
  readonly aggression: number;
  readonly skill: number;
  private track: TrackData;
  private decisionTimer = 0;
  private cachedInput: DriverInput = { throttle: 0, brake: 0, steer: 0 };
  private targetLateral = 0;
  private overtakeSide = 0;
  private overtakeTimer = 0;
  private mistakeTimer = 0;
  private mistakeSteer = 0;
  private launchTimer = 2.6;
  private readonly classPace: number;

  constructor(car: RaceCar, name: string, team: string, pace: number) {
    this.car = car;
    this.track = car.track;
    this.name = name;
    this.team = team;
    this.pace = clamp(pace, 50, 110);
    this.aggression = clamp((pace - 50) / 60, 0, 1);
    this.skill = this.aggression;
    const category = CAR_CLASSES[car.config.carClass].category;
    this.classPace = category === 'kart' ? 0.64 : category === 'gt' ? 0.8 : category === 'prototype' ? 0.93 : 1;
  }

  private paceFactor(): number {
    return (0.72 + ((this.pace - 50) / 60) * 0.36) * this.classPace;
  }

  get wantsPit(): boolean {
    return this.car.tyreLife < 0.26 && this.car.pitCount < 3;
  }

  update(dt: number, opponents: RaceCar[]): DriverInput {
    this.decisionTimer -= dt;
    this.overtakeTimer = Math.max(0, this.overtakeTimer - dt);
    this.mistakeTimer = Math.max(0, this.mistakeTimer - dt);
    this.launchTimer = Math.max(0, this.launchTimer - dt);
    if (this.decisionTimer > 0) return this.cachedInput;
    this.decisionTimer = 1 / 30;

    const car = this.car;
    const track = this.track;
    const n = track.samples.length;
    const ds = track.length / n;
    const speed = Math.abs(car.vx);
    const index = car.index;

    // Racing line: look a little farther ahead at speed, but never sample a
    // point outside the next corner's entry.
    const lineAhead = Math.round((9 + speed * 0.48) / ds);
    const lineIndex = (index + lineAhead) % n;
    let targetOffset = track.racingLine.offsets[lineIndex];

    // Traffic. Only react to a car that is genuinely in front and in our lane.
    let closing: RaceCar | null = null;
    let closest = 42;
    for (const other of opponents) {
      if (other === car) continue;
      const dx = other.pos.x - car.pos.x;
      const dz = other.pos.z - car.pos.z;
      const dist = Math.hypot(dx, dz);
      const forward = Math.sin(car.heading) * dx + Math.cos(car.heading) * dz;
      const side = Math.abs(Math.cos(car.heading) * dx - Math.sin(car.heading) * dz);
      if (forward > 0.5 && dist < closest && side < 2.9) {
        closest = dist;
        closing = other;
      }
    }

    let trafficBrake = 0;
    if (closing && closest < 34 && this.aggression > 0.2) {
      // Pick the side with more room. The old logic picked the opposite side
      // of the other car and could drive itself straight into the barrier.
      const otherOffset = closing.lateral;
      const side = otherOffset > 0 ? -1 : 1;
      const room = car.sample.width * 0.36;
      const proposed = otherOffset + side * (car.sample.width * 0.34);
      if (Math.abs(proposed) < room && car.sample.radius > 105) {
        this.overtakeSide = side;
        this.overtakeTimer = 0.9;
      }
      if (closest < 9) trafficBrake = 0.45;
    }
    if (this.launchTimer > 0) {
      // Hold the grid lane for the first couple of seconds. Without this every
      // car converged on the same racing-line point before the field had
      // spread out, causing the start-line pile-up. If someone is parked
      // directly ahead, peel around them instead of queueing behind.
      let hold = car.lateral * 0.82;
      if (closing && closest < 16) {
        hold += (closing.lateral > car.lateral ? -1 : 1) * car.sample.width * 0.3;
      }
      targetOffset = clamp(hold, -car.sample.width * 0.34, car.sample.width * 0.34);
    } else if (this.overtakeTimer > 0) {
      targetOffset += this.overtakeSide * car.sample.width * 0.25 * (0.5 + this.aggression * 0.5);
    }
    const offsetLimit = car.sample.width * 0.36;
    targetOffset = clamp(targetOffset, -offsetLimit, offsetLimit);
    this.targetLateral += (targetOffset - this.targetLateral) * Math.min(1, dt * 4.8);

    // Pure pursuit with cross-track correction. The correction stops the car
    // drifting wide after a contact or a late overtake.
    const lookAheadDist = 12 + speed * 0.58 + Math.abs(car.vy) * 2;
    const aimIndex = (index + Math.round(lookAheadDist / ds)) % n;
    const aimSample = track.samples[aimIndex];
    const offset = this.targetLateral;
    const aimX = aimSample.pos.x + aimSample.right.x * offset;
    const aimZ = aimSample.pos.z + aimSample.right.z * offset;
    const desiredHeading = Math.atan2(aimX - car.pos.x, aimZ - car.pos.z);
    const crossTrack = car.lateral - offset;
    let steer = clamp(wrapAngle(desiredHeading - car.heading) * 2.15 - crossTrack * 0.042, -1, 1);

    // Speed envelope: for every point on the horizon, calculate the fastest
    // speed from which we can still brake to that point's apex speed.
    const targetAheadDist = 38 + speed * 1.05;
    const targetAhead = Math.max(1, Math.round(targetAheadDist / ds));
    const decel = Math.max(12, CAR_CLASSES[car.config.carClass].brakeDecel * 0.55);
    let allowed = track.racingLine.targetSpeed[index] * this.paceFactor();
    for (let k = 4; k <= targetAhead; k += 4) {
      const apex = track.racingLine.targetSpeed[(index + k) % n] * this.paceFactor();
      const distance = k * ds;
      const brakingLimit = Math.sqrt(apex * apex + 2 * decel * distance);
      if (brakingLimit < allowed) allowed = brakingLimit;
    }

    let brake = 0;
    let throttle = 0;
    if (speed > allowed * 1.005) {
      brake = clamp((speed - allowed) / 6.5, 0.08, 1);
      throttle = 0;
    } else if (speed < allowed * 0.95) {
      throttle = 1;
    } else {
      throttle = 0.35;
    }
    if (trafficBrake > 0 && speed > 9) {
      brake = Math.max(brake, trafficBrake);
      throttle *= 0.45;
    }

    // A little throttle discipline prevents the rear stepping out on cold
    // tyres and in slow corners.
    if (speed < 24 && throttle > 0.7) throttle = 0.76;
    if (car.tyreLife < 0.3) throttle = Math.min(throttle, 0.92);

    if (car.offTrack) {
      // Recover toward the centreline, not toward the racing line on the far
      // side of the road. This is the main "confused AI" fix.
      this.targetLateral *= 0.7;
      const recovery = Math.atan2(
        car.sample.pos.x - car.pos.x,
        car.sample.pos.z - car.pos.z,
      );
      steer = clamp(wrapAngle(recovery - car.heading) * 2.6, -1, 1);
      throttle *= 0.55;
      brake = Math.max(brake, 0.08);
    }

    // Rare, small mistakes keep low-pace drivers human without making them
    // unpredictable every corner.
    if (this.mistakeTimer <= 0 && Math.random() < 0.0007) {
      this.mistakeTimer = 0.55;
      this.mistakeSteer = (Math.random() - 0.5) * 0.2 * (1 - this.skill);
      if (Math.random() < 0.35) throttle *= 0.45;
    }
    if (this.mistakeTimer > 0) steer = clamp(steer + this.mistakeSteer, -1, 1);

    this.cachedInput = { throttle, brake, steer };
    return this.cachedInput;
  }
}
