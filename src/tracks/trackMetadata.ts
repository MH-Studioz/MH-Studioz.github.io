import type { TrackMeta } from './types';

/**
 * Real-world overlays that the raw GPS trace cannot carry: elevation, banking,
 * night lighting, pit lane placement and official DRS zones.
 * Keys are circuit IDs from circuits.geojson.
 */
export const TRACK_METADATA: Record<string, TrackMeta> = {
  // ---- Signature elevation / banking circuits -------------------------
  'nl-1948': {
    width: 11.8,
    // Zandvoort: 18 degrees at Turn 3 (Hugenholtzbocht) and 18 degrees at
    // Turn 14 (Arie Luyendykbocht), snapped onto the real corner geometry.
    banking: [
      { at: 0.13, deg: 18, spread: 0.032, snapWindow: 0.06 },
      { at: 0.94, deg: 18, spread: 0.03, snapWindow: 0.07 },
    ],
    elevation: [
      { at: 0.0, height: 6 },
      { at: 0.16, height: 13 },
      { at: 0.34, height: 19 },
      { at: 0.52, height: 12 },
      { at: 0.7, height: 21 },
      { at: 0.86, height: 11 },
      { at: 1.0, height: 6 },
    ],
    drs: [
      [0.02, 0.1],
      [0.52, 0.6],
    ],
  },
  'be-1925': {
    width: 14,
    // Spa: the Eau Rouge / Raidillon climb, 30 m of vertical gain in ~600 m,
    // then the long descent to Les Combes and the Ardennes roll.
    elevation: [
      { at: 0.0, height: 28 },
      { at: 0.08, height: 28 },
      { at: 0.14, height: 39 },
      { at: 0.21, height: 79 },
      { at: 0.3, height: 92 },
      { at: 0.42, height: 87 },
      { at: 0.55, height: 68 },
      { at: 0.68, height: 61 },
      { at: 0.8, height: 47 },
      { at: 0.9, height: 33 },
      { at: 1.0, height: 28 },
    ],
    drs: [
      [0.12, 0.21],
      [0.61, 0.69],
    ],
  },
  'us-2012': {
    width: 13.5,
    // COTA: 41 m climb from the start/finish into the Turn 1 hairpin.
    elevation: [
      { at: 0.0, height: 0 },
      { at: 0.035, height: 5 },
      { at: 0.075, height: 40 },
      { at: 0.12, height: 39 },
      { at: 0.2, height: 28 },
      { at: 0.34, height: 19 },
      { at: 0.5, height: 12 },
      { at: 0.66, height: 17 },
      { at: 0.8, height: 9 },
      { at: 0.92, height: 4 },
      { at: 1.0, height: 0 },
    ],
    banking: [{ at: 0.62, deg: 6, spread: 0.02 }],
    drs: [
      [0.02, 0.07],
      [0.51, 0.59],
    ],
  },
  'jp-1962': {
    width: 12.6,
    overpass: true,
    // Suzuka's true figure-of-eight: the back straight passes over the
    // start/finish straight at 7.5 m before diving into 130R.
    elevation: [
      { at: 0.0, height: 5 },
      { at: 0.1, height: 12 },
      { at: 0.22, height: 7 },
      { at: 0.36, height: 18 },
      { at: 0.5, height: 13 },
      { at: 0.62, height: 22 },
      { at: 0.78, height: 11 },
      { at: 0.9, height: 16 },
      { at: 1.0, height: 5 },
    ],
    drs: [
      [0.45, 0.53],
      [0.05, 0.11],
    ],
  },
  'mc-1929': {
    width: 10.4,
    elevation: [
      { at: 0.0, height: 18 },
      { at: 0.12, height: 28 },
      { at: 0.26, height: 49 },
      { at: 0.36, height: 31 },
      { at: 0.52, height: 44 },
      { at: 0.64, height: 21 },
      { at: 0.78, height: 37 },
      { at: 0.9, height: 24 },
      { at: 1.0, height: 18 },
    ],
    drs: [[0.88, 0.957]],
  },
  'it-1922': {
    width: 13,
    banking: [{ at: 0.9, deg: 7, spread: 0.025, snapWindow: 0.05 }],
    elevation: [
      { at: 0.0, height: 10 },
      { at: 0.25, height: 8 },
      { at: 0.55, height: 12 },
      { at: 0.78, height: 9 },
      { at: 1.0, height: 10 },
    ],
    drs: [
      [0.55, 0.62],
      [0.88, 0.94],
    ],
  },
  'az-2016': {
    width: 12,
    elevation: [
      { at: 0.0, height: -2 },
      { at: 0.12, height: 2 },
      { at: 0.32, height: 8 },
      { at: 0.5, height: 1 },
      { at: 0.68, height: 19 },
      { at: 0.8, height: 6 },
      { at: 1.0, height: -2 },
    ],
    drs: [[0.85, 0.94]],
  },
  'at-1969': {
    width: 12.5,
    elevation: [
      { at: 0.0, height: 19 },
      { at: 0.18, height: 34 },
      { at: 0.4, height: 17 },
      { at: 0.62, height: 36 },
      { at: 0.82, height: 24 },
      { at: 1.0, height: 19 },
    ],
  },
  'br-1940': {
    width: 12.5,
    elevation: [
      { at: 0.0, height: 10 },
      { at: 0.14, height: 28 },
      { at: 0.3, height: 17 },
      { at: 0.46, height: 8 },
      { at: 0.62, height: 20 },
      { at: 0.78, height: 11 },
      { at: 1.0, height: 10 },
    ],
    drs: [
      [0.06, 0.12],
      [0.7, 0.76],
    ],
  },
  'it-1953': {
    width: 12.5,
    elevation: [
      { at: 0.0, height: 9 },
      { at: 0.2, height: 23 },
      { at: 0.45, height: 16 },
      { at: 0.62, height: 31 },
      { at: 0.8, height: 19 },
      { at: 1.0, height: 9 },
    ],
    drs: [
      [0.05, 0.11],
      [0.42, 0.49],
    ],
  },
  'mx-1962': {
    width: 13,
    elevation: [
      { at: 0.0, height: 12 },
      { at: 0.2, height: 6 },
      { at: 0.5, height: 10 },
      { at: 0.8, height: 4 },
      { at: 1.0, height: 12 },
    ],
  },
  'gb-1948': {
    width: 14,
    elevation: [
      { at: 0.0, height: 12 },
      { at: 0.16, height: 20 },
      { at: 0.38, height: 13 },
      { at: 0.58, height: 22 },
      { at: 0.8, height: 15 },
      { at: 1.0, height: 12 },
    ],
    drs: [
      [0.06, 0.13],
      [0.48, 0.55],
    ],
  },
  'sg-2008': {
    width: 11,
    night: true,
    elevation: [{ at: 0, height: 3 }, { at: 0.5, height: 5 }, { at: 1, height: 3 }],
  },
  'bh-2002': {
    width: 13,
    night: true,
    elevation: [
      { at: 0, height: 5 },
      { at: 0.25, height: 7 },
      { at: 0.5, height: 4 },
      { at: 1, height: 5 },
    ],
  },
  'ae-2009': { width: 12.5, night: true },
  'sa-2021': {
    width: 12.2,
    night: true,
    elevation: [
      { at: 0.0, height: 2 },
      { at: 0.22, height: 9 },
      { at: 0.4, height: 5 },
      { at: 0.62, height: 12 },
      { at: 0.8, height: 6 },
      { at: 1.0, height: 2 },
    ],
    drs: [
      [0.2, 0.29],
      [0.58, 0.65],
    ],
  },
  'qa-2004': { width: 12, night: true },
  'us-2023': {
    width: 12.5,
    night: true,
    elevation: [{ at: 0, height: 2 }, { at: 0.5, height: 3 }, { at: 1, height: 2 }],
    drs: [[0.36, 0.44]],
  },
  'fr-1969': { width: 13.5 },
  'ru-2014': { width: 13 },
  'tr-2005': { width: 12.5 },
  'my-1999': { width: 13 },
  'es-1991': { width: 12.8 },
  'de-1927': { width: 13 },
  'de-1932': { width: 12.5 },
  'pt-2008': { width: 12.5 },
  'it-1914': { width: 13 },
  'es-2026': { width: 12.5 },
};

/** Metadata lookup that tolerates name matching for supplemental circuits. */
export function getTrackMeta(id: string, name: string): TrackMeta {
  if (TRACK_METADATA[id]) return TRACK_METADATA[id];
  const lower = name.toLowerCase();
  if (lower.includes('buddh')) {
    return {
      width: 12.5,
      elevation: [
        { at: 0, height: 8 },
        { at: 0.22, height: 16 },
        { at: 0.45, height: 9 },
        { at: 0.7, height: 14 },
        { at: 1, height: 8 },
      ],
      drs: [[0.94, 0.99]],
    };
  }
  if (lower.includes('madrid')) return { width: 12.5 };
  return {};
}
