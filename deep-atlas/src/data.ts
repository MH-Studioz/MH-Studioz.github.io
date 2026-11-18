import countriesJson from '../data/countries.json';
import citiesJson from '../data/cities.json';
import riversJson from '../data/rivers.json';
import peaksJson from '../data/peaks.json';
import islandsJson from '../data/islands.json';

export type Category = 'country' | 'city' | 'river' | 'peak' | 'island' | 'lake';
export type Continent =
  | 'Europe'
  | 'Asia'
  | 'Africa'
  | 'North America'
  | 'South America'
  | 'Oceania'
  | 'Antarctica';

export type RegionId = 'world' | 'europe' | 'asia' | 'americas' | 'africa' | 'oceania';

export const REGIONS: { id: RegionId; label: string }[] = [
  { id: 'world', label: 'World' },
  { id: 'europe', label: 'Europe' },
  { id: 'asia', label: 'Asia' },
  { id: 'americas', label: 'Americas' },
  { id: 'africa', label: 'Africa' },
  { id: 'oceania', label: 'Oceania' },
];

export interface Place {
  id: string;
  name: string;
  aliases: string[];
  category: Category;
  continent: Continent;
  lat: number;
  lng: number;
  /** Population for countries and cities, length for rivers, elevation for peaks, area for islands and lakes. */
  metric: number;
  metricLabel: string;
  trap: boolean;
  /** 0 = the most obscure entry in its category, 1 = the most famous. */
  fame: number;
  country?: string;
  countryIsland?: boolean;
  population?: number;
  elevation?: number;
  area?: number;
  length?: number;
  outflow?: string;
  range?: string;
  landlocked?: boolean;
  island?: boolean;
  borders?: number;
  hemisphere?: 'N' | 'S' | 'B';
  isCapital?: boolean;
  capitalName?: string;
  kind?: 'island' | 'lake';
}

interface RawCountry {
  id: string;
  name: string;
  aliases: string[];
  continent: Continent;
  population: number;
  area: number;
  capital: string;
  lat: number;
  lng: number;
  landlocked: boolean;
  island: boolean;
  borders: number;
  hemisphere: 'N' | 'S' | 'B';
  isTouristTrap: boolean;
}

interface RawCity {
  name: string;
  country: string;
  continent: Continent;
  lat: number;
  lng: number;
  pop: number;
  elev: number;
  capital?: boolean;
  trap?: boolean;
  aliases?: string[];
}

interface RawRiver {
  name: string;
  aliases?: string[];
  continent: Continent;
  lat: number;
  lng: number;
  length: number;
  outflow: string;
  trap?: boolean;
}

interface RawPeak {
  name: string;
  aliases?: string[];
  continent: Continent;
  lat: number;
  lng: number;
  elevation: number;
  range: string;
  trap?: boolean;
}

interface RawIsland {
  name: string;
  kind: 'island' | 'lake';
  aliases?: string[];
  continent: Continent;
  lat: number;
  lng: number;
  area: number;
  trap?: boolean;
}

const countries = countriesJson as unknown as RawCountry[];
const cities = citiesJson as unknown as RawCity[];
const rivers = riversJson as unknown as RawRiver[];
const peaks = peaksJson as unknown as RawPeak[];
const islands = islandsJson as unknown as RawIsland[];

export function normalize(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['\u2019`]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slug(input: string): string {
  return normalize(input).replace(/\s+/g, '-');
}

const countryByName = new Map<string, RawCountry>();
for (const c of countries) countryByName.set(normalize(c.name), c);

const places: Place[] = [];

for (const c of countries) {
  places.push({
    id: `country-${c.id.toLowerCase()}`,
    name: c.name,
    aliases: c.aliases ?? [],
    category: 'country',
    continent: c.continent,
    lat: c.lat,
    lng: c.lng,
    metric: c.population,
    metricLabel: 'POP',
    trap: c.isTouristTrap,
    fame: 0,
    country: c.name,
    population: c.population,
    area: c.area,
    landlocked: c.landlocked,
    island: c.island,
    borders: c.borders,
    hemisphere: c.hemisphere,
    capitalName: c.capital,
  });
}

for (const c of cities) {
  const parent = countryByName.get(normalize(c.country));
  places.push({
    id: `city-${slug(c.name)}`,
    name: c.name,
    aliases: c.aliases ?? [],
    category: 'city',
    continent: c.continent,
    lat: c.lat,
    lng: c.lng,
    metric: c.pop,
    metricLabel: 'POP',
    trap: Boolean(c.trap),
    fame: 0,
    country: c.country,
    countryIsland: parent?.island ?? false,
    population: c.pop,
    elevation: c.elev,
    isCapital: Boolean(c.capital),
  });
}

for (const r of rivers) {
  places.push({
    id: `river-${slug(r.name)}`,
    name: r.name,
    aliases: r.aliases ?? [],
    category: 'river',
    continent: r.continent,
    lat: r.lat,
    lng: r.lng,
    metric: r.length,
    metricLabel: 'LENGTH',
    trap: Boolean(r.trap),
    fame: 0,
    length: r.length,
    outflow: r.outflow,
  });
}

for (const p of peaks) {
  places.push({
    id: `peak-${slug(p.name)}`,
    name: p.name,
    aliases: p.aliases ?? [],
    category: 'peak',
    continent: p.continent,
    lat: p.lat,
    lng: p.lng,
    metric: p.elevation,
    metricLabel: 'ELEV',
    trap: Boolean(p.trap),
    fame: 0,
    elevation: p.elevation,
    range: p.range,
  });
}

for (const i of islands) {
  places.push({
    id: `${i.kind}-${slug(i.name)}`,
    name: i.name,
    aliases: i.aliases ?? [],
    category: i.kind,
    continent: i.continent,
    lat: i.lat,
    lng: i.lng,
    metric: i.area,
    metricLabel: 'AREA',
    trap: Boolean(i.trap),
    fame: 0,
    area: i.area,
    kind: i.kind,
  });
}

// Fame = percentile of the entry's metric inside its own category (1 = most famous).
for (const category of ['country', 'city', 'river', 'peak', 'island', 'lake'] as Category[]) {
  const group = places.filter((p) => p.category === category).sort((a, b) => a.metric - b.metric);
  const last = Math.max(1, group.length - 1);
  group.forEach((p, i) => {
    p.fame = i / last;
  });
}

export const ALL_PLACES: readonly Place[] = places;

export const DATASET_COUNTS = {
  countries: countries.length,
  cities: cities.length,
  rivers: rivers.length,
  peaks: peaks.length,
  islands: islands.filter((i) => i.kind === 'island').length,
  lakes: islands.filter((i) => i.kind === 'lake').length,
  total: places.length,
};

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

const index = new Map<string, Place[]>();

function addKey(key: string, place: Place): void {
  if (!key) return;
  const bucket = index.get(key);
  if (bucket) {
    if (!bucket.includes(place)) bucket.push(place);
  } else {
    index.set(key, [place]);
  }
}

for (const place of places) {
  addKey(normalize(place.name), place);
  for (const alias of place.aliases) addKey(normalize(alias), place);
}

function levenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Uint8Array(b.length + 1);
  const curr = new Uint8Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    prev.set(curr);
  }
  return prev[b.length];
}

export interface Resolution {
  place: Place;
  distance: number;
  exact: boolean;
}

function preferPool(list: Place[], pool?: Place[]): Place {
  if (pool && pool.length) {
    const hit = list.find((p) => pool.includes(p));
    if (hit) return hit;
  }
  return list[0];
}

/**
 * Resolves a typed guess against names, aliases, prefix forms and a bounded
 * Levenshtein search. `pool` is used to disambiguate when the same name exists
 * in more than one category.
 */
export function resolveGuess(input: string, pool?: Place[]): Resolution | null {
  const query = normalize(input);
  if (query.length < 2) return null;

  const direct = index.get(query);
  if (direct) {
    const place = preferPool(direct, pool);
    return { place, distance: 0, exact: true };
  }

  // "new york" -> "new york city", "mount everest" -> "everest" style prefix hits.
  if (query.length >= 5) {
    const prefixed: Place[] = [];
    for (const [key, list] of index) {
      if (key.startsWith(query) || (query.startsWith(key) && key.length >= 5)) {
        prefixed.push(...list);
      }
    }
    if (prefixed.length) {
      const place = preferPool(prefixed, pool);
      return { place, distance: 0, exact: false };
    }
  }

  const maxDistance = query.length <= 4 ? 1 : 2;
  let best: Place | null = null;
  let bestDistance = maxDistance + 1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const [key, list] of index) {
    if (Math.abs(key.length - query.length) > maxDistance) continue;
    const distance = levenshtein(query, key, maxDistance);
    if (distance > maxDistance) continue;
    for (const place of list) {
      const inPool = pool?.includes(place) ? 0 : 1;
      const score = distance * 10 + inPool * 3 + Math.abs(key.length - query.length) * 0.1;
      if (score < bestScore) {
        bestScore = score;
        bestDistance = distance;
        best = place;
      }
    }
  }

  if (!best) return null;
  return { place: best, distance: bestDistance, exact: false };
}

/** Any place within a radius, used by Pinpoint mode feedback. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ------------------------------------------------------------------ */
/* Rarity                                                              */
/* ------------------------------------------------------------------ */

export function inRegion(place: Place, region: RegionId): boolean {
  if (region === 'world') return true;
  if (region === 'americas') {
    return place.continent === 'North America' || place.continent === 'South America';
  }
  const map: Record<Exclude<RegionId, 'world' | 'americas'>, Continent> = {
    europe: 'Europe',
    asia: 'Asia',
    africa: 'Africa',
    oceania: 'Oceania',
  };
  return place.continent === map[region];
}

export interface DepthResult {
  depth: number;
  percentile: number;
  trap: boolean;
  gem: boolean;
}

/** Minimal shape the map needs from a round entry. */
export interface EntryLike {
  answer: Place | null;
  depth: number;
  trap: boolean;
  best: Place | null;
  bestDepth: number;
}

function commonness(place: Place, pool: Place[]): number {
  if (!pool.length) return place.fame;
  const uniform = pool.every((p) => p.category === pool[0].category);
  if (!uniform) return place.fame;
  if (pool.length === 1) return place.fame;
  let below = 0;
  for (const p of pool) if (p.metric < place.metric) below++;
  const ratio = below / (pool.length - 1);
  return Math.max(0, Math.min(1, ratio));
}

/** Depth at full time, before the remaining-seconds multiplier. */
export function rawDepth(place: Place, pool: Place[]): DepthResult {
  const common = commonness(place, pool);
  const obscurity = Math.max(0, Math.min(1, 1 - common));
  let depth = 50 + 950 * Math.pow(obscurity, 1.35);
  if (place.trap) depth = Math.min(depth, 150);
  depth = Math.round(depth);
  return {
    depth,
    percentile: Math.round(obscurity * 100),
    trap: place.trap,
    gem: depth >= 700 && !place.trap,
  };
}

export function timedDepth(base: number, secondsLeft: number, secondsTotal: number): number {
  const ratio = Math.max(0, Math.min(1, secondsLeft / Math.max(1, secondsTotal)));
  return Math.round(base * (1 + 0.25 * ratio));
}

export function rarestIn(pool: Place[]): { place: Place; result: DepthResult } | null {
  if (!pool.length) return null;
  let best = pool[0];
  let bestResult = rawDepth(pool[0], pool);
  for (const place of pool.slice(1)) {
    const result = rawDepth(place, pool);
    if (result.depth > bestResult.depth) {
      best = place;
      bestResult = result;
    }
  }
  return { place: best, result: bestResult };
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

export function compact(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return formatNumber(value);
}

export function formatDepth(meters: number): string {
  return `${formatNumber(meters)} m`;
}

export function statLine(place: Place): string {
  switch (place.category) {
    case 'country':
      return `${compact(place.population ?? 0)} people · ${formatNumber(place.area ?? 0)} km² · ${place.capitalName ?? '—'}`;
    case 'city':
      return `${compact(place.population ?? 0)} people · ${place.country ?? '—'} · ${formatNumber(place.elevation ?? 0)} m elevation`;
    case 'river':
      return `${formatNumber(place.length ?? 0)} km · flows into ${place.outflow ?? '—'}`;
    case 'peak':
      return `${formatNumber(place.elevation ?? 0)} m · ${place.range ?? '—'}`;
    case 'island':
    case 'lake':
      return `${formatNumber(place.area ?? 0, 2)} km² · ${place.continent}`;
    default:
      return place.continent;
  }
}

export function categoryLabel(place: Place): string {
  if (place.category === 'island') return 'ISLAND';
  if (place.category === 'lake') return 'LAKE';
  return place.category.toUpperCase();
}
