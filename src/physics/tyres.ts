export type CompoundId = 'soft' | 'medium' | 'hard' | 'intermediate' | 'wet';
export type WheelPosition = 'FL' | 'FR' | 'RL' | 'RR';

export interface TyreCompound {
  id: CompoundId;
  label: string;
  short: string;
  /** Sidewall ring colour. */
  color: string;
  /** Peak friction coefficient on a perfect surface. */
  mu: number;
  /** Multiplier on wear. */
  wearRate: number;
  optimalTemp: number;
  /** Temperature range before the tyre falls off. */
  window: number;
  wetGrip: number;
}

export const COMPOUNDS: Record<CompoundId, TyreCompound> = {
  soft: {
    id: 'soft',
    label: 'Soft',
    short: 'S',
    color: '#e10600',
    mu: 1.98,
    wearRate: 1.55,
    optimalTemp: 98,
    window: 30,
    wetGrip: 0.3,
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    short: 'M',
    color: '#ffd400',
    mu: 1.86,
    wearRate: 1.0,
    optimalTemp: 104,
    window: 35,
    wetGrip: 0.32,
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    short: 'H',
    color: '#f4f4f4',
    mu: 1.74,
    wearRate: 0.66,
    optimalTemp: 112,
    window: 40,
    wetGrip: 0.34,
  },
  intermediate: {
    id: 'intermediate',
    label: 'Intermediate',
    short: 'I',
    color: '#18c96a',
    mu: 1.46,
    wearRate: 1.2,
    optimalTemp: 72,
    window: 28,
    wetGrip: 0.78,
  },
  wet: {
    id: 'wet',
    label: 'Wet',
    short: 'W',
    color: '#1789e8',
    mu: 1.24,
    wearRate: 1.45,
    optimalTemp: 52,
    window: 24,
    wetGrip: 1,
  },
};

export interface TyreState {
  position: WheelPosition;
  compound: TyreCompound;
  /** Remaining life fraction, 1 = new, 0 = destroyed. */
  life: number;
  surfaceTemp: number;
  coreTemp: number;
  /** Vertical load in Newtons. */
  load: number;
  slipAngle: number;
  /** 0..1 lockup / wheelspin indicator for the HUD. */
  slipRatio: number;
  tempGrip: number;
  lifeGrip: number;
  locked: boolean;
  /** Accumulated flat spot from locked braking. */
  flatSpot: number;
}

export function createTyre(position: WheelPosition, compound: CompoundId, ambient = 28): TyreState {
  return {
    position,
    compound: COMPOUNDS[compound],
    life: 1,
    surfaceTemp: ambient + 13,
    coreTemp: ambient + 6,
    load: 0,
    slipAngle: 0,
    slipRatio: 0,
    tempGrip: 0.8,
    lifeGrip: 1,
    locked: false,
    flatSpot: 0,
  };
}

export function createTyreSet(compound: CompoundId, ambient = 28): TyreState[] {
  return [
    createTyre('FL', compound, ambient),
    createTyre('FR', compound, ambient),
    createTyre('RL', compound, ambient),
    createTyre('RR', compound, ambient),
  ];
}

/** Simplified Pacejka Magic Formula, peak force points opposite the slip. */
export function pacejka(slipAngle: number, mu: number, normalLoad: number): number {
  const B = 10.2;
  const C = 1.42;
  const E = 0.94;
  const D = mu * normalLoad;
  const x = B * slipAngle;
  const peak = Math.sin(C * Math.atan(x - E * (x - Math.atan(x))));
  return D * peak;
}

export function updateTyreGrip(tyre: TyreState): void {
  const opt = tyre.compound.optimalTemp;
  const t = tyre.coreTemp;
  let tempGrip: number;
  if (t < opt) {
    // Cold tyres are still a little greasy, but not so edgy that the first
    // keyboard input after the start instantly rotates the car.
    tempGrip = 0.64 + 0.36 * Math.max(0, Math.min(1, (t - 18) / (opt - 18)));
  } else {
    const over = (t - opt) / tyre.compound.window;
    tempGrip = 1 - Math.min(0.34, over * 0.18);
    // Graining / blistering late in the window.
    if (over > 1.6) tempGrip -= Math.min(0.2, (over - 1.6) * 0.2);
  }
  // Steep cliff below 25% life.
  const lifeGrip = tyre.life >= 0.25 ? 1 : 0.42 + 0.58 * (tyre.life / 0.25);
  tyre.tempGrip = Math.max(0.35, Math.min(1.06, tempGrip));
  tyre.lifeGrip = lifeGrip - tyre.flatSpot * 0.25;
}

export interface TyreUpdateInput {
  load: number;
  slipAngle: number;
  slipRatio: number;
  braking: number;
  speed: number;
  dt: number;
  wearMultiplier: number;
  ambient: number;
  wetness?: number;
}

export function updateTyre(tyre: TyreState, input: TyreUpdateInput): void {
  updateTyreGrip(tyre);
  tyre.load = input.load;
  tyre.slipAngle = input.slipAngle;
  tyre.slipRatio = input.slipRatio;
  tyre.locked = input.slipRatio > 0.82 && input.braking > 0.5;

  const speed = Math.abs(input.speed);
  const loadFactor = Math.max(0, input.load) / 4200;
  const slide = Math.abs(input.slipAngle) * speed; // m/s of scrub
  const heatFromSlide = Math.min(3.2, slide * 0.032 * loadFactor);
  const heatFromBrake = input.braking * 0.55;
  const heatFromEngine = input.slipRatio * 0.25;
  const wetness = Math.max(0, Math.min(1, input.wetness ?? 0));
  const cooling = (tyre.surfaceTemp - input.ambient) * (0.055 + 0.0017 * speed + wetness * 0.045);
  tyre.surfaceTemp += (heatFromSlide + heatFromBrake + heatFromEngine - cooling) * input.dt * 1.9;
  tyre.surfaceTemp = Math.max(input.ambient, Math.min(230, tyre.surfaceTemp));
  const coreTarget = tyre.surfaceTemp * 0.86 + 12;
  tyre.coreTemp += (coreTarget - tyre.coreTemp) * input.dt * (0.32 + speed * 0.0022);
  tyre.coreTemp = Math.max(input.ambient, Math.min(190, tyre.coreTemp));

  // Wear accelerates with temperature and slide energy. The base rate is
  // calibrated so a soft set lasts roughly 15 minutes of clean running at 1x,
  // with abuse (wheelspin, lockups, overheating) able to halve that.
  const overHeat = Math.max(0, tyre.coreTemp - tyre.compound.optimalTemp) / 55;
  const wearRate =
    (0.000012 + Math.min(0.000055, slide * 0.00000075) + overHeat * 0.00005 + input.slipRatio * 0.000035) *
    tyre.compound.wearRate *
    input.wearMultiplier;
  tyre.life = Math.max(0, tyre.life - wearRate * input.dt * 60);
  if (tyre.locked && speed > 8) {
    tyre.flatSpot = Math.min(1, tyre.flatSpot + input.dt * 0.02);
  }
}

export function tyreGrip(tyre: TyreState, wetness = 0): number {
  // Slicks retain almost none of their peak grip in standing water; the wet
  // tyre gives up some dry performance but keeps its tread working. wetness
  // is 0 for dry and 1 for a fully wet surface.
  const water = Math.max(0, Math.min(1, wetness));
  const wetRetention = 1 - water * (1 - tyre.compound.wetGrip);
  return tyre.compound.mu * tyre.tempGrip * Math.max(0.3, tyre.lifeGrip) * wetRetention;
}

export function averageGrip(tyres: TyreState[], from: number, to: number, wetness = 0): number {
  let sum = 0;
  for (let i = from; i <= to; i++) sum += tyreGrip(tyres[i], wetness);
  return sum / (to - from + 1);
}

export function reMount(tyres: TyreState[], compound: CompoundId, ambient: number): void {
  for (const t of tyres) {
    t.compound = COMPOUNDS[compound];
    t.life = 1;
    t.surfaceTemp = ambient + 24;
    t.coreTemp = ambient + 14;
    t.lifeGrip = 1;
    t.flatSpot = 0;
    t.tempGrip = 0.86;
  }
}
