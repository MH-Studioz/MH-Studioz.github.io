/**
 * Builds deep-atlas/data/countries.json from two bundled, free static datasets:
 *  - world-countries (mledoze/countries, ODbL) for names, area, borders, coordinates, aliases
 *  - country-json (worldometer-derived) for population
 *
 * The output is committed; the app itself performs zero network requests for data.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const wc = require('world-countries');
const pops = require('country-json/src/country-by-population.json');

const norm = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const popByName = new Map(pops.map((p) => [norm(p.country), p.population]));

// Name differences between the two static datasets.
const POP_ALIAS = {
  VAT: 'Holy See (Vatican City State)',
  PSE: 'Palestine',
  USA: 'United States',
  RUS: 'Russia',
  KOR: 'South Korea',
  PRK: 'North Korea',
  IRN: 'Iran',
  SYR: 'Syria',
  LAO: 'Laos',
  TZA: 'Tanzania',
  BOL: 'Bolivia',
  VEN: 'Venezuela',
  MDA: 'Moldova',
  TUR: 'Turkey',
  CZE: 'Czech Republic',
  MKD: 'Macedonia',
  SWZ: 'Swaziland',
  CPV: 'Cape Verde',
  CIV: 'Ivory Coast',
  COD: 'The Democratic Republic of Congo',
  COG: 'Congo',
  FJI: 'Fiji Islands',
  FSM: 'Micronesia, Federated States of',
  MKD: 'North Macedonia',
  SWZ: 'Eswatini',
  GBR: 'United Kingdom',
  STP: 'Sao Tome and Principe',
  TLS: 'East Timor',
  BRN: 'Brunei',
  VCT: 'Saint Vincent and the Grenadines',
  KNA: 'Saint Kitts and Nevis',
  LCA: 'Saint Lucia',
  TTO: 'Trinidad and Tobago',
  ATG: 'Antigua and Barbuda',
  BHS: 'Bahamas',
  GMB: 'Gambia',
  MMR: 'Myanmar',
  SSD: 'South Sudan',
};

// Predominantly insular states.
const ISLAND = new Set([
  'ATG', 'AUS', 'BHS', 'BHR', 'BRB', 'CPV', 'COM', 'CUB', 'CYP', 'DMA', 'DOM', 'FJI',
  'GRD', 'HTI', 'IDN', 'IRL', 'ISL', 'JAM', 'JPN', 'KIR', 'LCA', 'MDG', 'MDV', 'MLT',
  'MHL', 'MUS', 'FSM', 'NRU', 'NZL', 'PLW', 'PNG', 'PHL', 'KNA', 'VCT', 'WSM', 'STP',
  'SYC', 'SGP', 'SLB', 'LKA', 'TLS', 'TON', 'TTO', 'TUV', 'GBR', 'VUT',
]);

// Famous answers that otherwise dominate "smallest / biggest / most famous" trivia.
const TRAP = new Set([
  'VAT', 'MCO', 'SMR', 'LIE', 'AND', 'LUX', 'MLT', 'ISL', 'RUS', 'CHN', 'USA', 'FRA',
  'ITA', 'JPN', 'BRA', 'IND', 'EGY', 'AUS', 'CAN', 'GBR', 'DEU', 'ESP', 'GRC', 'CHE',
  'NOR', 'NPL', 'BTN', 'MDV', 'SGP', 'ISR', 'ARE', 'SAU', 'MEX', 'ARG', 'ZAF', 'KEN',
  'THA', 'VNM', 'TUR', 'NLD', 'BEL', 'PRT', 'IRL', 'DNK', 'SWE', 'FIN', 'POL', 'UKR',
  'CUB', 'JAM', 'CRI', 'PER', 'CHL', 'NZL', 'FJI', 'MAR', 'TUN', 'MDG', 'KOR', 'PRK',
  'IDN', 'PHL', 'COL', 'VEN', 'PAK', 'IRN', 'IRQ', 'CZE', 'AUT', 'HUN',
]);

const BOTH_HEMISPHERES = new Set([
  'BRA', 'COL', 'ECU', 'COG', 'COD', 'UGA', 'KEN', 'IDN', 'GAB', 'SOM', 'MDV', 'KIR', 'STP',
]);

const ALIASES = {
  USA: ['United States of America', 'US', 'America', 'The States'],
  GBR: ['UK', 'Britain', 'Great Britain', 'England', 'United Kingdom of Great Britain and Northern Ireland'],
  ARE: ['UAE', 'Emirates'],
  NLD: ['Holland', 'The Netherlands'],
  MMR: ['Burma'],
  CIV: ["Ivory Coast", "Cote d'Ivoire"],
  CZE: ['Czech Republic', 'Czechia'],
  COD: ['DR Congo', 'Democratic Republic of the Congo', 'Zaire', 'DRC', 'Congo-Kinshasa'],
  COG: ['Republic of the Congo', 'Congo-Brazzaville'],
  KOR: ['South Korea', 'Korea'],
  PRK: ['North Korea'],
  RUS: ['Russian Federation'],
  VAT: ['Vatican', 'Holy See'],
  PSE: ['Palestinian Territories', 'West Bank', 'Gaza'],
  TLS: ['East Timor'],
  SWZ: ['Eswatini', 'Swaziland'],
  MKD: ['North Macedonia', 'Macedonia'],
  CPV: ['Cape Verde', 'Cabo Verde'],
  TUR: ['Turkey', 'Turkiye'],
  DEU: ['Germany', 'Deutschland'],
  CHN: ['PRC', "People's Republic of China"],
  IRN: ['Iran', 'Persia'],
  LAO: ['Laos'],
  SYR: ['Syria'],
  TZA: ['Tanzania'],
  BOL: ['Bolivia'],
  VEN: ['Venezuela'],
  MDA: ['Moldova'],
  FSM: ['Micronesia'],
  KNA: ['Saint Kitts and Nevis', 'St Kitts'],
  LCA: ['Saint Lucia', 'St Lucia'],
  VCT: ['Saint Vincent and the Grenadines', 'St Vincent'],
  STP: ['Sao Tome and Principe'],
  GNQ: ['Equatorial Guinea'],
  DOM: ['Dominican Republic'],
  CAF: ['Central African Republic'],
  SSD: ['South Sudan'],
  BIH: ['Bosnia', 'Bosnia and Herzegovina'],
  BRN: ['Brunei'],
  GMB: ['The Gambia'],
  NGA: ['Nigeria'],
  ETH: ['Ethiopia'],
  MAR: ['Morocco'],
  DZA: ['Algeria'],
  AZE: ['Azerbaijan'],
  KAZ: ['Kazakhstan'],
  UZB: ['Uzbekistan'],
  TKM: ['Turkmenistan'],
  KGZ: ['Kyrgyzstan'],
  TJK: ['Tajikistan'],
  BLR: ['Belarus'],
  GEO: ['Georgia'],
  ARM: ['Armenia'],
  MDA: ['Moldova'],
  NAM: ['Namibia'],
  BWA: ['Botswana'],
  LSO: ['Lesotho'],
  SWZ: ['Eswatini'],
  MWI: ['Malawi'],
  ZMB: ['Zambia'],
  ZWE: ['Zimbabwe'],
  MOZ: ['Mozambique'],
  TGO: ['Togo'],
  BEN: ['Benin'],
  BFA: ['Burkina Faso'],
  MLI: ['Mali'],
  NER: ['Niger'],
  TCD: ['Chad'],
  SDN: ['Sudan'],
  LBY: ['Libya'],
  MRT: ['Mauritania'],
  ERI: ['Eritrea'],
  DJI: ['Djibouti'],
  SOM: ['Somalia'],
  RWA: ['Rwanda'],
  BDI: ['Burundi'],
  GNB: ['Guinea-Bissau'],
  SLE: ['Sierra Leone'],
  LBR: ['Liberia'],
  SEN: ['Senegal'],
  GIN: ['Guinea'],
};

// world-countries 5.x dropped the `continents` array, so derive ours from
// `region` + `subregion` (the Americas split in two for this game).
const REGION_CONTINENT = {
  Europe: 'Europe',
  Asia: 'Asia',
  Africa: 'Africa',
  Oceania: 'Oceania',
  Antarctic: 'Antarctica',
};

function continentFor(c) {
  if (c.region === 'Americas') {
    return c.subregion === 'South America' ? 'South America' : 'North America';
  }
  return REGION_CONTINENT[c.region] || 'Europe';
}

const selected = wc.filter((c) => c.unMember || c.cca3 === 'PSE');
const rows = [];
const missingPop = [];

for (const c of selected) {
  const pop = popByName.get(norm(POP_ALIAS[c.cca3] || c.name.common)) ?? null;
  if (!pop) missingPop.push(`${c.cca3} ${c.name.common}`);
  const lat = c.latlng?.[0] ?? 0;
  const lng = c.latlng?.[1] ?? 0;

  const aliasSet = new Set();
  for (const a of [c.cca2, c.cca3, c.cioc, ...(c.altSpellings || []), ...(ALIASES[c.cca3] || [])]) {
    if (!a) continue;
    const s = String(a).trim();
    if (s.length < 2) continue;
    if (norm(s) === norm(c.name.common) || norm(s) === norm(c.name.official)) continue;
    aliasSet.add(s);
  }

  rows.push({
    id: c.cca3,
    name: c.name.common,
    aliases: [...aliasSet],
    continent: continentFor(c),
    population: pop ?? 0,
    area: Math.round(c.area * 100) / 100,
    capital: c.capital?.[0] ?? '—',
    lat: Number(lat.toFixed(3)),
    lng: Number(lng.toFixed(3)),
    landlocked: !!c.landlocked,
    island: ISLAND.has(c.cca3),
    borders: (c.borders || []).length,
    hemisphere: BOTH_HEMISPHERES.has(c.cca3) ? 'B' : lat >= 0 ? 'N' : 'S',
    isTouristTrap: TRAP.has(c.cca3),
  });
}

rows.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(new URL('../deep-atlas/data/countries.json', import.meta.url), JSON.stringify(rows, null, 0) + '\n');

console.log(`countries: ${rows.length}`);
console.log(`missing population: ${missingPop.length}${missingPop.length ? ' -> ' + missingPop.join(', ') : ''}`);
console.log(`island: ${rows.filter((r) => r.island).length}, landlocked: ${rows.filter((r) => r.landlocked).length}, traps: ${rows.filter((r) => r.isTouristTrap).length}`);
console.log(`zero population: ${rows.filter((r) => !r.population).map((r) => r.id).join(', ') || 'none'}`);
