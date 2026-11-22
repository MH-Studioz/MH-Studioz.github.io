import { Vector3 } from 'three';
import { CAR_CLASSES, type CarConfig } from '../garage/carConfig';
import type { TrackData, TrackSample } from '../tracks/types';
import {
  inRangeWrap,
  lateralOffset,
  nearestSampleIndex,
  sampleAtU,
  surfaceHeight,
  wrapU,
} from '../tracks/trackMath';
import { computeAero, type AeroState } from './aero';
import { clampFrictionCircle, suspensionForce } from './raycastVehicle';
import type { AssistSettings, SimSettings } from './settings';
import {
  COMPOUNDS,
  createTyreSet,
  loadSensitivity,
  reMount,
  tyreGrip,
  updateTyre,
  type CompoundId,
  type TyreState,
} from './tyres';

const GRAVITY = 9.81;
const PIT_LIMIT = 80 / 3.6;

/**
 * Suspension geometry. The car runs on four raycast springs exactly as
 * `btRaycastVehicle` does; the only difference is that the ray is cast against
 * the circuit surface instead of a triangle mesh.
 */
const WHEEL_REST_LENGTH = 0.2;
const WHEEL_TRAVEL = 0.11;
const STATIC_COMPRESSION = 0.062;
/** Spring rate in Bullet's per-chassis-mass units: mass*g/4 per corner. */
const SPRING_UNITS = GRAVITY / (4 * STATIC_COMPRESSION);
const WHEEL_INERTIA = 1.6;

/** Peak slip values of the tyre, radians and ratio. */
const PEAK_SLIP_ANGLE = 0.115;
const PEAK_SLIP_RATIO = 0.105;
/** Centre-of-gravity height, metres. Sets how much weight the tyres move. */
const CG_HEIGHT = 0.29;
/**
 * Visible body attitude. The chassis leans by at most these angles, reached as
 * the smoothed acceleration approaches the reference value: 0.055 rad is 3.2°
 * of dive and 0.05 rad is 2.9° of roll, which reads clearly in the chase cam
 * without tipping the wheels off the road.
 */
// The front wing sits ~9 cm off the road, so anything past ~2.5 degrees of dive
// pushes it through the tarmac. This lands the wing on the surface at full
// braking: readable, and the limit before it looks broken.
const PITCH_GAIN = 0.04;
const PITCH_REF = 22;
const ROLL_GAIN = 0.09;
const ROLL_REF = 17;

export interface DriverInput {
  throttle: number;
  brake: number;
  steer: number;
  shiftUp?: boolean;
  shiftDown?: boolean;
  /** Select reverse instead of drive. Used by the AI to back out of trouble. */
  reverse?: boolean;
}

export interface VehicleDamage {
  wingFL: number;
  wingFR: number;
  floor: number;
  suspension: number;
}

export interface VehicleTelemetry {
  speedKmh: number;
  gear: number;
  rpm: number;
  throttle: number;
  brake: number;
  drsOpen: boolean;
  drsAvailable: boolean;
  drsEquipped: boolean;
  ersEquipped: boolean;
  ers: number;
  fuel: number;
  lateral: number;
  u: number;
  inPitLane: boolean;
  pitLimiter: boolean;
  servicing: boolean;
  pitTimer: number;
  wingFL: number;
  wingFR: number;
  floor: number;
  suspension: number;
  understeer: number;
  gLat: number;
  gLong: number;
  compound: CompoundId;
  trackLimitStrikes: number;
  pendingPenalty: number;
  tyres: Array<{
    position: string;
    compound: CompoundId;
    color: string;
    life: number;
    surfaceTemp: number;
    coreTemp: number;
    load: number;
    slipAngle: number;
    locked: boolean;
  }>;
}

/** Pole position per track, found once and reused for every car. */
const GRID_ANCHOR = new WeakMap<TrackData, number>();

/**
 * Which lap fraction pole sits on. Normally just behind the line, but on the
 * circuits whose polygon starts in the middle of a bend (Monaco, Buddh) a
 * 20-car field laid out there curled through the corner with 44 degrees of
 * heading across the grid. Move the whole field back to the straightest spot
 * within 10% of the lap if the road behind the line is that bent.
 */
function gridAnchor(track: TrackData): number {
  const cached = GRID_ANCHOR.get(track);
  if (cached !== undefined) return cached;
  const n = track.samples.length;
  const ds = track.length / n;
  const span = Math.max(4, Math.round(92 / ds));
  const windowRadius = (index: number): number => {
    let minR = Infinity;
    for (let k = 0; k <= span; k++) minR = Math.min(minR, track.samples[(index - k + n) % n].radius);
    return minR;
  };
  const baseIndex = Math.round(0.992 * n) % n;
  let bestIndex = baseIndex;
  let bestR = windowRadius(baseIndex);
  if (bestR < 150) {
    // Candidates must stay behind the line, or pole starts a lap up.
    for (let i = Math.round(0.9 * n); i <= baseIndex; i++) {
      const r = windowRadius(i);
      if (r > bestR) {
        bestR = r;
        bestIndex = i;
      }
    }
  }
  const u = bestIndex / n;
  GRID_ANCHOR.set(track, u);
  return u;
}

interface WheelSim {
  /** Connection point in the chassis frame: x = right, z = forward. */
  localX: number;
  localZ: number;
  front: boolean;
  radius: number;
  /** Current suspension length, metres. */
  length: number;
  previousLength: number;
  lengthVelocity: number;
  /** Vertical load carried by this tyre, newtons. */
  load: number;
  /** Wheel angular speed, rad/s. */
  omega: number;
  slipAngle: number;
  slipRatio: number;
  contact: boolean;
  groundY: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function approach(current: number, target: number, maxDelta: number): number {
  return current + clamp(target - current, -maxDelta, maxDelta);
}

/**
 * Combined-slip curve with a peak at s = 1. `s` is the length of the
 * normalised slip vector (slip ratio over peak, tan(slip angle) over peak),
 * which is how TORCS / Speed Dreams simuv2 combines longitudinal and lateral
 * slip into one friction demand.
 */
function slipCurve(s: number): number {
  if (s <= 1e-6) return 0;
  const B = 6.5;
  const C = 1.5;
  const E = 0.85;
  const x = B * s;
  const raw = Math.sin(C * Math.atan(x - E * (x - Math.atan(x))));
  const peakX = B;
  const peak = Math.sin(C * Math.atan(peakX - E * (peakX - Math.atan(peakX))));
  return Math.max(0, raw / Math.max(1e-6, peak));
}

/**
 * Wheeled car on the track surface.
 *
 * The chassis is driven by four suspensions raycast onto the circuit
 * (Bullet's `btRaycastVehicle`, ported in `raycastVehicle.ts`) and by a
 * per-wheel slip model that TORCS and Speed Dreams use in simuv2: each wheel
 * has its own angular speed, so wheelspin and brake lockups are simulated
 * rather than scripted.
 */
export class RaceCar {
  readonly track: TrackData;
  readonly config: CarConfig;
  readonly assists: AssistSettings;
  readonly sim: SimSettings;
  readonly wetness: number;

  pos = new Vector3();
  heading = 0;
  /** Body velocity in the car frame: vx forward, vy to the right. */
  vx = 0;
  vy = 0;
  yawRate = 0;
  index = 0;
  u = 0;
  lateral = 0;
  speed = 0;
  gear = 1;
  rpm = 4200;
  throttle = 0;
  brake = 0;
  steerInput = 0;
  steerAngle = 0;
  ax = 0;
  ay = 0;

  wheels: TyreState[];
  ambient = 26;

  fuel = 100; // litres
  ers = 1;
  drsAllowed = false;
  drsOpen = false;
  dirtyAir = 0;
  inPitLane = false;
  pitLimiter = false;
  servicing = false;
  pitTimer = 0;
  pitCompound: CompoundId;
  pitCount = 0;
  stintCompounds: CompoundId[];

  damage: VehicleDamage = { wingFL: 1, wingFR: 1, floor: 1, suspension: 0 };
  offTrack = false;
  onKerb = false;
  trackLimitStrikes = 0;
  pendingPenalty = 0;
  impactPulse = 0;
  lastImpactSpeed = 0;

  /** Body pitch from weight transfer: positive = nose down, radians. */
  bodyPitch = 0;
  /** Body roll from lateral transfer: positive = right-hand side lifts. */
  bodyRoll = 0;

  private input: DriverInput = { throttle: 0, brake: 0, steer: 0 };
  private shiftCooldown = 0;
  private impactCooldown = 0;
  private offTimer = 0;
  private limitCooldown = 0;
  private servicedThisStop = false;
  private aeroState: AeroState = { cla: 0, cda: 0, drag: 0, downforce: 0, drsEffect: 0 };
  private gLatSmoothed = 0;
  private gLongSmoothed = 0;
  private steerCommand = 0;
  private rigidWheels: WheelSim[] = [];
  /** Mean tyre friction available, refreshed every substep. */
  private muLat = 1.5;
  /** Lock available at the current speed, radians. Refreshed every substep. */
  private steerLimit = 0.2;

  constructor(track: TrackData, config: CarConfig, assists: AssistSettings, sim: SimSettings, wetness = 0) {
    this.track = track;
    this.config = config;
    this.assists = assists;
    this.sim = sim;
    this.wetness = Math.max(0, Math.min(1, wetness));
    this.ambient = track.night ? 19 : this.wetness > 0 ? 14 : 27;
    this.wheels = createTyreSet(config.livery.compound, this.ambient);
    this.pitCompound = config.livery.compound;
    this.stintCompounds = [config.livery.compound];
    this.fuel = sim.fuel ? this.spec.fuelCapacity : this.spec.fuelCapacity * 0.45;
    this.buildWheels();
    this.placeAt(0.982, -2.2, 0);
  }

  get speedKmh(): number {
    return Math.abs(this.vx) * 3.6;
  }

  private get spec() {
    return CAR_CLASSES[this.config.carClass];
  }

  get mass(): number {
    return this.spec.mass + this.fuel * this.spec.fuelDensity;
  }

  get collisionHalfLength(): number {
    return this.spec.collisionHalfLength;
  }

  get collisionHalfWidth(): number {
    return this.spec.collisionHalfWidth;
  }

  get collisionCenterZ(): number {
    return this.spec.collisionCenterZ;
  }

  get carCategory() {
    return this.spec.category;
  }

  private buildWheels(): void {
    const spec = this.spec;
    const halfTrack = spec.trackWidth / 2;
    const halfBase = spec.wheelbase / 2;
    this.rigidWheels = [
      { localX: -halfTrack, localZ: halfBase, front: true },
      { localX: halfTrack, localZ: halfBase, front: true },
      { localX: -halfTrack, localZ: -halfBase, front: false },
      { localX: halfTrack, localZ: -halfBase, front: false },
    ].map((w) => ({
      ...w,
      radius: spec.wheelRadius,
      length: WHEEL_REST_LENGTH,
      previousLength: WHEEL_REST_LENGTH,
      lengthVelocity: 0,
      load: 0,
      omega: 0,
      slipAngle: 0,
      slipRatio: 0,
      contact: true,
      groundY: 0,
    }));
  }

  /** Re-seat the car on the nearest sample after a contact resolution. */
  refreshTrackPose(): void {
    const sample = this.track.samples[nearestSampleIndex(this.track, this.pos.x, this.pos.z, this.index)];
    this.index = sample.index;
    this.u = sample.u;
    this.lateral = lateralOffset(sample, this.pos.x, this.pos.z);
    this.pos.y = surfaceHeight(sample, this.lateral);
    this.offTrack = !this.inPitLane && Math.abs(this.lateral) > sample.width / 2 + 0.35;
  }

  get sample(): TrackSample {
    return this.track.samples[this.index];
  }

  setInput(input: DriverInput): void {
    // A NaN from an AI controller or a modded input source used to propagate
    // through steering, yaw and position within two substeps, leaving a car
    // that could never be recovered. Sanitise at the boundary instead.
    const finite = (value: number | undefined): number =>
      typeof value === 'number' && Number.isFinite(value) ? value : 0;
    this.input = {
      throttle: clamp(finite(input.throttle), 0, 1),
      brake: clamp(finite(input.brake), 0, 1),
      steer: clamp(finite(input.steer), -1, 1),
      shiftUp: Boolean(input.shiftUp),
      shiftDown: Boolean(input.shiftDown),
      reverse: Boolean(input.reverse),
    };
  }

  setDirtyAir(amount: number): void {
    this.dirtyAir = clamp(amount, 0, 1);
  }

  placeAt(u: number, lateral: number, speed: number): void {
    const sample = sampleAtU(this.track, u);
    this.index = sample.index;
    this.u = sample.u;
    this.pos.set(
      sample.pos.x + sample.right.x * lateral,
      surfaceHeight(sample, lateral),
      sample.pos.z + sample.right.z * lateral,
    );
    this.heading = Math.atan2(sample.tangent.x, sample.tangent.z);
    this.vx = speed;
    this.vy = 0;
    this.yawRate = 0;
    this.bodyPitch = 0;
    this.bodyRoll = 0;
    this.gear = Math.min(
      this.spec.gearRatios.length,
      speed > 55 ? 5 : speed > 35 ? 4 : speed > 20 ? 3 : speed > 8 ? 2 : 1,
    );
    this.lateral = lateral;
    this.steerInput = 0;
    this.steerAngle = 0;
    this.steerCommand = 0;
    this.throttle = 0;
    this.brake = 0;
    this.input = { throttle: 0, brake: 0, steer: 0 };
    for (const wheel of this.rigidWheels) {
      wheel.omega = speed / Math.max(0.05, wheel.radius);
      wheel.slipAngle = 0;
      wheel.slipRatio = 0;
      wheel.load = 0;
    }
  }

  placeOnGrid(slot: number): void {
    const row = Math.floor(slot / 2);
    const side = slot % 2 === 0 ? -2.55 : 2.55;
    // Two cars per row, 8.4 m apart, with the right-hand car staggered
    // slightly forward like a real grid box. The spacing scales with short
    // circuits so karts and junior cars still fit behind the line.
    const rowGap = Math.min(0.006, 8.4 / Math.max(1, this.track.length));
    const stagger = slot % 2 === 1 ? rowGap * 0.16 : 0;
    const u = wrapU(gridAnchor(this.track) - row * rowGap - stagger);
    this.placeAt(u, side, 0);
    this.throttle = 0;
    this.brake = 0;
    this.input = { throttle: 0, brake: 0, steer: 0 };
  }

  /** Recover the car onto the racing surface after a spin or a gravel trap. */
  resetToTrack(): void {
    this.placeAt(this.u, 0, 0);
    this.vx = 0;
    this.vy = 0;
    this.yawRate = 0;
    this.steerCommand = 0;
    this.steerAngle = 0;
    this.gear = 1;
    this.throttle = 0;
    this.brake = 0;
  }

  resetSession(compound: CompoundId = this.config.livery.compound): void {
    this.wheels = createTyreSet(compound, this.ambient);
    this.fuel = this.sim.fuel ? this.spec.fuelCapacity : this.spec.fuelCapacity * 0.45;
    this.ers = 1;
    this.damage = { wingFL: 1, wingFR: 1, floor: 1, suspension: 0 };
    this.trackLimitStrikes = 0;
    this.pendingPenalty = 0;
    this.pitCount = 0;
    this.stintCompounds = [compound];
    this.pitCompound = compound;
    this.u = 0.982;
    this.lateral = 0;
    this.vx = 0;
    this.vy = 0;
    this.yawRate = 0;
    this.steerCommand = 0;
    this.steerAngle = 0;
    this.buildWheels();
  }

  private damageScale(): number {
    if (this.sim.damage === 'full') return 1;
    if (this.sim.damage === 'reduced') return 0.55;
    return 0; // visual / off do not change the physics
  }

  update(dt: number): void {
    // A zero, negative or NaN step divides the load model by zero downstream.
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.shiftCooldown = Math.max(0, this.shiftCooldown - dt);
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);
    this.limitCooldown = Math.max(0, this.limitCooldown - dt);

    if (this.servicing) {
      this.vx = Math.max(0, this.vx - dt * 14);
      this.vy *= 0.5;
      this.yawRate *= 0.5;
      this.pitTimer -= dt;
      this.lateral = lateralOffset(this.sample, this.pos.x, this.pos.z);
      this.pos.y = surfaceHeight(this.sample, this.lateral);
      this.speed = this.vx;
      if (this.pitTimer <= 0) this.completePitStop();
      return;
    }

    if (this.servicedThisStop && !this.inPitLane) this.servicedThisStop = false;

    let sample = this.track.samples[nearestSampleIndex(this.track, this.pos.x, this.pos.z, this.index)];
    this.index = sample.index;
    this.u = sample.u;
    let lateral = lateralOffset(sample, this.pos.x, this.pos.z);
    const speedAbs = Math.abs(this.vx);

    // ------- driver inputs, braking assist --------------------------------
    this.throttle = approach(this.throttle, this.input.throttle, dt * 5.5);
    this.brake = approach(this.brake, this.input.brake, dt * 8);

    if (this.assists.brakingAssist !== 'off' && speedAbs > 4) {
      const count = this.track.samples.length;
      const ds = this.track.length / count;
      const strength = this.assists.brakingAssist === 'high' ? 1 : 0.6;
      // Ask the same question a driver asks: "given the corner ahead, how fast
      // may I be *now*?". Walk the braking curve of every point inside the
      // stopping distance rather than comparing against one lookahead point.
      const usable = Math.max(6, this.brakeAccel * 0.55);
      const horizon = Math.min(
        count - 2,
        Math.max(6, Math.round((20 + (speedAbs * speedAbs) / (2 * usable)) / ds)),
      );
      let allowedNow = Infinity;
      for (let k = 3; k <= horizon; k += 2) {
        const target = this.track.racingLine.targetSpeed[(this.index + k) % count];
        const limit = Math.sqrt(target * target + 2 * usable * (k * ds));
        if (limit < allowedNow) allowedNow = limit;
      }
      const excess = speedAbs - allowedNow;
      if (excess > 0.4) {
        const auto = clamp(excess / 6, 0, 1) * strength;
        if (auto > this.brake) this.brake = approach(this.brake, auto, dt * 11);
        this.throttle = Math.min(this.throttle, 1 - auto * 0.95);
      }
    }

    // Keyboard steering is binary, so ramp the command at speed instead of
    // applying full lock in a single physics step.
    const mechanicalSteer = (0.38 * this.spec.steerScale) / (1 + speedAbs * 0.045) + 0.05;
    const availableLat = this.muLat * (GRAVITY + this.aeroState.downforce / this.mass);
    const slipAllowance = 0.09 * Math.min(1, 40 / Math.max(6, speedAbs));
    const gripSteerLimit =
      Math.atan((availableLat * this.spec.wheelbase) / Math.max(1, this.vx * this.vx)) + slipAllowance;
    const maxSteer = Math.min(mechanicalSteer, Math.max(0.018, gripSteerLimit));
    this.steerLimit = maxSteer;
    const steerRate = 5.4 - Math.min(2.2, speedAbs * 0.014);
    this.steerCommand = approach(this.steerCommand, this.input.steer, dt * steerRate);
    const targetSteer = this.steerCommand * maxSteer;
    this.steerAngle = approach(this.steerAngle, targetSteer, dt * 6.5);
    if (this.damage.suspension > 0.01) {
      this.steerAngle += Math.sin(this.u * 200) * 0.006 * this.damage.suspension * this.damageScale();
    }

    // Pit lane / limiter ---------------------------------------------------
    const pitZone = inRangeWrap(sample.u, this.track.pitEntryU, this.track.pitExitU);
    this.inPitLane =
      this.track.pitLane.length > 1 &&
      pitZone &&
      lateral * this.track.pitSide > this.track.width / 2 + 1.6;
    this.pitLimiter = this.inPitLane;
    if (this.inPitLane && this.vx > PIT_LIMIT) {
      this.vx = Math.max(PIT_LIMIT, this.vx - 16 * dt);
    }

    // ------- aero / DRS ---------------------------------------------------
    if (!this.spec.drs || !this.drsAllowed || speedAbs < 62 || this.brake > 0.25) this.drsOpen = false;
    else this.drsOpen = true;

    const avgWing = (this.damage.wingFL + this.damage.wingFR) / 2;
    this.aeroState = computeAero(
      {
        aeroPackage: this.config.livery.aero,
        carClass: this.config.carClass,
        frontWingAngle: this.config.setup.frontWingAngle,
        rearWingAngle: this.config.setup.rearWingAngle,
        rideHeight: this.config.setup.rideHeight,
      },
      speedAbs,
      this.drsOpen,
      this.dirtyAir,
      1 - this.damage.floor,
      (1 - avgWing) * 0.6,
      this.aeroState,
    );

    // ------- surfaces and grip -------------------------------------------
    const gravel = this.track.surface === 'gravel';
    const rallySurface = gravel ? 0.76 : 1;
    const wetSurface = 1 - this.wetness * 0.1;
    const kerbGrip = this.onKerb ? 0.94 : 1;
    const offGrip = this.track.surface === 'gravel' ? 0.58 : 0.63;
    const surfaceGrip = (this.offTrack ? offGrip : kerbGrip) * rallySurface * wetSurface;
    const mechGrip = (1 + (this.config.setup.suspensionStiffness - 50) * 0.00055) * this.spec.grip;
    const wingPenalty = 1 - (1 - avgWing) * 0.3 * this.damageScale();
    const susPenalty = 1 - this.damage.suspension * 0.16 * this.damageScale();

    // ------- chassis frame and suspension ---------------------------------
    const h = this.heading;
    const fxDir = { x: Math.sin(h), z: Math.cos(h) };
    const rgDir = { x: Math.cos(h), z: -Math.sin(h) };
    const worldX = fxDir.x * this.vx + rgDir.x * this.vy;
    const worldZ = fxDir.z * this.vx + rgDir.z * this.vy;

    const mass = this.mass;
    const spec = this.spec;
    const bodyOffset = spec.wheelRadius + WHEEL_REST_LENGTH - STATIC_COMPRESSION;
    const springUnits = SPRING_UNITS * (0.85 + this.config.setup.suspensionStiffness * 0.003);
    const maxSuspensionForce = mass * GRAVITY * 2.6;

    // ------- where the road sits under each wheel -------------------------
    // The chassis rides on its four contact patches, not on the centre line.
    // Sampling only the centre left the body level while the road pitched, so
    // on any gradient the lower axle carried the whole car (at 200 km/h the
    // rears were down to 306 N each) and the car lost half its grip on hills.
    for (let i = 0; i < 4; i++) {
      const wheel = this.rigidWheels[i];
      const wx = this.pos.x + wheel.localZ * fxDir.x + wheel.localX * rgDir.x;
      const wz = this.pos.z + wheel.localZ * fxDir.z + wheel.localX * rgDir.z;
      const groundSample = this.track.samples[nearestSampleIndex(this.track, wx, wz, this.index, 16)];
      wheel.groundY = surfaceHeight(groundSample, lateralOffset(groundSample, wx, wz));
    }
    const frontGround = (this.rigidWheels[0].groundY + this.rigidWheels[1].groundY) / 2;
    const rearGround = (this.rigidWheels[2].groundY + this.rigidWheels[3].groundY) / 2;
    this.pos.y = (frontGround + rearGround) / 2;
    const bodyY = this.pos.y + bodyOffset;

    // ------- corner loads: springs plus weight transfer -------------------
    // A car with no load transfer has the same grip on all four corners, which
    // is why it cornered like it was on rails and then washed out all at once.
    // 46% of the mass sits ahead of the axle line and the centre of gravity is
    // 0.29 m up, which is what sets how hard the nose dives and the rear squats.
    const ayTransfer = clamp(this.ay, -28, 28);
    const axTransfer = clamp(this.ax, -55, 25);
    const transferLat = (mass * ayTransfer * CG_HEIGHT) / spec.trackWidth;
    const transferLong = (mass * axTransfer * CG_HEIGHT) / spec.wheelbase;

    let totalFz = 0;
    for (let i = 0; i < 4; i++) {
      const wheel = this.rigidWheels[i];
      const freeLength = bodyY - wheel.groundY - wheel.radius;
      wheel.previousLength = wheel.length;
      let springLoad = 0;
      if (freeLength >= WHEEL_REST_LENGTH + WHEEL_TRAVEL) {
        wheel.contact = false;
        wheel.length = WHEEL_REST_LENGTH + WHEEL_TRAVEL;
        wheel.lengthVelocity = 0;
        wheel.load = 0;
        continue;
      }
      wheel.contact = true;
      wheel.length = Math.max(WHEEL_REST_LENGTH - WHEEL_TRAVEL, freeLength);
      wheel.lengthVelocity = (wheel.length - wheel.previousLength) / Math.max(1e-4, dt);
      springLoad = suspensionForce({
        stiffness: springUnits,
        dampingCompression: 2 * Math.sqrt(SPRING_UNITS) * 0.6,
        dampingRelaxation: 2 * Math.sqrt(SPRING_UNITS) * 0.95,
        restLength: WHEEL_REST_LENGTH,
        length: wheel.length,
        lengthVelocity: wheel.lengthVelocity,
        chassisMass: mass,
        maxForce: maxSuspensionForce,
      });
      const lateralShare = -Math.sign(wheel.localX || 1) * transferLat * (wheel.front ? 0.55 : 0.45) * 0.5;
      const longitudinalShare = wheel.front ? -transferLong * 0.5 : transferLong * 0.5;
      // Downforce presses the tyres into the road: 45% front, 55% rear.
      const aeroShare = this.aeroState.downforce * (wheel.front ? 0.225 : 0.275);
      wheel.load = Math.max(0, springLoad + lateralShare + longitudinalShare + aeroShare);
      totalFz += wheel.load;
    }

    // ------- tyre forces --------------------------------------------------
    const tyreMu = (i: number): number => {
      const wheel = this.rigidWheels[i];
      const load = Math.max(120, wheel.load);
      const rearReserve = wheel.front ? 1 : 1.045;
      return (
        tyreGrip(this.wheels[i], this.wetness) *
        surfaceGrip *
        mechGrip *
        wingPenalty *
        susPenalty *
        rearReserve *
        loadSensitivity(load)
      );
    };

    // Drivetrain -----------------------------------------------------------
    const gearCount = spec.gearRatios.length;
    const wheelCircumference = 2 * Math.PI * spec.wheelRadius;
    const wheelRpm = (speedAbs / wheelCircumference) * 60;
    let rpmRaw = wheelRpm * (spec.gearRatios[this.gear - 1] * spec.finalDrive);
    if (speedAbs < 2 && this.throttle > 0.05) rpmRaw = Math.max(spec.idleRpm + 900, spec.maxRpm * 0.38);
    this.rpm = clamp(Math.max(spec.idleRpm, rpmRaw), spec.idleRpm, spec.maxRpm);

    const upshiftRpm = spec.maxRpm * 0.95;
    const downshiftRpm = spec.maxRpm * 0.68;
    if (this.assists.gearbox === 'manual') {
      if (this.shiftCooldown <= 0) {
        if (this.input.shiftUp && this.gear < gearCount) {
          this.gear++;
          this.shiftCooldown = 0.11;
        } else if (this.input.shiftDown && this.gear > 1) {
          this.gear--;
          this.shiftCooldown = 0.11;
        }
      }
      if (this.gear > 1 && rpmRaw < spec.maxRpm * 0.32 && this.shiftCooldown <= 0) {
        this.gear--;
        this.shiftCooldown = 0.18;
      }
    } else if (this.shiftCooldown <= 0 && gearCount > 1) {
      if (this.gear < gearCount && rpmRaw > upshiftRpm) {
        this.gear++;
        this.shiftCooldown = 0.09;
      } else if (this.gear > 1 && rpmRaw < downshiftRpm) {
        this.gear--;
        this.shiftCooldown = 0.09;
      }
    }
    if (speedAbs < 1.5) this.gear = 1;

    const rpmNorm = clamp(this.rpm / spec.maxRpm, 0, 1.08);
    const torque = spec.torquePeak * (0.74 + 0.26 * Math.exp(-Math.pow((rpmNorm - 0.78) / 0.2, 2)));
    const limiter = this.rpm > spec.maxRpm * 0.988 ? 0.35 : 1;
    const deploying = spec.ers && this.ers > 0.005 && this.throttle > 0.45 && speedAbs > 18;
    const ersPower = deploying ? 165000 : 0;
    if (deploying) this.ers = Math.max(0, this.ers - dt * 0.052);
    else if (spec.ers) {
      this.ers = Math.min(1, this.ers + dt * (this.brake > 0.15 ? 0.075 : 0.018));
    } else {
      this.ers = 1;
    }

    const gearRatio = spec.gearRatios[this.gear - 1] * spec.finalDrive;
    const reversing = Boolean(this.input.reverse);
    // Force demand at the contact patch; the tyres decide how much of it the
    // car can actually use, so a first-gear launch spins the rears.
    let driveForce =
      ((torque * gearRatio * 0.9) / spec.wheelRadius) * this.throttle * limiter +
      ersPower / Math.max(15, speedAbs);
    if (reversing) driveForce = -this.throttle * mass * 3.4;

    const brakeTotal = this.brake * mass * spec.brakeDecel;
    const bias = this.config.setup.brakeBias / 100;
    const driven = [2, 3];
    const drivePerWheel = driveForce / driven.length;

    let sumFx = 0;
    let sumFy = 0;
    let yawAcc = 0;

    for (let i = 0; i < 4; i++) {
      const wheel = this.rigidWheels[i];
      const rx = wheel.localZ * fxDir.x + wheel.localX * rgDir.x;
      const rz = wheel.localZ * fxDir.z + wheel.localX * rgDir.z;
      // Velocity of the contact patch.
      const vpx = worldX + this.yawRate * rz;
      const vpz = worldZ - this.yawRate * rx;
      // Wheel heading: the front wheels are steered.
      const delta = wheel.front ? this.steerAngle : 0;
      const cosD = Math.cos(delta);
      const sinD = Math.sin(delta);
      const wfx = fxDir.x * cosD + rgDir.x * sinD;
      const wfz = fxDir.z * cosD + rgDir.z * sinD;
      const wrx = rgDir.x * cosD - fxDir.x * sinD;
      const wrz = rgDir.z * cosD - fxDir.z * sinD;
      const vLong = vpx * wfx + vpz * wfz;
      const vLat = vpx * wrx + vpz * wrz;

      const mu = tyreMu(i);
      const load = Math.max(0, wheel.load);

      const axleBrake = (wheel.front ? bias : 1 - bias) / 2;
      const brakeTorque = brakeTotal * axleBrake * wheel.radius;
      const driveTorque = wheel.front ? 0 : drivePerWheel * wheel.radius;
      const coastTorque = this.throttle < 0.05 ? (this.rpm / spec.maxRpm) * 55 * (wheel.front ? 0 : 1) : 0;

      if (!wheel.contact || load <= 1) {
        wheel.slipAngle = 0;
        wheel.slipRatio = 0;
        wheel.omega += ((driveTorque - coastTorque) / WHEEL_INERTIA) * dt;
        continue;
      }

      // Slip is measured from the wheel speed left over by the last step; the
      // tyre then reacts on the wheel and spins it down (or up) this step.
      wheel.slipRatio =
        (wheel.omega * wheel.radius - vLong) / Math.max(1.2, Math.abs(vLong));
      wheel.slipAngle = Math.atan2(vLat, Math.max(0.6, Math.abs(vLong)));

      // Combined slip: one friction demand for both directions.
      const sx = wheel.slipRatio / PEAK_SLIP_RATIO;
      const sy = Math.tan(wheel.slipAngle) / Math.tan(PEAK_SLIP_ANGLE);
      const s = Math.hypot(sx, sy);
      const curve = slipCurve(s);
      const gripForce = mu * load;
      let fxTyre = s > 1e-6 ? (sx / s) * curve * gripForce : 0;
      let fyTyre = s > 1e-6 ? -(sy / s) * curve * gripForce : 0;

      // Bullet's friction circle, applied per wheel and per step.
      const maxImpulse = load * mu * dt;
      const clamped = clampFrictionCircle(fxTyre * dt, fyTyre * dt, maxImpulse, 0.85, 1);
      fxTyre = clamped.forward / dt;
      fyTyre = clamped.side / dt;

      // Wheel spin: engine torque in, brake torque and tyre reaction out.
      const spinDirection = Math.sign(wheel.omega) || Math.sign(vLong) || 1;
      const brakeTorqueSigned = brakeTorque * spinDirection;
      const nextOmega =
        wheel.omega +
        ((driveTorque - coastTorque - brakeTorqueSigned - fxTyre * wheel.radius) / WHEEL_INERTIA) * dt;
      if (brakeTorque > 0 && Math.sign(nextOmega) !== Math.sign(wheel.omega || spinDirection) && Math.abs(vLong) > 0.5) {
        wheel.omega = 0; // locked: the tyre is now sliding, not rolling
      } else if (brakeTorque <= 0 && this.throttle < 0.05 && Math.abs(vLong) < 1.5) {
        wheel.omega = vLong / wheel.radius;
      } else {
        wheel.omega = nextOmega;
      }

      // Traction control and ABS work on wheel speed, exactly as the real
      // systems do: they stop the tyre exceeding its peak slip.
      if (this.assists.tractionControl !== 'off' && !wheel.front && vLong > 1) {
        const target = this.assists.tractionControl === 'full' ? 0.1 : 0.16;
        const limit = (vLong * (1 + target)) / wheel.radius;
        if (wheel.omega > limit) wheel.omega = limit;
      }
      if (this.assists.abs && vLong > 2) {
        const lock = (vLong * (1 - 0.1)) / wheel.radius;
        if (wheel.omega < lock) wheel.omega = lock;
      }

      const fwx = fxTyre * wfx + fyTyre * wrx;
      const fwz = fxTyre * wfz + fyTyre * wrz;
      sumFx += fwx;
      sumFy += fwz;
      // Torque about the yaw axis from a force applied at the contact patch.
      yawAcc += (fwx * rz - fwz * rx) / spec.yawInertia;
    }

    this.muLat =
      ((tyreMu(0) + tyreMu(1) + tyreMu(2) + tyreMu(3)) / 4) *
      (1 + this.aeroState.downforce / Math.max(1, mass * GRAVITY));

    // ------- longitudinal resistance and gravity along the slope ----------
    const speedNow = Math.hypot(worldX, worldZ);
    const roadDrag =
      0.013 * mass * GRAVITY +
      (this.offTrack ? 2400 : 0) +
      (gravel && !this.offTrack ? mass * 1.15 : 0) +
      this.damage.suspension * 240 * this.damageScale() +
      this.aeroState.drag;
    const vLongBody = this.vx;
    const dragX = speedNow > 0.4 ? -(worldX / speedNow) * roadDrag : 0;
    const dragZ = speedNow > 0.4 ? -(worldZ / speedNow) * roadDrag : 0;
    // Gravity pulls along the gradient of the surface.
    const gradeLong = -this.sample.tangent.y * mass * GRAVITY;
    const bankRad = (this.sample.bankDeg * Math.PI) / 180;
    const bankAssist = -this.sample.turnSign * mass * GRAVITY * Math.sin(bankRad);

    let axWorld = (sumFx + dragX + fxDir.x * gradeLong) / mass;
    let azWorld = (sumFy + dragZ + fxDir.z * gradeLong) / mass;
    // Banked corners carry load and add a small sideways pull.
    azWorld += rgDir.z * (bankAssist / mass);
    axWorld += rgDir.x * (bankAssist / mass);

    const lowSpeed = speedAbs < 3;
    let yawAccel = yawAcc;
    if (lowSpeed) {
      // Kinematic steering below walking pace, so the car can be parked and
      // reversed precisely instead of relying on tyre slip.
      const targetYaw = (this.vx * Math.tan(this.steerAngle)) / spec.wheelbase;
      this.yawRate = approach(this.yawRate, targetYaw, dt * 6);
      this.vy *= 0.85;
      yawAccel = 0;
    } else {
      const diff = (this.config.setup.diffOnThrottle - 50) / 50;
      if (this.throttle > 0.2) yawAccel -= this.yawRate * (0.12 + diff * 0.4);
      // Only aerodynamic yaw damping is left. The previous model damped up to
      // 1.05 rad/s per second on top of the tyres, which fought every turn-in
      // and made the car feel like it was towing a trailer: understeer on
      // entry, then a snap once the tyres finally let go.
      this.yawRate *= 1 - dt * (0.05 + Math.min(0.1, speedAbs * 0.0012));
    }

    let nwx = worldX + axWorld * dt;
    let nwz = worldZ + azWorld * dt;
    this.yawRate += yawAccel * dt;

    const newVx = nwx * fxDir.x + nwz * fxDir.z;
    const newVy = nwx * rgDir.x + nwz * rgDir.z;
    const vyBefore = this.vy;
    this.vx = newVx;
    this.vy = newVy;
    this.ax = (newVx - vLongBody) / Math.max(1e-4, dt);
    // Measured lateral acceleration in the body frame, not the kinematic
    // v*r estimate: the old number understated a sliding car by half and drove
    // the weight-transfer model with it.
    this.ay = (newVy - vyBefore) / Math.max(1e-4, dt) + this.vx * this.yawRate;
    this.gLatSmoothed += (this.ay / GRAVITY - this.gLatSmoothed) * Math.min(1, dt * 8);
    this.gLongSmoothed += (this.ax / GRAVITY - this.gLongSmoothed) * Math.min(1, dt * 8);

    // Visible attitude from the same filtered accelerations that drive the
    // corner loads. The body used to sit flat and the weight transfer was
    // invisible; now a stop dives the nose, an exit squats it and a corner
    // rolls the outside down. tanh saturates, so even a 5 g braking event
    // leans the shell instead of tipping it onto its side.
    const pitchTarget = PITCH_GAIN * Math.tanh((-this.gLongSmoothed * GRAVITY) / PITCH_REF);
    const rollTarget = ROLL_GAIN * Math.tanh((this.gLatSmoothed * GRAVITY) / ROLL_REF);
    this.bodyPitch += (pitchTarget - this.bodyPitch) * Math.min(1, dt * 12);
    this.bodyRoll += (rollTarget - this.bodyRoll) * Math.min(1, dt * 10);
    if (this.vx < 0 && !reversing) this.vx = 0;
    if (this.vx < -9) this.vx = -9;
    this.vy = clamp(this.vy, -30, 30);

    this.heading += this.yawRate * dt;
    this.pos.x += (Math.sin(h) * this.vx + Math.cos(h) * this.vy) * dt;
    this.pos.z += (Math.cos(h) * this.vx - Math.sin(h) * this.vy) * dt;

    // ------- track position, surfaces and barriers ------------------------
    sample = this.track.samples[nearestSampleIndex(this.track, this.pos.x, this.pos.z, this.index)];
    this.index = sample.index;
    this.u = sample.u;
    lateral = lateralOffset(sample, this.pos.x, this.pos.z);
    this.lateral = lateral;
    this.pos.y = surfaceHeight(sample, lateral);

    this.offTrack = !this.inPitLane && Math.abs(lateral) > sample.width / 2 + 0.35;
    this.onKerb = !this.offTrack && Math.abs(lateral) > sample.width / 2 - 0.55 && sample.kerb;

    const relativeHeading = this.heading - Math.atan2(sample.tangent.x, sample.tangent.z);
    const bodyHalfWidth =
      Math.abs(Math.cos(relativeHeading)) * this.collisionHalfWidth +
      Math.abs(Math.sin(relativeHeading)) * this.collisionHalfLength;
    // A car sideways against a narrow barrier can be wider than the gap between
    // the centre line and the wall. Leaving the limit negative flipped the
    // barrier side every substep and teleported the car across the road.
    const barrierLimit = Math.max(0.6, sample.barrier - bodyHalfWidth - 0.02);
    if (!this.inPitLane && Math.abs(lateral) > barrierLimit) {
      this.hitBarrier(lateral, sample, speedAbs, barrierLimit, dt);
    }

    if (
      this.sim.trackLimits !== 'off' &&
      !this.inPitLane &&
      Math.abs(lateral) > this.track.width / 2 + 1.35 &&
      speedAbs > 3
    ) {
      this.offTimer += dt;
      if (this.offTimer > 0.65 && this.limitCooldown <= 0) {
        this.trackLimitStrikes++;
        this.limitCooldown = 3;
        this.offTimer = 0;
        if (this.sim.trackLimits === 'strict' && this.trackLimitStrikes % 3 === 0) {
          this.pendingPenalty += 5;
        }
      }
    } else {
      this.offTimer = Math.max(0, this.offTimer - dt * 2);
    }

    if (
      this.inPitLane &&
      !this.servicedThisStop &&
      Math.abs(wrapU(sample.u) - this.track.pitBoxU) < 0.008 &&
      Math.abs(this.vx) < 3
    ) {
      this.servicing = true;
      this.servicedThisStop = true;
      this.pitTimer = 2.6;
      this.vx = 0;
      this.vy = 0;
    }

    this.updateTyresAndFuel(dt, mass);
    this.speed = this.vx;
  }

  private updateTyresAndFuel(dt: number, _mass: number): void {
    const wearMultiplier = this.sim.tyreWear === 'off' ? 0 : this.sim.tyreWear === '2x' ? 2 : 1;
    const speed = Math.abs(this.vx);
    for (let i = 0; i < 4; i++) {
      const wheel = this.rigidWheels[i];
      updateTyre(this.wheels[i], {
        load: wheel.load,
        slipAngle: wheel.slipAngle,
        slipRatio: Math.min(1, Math.abs(wheel.slipRatio)),
        braking: this.brake,
        speed,
        dt,
        wearMultiplier,
        ambient: this.ambient,
        wetness: this.wetness,
      });
    }

    if (this.sim.fuel) {
      const burn = (0.006 + this.throttle * 0.028 + (this.ers < 1 ? 0.004 : 0)) * dt;
      this.fuel = Math.max(0, this.fuel - burn);
    } else {
      this.fuel = this.spec.fuelCapacity * 0.45;
    }
    if (this.sim.damage === 'full' && this.offTrack && speed > 25) {
      this.damage.floor = Math.max(0.2, this.damage.floor - dt * 0.002);
    }
    this.impactPulse = Math.max(0, this.impactPulse - dt * 2.2);
  }

  private hitBarrier(lateral: number, sample: TrackSample, impactSpeed: number, limit: number, dt: number): void {
    const side = Math.sign(lateral) || 1;
    this.pos.x = sample.pos.x + sample.right.x * side * limit;
    this.pos.z = sample.pos.z + sample.right.z * side * limit;
    this.pos.y = surfaceHeight(sample, side * limit);
    this.lateral = side * limit;

    const h = this.heading;
    let wx = Math.sin(h) * this.vx + Math.cos(h) * this.vy;
    let wz = Math.cos(h) * this.vx - Math.sin(h) * this.vy;
    const nx = sample.right.x * side;
    const nz = sample.right.z * side;
    const into = wx * nx + wz * nz;
    if (into > 0) {
      wx -= nx * into * 1.1;
      wz -= nz * into * 1.1;
      this.vx = Math.sin(h) * wx + Math.cos(h) * wz;
      this.vy = Math.cos(h) * wx - Math.sin(h) * wz;
    }

    const wallHeading = Math.atan2(sample.tangent.x, sample.tangent.z);
    const align = Math.atan2(Math.sin(wallHeading - h), Math.cos(wallHeading - h));
    if (Math.abs(align) < 1.4) this.yawRate += clamp(align, -0.7, 0.7) * dt * 9;
    this.yawRate *= 0.88;

    if (into < 1.2) return;
    if (this.impactCooldown > 0) return;
    this.impactCooldown = 0.5;
    this.lastImpactSpeed = impactSpeed;
    this.impactPulse = 1;
    const severity = clamp(into / 34, 0.12, 1.4);
    if (this.sim.damage === 'off') return;
    if (side > 0) this.damage.wingFR = Math.max(0, this.damage.wingFR - (0.2 + severity * 0.4));
    else this.damage.wingFL = Math.max(0, this.damage.wingFL - (0.2 + severity * 0.4));
    this.damage.floor = Math.max(0.15, this.damage.floor - severity * 0.12);
    if (severity > 0.45) this.damage.suspension = Math.min(1, this.damage.suspension + severity * 0.16);
  }

  private completePitStop(): void {
    reMount(this.wheels, this.pitCompound, this.ambient);
    this.damage.wingFL = 1;
    this.damage.wingFR = 1;
    this.damage.floor = Math.min(1, this.damage.floor + 0.35);
    this.damage.suspension = Math.max(0, this.damage.suspension - 0.4);
    if (this.sim.fuel) this.fuel = this.spec.fuelCapacity;
    this.ers = 1;
    this.pitCount++;
    this.stintCompounds.push(this.pitCompound);
    this.servicing = false;
    this.vx = 0;
  }

  getTelemetry(): VehicleTelemetry {
    const wingLoss = 1 - (this.damage.wingFL + this.damage.wingFR) / 2;
    return {
      speedKmh: this.speedKmh,
      gear: this.gear,
      rpm: this.rpm,
      throttle: this.throttle,
      brake: this.brake,
      drsOpen: this.drsOpen,
      drsAvailable: this.drsAllowed,
      drsEquipped: this.spec.drs,
      ersEquipped: this.spec.ers,
      ers: this.ers,
      fuel: this.fuel,
      lateral: this.lateral,
      u: this.u,
      inPitLane: this.inPitLane,
      pitLimiter: this.pitLimiter,
      servicing: this.servicing,
      pitTimer: this.pitTimer,
      wingFL: this.damage.wingFL,
      wingFR: this.damage.wingFR,
      floor: this.damage.floor,
      suspension: this.damage.suspension,
      understeer: wingLoss,
      gLat: this.gLatSmoothed,
      gLong: this.gLongSmoothed,
      compound: this.wheels[0].compound.id,
      trackLimitStrikes: this.trackLimitStrikes,
      pendingPenalty: this.pendingPenalty,
      tyres: this.wheels.map((t) => ({
        position: t.position,
        compound: t.compound.id,
        color: t.compound.color,
        life: t.life,
        surfaceTemp: t.surfaceTemp,
        coreTemp: t.coreTemp,
        load: t.load,
        slipAngle: (t.slipAngle * 180) / Math.PI,
        locked: t.locked,
      })),
    };
  }

  getAero(): AeroState {
    return this.aeroState;
  }

  /** Steering lock the car can actually use at its current speed, radians. */
  get maxSteerAngle(): number {
    return this.steerLimit;
  }

  /** Lateral acceleration the tyres can hold right now, m/s². */
  get lateralAccel(): number {
    return this.muLat * (GRAVITY + this.aeroState.downforce / this.mass);
  }

  /** Braking deceleration available right now, m/s². */
  get brakeAccel(): number {
    return this.lateralAccel * 0.94 + this.aeroState.drag / this.mass;
  }

  /** Percent of tyre life remaining across the set. */
  get tyreLife(): number {
    return (this.wheels[0].life + this.wheels[1].life + this.wheels[2].life + this.wheels[3].life) / 4;
  }

  getCompound(): CompoundId {
    return this.wheels[0].compound.id;
  }

  getCompoundColor(): string {
    return COMPOUNDS[this.getCompound()].color;
  }
}
