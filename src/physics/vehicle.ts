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
import type { AssistSettings, SimSettings } from './settings';
import {
  averageGrip,
  COMPOUNDS,
  createTyreSet,
  pacejka,
  reMount,
  updateTyre,
  type CompoundId,
  type TyreState,
} from './tyres';

const GRAVITY = 9.81;
const WHEELBASE = 3.6;
const LF = 1.82;
const LR = 1.78;
const TRACK_WIDTH = 1.9;
const CG_HEIGHT = 0.32;
const YAW_INERTIA = 1180;
const WHEEL_RADIUS = 0.36;
const WHEEL_CIRCUMFERENCE = 2 * Math.PI * WHEEL_RADIUS;
const FINAL_DRIVE = 5.2;
const GEAR_RATIOS = [3.3, 2.65, 2.2, 1.85, 1.58, 1.36, 1.16, 0.98];
const PIT_LIMIT = 80 / 3.6;

export interface DriverInput {
  throttle: number;
  brake: number;
  steer: number;
  shiftUp?: boolean;
  shiftDown?: boolean;
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

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function approach(current: number, target: number, maxDelta: number): number {
  return current + clamp(target - current, -maxDelta, maxDelta);
}

/**
 * Open-wheel car physics. The simulation runs at a fixed 120 Hz; every force
 * below is evaluated in the car's banked track frame so 18-degree corners
 * really do carry more normal load and allow higher apex speeds.
 */
export class RaceCar {
  readonly track: TrackData;
  readonly config: CarConfig;
  readonly assists: AssistSettings;
  readonly sim: SimSettings;

  pos = new Vector3();
  heading = 0;
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
  understeer = 0;

  private input: DriverInput = { throttle: 0, brake: 0, steer: 0 };
  private shiftCooldown = 0;
  private impactCooldown = 0;
  private offTimer = 0;
  private limitCooldown = 0;
  private servicedThisStop = false;
  private aeroState: AeroState = { cla: 0, cda: 0, drag: 0, downforce: 0, drsEffect: 0 };
  private wheelspin = 0;
  private lockedFront = false;
  private lockedRear = false;
  private gLatSmoothed = 0;
  private gLongSmoothed = 0;

  constructor(track: TrackData, config: CarConfig, assists: AssistSettings, sim: SimSettings) {
    this.track = track;
    this.config = config;
    this.assists = assists;
    this.sim = sim;
    this.ambient = track.night ? 19 : 27;
    this.wheels = createTyreSet(config.livery.compound, this.ambient);
    this.pitCompound = config.livery.compound;
    this.stintCompounds = [config.livery.compound];
    this.fuel = sim.fuel ? 100 : 45;
    this.placeAt(0.982, -2.2, 0);
  }

  get speedKmh(): number {
    return Math.abs(this.vx) * 3.6;
  }

  get mass(): number {
    return CAR_CLASSES[this.config.carClass].mass + this.fuel * 0.745;
  }

  get sample(): TrackSample {
    return this.track.samples[this.index];
  }

  setInput(input: DriverInput): void {
    this.input = {
      throttle: clamp(input.throttle, 0, 1),
      brake: clamp(input.brake, 0, 1),
      steer: clamp(input.steer, -1, 1),
      shiftUp: Boolean(input.shiftUp),
      shiftDown: Boolean(input.shiftDown),
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
    this.gear = speed > 55 ? 5 : speed > 35 ? 4 : speed > 20 ? 3 : speed > 8 ? 2 : 1;
    this.lateral = lateral;
    this.steerInput = 0;
    this.steerAngle = 0;
    this.throttle = 0;
    this.brake = 0;
    this.input = { throttle: 0, brake: 0, steer: 0 };
  }

  placeOnGrid(slot: number): void {
    const row = Math.floor(slot / 2);
    const side = slot % 2 === 0 ? -2.3 : 2.3;
    // Two cars per row, 7 m between rows, all behind the start line.
    const u = wrapU(0.992 - row * 0.0013);
    this.placeAt(u, side, 0);
    this.throttle = 0;
    this.brake = 0;
    this.input = { throttle: 0, brake: 0, steer: 0 };
  }

  /** Recover the car onto the racing surface after a spin or a trip through a gravel trap. */
  resetToTrack(): void {
    this.placeAt(this.u, 0, 0);
    this.vx = 0;
    this.vy = 0;
    this.yawRate = 0;
    this.steerAngle = 0;
    this.gear = 1;
    this.throttle = 0;
    this.brake = 0;
  }

  resetSession(compound: CompoundId = this.config.livery.compound): void {
    this.wheels = createTyreSet(compound, this.ambient);
    this.fuel = this.sim.fuel ? 100 : 45;
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
  }

  private damageScale(): number {
    if (this.sim.damage === 'full') return 1;
    if (this.sim.damage === 'reduced') return 0.55;
    return 0; // visual / off do not change the physics
  }

  update(dt: number): void {
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
      const ahead = Math.min(this.track.samples.length - 2, Math.round((45 + speedAbs * 2.4) / (this.track.length / this.track.samples.length)));
      const target = this.track.racingLine.targetSpeed[(this.index + ahead) % this.track.samples.length];
      if (speedAbs > target + 1.5) {
        const strength = this.assists.brakingAssist === 'high' ? 1 : 0.55;
        const auto = clamp((speedAbs - target) / 9, 0, 1) * strength;
        this.brake = Math.max(this.brake, auto);
        this.throttle = Math.min(this.throttle, 0.15);
      }
    }

    const maxSteer = 0.36 / (1 + speedAbs * 0.075) + 0.025;
    const targetSteer = this.input.steer * maxSteer;
    this.steerAngle = approach(this.steerAngle, targetSteer, dt * 1.9);
    if (this.damage.suspension > 0.01) {
      this.steerAngle += Math.sin(this.u * 200) * 0.006 * this.damage.suspension * this.damageScale();
    }

    // Pit lane / limiter ---------------------------------------------------
    const pitZone = inRangeWrap(sample.u, this.track.pitEntryU, this.track.pitExitU);
    this.inPitLane = pitZone && lateral > this.track.width / 2 + 1.6;
    this.pitLimiter = this.inPitLane;
    if (this.inPitLane && this.vx > PIT_LIMIT) {
      this.vx = Math.max(PIT_LIMIT, this.vx - 16 * dt);
    }

    // ------- aero / DRS ---------------------------------------------------
    if (!this.drsAllowed || speedAbs < 62 || this.brake > 0.25) this.drsOpen = false;
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

    // ------- banking: tilted normal force + gravity component -------------
    const bankRad = (sample.bankDeg * Math.PI) / 180;
    const latEstimate = (this.vx * this.vx) / Math.max(25, sample.radius);
    const normalFactor = Math.cos(bankRad) + (latEstimate * Math.sin(bankRad)) / GRAVITY;
    const bankAssist = -sample.turnSign * GRAVITY * Math.sin(bankRad);

    const mass = this.mass;
    const totalFz = mass * GRAVITY * normalFactor + this.aeroState.downforce;
    let fzF = totalFz * 0.46;
    let fzR = totalFz * 0.54;
    const longTransfer = clamp((this.ax * mass * CG_HEIGHT) / WHEELBASE, -totalFz * 0.22, totalFz * 0.22);
    fzF -= longTransfer;
    fzR += longTransfer;
    const latTransfer = clamp((this.ay * mass * CG_HEIGHT) / TRACK_WIDTH, -totalFz * 0.3, totalFz * 0.3);
    const stiffness = 0.8 + this.config.setup.suspensionStiffness * 0.0035;

    const loads = [
      Math.max(180, fzF * 0.5 + latTransfer * 0.55 * stiffness), // FL
      Math.max(180, fzF * 0.5 - latTransfer * 0.55 * stiffness), // FR
      Math.max(180, fzR * 0.5 + latTransfer * 0.45 * stiffness), // RL
      Math.max(180, fzR * 0.5 - latTransfer * 0.45 * stiffness), // RR
    ];
    fzF = loads[0] + loads[1];
    fzR = loads[2] + loads[3];

    const kerbGrip = this.onKerb ? 0.94 : 1;
    const surfaceGrip = this.offTrack ? 0.63 : kerbGrip;
    const mechGrip = (1 + (this.config.setup.suspensionStiffness - 50) * 0.00055) * CAR_CLASSES[this.config.carClass].grip;
    const wingPenalty = 1 - (1 - avgWing) * 0.3 * this.damageScale();
    const susPenalty = 1 - this.damage.suspension * 0.16 * this.damageScale();
    const muF = averageGrip(this.wheels, 0, 1) * surfaceGrip * mechGrip * wingPenalty * susPenalty;
    const muR = averageGrip(this.wheels, 2, 3) * surfaceGrip * mechGrip * susPenalty;

    const stableV = Math.max(2.5, speedAbs);
    const alphaF = Math.atan2(this.vy + this.yawRate * LF, stableV) - this.steerAngle;
    const alphaR = Math.atan2(this.vy - this.yawRate * LR, stableV);

    let fyF = -pacejka(alphaF, muF, fzF);
    let fyR = -pacejka(alphaR, muR, fzR);

    // ------- engine, gearbox, ERS ----------------------------------------
    const wheelRpm = (speedAbs / WHEEL_CIRCUMFERENCE) * 60;
    const ratio = GEAR_RATIOS[this.gear - 1] * FINAL_DRIVE;
    let rpmRaw = wheelRpm * ratio;
    if (speedAbs < 2 && this.throttle > 0.05) rpmRaw = 5000;
    this.rpm = clamp(Math.max(3600, rpmRaw), 3600, 13000);

    if (this.assists.gearbox === 'manual') {
      if (this.shiftCooldown <= 0) {
        if (this.input.shiftUp && this.gear < 8) {
          this.gear++;
          this.shiftCooldown = 0.11;
        } else if (this.input.shiftDown && this.gear > 1) {
          this.gear--;
          this.shiftCooldown = 0.11;
        }
      }
      // Anti-stall safety downshift.
      if (this.gear > 1 && rpmRaw < 4200 && this.shiftCooldown <= 0) {
        this.gear--;
        this.shiftCooldown = 0.18;
      }
    } else if (this.shiftCooldown <= 0) {
      if (this.gear < 8 && rpmRaw > 12350) {
        this.gear++;
        this.shiftCooldown = 0.09;
      } else if (this.gear > 1 && rpmRaw < 8900) {
        this.gear--;
        this.shiftCooldown = 0.09;
      }
    }
    if (speedAbs < 1.5) this.gear = 1;

    const torque =
      (330 + 105 * Math.exp(-Math.pow((this.rpm - 10600) / 2400, 2)) + 18 * (this.rpm / 13000)) *
      CAR_CLASSES[this.config.carClass].power;
    const limiter = this.rpm > 12850 ? 0.35 : 1;
    const deploying = this.ers > 0.005 && this.throttle > 0.45 && speedAbs > 18;
    const ersPower = deploying ? 165000 : 0;
    if (deploying) this.ers = Math.max(0, this.ers - dt * 0.052);
    else {
      const recharge = this.brake > 0.15 ? 0.075 : 0.018;
      this.ers = Math.min(1, this.ers + dt * recharge);
    }

    const gearRatio = GEAR_RATIOS[this.gear - 1] * FINAL_DRIVE;
    let driveForce =
      (torque * gearRatio * 0.9) / WHEEL_RADIUS * this.throttle * limiter +
      ersPower / Math.max(15, speedAbs);

    // Traction control / wheelspin.
    const rearCircle = Math.max(1, Math.hypot(muR * fzR, 1));
    const rearLongLimit = Math.sqrt(Math.max(0, rearCircle * rearCircle - fyR * fyR));
    this.wheelspin = 0;
    if (driveForce > rearLongLimit) {
      if (this.assists.tractionControl === 'full') {
        driveForce = rearLongLimit * 0.97;
      } else if (this.assists.tractionControl === 'medium') {
        this.wheelspin = clamp((driveForce - rearLongLimit) / rearLongLimit, 0, 0.5);
        driveForce = rearLongLimit * 1.02;
      } else {
        this.wheelspin = clamp((driveForce - rearLongLimit) / Math.max(1, rearLongLimit), 0, 1);
        driveForce = Math.min(driveForce, rearLongLimit * 1.35);
        fyR *= 1 - this.wheelspin * 0.32;
      }
    }

    // ------- brakes with bias, ABS and lockups ---------------------------
    const brakeRequest = this.brake * mass * 44;
    const bias = this.config.setup.brakeBias / 100;
    const frontCircle = Math.hypot(muF * fzF, 1);
    const rearCircle2 = Math.hypot(muR * fzR, 1);
    let availF = Math.sqrt(Math.max(0, frontCircle * frontCircle - fyF * fyF));
    let availR = Math.sqrt(Math.max(0, rearCircle2 * rearCircle2 - fyR * fyR));
    let requestedF = brakeRequest * bias;
    let requestedR = brakeRequest * (1 - bias);
    this.lockedFront = false;
    this.lockedRear = false;
    if (!this.assists.abs) {
      if (requestedF > availF * 1.02) {
        this.lockedFront = true;
        availF *= 0.82;
        fyF *= 0.55;
      }
      if (requestedR > availR * 1.02) {
        this.lockedRear = true;
        availR *= 0.76;
        fyR *= 0.5;
        this.yawRate += Math.sign(alphaR || 1) * 0.05 * dt * 60;
      }
    }
    requestedF = Math.min(requestedF, availF);
    requestedR = Math.min(requestedR, availR);

    // ------- longitudinal load -------------------------------------------
    const rolling = 0.013 * mass * GRAVITY + (this.offTrack ? 2400 : 0);
    const suspensionDrag = this.damage.suspension * 240 * this.damageScale();
    const engineBrake = this.throttle < 0.05 ? 90 + speedAbs * 3.5 : 0;
    const fx =
      driveForce -
      requestedF -
      requestedR -
      this.aeroState.drag -
      rolling -
      suspensionDrag -
      engineBrake;

    // ------- integrate body dynamics -------------------------------------
    const cosD = Math.cos(this.steerAngle);
    const sinD = Math.sin(this.steerAngle);
    const lowSpeed = speedAbs < 3;

    let ax = fx / mass + this.vy * this.yawRate;
    let ay = (fyF * cosD + fyR) / mass - this.vx * this.yawRate + bankAssist;
    let yawAcc = (LF * fyF * cosD - LR * fyR) / YAW_INERTIA;

    if (lowSpeed) {
      const targetYaw = (this.vx * Math.tan(this.steerAngle)) / WHEELBASE;
      this.yawRate = approach(this.yawRate, targetYaw, dt * 6);
      this.vy *= 0.82;
      ay = 0;
      yawAcc = 0;
      ax = fx / mass;
    }

    // Differential locking stabilises the rear under power.
    const diff = (this.config.setup.diffOnThrottle - 50) / 50;
    if (this.throttle > 0.35) yawAcc -= this.yawRate * diff * 0.55;

    this.vx += ax * dt;
    this.vy += ay * dt;
    this.yawRate += yawAcc * dt;
    this.yawRate *= 1 - dt * 0.5;
    if (this.vx < 0) this.vx = 0;
    this.vy = clamp(this.vy, -28, 28);

    this.ax = ax;
    this.ay = ay;
    this.gLatSmoothed += (ay / GRAVITY - this.gLatSmoothed) * Math.min(1, dt * 8);
    this.gLongSmoothed += (ax / GRAVITY - this.gLongSmoothed) * Math.min(1, dt * 8);

    this.heading += this.yawRate * dt;
    const h = this.heading;
    this.pos.x += (Math.sin(h) * this.vx + Math.cos(h) * this.vy) * dt;
    this.pos.z += (Math.cos(h) * this.vx - Math.sin(h) * this.vy) * dt;

    // ------- track position, surfaces and barriers ------------------------
    sample = this.track.samples[nearestSampleIndex(this.track, this.pos.x, this.pos.z, this.index)];
    this.index = sample.index;
    this.u = sample.u;
    lateral = lateralOffset(sample, this.pos.x, this.pos.z);
    this.lateral = lateral;
    this.pos.y = surfaceHeight(sample, lateral);

    this.offTrack = Math.abs(lateral) > this.track.width / 2 + 0.35;
    this.onKerb = !this.offTrack && Math.abs(lateral) > this.track.width / 2 - 0.55 && sample.kerb;

    const barrier = this.track.width / 2 + 3.35;
    if (!this.inPitLane && lateral > barrier) {
      this.hitBarrier(lateral, sample, speedAbs);
    } else if (lateral < -barrier) {
      this.hitBarrier(lateral, sample, speedAbs);
    }

    // Track limits: strict mode issues a 5 s penalty every third strike.
    if (Math.abs(lateral) > this.track.width / 2 + 1.35 && speedAbs > 3) {
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

    // ------- pit box service --------------------------------------------
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

    this.updateTyresAndFuel(dt, alphaF, alphaR, loads, requestedF / Math.max(1, fzF), requestedR / Math.max(1, fzR));
    this.speed = this.vx;
  }

  private updateTyresAndFuel(
    dt: number,
    alphaF: number,
    alphaR: number,
    loads: number[],
    brakeF: number,
    brakeR: number,
  ): void {
    const wearMultiplier = this.sim.tyreWear === 'off' ? 0 : this.sim.tyreWear === '2x' ? 2 : 1;
    const speed = Math.abs(this.vx);
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      updateTyre(this.wheels[i], {
        load: loads[i],
        slipAngle: front ? alphaF : alphaR,
        slipRatio: front ? (this.lockedFront ? 1 : 0) : this.lockedRear ? 1 : this.wheelspin,
        braking: front ? brakeF : brakeR,
        speed,
        dt,
        wearMultiplier,
        ambient: this.ambient,
      });
    }

    if (this.sim.fuel) {
      const burn = (0.006 + this.throttle * 0.028 + (deployingSafe(this.ers) ? 0.004 : 0)) * dt;
      this.fuel = Math.max(0, this.fuel - burn);
    } else {
      this.fuel = 45;
    }
    if (this.sim.damage === 'full' && this.offTrack && speed > 25) {
      this.damage.floor = Math.max(0.2, this.damage.floor - dt * 0.002);
    }
    this.impactPulse = Math.max(0, this.impactPulse - dt * 2.2);
  }

  private hitBarrier(lateral: number, sample: TrackSample, impactSpeed: number): void {
    const barrier = this.track.width / 2 + 3.35;
    const side = Math.sign(lateral) || 1;
    const limit = barrier - 0.7;
    this.pos.x = sample.pos.x + sample.right.x * side * limit;
    this.pos.z = sample.pos.z + sample.right.z * side * limit;
    this.pos.y = surfaceHeight(sample, side * limit);
    this.lateral = side * limit;
    if (this.impactCooldown > 0) return;
    this.impactCooldown = 0.5;
    this.lastImpactSpeed = impactSpeed;
    this.impactPulse = 1;
    const severity = clamp(impactSpeed / 70, 0.15, 1.4);
    this.vx *= 0.45;
    this.vy = -this.vy * 0.2;
    this.yawRate *= 0.4;
    if (this.sim.damage === 'off') return;
    if (side > 0) this.damage.wingFR = Math.max(0, this.damage.wingFR - (0.28 + severity * 0.4));
    else this.damage.wingFL = Math.max(0, this.damage.wingFL - (0.28 + severity * 0.4));
    this.damage.floor = Math.max(0.15, this.damage.floor - severity * 0.12);
    if (severity > 0.45) this.damage.suspension = Math.min(1, this.damage.suspension + severity * 0.16);
  }

  private completePitStop(): void {
    reMount(this.wheels, this.pitCompound, this.ambient);
    this.damage.wingFL = 1;
    this.damage.wingFR = 1;
    this.damage.floor = Math.min(1, this.damage.floor + 0.35);
    this.damage.suspension = Math.max(0, this.damage.suspension - 0.4);
    if (this.sim.fuel) this.fuel = 100;
    this.ers = 1;
    this.pitCount++;
    this.stintCompounds.push(this.pitCompound);
    this.servicing = false;
    this.vx = 0;
    this.understeer = 1 - (this.damage.wingFL + this.damage.wingFR) / 2;
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

function deployingSafe(_ers: number): boolean {
  return false;
}
