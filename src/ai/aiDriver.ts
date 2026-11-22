import { CAR_CLASSES } from '../garage/carConfig';
import { computeAero } from '../physics/aero';
import type { DriverInput, RaceCar } from '../physics/vehicle';
import type { TrackData } from '../tracks/types';

const GRAVITY = 9.81;
const AIR_DENSITY = 1.225;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function sign(v: number): number {
  return v < 0 ? -1 : 1;
}

/**
 * PID controller, ported from Speed Dreams' `TPidController`
 * (`src/drivers/simplix/src/unitpidctrl.cpp`, GPL-2.0). The algorithm is the
 * same: proportional term, optional integral term with a clamped accumulator
 * and an optional rate-limited total, optional derivative term.
 */
class PidController {
  p = 1;
  i = 0;
  d = 0;
  maxTotal = 100;
  minTotal = -100;
  totalRate = 0;
  private total = 0;
  private last = 0;

  sample(value: number, diff: number): number {
    this.last = value;
    let control = value * this.p;
    if (this.d !== 0) control += diff * this.d;
    if (this.i !== 0) {
      this.total = this.totalRate === 0 ? this.total + value : this.total + (value - this.total) * this.totalRate;
      this.total = clamp(this.total, this.minTotal, this.maxTotal);
      control += this.total * this.i;
    }
    return control;
  }

  sampleAuto(value: number): number {
    return this.sample(value, value - this.last);
  }
}

/**
 * AI driver, ported from Speed Dreams' Simplix robot (`src/drivers/simplix`,
 * GPL-2.0, Wolf-Dieter Beelitz, itself derived from Tim Foden's mouse_2006).
 *
 * Three parts of that driver are reproduced here:
 *  - `TDriver::BrakingForceController`: a PID on the cube of the normalised
 *    speed error, which is what gives simplix its smooth brake release instead
 *    of an on/off pedal.
 *  - `TDriver::SteerAngle`: pure pursuit whose lookahead grows with speed,
 *    plus a yaw-rate feedback term (0.08 * (v*k - yawRate)), a curvature
 *    feed-forward term for the corner ahead, and a P/D controller on the
 *    offset from the racing line.
 *  - `TDriver::Runaround`: lateral avoidance as an accel/velocity limited
 *    ramp between the racing line and an offset around the car ahead.
 *
 * The reference implementation talks to TORCS through its car and track
 * handles. Here the same quantities come from this game's own car and track
 * sample data, and the target speed comes from the racing line solve in
 * `tracks/racingLine.ts` rather than simplix's precomputed line file.
 */
export class AIDriver {
  readonly car: RaceCar;
  readonly name: string;
  readonly team: string;
  readonly pace: number;
  readonly aggression: number;
  readonly skill: number;
  private track: TrackData;
  /** Target speed per sample, m/s. */
  private readonly profile: Float32Array;
  private readonly ds: number;
  private decisionTimer = 0;
  private cachedInput: DriverInput = { throttle: 0, brake: 0, steer: 0 };
  private targetLateral = 0;
  private overtakeSide = 0;
  private overtakeTimer = 0;
  private mistakeTimer = 0;
  private mistakeSteer = 0;
  private launchTimer = 2.6;
  private readonly classPace: number;
  private readonly latMu: number;
  private readonly cla: number;
  private readonly cda: number;
  private readonly mass: number;
  private readonly topSpeed: number;
  private state: 'race' | 'reverse' = 'race';
  private reverseTimer = 0;
  private stuckTimer = 0;
  private offTimer = 0;
  private reverseCooldown = 0;
  private mistakesEnabled = true;
  /** Rate-limited steering command, so the wheel cannot go lock-to-lock. */
  private steerOutput = 0;
  private readonly brakePid = new PidController();
  private readonly linePid = new PidController();
  /** Simplix's avoidance ramp: how far to the side, and how fast it moves. */
  private avoidOffset = 0;
  private avoidOffsetDelta = 0;
  private lastBrakeDemand = 0;
  private lastLineError = 0;
  /** Dev telemetry: the terms the controller actually used this step. */
  debug = { targetSpeed: 0, aimOffset: 0, headingError: 0, steerAngle: 0, avoid: 0 };

  constructor(
    car: RaceCar,
    name: string,
    team: string,
    pace: number,
    options?: { aggression?: number; mistakes?: boolean },
  ) {
    this.car = car;
    this.track = car.track;
    this.name = name;
    this.team = team;
    this.pace = clamp(pace, 50, 110);
    this.aggression = clamp(clamp((pace - 50) / 60, 0, 1) * (options?.aggression ?? 1), 0, 1);
    this.skill = this.aggression;
    this.mistakesEnabled = options?.mistakes !== false;
    const carClass = car.config.carClass;
    this.classPace = 1 - car.wetness * 0.08;
    const surface = car.track.surface === 'gravel' ? 0.82 : 1;
    this.latMu = CAR_CLASSES[carClass].grip * 1.42 * surface * (1 - car.wetness * 0.16);
    const aero = computeAero(
      {
        aeroPackage: car.config.livery.aero,
        carClass,
        frontWingAngle: car.config.setup.frontWingAngle,
        rearWingAngle: car.config.setup.rearWingAngle,
        rideHeight: car.config.setup.rideHeight,
      },
      60,
      false,
      0,
      0,
      0,
    );
    this.cla = aero.cla;
    this.cda = aero.cda;
    this.mass = car.mass;
    this.topSpeed =
      carClass === 'kart'
        ? 30
        : carClass === 'stock'
          ? 80
          : carClass === 'gt'
            ? 78
            : carClass === 'junior'
              ? 76
              : carClass === 'hypercar'
                ? 88
                : 94;
    this.ds = car.track.length / car.track.samples.length;
    this.profile = this.buildProfile();

    // Simplix's brake controller shape (BC_P / BC_D), rescaled because this
    // controller feeds it a normalised error rather than its raw speed error.
    this.brakePid.p = 1;
    this.brakePid.i = 0;
    this.brakePid.d = 0.6;
    this.brakePid.maxTotal = 0;
    this.brakePid.minTotal = 0;
    // TDriver::SteerAngle's line controller gains, with the derivative scaled
    // for an error that is already normalised by the road width.
    this.linePid.p = 1.2;
    this.linePid.d = 0.8;
  }

  /** Downforce-assisted lateral acceleration at a given speed, m/s². */
  private gripAt(v: number): number {
    const q = 0.5 * AIR_DENSITY * v * v;
    return this.latMu * (GRAVITY + (q * this.cla) / this.mass);
  }

  /** Racing line -> target speed for every sample, m/s. */
  private buildProfile(): Float32Array {
    const track = this.track;
    const n = track.samples.length;
    const ds = this.ds;
    const profile = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const sample = track.samples[i];
      const widthFactor = Math.min(1, sample.width / Math.max(6, track.width));
      const lineR = track.racingLine.lineRadius[i] ?? sample.peakRadius;
      const radius = Math.max(9, Math.min(lineR, sample.peakRadius * 1.8)) * (0.93 + widthFactor * 0.07);
      let v = Math.min(this.topSpeed, Math.sqrt(this.latMu * GRAVITY * radius));
      for (let k = 0; k < 4; k++) {
        v = Math.min(this.topSpeed, Math.sqrt(this.gripAt(v) * radius));
      }
      profile[i] = v > 55 ? v * 0.96 : v;
    }

    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < n; k++) {
        const i = n - 1 - k;
        const next = (i + 1) % n;
        const vNext = profile[next];
        const q = 0.5 * AIR_DENSITY * vNext * vNext;
        const decel =
          this.latMu * (GRAVITY + (q * this.cla) / this.mass) * 0.94 + (q * this.cda) / this.mass;
        const limit = Math.sqrt(vNext * vNext + 2 * Math.max(4, decel) * ds);
        if (profile[i] > limit) profile[i] = limit;
      }
    }

    const drive = CAR_CLASSES[this.car.config.carClass].brakeDecel * 0.26;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        const next = (i + 1) % n;
        const limit = Math.sqrt(profile[i] * profile[i] + 2 * drive * ds);
        if (profile[next] > limit) profile[next] = limit;
      }
    }
    return profile;
  }

  private paceFactor(): number {
    return (0.8 + ((this.pace - 50) / 60) * 0.3) * this.classPace;
  }

  get wantsPit(): boolean {
    return this.car.tyreLife < 0.26 && this.car.pitCount < 3;
  }

  /** Line offset at a sample, blended with the current avoidance offset. */
  private lineOffset(index: number): number {
    const n = this.track.samples.length;
    const sample = this.track.samples[index];
    const limit = sample.width * 0.36;
    return clamp(this.track.racingLine.offsets[index % n] * 0.85 + this.avoidOffset * limit, -limit, limit);
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
    const ds = this.ds;
    const speed = Math.abs(car.vx);
    const index = car.index;
    const pace = this.paceFactor();

    // ------- recovery: reverse out, then rejoin under power ---------------
    if (this.state === 'reverse') {
      this.reverseTimer -= dt;
      const ahead = track.samples[(index + Math.max(2, Math.round(12 / ds))) % n];
      const toRoad = Math.atan2(ahead.pos.x - car.pos.x, ahead.pos.z - car.pos.z);
      const err = wrapAngle(toRoad - car.heading);
      // In reverse a positive steering command turns the nose right, so the
      // sign flips: backing up with opposite lock swings the nose at the road.
      const steer = clamp(-err * 1.5, -1, 1);
      if (this.reverseTimer <= 0 || speed > 5.5) {
        this.state = 'race';
        this.stuckTimer = 0;
        this.reverseCooldown = 2.2;
      }
      this.cachedInput = { throttle: 0.62, brake: 0, steer, reverse: true };
      return this.cachedInput;
    }

    this.reverseCooldown = Math.max(0, this.reverseCooldown - dt);
    this.offTimer = car.offTrack ? this.offTimer + dt : 0;
    this.stuckTimer = speed < 2.2 ? this.stuckTimer + dt : Math.max(0, this.stuckTimer - dt * 2);
    const canReverse = this.reverseCooldown <= 0;
    const beached = canReverse && car.offTrack && this.offTimer > 1.8 && speed < 9;
    const trackHeading = Math.atan2(car.sample.tangent.x, car.sample.tangent.z);
    const facingWrong = canReverse && Math.abs(wrapAngle(trackHeading - car.heading)) > 1.9 && speed < 6;
    if ((canReverse && this.stuckTimer > 1.7) || beached || facingWrong) {
      this.stuckTimer = 0;
      this.offTimer = 0;
      this.state = 'reverse';
      this.reverseTimer = 1.4 + Math.random() * 0.7;
      this.cachedInput = { throttle: 0.62, brake: 0, steer: 0, reverse: true };
      return this.cachedInput;
    }

    // ------- target speed -------------------------------------------------
    let targetSpeed = this.profile[index] * pace;
    // Apex a couple of car lengths ahead may be slower than here even though
    // the profile already brakes for it; clamping against the live brake
    // capability keeps the car honest when grip drops mid-corner.
    const horizon = Math.max(4, Math.round((30 + speed * 1.6) / ds));
    const decelAvailable = Math.max(5, car.brakeAccel * 0.55);
    for (let k = 2; k <= horizon; k += 2) {
      const apex = this.profile[(index + k) % n] * pace;
      const limit = Math.sqrt(apex * apex + 2 * decelAvailable * (k * ds));
      if (limit < targetSpeed) targetSpeed = limit;
    }

    // ------- avoidance (simplix Runaround) --------------------------------
    let closing: RaceCar | null = null;
    let closest = 60;
    for (const other of opponents) {
      if (other === car) continue;
      const dx = other.pos.x - car.pos.x;
      const dz = other.pos.z - car.pos.z;
      const dist = Math.hypot(dx, dz);
      const forward = Math.sin(car.heading) * dx + Math.cos(car.heading) * dz;
      const side = Math.abs(Math.cos(car.heading) * dx - Math.sin(car.heading) * dz);
      if (forward > 0.5 && dist < closest && side < 3.2) {
        closest = dist;
        closing = other;
      }
    }

    let avoidTarget = 0;
    let trafficBrake = 0;
    if (closing && closest < 42) {
      const otherOffset = closing.lateral;
      const side = otherOffset > 0 ? -1 : 1;
      avoidTarget = side * clamp(0.55 + this.aggression * 0.35, 0.4, 1);
      if (closest < 12) trafficBrake = 0.45;
      if (this.launchTimer > 0 && closest < 18) {
        avoidTarget = (closing.lateral > car.lateral ? -1 : 1) * 0.6;
      }
    }
    if (this.launchTimer > 0) {
      // Hold the grid lane for the first couple of seconds.
      avoidTarget = clamp((car.lateral + avoidTarget * car.sample.width * 0.3) / Math.max(1, car.sample.width * 0.36), -1, 1);
    }

    // Ramp the offset with limited acceleration and velocity, as `Runaround`
    // does, so the car slides across the road instead of stepping sideways.
    const offsetAccMax = 0.0009;
    const offsetVelMax = 0.06;
    const dist = avoidTarget - this.avoidOffset;
    let accel = dist > 0 ? offsetAccMax : -offsetAccMax;
    // Brake the ramp so it stops on the target. The distance must keep its
    // sign here: clamping it positive made the deceleration push the same way
    // as the movement, and the offset ran to full lock with no car in sight.
    if (
      this.avoidOffsetDelta * dist > 0 &&
      Math.abs(dist) > 1e-4 &&
      Math.abs(dist) <= (this.avoidOffsetDelta * this.avoidOffsetDelta) / (2 * offsetAccMax)
    ) {
      accel = -(this.avoidOffsetDelta * this.avoidOffsetDelta) / (2 * dist);
    }
    this.avoidOffsetDelta = clamp(this.avoidOffsetDelta + accel, -offsetVelMax, offsetVelMax);
    this.avoidOffset = clamp(this.avoidOffset + this.avoidOffsetDelta, -1, 1);
    if (Math.abs(dist) < 0.002) this.avoidOffsetDelta = 0;
    if ((this.avoidOffset <= -0.999 && avoidTarget < 0) || (this.avoidOffset >= 0.999 && avoidTarget > 0)) {
      this.avoidOffsetDelta = 0;
    }

    // ------- steering (simplix SteerAngle) --------------------------------
    // Lookahead grows with speed: `AheadDist = oLookBase + v * oLookScale`.
    const aheadDist = clamp(12 + speed * 0.42, 12, 46);
    const aimIndex = (index + Math.max(2, Math.round(aheadDist / ds))) % n;
    const aim = track.samples[aimIndex];
    // At walking pace the car should not lunge at a line that is several metres
    // to one side; blend the aim offset in as it gets moving.
    let aimOffset = this.lineOffset(aimIndex) * Math.min(1, 0.3 + speed / 18);
    // Edge guard: if the car is already drifting to the outside of the road,
    // pull the target back towards the middle so there is something to chase
    // before the white line arrives.
    const halfWidth = car.sample.width * 0.5;
    if (Math.abs(car.lateral) > halfWidth * 0.62) {
      const inward = car.lateral > 0 ? -1 : 1;
      aimOffset = clamp(aimOffset + inward * halfWidth * 0.34, -car.sample.width * 0.36, car.sample.width * 0.36);
    }
    const aimX = aim.pos.x + aim.right.x * aimOffset;
    const aimZ = aim.pos.z + aim.right.z * aimOffset;

    const headingError = wrapAngle(Math.atan2(aimX - car.pos.x, aimZ - car.pos.z) - car.heading);

    // Simplix works in radians of steering command and divides by the car's
    // full lock at the very end. Here the pursuit term is turned into a wheel
    // angle first, so the car's own speed-dependent lock limit still applies.
    const aimDistance = Math.max(5, Math.hypot(aimX - car.pos.x, aimZ - car.pos.z));
    const wheelbase = CAR_CLASSES[car.config.carClass].wheelbase;
    const curvatureCommand = (2 * Math.sin(headingError)) / aimDistance;
    let steerAngle = Math.atan(wheelbase * curvatureCommand);

    if (speed >= 6) {
      // Rotational velocity control: drive the yaw rate the corner asks for.
      const omegaIndex = (index + Math.max(1, Math.round((3 + speed * 0.12) / ds))) % n;
      const avgCurvature = (car.sample.curvature + track.samples[omegaIndex].curvature) / 2;
      const omega = speed * avgCurvature;
      steerAngle += 0.08 * (omega - car.yawRate) * 0.55;
      // Offset from the line, through simplix's P/D line controller. The
      // error is normalised to half a road width: feeding metres straight into
      // a D gain of 12 at 30 Hz commanded half a turn of lock on a straight.
      const lineError = (this.targetLateral - car.lateral) / Math.max(3, car.sample.width * 0.5);
      const lineCommand = this.linePid.sample(lineError, lineError - this.lastLineError);
      this.lastLineError = lineError;
      // Positive error means the target line is to the right, so this adds
      // right lock. (Subtracting it drove the car away from its own line.)
      steerAngle += clamp(0.1 * Math.atan(lineCommand), -0.09, 0.09);
    }
    this.targetLateral += (aimOffset - this.targetLateral) * Math.min(1, dt * 6);
    this.debug = {
      targetSpeed,
      aimOffset,
      headingError,
      steerAngle,
      avoid: this.avoidOffset,
    };

    let steer = clamp(steerAngle / Math.max(0.02, car.maxSteerAngle), -1, 1);
    this.steerOutput += clamp(steer - this.steerOutput, -0.16, 0.16);
    steer = this.steerOutput;

    // ------- brake controller (simplix BrakingForceController) ------------
    // Simplix runs a PID on the cube of the speed error, scaled by a per-speed
    // brake coefficient, so small overshoots barely touch the pedal and large
    // ones go straight to full pressure. The coefficient is expressed here as
    // "metres per second of overspeed that means full brake".
    const overspeed = speed - targetSpeed;
    const fullBrakeError = 2.2;
    let brake = 0;
    let throttle = this.throttleForSpeed(overspeed, speed);

    if (overspeed > 0.15) {
      const demand = Math.pow(overspeed / fullBrakeError, 3);
      brake = clamp(0.15 + this.brakePid.sample(demand, demand - this.lastBrakeDemand), 0, 1);
      this.lastBrakeDemand = demand;
      if (overspeed < 0.35) {
        brake = 0.12;
        throttle = 0.06;
      }
    } else {
      this.lastBrakeDemand = 0;
    }
    if (brake > 0.05) throttle = 0;

    if (trafficBrake > 0 && speed > 9) {
      brake = Math.max(brake, trafficBrake);
      throttle *= 0.4;
    }

    // Grip budget: a slip-based tyre loses lateral grip as longitudinal force
    // rises, so the AI must not ask for full power while the corner needs the
    // whole friction circle sideways.
    const lateralDemand = speed * speed * Math.abs(car.sample.curvature);
    const throttleCap = clamp(1 - 0.9 * (lateralDemand / Math.max(5, car.lateralAccel)), 0.1, 1);
    throttle = Math.min(throttle, throttleCap);
    if (speed < 24 && throttle > 0.74) throttle = 0.74;
    if (car.tyreLife < 0.3) throttle = Math.min(throttle, 0.92);

    if (car.inPitLane && !this.wantsPit) {
      throttle = 1;
      brake = 0;
    }

    if (car.offTrack) {
      // Rejoin toward the road ahead, not toward the racing line on the far
      // side of the circuit. Reduced grip does the rest.
      const rejoin = track.samples[(index + Math.max(2, Math.round(14 / ds))) % n];
      const toRoad = Math.atan2(rejoin.pos.x - car.pos.x, rejoin.pos.z - car.pos.z);
      steer = clamp(wrapAngle(toRoad - car.heading) * 2.4 - car.yawRate * 0.25, -1, 1);
      throttle = speed > 16 ? 0.5 : 1;
      brake = speed > 22 ? 0.25 : 0;
    }

    if (this.mistakesEnabled && this.mistakeTimer <= 0 && Math.random() < 0.0007) {
      this.mistakeTimer = 0.55;
      this.mistakeSteer = (Math.random() - 0.5) * 0.2 * (1 - this.skill);
      if (Math.random() < 0.35) throttle *= 0.45;
    }
    if (this.mistakeTimer > 0) steer = clamp(steer + this.mistakeSteer, -1, 1);

    this.cachedInput = { throttle, brake, steer };
    return this.cachedInput;
  }

  /** Throttle from the sign and size of the speed error, m/s. */
  private throttleForSpeed(overspeed: number, speed: number): number {
    if (overspeed > 0.15) return 0;
    // Coming up to speed: more error, more throttle, but never a step to full
    // throttle at low speed where the rear tyres would simply spin.
    const urgency = clamp(-overspeed / 6, 0, 1);
    const base = speed < 12 ? 0.6 : 0.78;
    return clamp(base + urgency * (1 - base), 0, 1);
  }
}
