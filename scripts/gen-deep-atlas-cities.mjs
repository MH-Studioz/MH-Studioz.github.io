/**
 * Expands games/deep-atlas/data/cities.json with towns and small cities from
 * all-the-cities (GeoNames, CC BY 4.0), keeping the hand-curated entries.
 *
 * For every country it samples across the population range (big regional towns
 * down to villages) so "A city with a population under 150,000" has hundreds of
 * valid, genuinely obscure answers instead of the same handful of capitals.
 *
 * The output is committed; the app performs zero network requests for data.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const allCities = require('all-the-cities');
const wc = require('world-countries');

const DATA = new URL('../games/deep-atlas/data/', import.meta.url);

// The committed file is a compact columnar table (see
// compact-deep-atlas-cities.mjs); decode it so this script can top it up.
function decode(table) {
  return table.rows.map((row) => ({
    name: row[0],
    code: row[1] || undefined,
    country: table.countries[row[2]],
    continent: table.continents[row[3]],
    lat: row[4],
    lng: row[5],
    pop: row[6],
    elev: row[7],
    capital: row[8] === 1,
    trap: row[9] === 1,
    aliases: row[10] ? String(row[10]).split('|') : undefined,
  }));
}

function encode(rows) {
  const continents = [];
  const countries = [];
  const continentIndex = new Map();
  const countryIndex = new Map();
  const pick = (table, index, value) => {
    if (!index.has(value)) {
      index.set(value, table.length);
      table.push(value);
    }
    return index.get(value);
  };
  return {
    v: 2,
    continents,
    countries,
    rows: rows.map((city) => [
      city.name,
      city.code ?? '',
      pick(countries, countryIndex, city.country),
      pick(continents, continentIndex, city.continent),
      Math.round(Number(city.lat) * 1000) / 1000,
      Math.round(Number(city.lng) * 1000) / 1000,
      city.pop,
      city.elev,
      city.capital ? 1 : 0,
      city.trap ? 1 : 0,
      city.aliases?.length ? city.aliases.join('|') : '',
    ]),
  };
}

const stored = JSON.parse(readFileSync(new URL('cities.json', DATA), 'utf8'));
const existing = Array.isArray(stored) ? stored : decode(stored);
// Generated rows carry a country code; only the hand-written rows are the base,
// so re-running this script never stacks duplicates on top of itself.
const curated = existing.filter((c) => !c.code);

const PER_COUNTRY = 32;
const MIN_POP = 1_000;
const MAX_POP = 400_000;

const norm = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const continentFor = (c) => {
  if (c.region === 'Americas') {
    return c.subregion === 'South America' ? 'South America' : 'North America';
  }
  return { Europe: 'Europe', Asia: 'Asia', Africa: 'Africa', Oceania: 'Oceania' }[c.region] ?? 'Europe';
};

// Only countries the game already ships (UN members + Palestine).
const gameCountries = new Set(curated.map((c) => norm(c.country)));

const byCode2 = new Map();
for (const c of wc) {
  if (!gameCountries.has(norm(c.name.common))) continue;
  byCode2.set(c.cca2, { name: c.name.common, continent: continentFor(c) });
}

const seen = new Set(curated.map((c) => `${norm(c.name)}|${norm(c.country)}`));
const generated = [];

for (const [code, country] of byCode2) {
  const pool = allCities
    .filter(
      (city) =>
        city.country === code &&
        city.population >= MIN_POP &&
        city.population <= MAX_POP &&
        norm(city.name).length >= 3 &&
        !/[0-9]/.test(city.name)
    )
    .sort((a, b) => b.population - a.population);

  if (!pool.length) continue;

  const wanted = Math.min(PER_COUNTRY, pool.length);
  const picks = [];
  const taken = new Set();
  for (let i = 0; i < wanted; i++) {
    const index = wanted === 1 ? 0 : Math.round((i * (pool.length - 1)) / (wanted - 1));
    picks.push(pool[index]);
  }

  for (const city of picks) {
    const key = `${norm(city.name)}|${norm(country.name)}`;
    if (seen.has(key) || taken.has(key)) continue;
    taken.add(key);
    seen.add(key);
    generated.push({
      name: city.name,
      country: country.name,
      code,
      continent: country.continent,
      lat: Number(city.loc.coordinates[1].toFixed(4)),
      lng: Number(city.loc.coordinates[0].toFixed(4)),
      pop: city.population,
      elev: 0,
      capital: false,
      trap: false,
    });
  }
}

generated.sort((a, b) => a.country.localeCompare(b.country) || b.pop - a.pop);
const rows = [...curated, ...generated];

writeFileSync(new URL('cities.json', DATA), JSON.stringify(encode(rows)));

const small = rows.filter((c) => c.pop < 150_000).length;
const tiny = rows.filter((c) => c.pop < 25_000).length;
console.log(`cities: ${rows.length} (curated ${curated.length} + ${generated.length} generated)`);
console.log(`under 150k: ${small}, under 25k: ${tiny}, countries: ${new Set(rows.map((c) => c.country)).size}`);
