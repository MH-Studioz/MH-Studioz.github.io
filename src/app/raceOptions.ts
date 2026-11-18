import { loadDifficulty, type DifficultySettings } from '../physics/settings';

export type WeatherMode = 'dry' | 'wet';
export type TimeOfDay = 'day' | 'night';
export type AiDifficulty = 'rookie' | 'club' | 'pro' | 'ace';
export type RaceAiCount = 0 | 5 | 9;

export interface RaceSettings {
  weather: WeatherMode;
  timeOfDay: TimeOfDay;
  aiCount: RaceAiCount;
  aiDifficulty: AiDifficulty;
  trackLimits: 'off' | 'lenient' | 'strict';
  flags: boolean;
}

export interface RaceSelection {
  mode: 'quick' | 'timetrial' | 'party';
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

export const DEFAULT_RACE_SETTINGS: RaceSettings = {
  weather: 'dry',
  timeOfDay: 'day',
  aiCount: 9,
  aiDifficulty: 'pro',
  trackLimits: 'strict',
  flags: true,
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
      aiCount: parsed.aiCount === 0 || parsed.aiCount === 5 || parsed.aiCount === 9 ? parsed.aiCount : 9,
      aiDifficulty: (['rookie', 'club', 'pro', 'ace'] as const).includes(parsed.aiDifficulty as never)
        ? (parsed.aiDifficulty as AiDifficulty)
        : 'pro',
      trackLimits: (['off', 'lenient', 'strict'] as const).includes(parsed.trackLimits as never)
        ? (parsed.trackLimits as RaceSettings['trackLimits'])
        : 'strict',
      flags: parsed.flags !== false,
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
    trackLimits: 'off',
    flags: true,
  };
}
