import type { Circuit } from './data';

/* ------------------------------------------------------------------ */
/* Difficulty                                                          */
/* ------------------------------------------------------------------ */

export type DifficultyId = 'rookie' | 'pro' | 'legend';

export interface DifficultyDef {
  id: DifficultyId;
  label: string;
  tagline: string;
  /** Guesses allowed per circuit. */
  guesses: number;
  /** Seconds before the round is a miss. */
  limit: number;
  /** Points lost per second. */
  timeRate: number;
  /** Final score multiplier. */
  multiplier: number;
  /** Reveal the country after this many wrong guesses; 99 = never. */
  countryAfter: number;
  /** Rotate and flip the centerline. */
  concealed: boolean;
}

export const DIFFICULTIES: DifficultyDef[] = [
  {
    id: 'rookie',
    label: 'ROOKIE',
    tagline: 'Five guesses, a longer clock, the country after one miss.',
    guesses: 5,
    limit: 75,
    timeRate: 4,
    multiplier: 0.85,
    countryAfter: 1,
    concealed: false,
  },
  {
    id: 'pro',
    label: 'PRO',
    tagline: 'Three guesses, a minute on the clock, no quarter given.',
    guesses: 3,
    limit: 60,
    timeRate: 7,
    multiplier: 1.15,
    countryAfter: 2,
    concealed: false,
  },
  {
    id: 'legend',
    label: 'LEGEND',
    tagline: 'One guess. The line is rotated and flipped. Country stays hidden.',
    guesses: 1,
    limit: 45,
    timeRate: 10,
    multiplier: 1.5,
    countryAfter: 99,
    concealed: true,
  },
];

export function difficultyById(id: DifficultyId): DifficultyDef {
  return DIFFICULTIES.find((entry) => entry.id === id) ?? DIFFICULTIES[1];
}

/* ------------------------------------------------------------------ */
/* Seeded randomness                                                   */
/* ------------------------------------------------------------------ */

export function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickRounds(pool: Circuit[], count: number, seed: number): Circuit[] {
  const rng = mulberry32(seed);
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/* ------------------------------------------------------------------ */
/* Answers                                                             */
/* ------------------------------------------------------------------ */

export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function answerTargets(circuit: Circuit): string[] {
  const targets = new Set<string>();
  for (const value of [circuit.name, circuit.short, circuit.city, ...circuit.aliases]) {
    const normalized = normalize(value);
    if (normalized) targets.add(normalized);
  }
  return [...targets];
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) previous[j] = j;
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

/** True when the typed answer names this circuit (aliases and small typos count). */
export function matchesAnswer(circuit: Circuit, guess: string): boolean {
  const value = normalize(guess);
  if (value.length < 3) return false;
  for (const target of answerTargets(circuit)) {
    if (value === target) return true;
    if (value.length >= 5 && target.length >= 5 && (target.includes(value) || value.includes(target))) {
      return true;
    }
    const allowed = target.length <= 7 ? 1 : 2;
    if (Math.abs(value.length - target.length) <= allowed && levenshtein(value, target) <= allowed) {
      return true;
    }
  }
  return false;
}

export interface Suggestion {
  circuit: Circuit;
  label: string;
  meta: string;
}

/** Spelling aid: matches on the short name, official name and city. */
export function findSuggestions(pool: Circuit[], query: string, limit = 6): Suggestion[] {
  const value = normalize(query);
  if (value.length < 2) return [];
  const scored: { circuit: Circuit; label: string; meta: string; rank: number }[] = [];
  for (const circuit of pool) {
    const names = [circuit.short, circuit.name, circuit.city];
    let rank = Infinity;
    for (const name of names) {
      const normalized = normalize(name);
      if (!normalized) continue;
      if (normalized.startsWith(value)) rank = Math.min(rank, 0);
      else if (normalized.split(' ').some((word) => word.startsWith(value))) rank = Math.min(rank, 1);
      else if (normalized.includes(value)) rank = Math.min(rank, 2);
    }
    if (rank === Infinity) continue;
    scored.push({
      circuit,
      label: circuit.short,
      meta: circuit.country.toUpperCase(),
      rank: rank * 100 + circuit.short.length,
    });
  }
  scored.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const entry of scored) {
    if (seen.has(entry.circuit.id)) continue;
    seen.add(entry.circuit.id);
    out.push({ circuit: entry.circuit, label: entry.label, meta: entry.meta });
    if (out.length >= limit) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

export interface RoundResult {
  circuit: Circuit;
  solved: boolean;
  /** One entry per guess: true for the hit. */
  attempts: boolean[];
  seconds: number;
  score: number;
}

export function scoreRound(solved: boolean, wrong: number, seconds: number, difficulty: DifficultyDef): number {
  if (!solved) return 0;
  const base = 1000 - 250 * wrong - Math.round(seconds * difficulty.timeRate);
  return Math.max(120, Math.round(Math.max(120, base) * difficulty.multiplier));
}

export function maxRoundScore(difficulty: DifficultyDef): number {
  return Math.round(1000 * difficulty.multiplier);
}

export interface GradeDef {
  letter: string;
  note: string;
}

export function gradeFor(ratio: number): GradeDef {
  if (ratio >= 0.94) return { letter: 'S', note: 'Every shape read clean. That is a scout’s eye.' };
  if (ratio >= 0.82) return { letter: 'A', note: 'Sharp. A couple of tenths left on the table.' };
  if (ratio >= 0.66) return { letter: 'B', note: 'Solid line reading, with room in the slow corners.' };
  if (ratio >= 0.46) return { letter: 'C', note: 'You know the famous ones. The rest need laps.' };
  if (ratio >= 0.24) return { letter: 'D', note: 'The shapes are there — the names are not yet.' };
  return { letter: 'E', note: 'Everyone starts somewhere. Run it back.' };
}

/* ------------------------------------------------------------------ */
/* Clock + share                                                       */
/* ------------------------------------------------------------------ */

export function formatClock(seconds: number): string {
  const total = Math.max(0, seconds);
  const minutes = Math.floor(total / 60);
  const rest = total - minutes * 60;
  if (minutes > 0) return `${minutes}:${rest.toFixed(0).padStart(2, '0')}`;
  return `${rest.toFixed(1)}s`;
}

export function formatRunTime(seconds: number): string {
  const total = Math.round(Math.max(0, seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

const DAILY_LAUNCH = new Date(2026, 10, 23);

/** Day #1 is Monday 23 November 2026, matching the rest of the shelf. */
export function dailyNumber(now: Date = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const launch = new Date(DAILY_LAUNCH.getFullYear(), DAILY_LAUNCH.getMonth(), DAILY_LAUNCH.getDate());
  return Math.max(1, Math.round((today.getTime() - launch.getTime()) / 86_400_000) + 1);
}

export function dailySeed(day: number): number {
  return hashSeed(`trace-daily-${day}`);
}

export interface ShareInput {
  title: string;
  difficulty: DifficultyDef;
  guesses: number;
  results: RoundResult[];
  total: number;
  elapsed: number;
  maxTotal: number;
}

export function buildShare(input: ShareInput): string {
  const solved = input.results.filter((result) => result.solved).length;
  const lines = input.results.map((result) => {
    const cells: string[] = result.attempts.map((hit) => (hit ? '🟩' : '🟥'));
    while (cells.length < input.guesses) cells.push('⬛');
    return cells.join('');
  });
  const header = `TRACE · ${input.title} · ${input.difficulty.label}`;
  const footer = `${solved}/${input.results.length} · ${input.total.toLocaleString('en-US')} / ${input.maxTotal.toLocaleString('en-US')} pts · ${formatRunTime(input.elapsed)}`;
  return [header, ...lines, footer].join('\n');
}
