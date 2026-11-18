export type DifficultyPresetId = 'rookie' | 'club' | 'pro' | 'ace' | 'master' | 'custom';
export type BrakingAssist = 'off' | 'low' | 'high';
export type TractionControl = 'off' | 'medium' | 'full';
export type RacingLineMode = 'off' | 'corners' | 'full';
export type GearboxMode = 'auto' | 'manual';
export type DamageMode = 'off' | 'visual' | 'reduced' | 'full';
export type TyreWearRate = '1x' | '2x' | 'off';
export type TrackLimitsMode = 'lenient' | 'strict';

export interface AssistSettings {
  brakingAssist: BrakingAssist;
  abs: boolean;
  tractionControl: TractionControl;
  racingLine: RacingLineMode;
  gearbox: GearboxMode;
}

export interface SimSettings {
  damage: DamageMode;
  tyreWear: TyreWearRate;
  fuel: boolean;
  trackLimits: TrackLimitsMode;
}

export interface DifficultySettings {
  preset: DifficultyPresetId;
  aiPace: number; // 50..110 (%)
  assists: AssistSettings;
  sim: SimSettings;
}

export interface DifficultyPreset {
  id: DifficultyPresetId;
  label: string;
  blurb: string;
  aiPace: number;
  assists: AssistSettings;
  sim: SimSettings;
}

export const DIFFICULTY_PRESETS: DifficultyPreset[] = [
  {
    id: 'rookie',
    label: 'Rookie',
    blurb: 'Full assists, forgiving limits, 60% AI pace.',
    aiPace: 60,
    assists: { brakingAssist: 'high', abs: true, tractionControl: 'full', racingLine: 'full', gearbox: 'auto' },
    sim: { damage: 'off', tyreWear: 'off', fuel: false, trackLimits: 'lenient' },
  },
  {
    id: 'club',
    label: 'Club',
    blurb: 'Light assists with visual damage.',
    aiPace: 72,
    assists: { brakingAssist: 'low', abs: true, tractionControl: 'full', racingLine: 'full', gearbox: 'auto' },
    sim: { damage: 'visual', tyreWear: '1x', fuel: true, trackLimits: 'lenient' },
  },
  {
    id: 'pro',
    label: 'Pro',
    blurb: 'ABS only. Wear, fuel and reduced damage.',
    aiPace: 84,
    assists: { brakingAssist: 'off', abs: true, tractionControl: 'medium', racingLine: 'corners', gearbox: 'auto' },
    sim: { damage: 'reduced', tyreWear: '1x', fuel: true, trackLimits: 'strict' },
  },
  {
    id: 'ace',
    label: 'Ace',
    blurb: 'No braking help. Manual paddles, full damage.',
    aiPace: 94,
    assists: { brakingAssist: 'off', abs: false, tractionControl: 'off', racingLine: 'off', gearbox: 'manual' },
    sim: { damage: 'full', tyreWear: '1x', fuel: true, trackLimits: 'strict' },
  },
  {
    id: 'master',
    label: 'Master / 110%',
    blurb: 'Maximum AI, zero assists, 2x tyre wear.',
    aiPace: 110,
    assists: { brakingAssist: 'off', abs: false, tractionControl: 'off', racingLine: 'off', gearbox: 'manual' },
    sim: { damage: 'full', tyreWear: '2x', fuel: true, trackLimits: 'strict' },
  },
];

export function preset(id: DifficultyPresetId): DifficultyPreset {
  return DIFFICULTY_PRESETS.find((p) => p.id === id) ?? DIFFICULTY_PRESETS[2];
}

export function defaultDifficulty(): DifficultySettings {
  const p = preset('pro');
  return {
    preset: 'pro',
    aiPace: p.aiPace,
    assists: { ...p.assists },
    sim: { ...p.sim },
  };
}

const STORAGE_KEY = 'apex-gp-2026.difficulty.v1';

export function loadDifficulty(): DifficultySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultDifficulty();
    const parsed = JSON.parse(raw) as Partial<DifficultySettings>;
    const base = defaultDifficulty();
    return {
      preset: parsed.preset ?? base.preset,
      aiPace: clamp(Number(parsed.aiPace) || base.aiPace, 50, 110),
      assists: { ...base.assists, ...(parsed.assists ?? {}) },
      sim: { ...base.sim, ...(parsed.sim ?? {}) },
    };
  } catch {
    return defaultDifficulty();
  }
}

export function saveDifficulty(settings: DifficultySettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage may be unavailable */
  }
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
