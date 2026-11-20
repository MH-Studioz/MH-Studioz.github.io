/**
 * Rewrites games/deep-atlas/data/cities.json into the compact columnar table
 * the app loads at runtime: repeated keys, country names and continent names
 * are stored once, so the file is roughly a third of its old size.
 *
 * Accepts either the old array-of-objects file or the compact table, so it is
 * safe to run more than once. Run: node scripts/compact-deep-atlas-cities.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../games/deep-atlas/data/cities.json', import.meta.url);
const raw = JSON.parse(readFileSync(file, 'utf8'));

const list = Array.isArray(raw) ? raw : decode(raw);

function decode(table) {
  const out = [];
  for (const row of table.rows) {
    out.push({
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
    });
  }
  return out;
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

  const encoded = rows.map((city) => [
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
  ]);

  return { v: 2, continents, countries, rows: encoded };
}

const before = readFileSync(file, 'utf8').length;
const table = encode(list);
const text = JSON.stringify(table);
writeFileSync(file, text);

console.log(`cities: ${list.length} rows, ${Math.round(before / 1024)} kB -> ${Math.round(text.length / 1024)} kB`);
console.log(`countries in table: ${table.countries.length}, continents: ${table.continents.length}`);
