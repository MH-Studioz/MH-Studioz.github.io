import {
  ALL_PLACES,
  inRegion,
  normalize,
  type Category,
  type Continent,
  type Place,
  type RegionId,
} from './data';

export type Chip = Category | 'mixed' | 'pinpoint';

export interface Prompt {
  id: string;
  text: string;
  chip: Chip;
  category: Category | 'mixed' | 'pinpoint';
  pool: Place[];
  target?: Place;
}

export type ModeId = 'daily' | 'blitz' | 'hardcore' | 'endless' | 'pinpoint' | 'party';

/* ------------------------------------------------------------------ */
/* Deterministic randomness                                            */
/* ------------------------------------------------------------------ */

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

export function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(rng: () => number, list: T[]): T {
  return list[Math.floor(rng() * list.length) % list.length];
}

function shuffle<T>(rng: () => number, list: T[]): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const CONTINENTS: Continent[] = [
  'Africa',
  'Asia',
  'Europe',
  'North America',
  'South America',
  'Oceania',
];

const REGION_CONTINENT: Partial<Record<RegionId, Continent>> = {
  europe: 'Europe',
  asia: 'Asia',
  africa: 'Africa',
  oceania: 'Oceania',
};

function continentsFor(region: RegionId): Continent[] {
  if (region === 'world') return CONTINENTS;
  if (region === 'americas') return ['North America', 'South America'];
  const only = REGION_CONTINENT[region];
  return only ? [only] : CONTINENTS;
}

function pool(category: Category, region: RegionId): Place[] {
  return ALL_PLACES.filter((p) => p.category === category && inRegion(p, region));
}

function withPool(category: Category, region: RegionId, filter: (p: Place) => boolean, min = 4): Place[] | null {
  const list = pool(category, region).filter(filter);
  return list.length >= min ? list : null;
}

function chipFor(category: Category): Chip {
  return category;
}

function promptFor(
  id: string,
  text: string,
  category: Category | 'mixed',
  list: Place[],
  chip?: Chip
): Prompt {
  return {
    id,
    text,
    chip: chip ?? chipFor(category as Category),
    category,
    pool: list,
  };
}

interface Gen {
  id: string;
  make: (rng: () => number, region: RegionId) => Prompt | null;
}

/* ------------------------------------------------------------------ */
/* Generators                                                          */
/* ------------------------------------------------------------------ */

const GENERATORS: Gen[] = [
  {
    id: 'country-landlocked',
    make: (rng, region) => {
      const options = continentsFor(region).filter(
        (continent) =>
          pool('country', region).filter((p) => p.continent === continent && p.landlocked).length >= 4
      );
      if (!options.length) return null;
      const continent = pick(rng, options);
      const list = pool('country', region).filter((p) => p.continent === continent && p.landlocked);
      return promptFor(`landlocked-${continent}`, `A landlocked country in ${continent}`, 'country', list);
    },
  },
  {
    id: 'country-one-border',
    make: (_rng, region) => {
      const list = withPool('country', region, (p) => p.borders === 1, 3);
      if (!list) return null;
      return promptFor('one-border', 'A country that borders only one other country', 'country', list);
    },
  },
  {
    id: 'country-island',
    make: (_rng, region) => {
      const list = withPool('country', region, (p) => p.island === true, 5);
      if (!list) return null;
      return promptFor('island-nation', 'An island nation', 'country', list);
    },
  },
  {
    id: 'country-south',
    make: (_rng, region) => {
      const list = withPool(
        'country',
        region,
        (p) => p.hemisphere === 'S' || p.hemisphere === 'B',
        8
      );
      if (!list) return null;
      return promptFor('southern-country', 'A country in the Southern Hemisphere', 'country', list);
    },
  },
  {
    id: 'country-capital-letter',
    make: (rng, region) => {
      const groups = new Map<string, Place[]>();
      for (const country of pool('country', region)) {
        const letter = (country.capitalName ?? '').charAt(0).toUpperCase();
        // Some rows carry a dash for "no capital" — never ask about “—”.
        if (!/^[A-Z]$/.test(letter)) continue;
        const list = groups.get(letter) ?? [];
        list.push(country);
        groups.set(letter, list);
      }
      const options = [...groups.entries()].filter(([, list]) => list.length >= 4);
      if (!options.length) return null;
      const [letter, list] = pick(rng, options);
      return promptFor(
        `capital-letter-${letter}`,
        `A country whose capital starts with “${letter}”`,
        'country',
        list
      );
    },
  },
  {
    id: 'country-small-pop',
    make: (_rng, region) => {
      const list = withPool('country', region, (p) => (p.population ?? 0) < 2_000_000, 8);
      if (!list) return null;
      return promptFor('small-pop-country', 'A country with fewer than 2 million people', 'country', list);
    },
  },
  {
    id: 'country-tiny-area',
    make: (_rng, region) => {
      const list = withPool('country', region, (p) => (p.area ?? 0) < 10_000, 5);
      if (!list) return null;
      return promptFor('tiny-country', 'A country smaller than 10,000 km²', 'country', list);
    },
  },
  {
    id: 'country-microstate',
    make: (_rng, region) => {
      const list = withPool('country', region, (p) => (p.area ?? 0) < 1_000, 5);
      if (!list) return null;
      return promptFor('microstate', 'A microstate under 1,000 km²', 'country', list);
    },
  },
  {
    id: 'country-huge-area',
    make: (_rng, region) => {
      const list = withPool('country', region, (p) => (p.area ?? 0) > 1_000_000, 4);
      if (!list) return null;
      return promptFor('huge-country', 'A country larger than 1 million km²', 'country', list);
    },
  },
  {
    id: 'country-continent',
    make: (rng, region) => {
      const options = continentsFor(region).filter(
        (continent) => pool('country', region).filter((p) => p.continent === continent).length >= 10
      );
      if (!options.length) return null;
      const continent = pick(rng, options);
      const list = pool('country', region).filter((p) => p.continent === continent);
      return promptFor(`country-${continent}`, `A country in ${continent}`, 'country', list);
    },
  },
  {
    id: 'country-equator',
    make: (_rng, region) => {
      const list = withPool('country', region, (p) => p.hemisphere === 'B', 4);
      if (!list) return null;
      return promptFor('equator-country', 'A country that crosses the Equator', 'country', list);
    },
  },
  {
    id: 'city-small',
    make: (_rng, region) => {
      const list = withPool('city', region, (p) => (p.population ?? 0) < 150_000, 6);
      if (!list) return null;
      return promptFor('small-city', 'A city with a population under 150,000', 'city', list);
    },
  },
  {
    id: 'city-capital-north',
    make: (_rng, region) => {
      const list = withPool('city', region, (p) => Boolean(p.isCapital) && p.lat > 45, 5);
      if (!list) return null;
      return promptFor(
        'capital-north',
        'A capital city north of 45° latitude',
        'city',
        list
      );
    },
  },
  {
    id: 'city-capital-south',
    make: (_rng, region) => {
      const list = withPool('city', region, (p) => Boolean(p.isCapital) && p.lat < 0, 5);
      if (!list) return null;
      return promptFor('capital-south', 'A capital city in the Southern Hemisphere', 'city', list);
    },
  },
  {
    id: 'city-south',
    make: (_rng, region) => {
      const list = withPool('city', region, (p) => p.lat < 0, 10);
      if (!list) return null;
      return promptFor('southern-city', 'A city in the Southern Hemisphere', 'city', list);
    },
  },
  {
    id: 'city-high',
    make: (_rng, region) => {
      const list = withPool('city', region, (p) => (p.elevation ?? 0) >= 2_000, 5);
      if (!list) return null;
      return promptFor('high-city', 'A city above 2,000 m elevation', 'city', list);
    },
  },
  {
    id: 'city-continent',
    make: (rng, region) => {
      const options = continentsFor(region).filter(
        (continent) => pool('city', region).filter((p) => p.continent === continent).length >= 8
      );
      if (!options.length) return null;
      const continent = pick(rng, options);
      const list = pool('city', region).filter((p) => p.continent === continent);
      return promptFor(`city-${continent}`, `A city in ${continent}`, 'city', list);
    },
  },
  {
    id: 'city-megacity',
    make: (_rng, region) => {
      const list = withPool('city', region, (p) => (p.population ?? 0) >= 10_000_000, 4);
      if (!list) return null;
      return promptFor('megacity', 'A megacity of 10 million people or more', 'city', list);
    },
  },
  {
    id: 'city-small-country',
    make: (_rng, region) => {
      const list = withPool(
        'city',
        region,
        (p) => {
          const country = ALL_PLACES.find((x) => x.category === 'country' && x.name === p.country);
          return Boolean(country && (country.population ?? 0) < 2_000_000);
        },
        5
      );
      if (!list) return null;
      return promptFor(
        'city-small-country',
        'A city in a country with under 2 million people',
        'city',
        list
      );
    },
  },
  {
    id: 'city-island',
    make: (_rng, region) => {
      const list = withPool('city', region, (p) => p.countryIsland === true, 6);
      if (!list) return null;
      return promptFor('island-city', 'A city on an island nation', 'city', list);
    },
  },
  {
    id: 'river-continent',
    make: (rng, region) => {
      const options = continentsFor(region).filter(
        (continent) => pool('river', region).filter((p) => p.continent === continent).length >= 4
      );
      if (!options.length) return null;
      const continent = pick(rng, options);
      const list = pool('river', region).filter((p) => p.continent === continent);
      return promptFor(`river-${continent}`, `A river in ${continent}`, 'river', list);
    },
  },
  {
    id: 'river-long',
    make: (_rng, region) => {
      const list = withPool('river', region, (p) => (p.length ?? 0) >= 3_000, 6);
      if (!list) return null;
      return promptFor('river-long', 'A river longer than 3,000 km', 'river', list);
    },
  },
  {
    id: 'river-short',
    make: (_rng, region) => {
      const list = withPool('river', region, (p) => (p.length ?? 0) < 1_000, 6);
      if (!list) return null;
      return promptFor('river-short', 'A river shorter than 1,000 km', 'river', list);
    },
  },
  {
    id: 'river-outflow',
    make: (rng, region) => {
      const groups = new Map<string, Place[]>();
      for (const river of pool('river', region)) {
        const key = (river.outflow ?? '').trim();
        // An empty outflow would read as “flows into the ”.
        if (!key || key === '—') continue;
        const list = groups.get(key) ?? [];
        list.push(river);
        groups.set(key, list);
      }
      const options = [...groups.entries()].filter(([, list]) => list.length >= 3);
      if (!options.length) return null;
      const [outflow, list] = pick(rng, options);
      return promptFor(
        `river-outflow-${outflow}`,
        `A river that flows into the ${outflow}`,
        'river',
        list
      );
    },
  },
  {
    id: 'peak-high',
    make: (_rng, region) => {
      const list = withPool('peak', region, (p) => (p.elevation ?? 0) >= 5_000, 6);
      if (!list) return null;
      return promptFor('peak-high', 'A mountain peak above 5,000 m', 'peak', list);
    },
  },
  {
    id: 'peak-low',
    make: (_rng, region) => {
      const list = withPool('peak', region, (p) => (p.elevation ?? 0) < 3_000, 5);
      if (!list) return null;
      return promptFor('peak-low', 'A mountain peak below 3,000 m', 'peak', list);
    },
  },
  {
    id: 'peak-range',
    make: (rng, region) => {
      const groups = new Map<string, Place[]>();
      for (const peak of pool('peak', region)) {
        const key = (peak.range ?? '').trim();
        // An empty range would read as “a peak in the ”.
        if (!key || key === '—') continue;
        const list = groups.get(key) ?? [];
        list.push(peak);
        groups.set(key, list);
      }
      const options = [...groups.entries()].filter(([, list]) => list.length >= 4);
      if (!options.length) return null;
      const [range, list] = pick(rng, options);
      return promptFor(`peak-range-${range}`, `A mountain peak in the ${range}`, 'peak', list);
    },
  },
  {
    id: 'peak-continent',
    make: (rng, region) => {
      const options = continentsFor(region).filter(
        (continent) => pool('peak', region).filter((p) => p.continent === continent).length >= 5
      );
      if (!options.length) return null;
      const continent = pick(rng, options);
      const list = pool('peak', region).filter((p) => p.continent === continent);
      return promptFor(`peak-${continent}`, `A mountain peak in ${continent}`, 'peak', list);
    },
  },
  {
    id: 'lake-big',
    make: (_rng, region) => {
      const list = withPool('lake', region, (p) => (p.area ?? 0) >= 10_000, 5);
      if (!list) return null;
      return promptFor('lake-big', 'A lake larger than 10,000 km²', 'lake', list);
    },
  },
  {
    id: 'lake-small',
    make: (_rng, region) => {
      const list = withPool('lake', region, (p) => (p.area ?? 0) < 1_500, 6);
      if (!list) return null;
      return promptFor('lake-small', 'A lake smaller than 1,500 km²', 'lake', list);
    },
  },
  {
    id: 'island-big',
    make: (_rng, region) => {
      const list = withPool('island', region, (p) => (p.area ?? 0) >= 100_000, 5);
      if (!list) return null;
      return promptFor('island-big', 'An island larger than 100,000 km²', 'island', list);
    },
  },
  {
    id: 'island-small',
    make: (_rng, region) => {
      const list = withPool('island', region, (p) => (p.area ?? 0) < 5_000, 6);
      if (!list) return null;
      return promptFor('island-small', 'An island smaller than 5,000 km²', 'island', list);
    },
  },
  {
    id: 'island-continent',
    make: (rng, region) => {
      const options = continentsFor(region).filter(
        (continent) => pool('island', region).filter((p) => p.continent === continent).length >= 4
      );
      if (!options.length) return null;
      const continent = pick(rng, options);
      const list = pool('island', region).filter((p) => p.continent === continent);
      return promptFor(`island-${continent}`, `An island in ${continent}`, 'island', list);
    },
  },
  {
    id: 'lake-continent',
    make: (rng, region) => {
      const options = continentsFor(region).filter(
        (continent) => pool('lake', region).filter((p) => p.continent === continent).length >= 4
      );
      if (!options.length) return null;
      const continent = pick(rng, options);
      const list = pool('lake', region).filter((p) => p.continent === continent);
      return promptFor(`lake-${continent}`, `A lake in ${continent}`, 'lake', list);
    },
  },
  {
    id: 'letter',
    make: (rng, region) => {
      const groups = new Map<string, Place[]>();
      for (const place of ALL_PLACES) {
        if (!inRegion(place, region)) continue;
        const letter = normalize(place.name).charAt(0).toUpperCase();
        // Only real initials: no digits or punctuation from odd place names.
        if (!/^[A-Z]$/.test(letter)) continue;
        const list = groups.get(letter) ?? [];
        list.push(place);
        groups.set(letter, list);
      }
      const options = [...groups.entries()].filter(([, list]) => list.length >= 10);
      if (!options.length) return null;
      const [letter, list] = pick(rng, options);
      return promptFor(
        `letter-${letter}`,
        `Any place starting with the letter “${letter}”`,
        'mixed',
        list,
        'mixed'
      );
    },
  },
];

/* ------------------------------------------------------------------ */
/* Round construction                                                  */
/* ------------------------------------------------------------------ */

export function createPromptFactory(seed: number, region: RegionId) {
  const rng = mulberry32(seed);
  const recent: string[] = [];
  const categories: string[] = [];

  return function nextPrompt(usedIds: Set<string> = new Set()): Prompt {
    for (let attempt = 0; attempt < 300; attempt++) {
      const gen = GENERATORS[Math.floor(rng() * GENERATORS.length)];
      if (recent.includes(gen.id)) continue;
      const made = gen.make(rng, region);
      if (!made) continue;
      if (made.pool.length < 4) continue;
      if (made.pool.every((p) => usedIds.has(p.id))) continue;
      if (categories.filter((c) => c === made.category).length >= 3 && categories.length >= 4) continue;

      recent.push(gen.id);
      if (recent.length > 8) recent.shift();
      categories.push(made.category);
      if (categories.length > 7) categories.shift();
      return made;
    }

    const fallback = pool('country', region);
    return promptFor('fallback-country', 'A country in the world', 'country', fallback);
  };
}

export function buildPrompts(count: number, seed: number, region: RegionId): Prompt[] {
  const factory = createPromptFactory(seed, region);
  const prompts: Prompt[] = [];
  const usedPrompts = new Set<string>();
  let guard = 0;
  while (prompts.length < count && guard < 200) {
    guard++;
    const next = factory();
    const signature = `${next.id}-${next.pool.length}`;
    if (usedPrompts.has(signature)) continue;
    usedPrompts.add(signature);
    prompts.push(next);
  }
  return prompts;
}

/* ------------------------------------------------------------------ */
/* Pinpoint                                                            */
/* ------------------------------------------------------------------ */

const PINPOINT_CATEGORIES: Category[] = ['city', 'peak', 'island', 'lake', 'river'];

export function buildPinpointPrompts(count: number, seed: number, region: RegionId): Prompt[] {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const prompts: Prompt[] = [];
  const used = new Set<string>();

  for (let guard = 0; prompts.length < count && guard < 400; guard++) {
    const category = pick(rng, PINPOINT_CATEGORIES);
    const candidates = ALL_PLACES.filter((p) => {
      if (p.category !== category || !inRegion(p, region)) return false;
      if (used.has(p.id)) return false;
      if (category === 'city') return (p.population ?? 0) >= 2_000 && (p.population ?? 0) <= 6_000_000;
      return true;
    });
    if (!candidates.length) continue;
    const target = pick(rng, candidates);
    used.add(target.id);

    const noun =
      target.category === 'city'
        ? 'city'
        : target.category === 'peak'
          ? 'summit'
          : target.category === 'river'
            ? 'river'
            : target.category === 'lake'
              ? 'lake'
              : 'island';

    prompts.push({
      id: `pinpoint-${target.id}`,
      text: `Name the ${noun} under the crosshair — or any place within 300 km`,
      chip: 'pinpoint',
      category: 'pinpoint',
      pool: [target],
      target,
    });
  }

  return prompts;
}

/** Monday 23 November 2026 is Day #1. */
export const DAILY_LAUNCH = { year: 2026, month: 10, day: 23 } as const;

export function dailyNumber(date: Date): number {
  const start = Date.UTC(DAILY_LAUNCH.year, DAILY_LAUNCH.month, DAILY_LAUNCH.day);
  const today = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  // Not clamped: before launch this is 0 or negative, which the UI shows as a countdown.
  return Math.floor((today - start) / 86_400_000) + 1;
}

export function dateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
