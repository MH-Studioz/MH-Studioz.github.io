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
const curated = JSON.parse(readFileSync(new URL('cities.json', DATA), 'utf8'));

const PER_COUNTRY = 14;
const MIN_POP = 2_000;
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

writeFileSync(new URL('cities.json', DATA), JSON.stringify(rows, null, 0) + '\n');

const small = rows.filter((c) => c.pop < 150_000).length;
const tiny = rows.filter((c) => c.pop < 25_000).length;
console.log(`cities: ${rows.length} (curated ${curated.length} + ${generated.length} generated)`);
console.log(`under 150k: ${small}, under 25k: ${tiny}, countries: ${new Set(rows.map((c) => c.country)).size}`);
