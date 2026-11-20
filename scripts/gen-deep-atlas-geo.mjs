/**
 * Builds the physical-geography half of the DEEP ATLAS database:
 *
 *   rivers.json   Natural Earth 10m river centrelines  -> length from geometry
 *   lakes.json    Natural Earth 10m lakes              -> area from geometry
 *   peaks.json    Natural Earth 10m elevation points   -> published elevation
 *   islands.json  Wikipedia island areas + Wikidata coords
 *
 * Natural Earth is public domain, Wikidata is CC0. The hand-curated rows that
 * already live in the data files are kept and always win on a name clash, so a
 * re-run never stacks duplicates and never loses a tourist-trap flag.
 *
 * Sources are cached in .tools/ne (git-ignored). Run: node scripts/gen-deep-atlas-geo.mjs
 */
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';

const NE_DIR = new URL('../.tools/ne/', import.meta.url);
const DATA_DIR = new URL('../games/deep-atlas/data/', import.meta.url);
const NE_RAW = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';

mkdirSync(NE_DIR, { recursive: true });

const R = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;

function normalize(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['\u2019\u02bb`]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function cached(name, load) {
  const file = new URL(name, NE_DIR);
  if (existsSync(file)) return readFileSync(file, 'utf8');
  process.stdout.write(`  fetch ${name} … `);
  const text = await load();
  writeFileSync(file, text);
  console.log(`${Math.round(text.length / 1024)} kB`);
  return text;
}

async function geojson(name) {
  const text = await cached(`${name}.geojson`, async () => {
    const response = await fetch(NE_RAW + `${name}.geojson`);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return response.text();
  });
  return JSON.parse(text).features;
}

async function sparql(file, query) {
  const text = await cached(file, async () => {
    const response = await fetch('https://query.wikidata.org/sparql?format=json', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/sparql-results+json',
        'user-agent': 'DeepAtlas/1.0 (geography game data build)',
      },
      body: new URLSearchParams({ query }),
    });
    if (!response.ok) throw new Error(`wikidata: HTTP ${response.status}`);
    return response.text();
  });
  return JSON.parse(text).results.bindings;
}

/* ------------------------------------------------------------------ */
/* Continents                                                          */
/* ------------------------------------------------------------------ */

const CONTINENT_ALIASES = {
  'Insular Oceania': 'Oceania',
  Eurasia: 'Asia',
  'Seven seas (open ocean)': null,
};

function mapContinent(value) {
  if (!value) return null;
  const mapped = CONTINENT_ALIASES[value] ?? value;
  if (!mapped) return null;
  return ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania', 'Antarctica'].includes(
    mapped
  )
    ? mapped
    : null;
}

function buildContinentLookup(features) {
  const polygons = [];
  for (const feature of features) {
    const continent = mapContinent(feature.properties.CONTINENT);
    if (!continent) continue;
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
      polygons.push({ ring, minX, minY, maxX, maxY, continent });
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

  return function continentAt(lng, lat) {
    for (const polygon of polygons) {
      if (lng < polygon.minX || lng > polygon.maxX || lat < polygon.minY || lat > polygon.maxY) continue;
      if (inRing(polygon.ring, lng, lat)) return polygon.continent;
    }
    return null;
  };
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

function lineLengthKm(coordinates) {
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const [x1, y1] = coordinates[i - 1];
    const [x2, y2] = coordinates[i];
    const dLat = toRad(y2 - y1);
    const dLng = toRad(x2 - x1);
    const a =
      Math.sin(dLat / 2) ** 2 + Math.cos(toRad(y1)) * Math.cos(toRad(y2)) * Math.sin(dLng / 2) ** 2;
    total += 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  return total;
}

function lineMidpoint(coordinates) {
  const half = lineLengthKm(coordinates) / 2;
  let walked = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const [x1, y1] = coordinates[i - 1];
    const [x2, y2] = coordinates[i];
    const dLat = toRad(y2 - y1);
    const dLng = toRad(x2 - x1);
    const a =
      Math.sin(dLat / 2) ** 2 + Math.cos(toRad(y1)) * Math.cos(toRad(y2)) * Math.sin(dLng / 2) ** 2;
    const step = 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
    if (walked + step >= half) {
      const t = step ? (half - walked) / step : 0;
      return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
    }
    walked += step;
  }
  return coordinates[0] ?? [0, 0];
}

/** Spherical ring area in km² (shoelace on the sphere, holes ignored). */
function ringAreaKm2(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % ring.length];
    sum += toRad(lng2 - lng1) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  }
  return Math.abs((sum * R * R) / 2);
}

function polygonInfo(geometry) {
  const parts = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let best = null;
  for (const part of parts) {
    const ring = part[0];
    if (!ring || ring.length < 4) continue;
    const area = ringAreaKm2(ring);
    if (!best || area > best.area) best = { area, ring };
  }
  if (!best) return null;
  let lng = 0;
  let lat = 0;
  for (const [x, y] of best.ring) {
    lng += x;
    lat += y;
  }
  return { area: Math.round(best.area * 100) / 100, lng: lng / best.ring.length, lat: lat / best.ring.length };
}

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */

function readData(name, fallback) {
  const file = new URL(name, DATA_DIR);
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeData(name, value) {
  writeFileSync(new URL(name, DATA_DIR), JSON.stringify(value));
  const kb = Math.round(JSON.stringify(value).length / 1024);
  console.log(`  wrote ${name} — ${Array.isArray(value) ? value.length : '?'} rows, ${kb} kB`);
}

async function buildRivers(continentAt, curated) {
  const features = await geojson('ne_10m_rivers_lake_centerlines');
  const byName = new Map();

  for (const feature of features) {
    const props = feature.properties;
    const name = String(props.name ?? '').trim();
    if (!name || props.featurecla === 'Lake Centerline') continue;
    const geometry = feature.geometry;
    const lines =
      geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
    let best = null;
    for (const line of lines) {
      if (line.length < 2) continue;
      const length = lineLengthKm(line);
      if (!best || length > best.length) best = { length, line };
    }
    if (!best || best.length < 45) continue;
    const [lng, lat] = lineMidpoint(best.line);
    const key = normalize(name);
    const length = Math.round(best.length);
    const previous = byName.get(key);
    if (previous && previous.length >= length) continue;
    const continent = continentAt(lng, lat);
    if (!continent || continent === 'Antarctica') continue;
    byName.set(key, {
      name,
      ...(props.name_alt ? { aliases: [String(props.name_alt).trim()].filter(Boolean) } : {}),
      continent,
      lat: Math.round(lat * 1000) / 1000,
      lng: Math.round(lng * 1000) / 1000,
      length,
      outflow: '',
    });
  }

  const seen = new Set(curated.map((row) => normalize(row.name)));
  const generated = [...byName.values()].filter((row) => !seen.has(normalize(row.name)));
  return [...curated, ...generated];
}

async function buildLakes(continentAt, curated) {
  const features = await geojson('ne_10m_lakes');
  const byName = new Map();

  for (const feature of features) {
    const name = String(feature.properties.name ?? '').trim();
    if (!name) continue;
    const info = polygonInfo(feature.geometry);
    if (!info || info.area < 4) continue;
    const key = normalize(name);
    const previous = byName.get(key);
    if (previous && previous.area >= info.area) continue;
    const continent = continentAt(info.lng, info.lat);
    if (!continent || continent === 'Antarctica') continue;
    byName.set(key, {
      name,
      kind: 'lake',
      continent,
      lat: Math.round(info.lat * 1000) / 1000,
      lng: Math.round(info.lng * 1000) / 1000,
      area: info.area,
    });
  }

  const seen = new Set(curated.map((row) => normalize(row.name)));
  const generated = [...byName.values()].filter(
    (row) => !seen.has(normalize(row.name)) && row.continent !== 'Antarctica'
  );
  return [...curated, ...generated];
}

/**
 * Natural Earth's subregion is sometimes just a country or an ocean
 * ("New Zealand", "Polynesia"). Only a real mountain group belongs after
 * "a peak in the …", so anything else falls back to no range at all.
 */
function rangeName(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return /mountain|range|alps|himalaya|andes|cordillera|sierra|massif|highland|rift|shan|pamir|karakoram|snowdonia|alborz|maoke|sudirman|crocker|olympus|grampian|appalachian|rocky|cascade|teton|sentinel|executive/i.test(
    text
  )
    ? text
    : '';
}

async function buildPeaks(continentAt, curated) {
  const features = await geojson('ne_10m_geography_regions_elevation_points');
  const byName = new Map();

  for (const feature of features) {
    const props = feature.properties;
    const name = String(props.name ?? '').trim();
    const elevation = Number(props.elevation);
    if (!name || !Number.isFinite(elevation) || elevation < 400) continue;
    if (props.featurecla === 'spot elevation') continue;
    const continent = mapContinent(props.region) ?? continentAt(props.long_x, props.lat_y);
    if (!continent || continent === 'Antarctica') continue;
    const key = normalize(name);
    const previous = byName.get(key);
    if (previous && previous.elevation >= elevation) continue;
    byName.set(key, {
      name,
      ...(props.name_alt ? { aliases: [String(props.name_alt).trim()].filter(Boolean) } : {}),
      continent,
      lat: Math.round(Number(props.lat_y) * 1000) / 1000,
      lng: Math.round(Number(props.long_x) * 1000) / 1000,
      elevation: Math.round(elevation),
      range: rangeName(props.subregion),
    });
  }

  const seen = new Set(curated.map((row) => normalize(row.name)));
  const generated = [...byName.values()].filter((row) => !seen.has(normalize(row.name)));
  return [...curated, ...generated];
}

async function buildIslands(continentAt, curated) {
  // Wikipedia: List of islands by area (area in km², verified table).
  const wiki = await cached('islands.wiki', async () => {
    const response = await fetch('https://en.wikipedia.org/w/index.php?title=List_of_islands_by_area&action=raw', {
      headers: { 'user-agent': 'DeepAtlas/1.0 (geography game data build)' },
    });
    if (!response.ok) throw new Error(`wikipedia: HTTP ${response.status}`);
    return response.text();
  });

  const listed = [];
  for (const line of wiki.split('\n')) {
    const match = line.match(/^\|_row_count \|\| (.+?) \|\| \{\{convert\|([\d.,]+)\|km2/);
    if (!match) continue;
    const links = [...match[1].matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)];
    let name = links.length ? links[0][2] || links[0][1] : match[1];
    name = name
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/\{\{[^}]*\}\}/g, '')
      .replace(/\[\[|\]\]|<[^>]+>/g, '')
      .replace(/<ref[^>]*>.*$/i, '')
      .trim();
    const area = Number.parseFloat(match[2].replace(/,/g, ''));
    if (!name || !Number.isFinite(area)) continue;
    listed.push({ name, area });
  }

  // Wikidata: one coordinate per listed name.
  const values = listed
    .map((row) => `"${row.name.replace(/"/g, '')}"@en`)
    .join(' ');
  const bindings = await sparql(
    'island-coords.json',
    `SELECT ?name ?coord ?continentLabel WHERE {
       VALUES ?name { ${values} }
       ?item rdfs:label ?name; wdt:P625 ?coord.
       OPTIONAL { ?item wdt:P30 ?continent. }
       SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
     }`
  );
  const coords = new Map();
  for (const binding of bindings) {
    const name = binding.name.value;
    if (coords.has(name)) continue;
    coords.set(name, {
      point: binding.coord.value,
      continent: binding.continentLabel?.value,
    });
  }

  const seen = new Set(curated.map((row) => normalize(row.name)));
  const generated = [];
  for (const row of listed) {
    const hit = coords.get(row.name);
    if (!hit) continue;
    const point = hit.point.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
    if (!point) continue;
    const lng = Number(point[1]);
    const lat = Number(point[2]);
    const continent = mapContinent(hit.continent) ?? continentAt(lng, lat);
    if (!continent || continent === 'Antarctica') continue;
    if (seen.has(normalize(row.name))) continue;
    seen.add(normalize(row.name));
    generated.push({
      name: row.name,
      kind: 'island',
      continent,
      lat: Math.round(lat * 1000) / 1000,
      lng: Math.round(lng * 1000) / 1000,
      area: Math.round(row.area * 100) / 100,
    });
  }

  return [...curated, ...generated];
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

console.log('DEEP ATLAS geography build');
console.log('  reading Natural Earth country outlines …');
const countries = await geojson('ne_10m_admin_0_countries');
const continentAt = buildContinentLookup(countries);
console.log(`  ${countries.length} country outlines indexed`);

const existingIslands = readData('islands.json', []);
const curatedIslands = existingIslands.filter((row) => row.kind === 'island');
const curatedLakes = existingIslands.filter((row) => row.kind === 'lake');
const curatedRivers = readData('rivers.json', []);
const curatedPeaks = readData('peaks.json', []);

const rivers = await buildRivers(continentAt, curatedRivers);
const lakes = await buildLakes(continentAt, [...readData('lakes.json', []), ...curatedLakes]);
const peaks = await buildPeaks(continentAt, curatedPeaks);
const islands = await buildIslands(continentAt, curatedIslands);

console.log('  totals:');
writeData('rivers.json', rivers);
writeData('lakes.json', lakes);
writeData('peaks.json', peaks);
writeData('islands.json', islands);
