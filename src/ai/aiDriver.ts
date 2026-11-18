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
 * Pace scales apex speed, braking points and overtaking aggression.
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
  private lastSpeed = 0;

  constructor(car: RaceCar, name: string, team: string, pace: number) {
    this.car = car;
    this.track = car.track;
    this.name = name;
    this.team = team;
    this.pace = clamp(pace, 50, 110);
    this.aggression = clamp((pace - 50) / 60, 0, 1);
    this.skill = this.aggression;
  }

  private paceFactor(): number {
    return 0.72 + (this.pace - 50) / 60 * 0.36;
  }

  get wantsPit(): boolean {
    return this.car.tyreLife < 0.26 && this.car.pitCount < 3;
  }

  update(dt: number, opponents: RaceCar[]): DriverInput {
    this.decisionTimer -= dt;
    this.overtakeTimer = Math.max(0, this.overtakeTimer - dt);
    this.mistakeTimer = Math.max(0, this.mistakeTimer - dt);
    if (this.decisionTimer > 0) return this.cachedInput;
    this.decisionTimer = 1 / 30;

    const car = this.car;
    const track = this.track;
    const n = track.samples.length;
    const ds = track.length / n;
    const speed = Math.abs(car.vx);
    const index = car.index;

    // Racing line + overtaking offset.
    const lineIndex = (index + Math.round((10 + speed * 0.5) / ds)) % n;
    let targetOffset = track.racingLine.offsets[lineIndex];

    let closing: RaceCar | null = null;
    let closest = 40;
    for (const other of opponents) {
      if (other === car) continue;
      const dx = other.pos.x - car.pos.x;
      const dz = other.pos.z - car.pos.z;
      const dist = Math.hypot(dx, dz);
      const forward = Math.sin(car.heading) * dx + Math.cos(car.heading) * dz;
      if (forward > 0 && dist < closest && Math.abs(other.lateral - car.lateral) < 3.2) {
        closest = dist;
        closing = other;
      }
    }
    if (closing && closest < 28 && this.aggression > 0.25) {
      const side = closing.lateral > car.lateral ? -1 : 1;
      this.overtakeSide = side;
      this.overtakeTimer = 1.2;
    }
    if (this.overtakeTimer > 0) {
      targetOffset += this.overtakeSide * car.sample.width * 0.26 * (0.4 + this.aggression * 0.6);
      if (Math.abs(targetOffset) > car.sample.width * 0.4) targetOffset = this.overtakeSide * car.sample.width * 0.4;
    }
    // Smooth lateral target.
    this.targetLateral += (targetOffset - this.targetLateral) * Math.min(1, dt * 4.2);

    const lookAheadDist = 14 + speed * 0.62 + Math.abs(car.vy) * 2;
    const aimIndex = (index + Math.round(lookAheadDist / ds)) % n;
    const aimSample = track.samples[aimIndex];
    const offset = this.targetLateral;
    const aimX = aimSample.pos.x + aimSample.right.x * offset;
    const aimZ = aimSample.pos.z + aimSample.right.z * offset;
    const desiredHeading = Math.atan2(aimX - car.pos.x, aimZ - car.pos.z);
    let steer = clamp(wrapAngle(desiredHeading - car.heading) * 2.5, -1, 1);

    // Slow-corner aim point: turn in earlier when the radius is tight.
    if (car.sample.radius < 90) {
      steer = clamp(steer * 1.12, -1, 1);
    }

    // Speed target with braking distance margin.
    const targetAhead = Math.round((14 + speed * 0.75) / ds);
    let target = Infinity;
    for (let k = 0; k < targetAhead; k += 3) {
      const v = track.racingLine.targetSpeed[(index + k) % n];
      if (v < target) target = v;
    }
    target *= this.paceFactor();

    // AI braking points shift earlier when pace is low.
    const brakeMargin = 1.25 / this.paceFactor();
    let brake = 0;
    if (speed > target * brakeMargin) {
      brake = clamp((speed - target) / 8, 0, 1);
    }
    let throttle = speed < target - 1.5 ? 1 : 0.2;
    if (speed > target * 1.02) throttle = 0;
    if (brake > 0.05) throttle = 0;

    // Low-speed throttle control for traction-limited corners.
    if (speed < 22 && throttle > 0.7) throttle = 0.78;

    // A rare, small mistake makes low-pace AI feel human.
    if (this.mistakeTimer <= 0 && Math.random() < 0.0009) {
      this.mistakeTimer = 0.6;
      this.mistakeSteer = (Math.random() - 0.5) * 0.22 * (1 - this.skill);
      if (Math.random() < 0.4) throttle *= 0.4;
    }
    if (this.mistakeTimer > 0) steer = clamp(steer + this.mistakeSteer, -1, 1);

    // Recover if the car has left the island.
    if (car.offTrack && speed > 8) {
      steer = clamp(steer * 1.25 - Math.sign(car.lateral) * 0.2, -1, 1);
      throttle *= 0.55;
    }

    this.cachedInput = { throttle, brake, steer };
    this.lastSpeed = speed;
    return this.cachedInput;
  }
}
