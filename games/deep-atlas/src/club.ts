/* ------------------------------------------------------------------ */
/* Club store — local, peer-synced, no accounts                        */
/* ------------------------------------------------------------------ */

export interface ClubEntry {
  id: string;
  name: string;
  depth: number;
  hits: number;
  mode: string;
  date: string;
}

export interface Club {
  code: string;
  name: string;
  entries: ClubEntry[];
}

export interface ClubRow {
  id: string;
  name: string;
  best: number;
  runs: number;
  last: string;
}

const KEY_CLUB = 'deepatlas.club.v1';
const MAX_ENTRIES = 300;

function cleanCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function readClub(): Club | null {
  try {
    const raw = localStorage.getItem(KEY_CLUB);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Club>;
    const code = cleanCode(String(parsed.code ?? ''));
    if (!code) return null;
    return {
      code,
      name: String(parsed.name || 'CLUB').slice(0, 18),
      entries: Array.isArray(parsed.entries) ? parsed.entries.slice(0, MAX_ENTRIES) : [],
    };
  } catch {
    return null;
  }
}

export function writeClub(club: Club): void {
  try {
    localStorage.setItem(KEY_CLUB, JSON.stringify({ ...club, entries: club.entries.slice(0, MAX_ENTRIES) }));
  } catch {
    /* storage may be blocked — the session still works */
  }
}

export function clearClub(): void {
  try {
    localStorage.removeItem(KEY_CLUB);
  } catch {
    /* ignore */
  }
}

function makeClubCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const values = new Uint32Array(4);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join('');
}

export function createClub(name: string): Club {
  return { code: makeClubCode(), name: name.trim().slice(0, 18) || 'THE CREW', entries: [] };
}

export function joinClub(code: string, name?: string): Club | null {
  const cleaned = cleanCode(code);
  if (cleaned.length < 4) return null;
  return { code: cleaned, name: (name ?? 'THE CREW').slice(0, 18), entries: [] };
}

/** Merge entries into a club, newest first, capped. */
export function addEntries(club: Club, incoming: ClubEntry[]): Club {
  const seen = new Set(club.entries.map((entry) => `${entry.id}|${entry.date}|${entry.depth}|${entry.mode}`));
  const entries = [...club.entries];
  for (const entry of incoming) {
    const key = `${entry.id}|${entry.date}|${entry.depth}|${entry.mode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  entries.sort((a, b) => (a.date < b.date ? 1 : -1));
  return { ...club, entries: entries.slice(0, MAX_ENTRIES) };
}

export function recordClubRun(club: Club, entry: Omit<ClubEntry, 'date'>): Club {
  return addEntries(club, [{ ...entry, date: new Date().toISOString() }]);
}

/** One row per diver: their deepest single run, plus how many runs they logged. */
export function clubBoard(entries: ClubEntry[]): ClubRow[] {
  const rows = new Map<string, ClubRow>();
  for (const entry of entries) {
    const row = rows.get(entry.id) ?? { id: entry.id, name: entry.name, best: 0, runs: 0, last: entry.date };
    row.runs += 1;
    if (entry.depth > row.best) row.best = entry.depth;
    if (entry.date > row.last) row.last = entry.date;
    row.name = entry.name || row.name;
    rows.set(entry.id, row);
  }
  return [...rows.values()].sort((a, b) => b.best - a.best || b.runs - a.runs);
}
