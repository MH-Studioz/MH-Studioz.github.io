import { loadDifficulty, type DifficultySettings } from '../physics/settings';

export type WeatherMode = 'dry' | 'wet';
export type TimeOfDay = 'day' | 'night';
export type AiDifficulty = 'rookie' | 'club' | 'pro' | 'ace';
export type AiAggression = 'low' | 'normal' | 'high';
export type RaceAiCount = number;

export interface RaceSettings {
  weather: WeatherMode;
  timeOfDay: TimeOfDay;
  aiCount: RaceAiCount;
  aiDifficulty: AiDifficulty;
  /** How hard the AI will lean on the car ahead: side-by-side moves, defending. */
  aiAggression: AiAggression;
  /** Whether the AI is allowed to make small, human driver errors. */
  aiMistakes: boolean;
  trackLimits: 'off' | 'lenient' | 'strict';
  flags: boolean;
  /** Free-practice minutes before weekend qualifying. 0 skips practice. */
  practiceMinutes: number;
  /** Timed qualifying length in minutes. */
  qualifyingMinutes: number;
}

export const MAX_AI_OPPONENTS = 20;
export const MAX_LAPS = 50;

export interface RaceSelection {
  mode: 'quick' | 'timetrial' | 'weekend' | 'party';
  featureId: string;
  laps: number;
  settings: RaceSettings;
}

export const AI_DIFFICULTY_LABELS: Record<AiDifficulty, string> = {
  rookie: 'Rookie',
  club: 'Club',
  pro: 'Pro',
  ace: 'Ace',
};

export const AI_DIFFICULTY_PACE: Record<AiDifficulty, number> = {
  rookie: 62,
  club: 76,
  pro: 88,
  ace: 100,
};

export const AI_AGGRESSION_LABELS: Record<AiAggression, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
};

/** Multiplier applied to the pace-derived aggression value. */
export const AI_AGGRESSION_SCALE: Record<AiAggression, number> = {
  low: 0.55,
  normal: 1,
  high: 1.5,
};

export const DEFAULT_RACE_SETTINGS: RaceSettings = {
  weather: 'dry',
  timeOfDay: 'day',
  aiCount: 9,
  aiDifficulty: 'pro',
  aiAggression: 'normal',
  aiMistakes: true,
  trackLimits: 'strict',
  flags: true,
  practiceMinutes: 10,
  qualifyingMinutes: 10,
};

const STORAGE_KEY = 'gp2026.race.settings.v1';

export function loadRaceSettings(): RaceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_RACE_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<RaceSettings>;
    return {
      weather: parsed.weather === 'wet' ? 'wet' : 'dry',
      timeOfDay: parsed.timeOfDay === 'night' ? 'night' : 'day',
      aiCount: Number.isFinite(Number(parsed.aiCount))
        ? Math.max(0, Math.min(MAX_AI_OPPONENTS, Math.round(Number(parsed.aiCount))))
        : 9,
      aiDifficulty: (['rookie', 'club', 'pro', 'ace'] as const).includes(parsed.aiDifficulty as never)
        ? (parsed.aiDifficulty as AiDifficulty)
        : 'pro',
      aiAggression: (['low', 'normal', 'high'] as const).includes(parsed.aiAggression as never)
        ? (parsed.aiAggression as AiAggression)
        : 'normal',
      aiMistakes: parsed.aiMistakes !== false,
      trackLimits: (['off', 'lenient', 'strict'] as const).includes(parsed.trackLimits as never)
        ? (parsed.trackLimits as RaceSettings['trackLimits'])
        : 'strict',
      flags: parsed.flags !== false,
      practiceMinutes: Number.isFinite(Number(parsed.practiceMinutes))
        ? Math.max(0, Math.min(30, Math.round(Number(parsed.practiceMinutes))))
        : 10,
      qualifyingMinutes: Number.isFinite(Number(parsed.qualifyingMinutes))
        ? Math.max(3, Math.min(30, Math.round(Number(parsed.qualifyingMinutes))))
        : 10,
    };
  } catch {
    return { ...DEFAULT_RACE_SETTINGS };
  }
}

export function saveRaceSettings(settings: RaceSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage can be unavailable */
  }
}

/** Keep the player's assist settings, but apply the session's AI and limits. */
export function difficultyForRace(settings: RaceSettings): DifficultySettings {
  const difficulty = loadDifficulty();
  difficulty.preset = 'custom';
  difficulty.aiPace = AI_DIFFICULTY_PACE[settings.aiDifficulty];
  difficulty.sim.trackLimits = settings.trackLimits;
  return difficulty;
}

export function idealTrialSettings(): RaceSettings {
  return {
    weather: 'dry',
    timeOfDay: 'day',
    aiCount: 0,
    aiDifficulty: 'pro',
    aiAggression: 'normal',
    aiMistakes: true,
    trackLimits: 'off',
    flags: true,
    practiceMinutes: 0,
    qualifyingMinutes: 10,
  };
}
