import raw from '../data/circuits.json';

export type SeriesId = 'f1' | 'f2' | 'f3' | 'f4' | 'wec' | 'nascar' | 'indycar';

export interface SeriesDef {
  id: SeriesId;
  label: string;
  name: string;
  note: string;
}

export const SERIES: SeriesDef[] = [
  { id: 'f1', label: 'F1', name: 'Formula 1', note: '2026 CALENDAR' },
  { id: 'f2', label: 'F2', name: 'Formula 2', note: 'FEEDER LADDER' },
  { id: 'f3', label: 'F3', name: 'Formula 3', note: 'FEEDER LADDER' },
  { id: 'f4', label: 'F4', name: 'Formula 4', note: 'NATIONAL GRIDS' },
  { id: 'wec', label: 'WEC', name: 'World Endurance', note: 'HYPERCAR' },
  { id: 'nascar', label: 'NASCAR', name: 'NASCAR Cup', note: 'OVALS + ROAD' },
  { id: 'indycar', label: 'INDYCAR', name: 'IndyCar', note: 'OVALS + STREETS' },
];

export type ChampionshipId = SeriesId | 'mixed' | 'feeder' | 'american';

export interface ChampionshipDef {
  id: ChampionshipId;
  label: string;
  note: string;
  title: string;
  /** Series whose calendars feed this championship's pool. */
  series: SeriesId[];
}

/** Single-series titles first, then the championships that draw across them. */
export const CHAMPIONSHIPS: ChampionshipDef[] = [
  ...SERIES.map((series) => ({
    id: series.id,
    label: series.label,
    note: series.note,
    title: series.name,
    series: [series.id],
  })),
  {
    id: 'mixed',
    label: 'MIXED',
    note: 'ALL SEVEN SERIES',
    title: 'Mixed Grid',
    series: SERIES.map((series) => series.id),
  },
  { id: 'feeder', label: 'FEEDER', note: 'F2 · F3 · F4', title: 'Feeder Ladder', series: ['f2', 'f3', 'f4'] },
  {
    id: 'american',
    label: 'AMERICAN',
    note: 'NASCAR · INDYCAR',
    title: 'American Speed',
    series: ['nascar', 'indycar'],
  },
];

export interface Circuit {
  id: string;
  name: string;
  short: string;
  city: string;
  country: string;
  length: number;
  series: SeriesId[];
  aliases: string[];
  source: string;
  points: number[][];
  /** SVG path for the closed centerline. */
  path: string;
}

interface RawCircuit extends Omit<Circuit, 'path'> {}

function toPath(points: number[][]): string {
  let d = '';
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    d += `${i === 0 ? 'M' : 'L'}${x} ${y}`;
  }
  return `${d}Z`;
}

export const CIRCUITS: Circuit[] = (raw as { circuits: RawCircuit[] }).circuits.map((entry) => ({
  ...entry,
  series: entry.series as SeriesId[],
  path: toPath(entry.points),
}));

export const BY_ID = new Map(CIRCUITS.map((circuit) => [circuit.id, circuit]));

/** Circuits that belong to at least one championship — the daily pool. */
export const TAGGED = CIRCUITS.filter((circuit) => circuit.series.length > 0);

/** Every circuit on any of the championship's calendars, one entry each. */
export function circuitsForChampionship(id: ChampionshipId): Circuit[] {
  const championship = CHAMPIONSHIPS.find((entry) => entry.id === id);
  if (!championship) return TAGGED;
  return CIRCUITS.filter((circuit) => circuit.series.some((series) => championship.series.includes(series)));
}

export function championshipName(id: ChampionshipId): string {
  return CHAMPIONSHIPS.find((championship) => championship.id === id)?.title ?? 'Circuit';
}

export function formatLength(meters: number): string {
  return `${meters.toLocaleString('en-US')} m`;
}
