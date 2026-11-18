import type { CompoundId } from '../physics/tyres';

export type FinishType = 'gloss' | 'matte' | 'carbon';
export type LiveryPattern = 'classic' | 'fade' | 'chevron' | 'halftone' | 'minimal';
export type AeroPackage = 'low-drag' | 'balanced' | 'high-downforce';
export type CarClass = 'hybrid' | 'v10' | 'junior';

export interface CarClassSpec {
  id: CarClass;
  label: string;
  short: string;
  blurb: string;
  mass: number;
  power: number;
  grip: number;
  aero: number;
  drag: number;
}

/** Fictional classes keep the game independent of any real championship. */
export const CAR_CLASSES: Record<CarClass, CarClassSpec> = {
  hybrid: {
    id: 'hybrid',
    label: 'Apex Hybrid',
    short: 'HYB',
    blurb: 'Turbo-hybrid · 798 kg · maximum downforce',
    mass: 798,
    power: 1,
    grip: 1,
    aero: 1,
    drag: 1,
  },
  v10: {
    id: 'v10',
    label: 'Apex V10',
    short: 'V10',
    blurb: 'High-revving V10 · lighter · higher top speed',
    mass: 760,
    power: 1.08,
    grip: 0.94,
    aero: 0.82,
    drag: 0.93,
  },
  junior: {
    id: 'junior',
    label: 'Apex Junior',
    short: 'JNR',
    blurb: 'Entry formula · 620 kg · lower power and grip',
    mass: 620,
    power: 0.58,
    grip: 0.9,
    aero: 0.78,
    drag: 0.86,
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
  teamName: 'Apex GP',
  carClass: 'hybrid',
  livery: {
    primary: '#d5001c',
    secondary: '#111318',
    accent: '#ffd400',
    finish: 'gloss',
    pattern: 'classic',
    number: 27,
    tag: 'APX',
    visorTint: '#c9a227',
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
];

const STORAGE_KEY = 'apex-gp-2026.car.v1';

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
    carClass: (['hybrid', 'v10', 'junior'] as const).includes(c.carClass as never) ? (c.carClass as CarClass) : DEFAULT_CONFIG.carClass,
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
    if (!raw) return cloneConfig(DEFAULT_CONFIG);
    return sanitizeConfig(JSON.parse(raw) as Partial<CarConfig>);
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

export function teamConfig(team: TeamPreset): CarConfig {
  return {
    driverName: team.tag,
    teamName: team.name,
    carClass: 'hybrid',
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
