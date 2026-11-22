import type { CompoundId } from '../physics/tyres';

export type FinishType = 'gloss' | 'matte' | 'carbon';
export type LiveryPattern = 'classic' | 'fade' | 'chevron' | 'halftone' | 'minimal';
export type AeroPackage = 'low-drag' | 'balanced' | 'high-downforce';
export type CarClass =
  | 'hybrid'
  | 'v10'
  | 'junior'
  | 'gt'
  | 'prototype'
  | 'hypercar'
  | 'stock'
  | 'rally'
  | 'kart';
export type CarCategory = 'open-wheel' | 'gt' | 'prototype' | 'kart';

export const CAR_CLASS_ORDER: CarClass[] = [
  'hybrid',
  'v10',
  'junior',
  'gt',
  'prototype',
  'hypercar',
  'stock',
  'rally',
  'kart',
];

export interface CarClassSpec {
  id: CarClass;
  label: string;
  short: string;
  blurb: string;
  category: CarCategory;
  /** Card caption when the class needs a name of its own inside a family. */
  categoryLabel?: string;
  mass: number;
  grip: number;
  aero: number;
  drag: number;
  wheelbase: number;
  trackWidth: number;
  cgHeight: number;
  yawInertia: number;
  wheelRadius: number;
  brakeDecel: number;
  steerScale: number;
  fuelCapacity: number;
  fuelDensity: number;
  gearRatios: number[];
  finalDrive: number;
  maxRpm: number;
  idleRpm: number;
  torquePeak: number;
  drs: boolean;
  ers: boolean;
  /** Half of the body length used for car-to-car contact, in metres. */
  collisionHalfLength: number;
  /** Half of the body width used for car-to-car contact, in metres. */
  collisionHalfWidth: number;
  /** Longitudinal offset of the contact box centre from the car origin, forward positive. */
  collisionCenterZ: number;
}

/** Fictional classes keep the game independent of any real championship. */
export const CAR_CLASSES: Record<CarClass, CarClassSpec> = {
  hybrid: {
    id: 'hybrid',
    label: 'GP Hybrid',
    short: 'HYB',
    blurb: 'Turbo-hybrid · 798 kg · maximum downforce',
    category: 'open-wheel',
    mass: 798,
    grip: 1,
    aero: 1,
    drag: 1,
    wheelbase: 3.6,
    trackWidth: 1.9,
    cgHeight: 0.32,
    yawInertia: 1180,
    wheelRadius: 0.36,
    brakeDecel: 44,
    steerScale: 1,
    fuelCapacity: 100,
    fuelDensity: 0.745,
    gearRatios: [3.3, 2.65, 2.2, 1.85, 1.58, 1.36, 1.16, 0.98],
    finalDrive: 5.2,
    maxRpm: 13000,
    idleRpm: 3600,
    torquePeak: 435,
    drs: true,
    ers: true,
    collisionHalfLength: 2.8,
    collisionHalfWidth: 1.0,
    collisionCenterZ: 0,
  },
  v10: {
    id: 'v10',
    label: 'GP V10',
    short: 'V10',
    blurb: 'High-revving V10 · lighter · higher top speed',
    category: 'open-wheel',
    mass: 760,
    grip: 0.96,
    aero: 0.82,
    drag: 0.93,
    wheelbase: 3.5,
    trackWidth: 1.9,
    cgHeight: 0.31,
    yawInertia: 1120,
    wheelRadius: 0.36,
    brakeDecel: 44,
    steerScale: 1,
    fuelCapacity: 110,
    fuelDensity: 0.745,
    gearRatios: [3.2, 2.5, 2.05, 1.72, 1.45, 1.22, 1.02],
    finalDrive: 5.8,
    maxRpm: 15000,
    idleRpm: 4000,
    torquePeak: 430,
    drs: false,
    ers: false,
    collisionHalfLength: 2.72,
    collisionHalfWidth: 0.97,
    collisionCenterZ: 0,
  },
  junior: {
    id: 'junior',
    label: 'GP Junior',
    short: 'JNR',
    blurb: 'Entry formula · 620 kg · lower power and grip',
    category: 'open-wheel',
    mass: 620,
    grip: 0.92,
    aero: 0.78,
    drag: 0.86,
    wheelbase: 3.0,
    trackWidth: 1.75,
    cgHeight: 0.3,
    yawInertia: 900,
    wheelRadius: 0.33,
    brakeDecel: 38,
    steerScale: 1.05,
    fuelCapacity: 60,
    fuelDensity: 0.745,
    gearRatios: [3.4, 2.7, 2.2, 1.8, 1.5, 1.24],
    finalDrive: 4.8,
    maxRpm: 12000,
    idleRpm: 3500,
    torquePeak: 290,
    drs: false,
    ers: false,
    collisionHalfLength: 2.33,
    collisionHalfWidth: 0.83,
    collisionCenterZ: 0,
  },
  gt: {
    id: 'gt',
    label: 'GP GT',
    short: 'GT',
    blurb: 'Closed-wheel GT3 · 1290 kg · mechanical grip',
    category: 'gt',
    mass: 1290,
    grip: 1.12,
    aero: 0.34,
    drag: 1.4,
    wheelbase: 2.62,
    trackWidth: 1.62,
    cgHeight: 0.42,
    yawInertia: 1900,
    wheelRadius: 0.34,
    brakeDecel: 30,
    steerScale: 1.2,
    fuelCapacity: 100,
    fuelDensity: 0.745,
    gearRatios: [3.4, 2.4, 1.85, 1.5, 1.24, 1.04],
    finalDrive: 3.45,
    maxRpm: 8500,
    idleRpm: 1100,
    torquePeak: 520,
    drs: false,
    ers: false,
    collisionHalfLength: 2.4,
    collisionHalfWidth: 1.09,
    collisionCenterZ: -0.02,
  },
  prototype: {
    id: 'prototype',
    label: 'GP Prototype',
    short: 'P1',
    blurb: 'Closed-cockpit hybrid · 1,030 kg · endurance prototype',
    category: 'prototype',
    mass: 1030,
    grip: 1.08,
    aero: 0.92,
    drag: 1.05,
    wheelbase: 3.05,
    trackWidth: 1.72,
    cgHeight: 0.38,
    yawInertia: 1500,
    wheelRadius: 0.36,
    brakeDecel: 38,
    steerScale: 1.12,
    fuelCapacity: 100,
    fuelDensity: 0.745,
    gearRatios: [3.1, 2.45, 1.98, 1.64, 1.38, 1.16],
    finalDrive: 3.65,
    maxRpm: 9000,
    idleRpm: 1800,
    torquePeak: 680,
    drs: false,
    ers: true,
    collisionHalfLength: 2.5,
    collisionHalfWidth: 1.24,
    collisionCenterZ: 0.03,
  },
  hypercar: {
    id: 'hypercar',
    label: 'GP Hypercar',
    short: 'HYC',
    blurb: 'Road-based hybrid hypercar · 1,450 kg · active aero',
    category: 'gt',
    mass: 1450,
    grip: 1.18,
    aero: 0.58,
    drag: 1.12,
    wheelbase: 2.7,
    trackWidth: 1.68,
    cgHeight: 0.4,
    yawInertia: 2100,
    wheelRadius: 0.36,
    brakeDecel: 32,
    steerScale: 1.16,
    fuelCapacity: 90,
    fuelDensity: 0.745,
    gearRatios: [3.2, 2.35, 1.85, 1.5, 1.25, 1.05, 0.9],
    finalDrive: 3.4,
    maxRpm: 9000,
    idleRpm: 1200,
    torquePeak: 820,
    drs: false,
    ers: true,
    collisionHalfLength: 2.42,
    collisionHalfWidth: 1.17,
    collisionCenterZ: 0.03,
  },
  stock: {
    id: 'stock',
    label: 'GP Stock',
    short: 'STK',
    blurb: 'Full-size stock car · 1,550 kg · oval aero',
    category: 'gt',
    mass: 1550,
    grip: 1.12,
    aero: 0.3,
    drag: 1.5,
    wheelbase: 2.9,
    trackWidth: 1.62,
    cgHeight: 0.46,
    yawInertia: 2500,
    wheelRadius: 0.37,
    brakeDecel: 28,
    steerScale: 1.2,
    fuelCapacity: 80,
    fuelDensity: 0.745,
    gearRatios: [2.9, 1.9, 1.4, 1.05],
    finalDrive: 3.5,
    maxRpm: 8000,
    idleRpm: 900,
    torquePeak: 700,
    drs: false,
    ers: false,
    collisionHalfLength: 2.46,
    collisionHalfWidth: 1.13,
    collisionCenterZ: 0.04,
  },
  rally: {
    id: 'rally',
    label: 'GP Rally',
    short: 'RLY',
    blurb: 'Rally WRC · 1,230 kg · all-wheel drive on gravel',
    category: 'gt',
    categoryLabel: 'RALLY',
    mass: 1230,
    grip: 1.16,
    aero: 0.18,
    drag: 1.55,
    wheelbase: 2.51,
    trackWidth: 1.58,
    cgHeight: 0.44,
    yawInertia: 1750,
    wheelRadius: 0.34,
    brakeDecel: 27,
    steerScale: 1.24,
    fuelCapacity: 60,
    fuelDensity: 0.745,
    gearRatios: [3.6, 2.6, 2.0, 1.6, 1.3, 1.08],
    finalDrive: 3.9,
    maxRpm: 7000,
    idleRpm: 1000,
    torquePeak: 500,
    drs: false,
    ers: false,
    collisionHalfLength: 2.06,
    collisionHalfWidth: 0.95,
    collisionCenterZ: 0,
  },
  kart: {
    id: 'kart',
    label: 'GP Kart',
    short: 'KRT',
    blurb: 'Direct-drive kart · 175 kg · 115 km/h',
    category: 'kart',
    mass: 175,
    grip: 1.05,
    aero: 0.015,
    drag: 1.8,
    wheelbase: 1.05,
    trackWidth: 1.2,
    cgHeight: 0.24,
    yawInertia: 95,
    wheelRadius: 0.14,
    brakeDecel: 18,
    steerScale: 1.7,
    fuelCapacity: 8,
    fuelDensity: 0.75,
    gearRatios: [1],
    finalDrive: 5.5,
    maxRpm: 12000,
    idleRpm: 3000,
    torquePeak: 30,
    drs: false,
    ers: false,
    collisionHalfLength: 1.23,
    collisionHalfWidth: 0.78,
    collisionCenterZ: 0.07,
  },
};

export interface LiveryConfig {
  primary: string;
  secondary: string;
  accent: string;
  finish: FinishType;
  pattern: LiveryPattern;
  number: number;
  tag: string;
  visorTint: string;
  aero: AeroPackage;
  compound: CompoundId;
}

export interface CarSetup {
  frontWingAngle: number;
  rearWingAngle: number;
  brakeBias: number;
  diffOnThrottle: number;
  suspensionStiffness: number;
  rideHeight: number;
}

export interface CarConfig {
  livery: LiveryConfig;
  setup: CarSetup;
  driverName: string;
  teamName: string;
  carClass: CarClass;
}

export const AERO_PACKAGE_LABELS: Record<AeroPackage, string> = {
  'low-drag': 'Low-Drag Monza Spec',
  balanced: 'Balanced Medium-Downforce',
  'high-downforce': 'High-Downforce Monaco Spec',
};

export const FINISH_LABELS: Record<FinishType, string> = {
  gloss: 'Gloss',
  matte: 'Matte',
  carbon: 'Metallic Carbon',
};

export const PATTERN_LABELS: Record<LiveryPattern, string> = {
  classic: 'Classic Stripes',
  fade: 'Sidepod Fade',
  chevron: 'Geometric Chevron',
  halftone: 'Halftone',
  minimal: 'Minimal Carbon',
};

export const DEFAULT_CONFIG: CarConfig = {
  driverName: 'A. DRIVER',
  teamName: 'GP 2026',
  carClass: 'hybrid',
  livery: {
    primary: '#070b12',
    secondary: '#2f7dff',
    accent: '#d9f3ff',
    // Matte black keeps the launch livery reading black under the studio
    // lights instead of mirroring the whole softbox as white.
    finish: 'matte',
    pattern: 'classic',
    number: 27,
    tag: 'GPX',
    visorTint: '#6fb6ff',
    aero: 'balanced',
    compound: 'medium',
  },
  setup: {
    frontWingAngle: 11,
    rearWingAngle: 13,
    brakeBias: 56,
    diffOnThrottle: 62,
    suspensionStiffness: 55,
    rideHeight: 45,
  },
};

export interface TeamPreset {
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  tag: string;
  number: number;
  aero: AeroPackage;
  compound: CompoundId;
}

/** Fictional grid used for the AI field. */
export const TEAM_PRESETS: TeamPreset[] = [
  { name: 'Rosso Corse', primary: '#d5001c', secondary: '#101014', accent: '#ffffff', tag: 'LUX', number: 16, aero: 'balanced', compound: 'medium' },
  { name: 'Argent Racing', primary: '#c8ccce', secondary: '#0b0d10', accent: '#00d2be', tag: 'VAN', number: 63, aero: 'balanced', compound: 'soft' },
  { name: 'Redstone GP', primary: '#1b2a5e', secondary: '#7c0a1e', accent: '#f6d03c', tag: 'KAI', number: 1, aero: 'high-downforce', compound: 'medium' },
  { name: 'Orange Motorsport', primary: '#ff8000', secondary: '#12161c', accent: '#47c7fc', tag: 'NEO', number: 4, aero: 'balanced', compound: 'soft' },
  { name: 'Emerald Racing', primary: '#00594f', secondary: '#d8ff3e', accent: '#ffffff', tag: 'ELI', number: 14, aero: 'high-downforce', compound: 'hard' },
  { name: 'Bluefield Racing', primary: '#0a3d91', secondary: '#ff69d4', accent: '#ffffff', tag: 'RAV', number: 10, aero: 'balanced', compound: 'medium' },
  { name: 'Vale Motorsport', primary: '#0b4ea2', secondary: '#ffffff', accent: '#00c2ff', tag: 'ORI', number: 23, aero: 'low-drag', compound: 'hard' },
  { name: 'Falcon Racing', primary: '#f2f4f5', secondary: '#14315f', accent: '#e2001a', tag: 'ION', number: 6, aero: 'balanced', compound: 'soft' },
  { name: 'Stateside Racing', primary: '#e8e8e8', secondary: '#b01220', accent: '#111111', tag: 'ZEN', number: 31, aero: 'low-drag', compound: 'medium' },
  { name: 'Bavaria Motorsport', primary: '#8c8f93', secondary: '#c4001a', accent: '#0a0a0a', tag: 'VEX', number: 27, aero: 'balanced', compound: 'hard' },
  { name: 'Nordic Works', primary: '#0f2b46', secondary: '#8fd7ff', accent: '#ffffff', tag: 'NRD', number: 77, aero: 'high-downforce', compound: 'medium' },
  { name: 'Scuderia Lume', primary: '#f5c400', secondary: '#141517', accent: '#ffffff', tag: 'LUM', number: 55, aero: 'balanced', compound: 'soft' },
  { name: 'Pacific Racing', primary: '#00a19a', secondary: '#0b1b2b', accent: '#f2f2f2', tag: 'PAC', number: 12, aero: 'balanced', compound: 'medium' },
  { name: 'Iberia Motorsport', primary: '#c1121f', secondary: '#f6e7c1', accent: '#1d1d1d', tag: 'IBR', number: 22, aero: 'high-downforce', compound: 'hard' },
  { name: 'Aurora GP', primary: '#6a2cff', secondary: '#111318', accent: '#c9b8ff', tag: 'AUR', number: 9, aero: 'low-drag', compound: 'soft' },
  { name: 'Delta Corse', primary: '#12352a', secondary: '#d4ff4f', accent: '#ffffff', tag: 'DLT', number: 44, aero: 'balanced', compound: 'medium' },
  { name: 'Kestrel Racing', primary: '#e0e3e6', secondary: '#0d4c8a', accent: '#ff5c00', tag: 'KES', number: 33, aero: 'balanced', compound: 'hard' },
  { name: 'Onyx Performance', primary: '#15171b', secondary: '#d4a017', accent: '#f4f4f4', tag: 'ONX', number: 88, aero: 'high-downforce', compound: 'soft' },
  { name: 'Meridian GP', primary: '#1c5f9e', secondary: '#f0f0f0', accent: '#00d1b2', tag: 'MRD', number: 17, aero: 'low-drag', compound: 'medium' },
  { name: 'Vanguard Racing', primary: '#8b1e3f', secondary: '#0f1116', accent: '#ffd166', tag: 'VNG', number: 5, aero: 'balanced', compound: 'hard' },
];

const STORAGE_KEY = 'gp2026.car.v1';
const LEGACY_STORAGE_KEY = 'apex-gp-2026.car.v2';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function sanitizeConfig(input: Partial<CarConfig> | null | undefined): CarConfig {
  const c: Partial<CarConfig> = input ?? {};
  const l: Partial<LiveryConfig> = c.livery ?? {};
  const s: Partial<CarSetup> = c.setup ?? {};
  const num = Number(l.number);
  return {
    driverName: typeof c.driverName === 'string' && c.driverName.trim() ? c.driverName.slice(0, 22) : DEFAULT_CONFIG.driverName,
    teamName: typeof c.teamName === 'string' && c.teamName.trim() ? c.teamName.slice(0, 24) : DEFAULT_CONFIG.teamName,
    carClass: CAR_CLASS_ORDER.includes(c.carClass as CarClass) ? (c.carClass as CarClass) : DEFAULT_CONFIG.carClass,
    livery: {
      primary: typeof l.primary === 'string' ? l.primary : DEFAULT_CONFIG.livery.primary,
      secondary: typeof l.secondary === 'string' ? l.secondary : DEFAULT_CONFIG.livery.secondary,
      accent: typeof l.accent === 'string' ? l.accent : DEFAULT_CONFIG.livery.accent,
      finish: (['gloss', 'matte', 'carbon'] as const).includes(l.finish as never) ? (l.finish as FinishType) : DEFAULT_CONFIG.livery.finish,
      pattern: (['classic', 'fade', 'chevron', 'halftone', 'minimal'] as const).includes(l.pattern as never)
        ? (l.pattern as LiveryPattern)
        : DEFAULT_CONFIG.livery.pattern,
      number: Number.isFinite(num) ? clamp(Math.round(num), 1, 99) : DEFAULT_CONFIG.livery.number,
      tag:
        typeof l.tag === 'string' && l.tag.trim()
          ? l.tag.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || DEFAULT_CONFIG.livery.tag
          : DEFAULT_CONFIG.livery.tag,
      visorTint: typeof l.visorTint === 'string' ? l.visorTint : DEFAULT_CONFIG.livery.visorTint,
      aero: (['low-drag', 'balanced', 'high-downforce'] as const).includes(l.aero as never)
        ? (l.aero as AeroPackage)
        : DEFAULT_CONFIG.livery.aero,
      compound: (['soft', 'medium', 'hard', 'intermediate', 'wet'] as const).includes(l.compound as never)
        ? (l.compound as CompoundId)
        : DEFAULT_CONFIG.livery.compound,
    },
    setup: {
      frontWingAngle: clamp(Number(s.frontWingAngle) || DEFAULT_CONFIG.setup.frontWingAngle, 0, 20),
      rearWingAngle: clamp(Number(s.rearWingAngle) || DEFAULT_CONFIG.setup.rearWingAngle, 0, 25),
      brakeBias: clamp(Number(s.brakeBias) || DEFAULT_CONFIG.setup.brakeBias, 50, 62),
      diffOnThrottle: clamp(Number(s.diffOnThrottle) || DEFAULT_CONFIG.setup.diffOnThrottle, 0, 100),
      suspensionStiffness: clamp(Number(s.suspensionStiffness) || DEFAULT_CONFIG.setup.suspensionStiffness, 0, 100),
      rideHeight: clamp(Number(s.rideHeight) || DEFAULT_CONFIG.setup.rideHeight, 30, 80),
    },
  };
}

export function loadCarConfig(): CarConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitizeConfig(JSON.parse(raw) as Partial<CarConfig>);
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) return cloneConfig(DEFAULT_CONFIG);
    const parsed = sanitizeConfig(JSON.parse(legacy) as Partial<CarConfig>);
    // The old default was red/yellow. Give the rebrand a black/blue default
    // without wiping a livery the driver actually customised.
    if (parsed.teamName === 'Apex GP' && parsed.livery.primary === '#d5001c' && parsed.livery.secondary === '#111318') {
      return cloneConfig(DEFAULT_CONFIG);
    }
    return parsed;
  } catch {
    return cloneConfig(DEFAULT_CONFIG);
  }
}

export function saveCarConfig(config: CarConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* ignore quota errors */
  }
}

export function cloneConfig(config: CarConfig): CarConfig {
  return {
    ...config,
    livery: { ...config.livery },
    setup: { ...config.setup },
  };
}

export function teamConfig(team: TeamPreset, carClass: CarClass = 'hybrid'): CarConfig {
  return {
    driverName: team.tag,
    teamName: team.name,
    carClass,
    livery: {
      primary: team.primary,
      secondary: team.secondary,
      accent: team.accent,
      finish: 'gloss',
      pattern: 'classic',
      number: team.number,
      tag: team.tag,
      visorTint: '#1a1a1a',
      aero: team.aero,
      compound: team.compound,
    },
    setup: {
      frontWingAngle: 11,
      rearWingAngle: 13,
      brakeBias: 56,
      diffOnThrottle: 60,
      suspensionStiffness: 55,
      rideHeight: 45,
    },
  };
}
