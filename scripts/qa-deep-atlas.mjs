/**
 * Release QA for the DEEP ATLAS data files.
 *
 * Checks structure (names, duplicates, ids, numeric ranges), confirms the
 * hand-curated tourist traps survived the Natural Earth build, and reports how
 * many physical features sit outside Natural Earth's land polygons (a delta or
 * a lakeshore can legitimately fall just offshore; a mountain in the sea is a
 * data bug).
 *
 * Run: node scripts/qa-deep-atlas.mjs
 */
import { readFileSync, existsSync } from 'node:fs';

const DATA = new URL('../games/deep-atlas/data/', import.meta.url);
const NE = new URL('../.tools/ne/ne_10m_admin_0_countries.geojson', import.meta.url);

const read = (name) => JSON.parse(readFileSync(new URL(name, DATA), 'utf8'));
const problems = [];
const warnings = [];

function check(condition, message) {
  if (!condition) problems.push(message);
}

/* ------------------------------------------------------------------ */
/* Structure                                                           */
/* ------------------------------------------------------------------ */

const countryTable = read('cities.json');
const cities = Array.isArray(countryTable)
  ? countryTable
  : countryTable.rows.map((row) => ({
      name: row[0],
      code: row[1],
      country: countryTable.countries[row[2]],
      continent: countryTable.continents[row[3]],
      lat: row[4],
      lng: row[5],
      pop: row[6],
      elev: row[7],
    }));

const countries = read('countries.json');
const rivers = read('rivers.json');
const lakes = read('lakes.json');
const peaks = read('peaks.json');
const islands = read('islands.json');

const counts = {
  countries: countries.length,
  cities: cities.length,
  rivers: rivers.length,
  lakes: lakes.length,
  peaks: peaks.length,
  islands: islands.length,
};
counts.total = Object.values(counts).reduce((sum, value) => sum + value, 0);

for (const [category, rows] of [
  ['country', countries],
  ['river', rivers],
  ['lake', lakes],
  ['peak', peaks],
  ['island', islands],
]) {
  const seen = new Map();
  for (const row of rows) {
    const name = String(row.name ?? '').trim();
    check(name.length > 0, `${category}: empty name`);
    check(name.length < 64, `${category}: name too long — ${name}`);
    if (name.length >= 40) warnings.push(`${category}: long name — ${name}`);
    check(!/^\d+$/.test(name), `${category}: numeric name — ${name}`);
    check(Number.isFinite(row.lat) && Math.abs(row.lat) <= 85, `${category}: bad latitude for ${name}`);
    check(Number.isFinite(row.lng) && Math.abs(row.lng) <= 180, `${category}: bad longitude for ${name}`);
    const key = name.toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [name, count] of seen) {
    if (count > 1) problems.push(`${category}: duplicate name ${name} ×${count}`);
  }
}

// Cities may share a name across countries (Damascus, Tripoli, Victoria). What
// matters is that a guess stays unambiguous inside one country.
const citySeen = new Map();
for (const row of cities) {
  const name = String(row.name ?? '').trim();
  check(name.length > 0, 'city: empty name');
  check(Number.isFinite(row.lat) && Math.abs(row.lat) <= 85, `city: bad latitude for ${name}`);
  check(Number.isFinite(row.lng) && Math.abs(row.lng) <= 180, `city: bad longitude for ${name}`);
  if (name.length >= 40) warnings.push(`city: long name — ${name}`);
  const key = `${name.toLowerCase()}|${String(row.country ?? '').toLowerCase()}`;
  citySeen.set(key, (citySeen.get(key) ?? 0) + 1);
}
for (const [key, count] of citySeen) {
  if (count > 1) problems.push(`city: duplicate ${key.replace('|', ' in ')} ×${count}`);
}

/* Metric sanity */
check(rivers.every((row) => row.length >= 40 && row.length <= 8000), 'river lengths out of range');
check(lakes.every((row) => row.area >= 1 && row.area <= 400_000), 'lake areas out of range');
check(peaks.every((row) => row.elevation >= 300 && row.elevation <= 9000), 'peak elevations out of range');
check(islands.every((row) => row.area >= 1 && row.area <= 3_000_000), 'island areas out of range');

/* Curated traps must survive the merge. */
const trapIn = (rows, name) =>
  rows.some((row) => row.name.toLowerCase() === name.toLowerCase() && row.trap === true);
check(trapIn(rivers, 'Nile'), 'Nile lost its tourist-trap flag');
check(trapIn(rivers, 'Amazon'), 'Amazon lost its tourist-trap flag');
check(trapIn(lakes, 'Caspian Sea'), 'Caspian Sea lost its tourist-trap flag');
check(trapIn(islands, 'Greenland'), 'Greenland lost its tourist-trap flag');

/* ------------------------------------------------------------------ */
/* Land check                                                          */
/* ------------------------------------------------------------------ */

function landTester(features) {
  const polygons = [];
  for (const feature of features) {
    const geometry = feature.geometry;
    const parts = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const part of parts) {
      const ring = part[0];
      if (!ring || ring.length < 4) continue;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      polygons.push({ ring, minX, minY, maxX, maxY });
    }
  }

  function inRing(ring, x, y) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  return (lng, lat) => {
    for (const polygon of polygons) {
      if (lng < polygon.minX || lng > polygon.maxX || lat < polygon.minY || lat > polygon.maxY) continue;
      if (inRing(polygon.ring, lng, lat)) return true;
    }
    return false;
  };
}

if (!existsSync(NE)) {
  warnings.push('No Natural Earth cache at .tools/ne — skipped the land check.');
} else {
  const onLand = landTester(JSON.parse(readFileSync(NE, 'utf8')).features);
  for (const [category, rows] of [
    ['river', rivers],
    ['lake', lakes],
    ['peak', peaks],
  ]) {
    const offshore = rows.filter((row) => !onLand(row.lng, row.lat));
    if (offshore.length) {
      warnings.push(
        `${category}: ${offshore.length}/${rows.length} outside land polygons — ${offshore
          .slice(0, 6)
          .map((row) => row.name)
          .join(', ')}`
      );
    }
  }
}

/* ------------------------------------------------------------------ */

console.log('DEEP ATLAS data QA');
for (const [key, value] of Object.entries(counts)) console.log(`  ${key.padEnd(10)} ${value}`);
console.log(`  ${'total'.padEnd(10)} ${counts.total}`);

if (warnings.length) {
  console.log('\nWarnings');
  for (const warning of warnings) console.log(`  ! ${warning}`);
}

if (problems.length) {
  console.log(`\nFAILED — ${problems.length} problem(s)`);
  for (const problem of problems.slice(0, 30)) console.log(`  ✕ ${problem}`);
  process.exit(1);
}

console.log('\nOK — no structural problems.');
