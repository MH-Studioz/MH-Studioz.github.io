import type { LonLat, TrackCatalog, TrackFeature } from './types';

export const TRACK_GEOJSON_URL = '../../assets/tracks/circuits.geojson';
/**
 * Real circuit centre lines assembled from OpenStreetMap `highway=raceway`
 * ways (see `.tools/osm-import.mjs`). The bundled GeoJSON only carries a
 * coarse outline - roughly one point every 45 m, which cannot describe a
 * chicane - so the imported rings are preferred whenever they are present.
 * Data (c) OpenStreetMap contributors, ODbL 1.0.
 */
export const TRACK_OSM_URL = '../../assets/tracks/osm-circuits.json';

interface RawGeoJSON {
  type: string;
  features: Array<{
    type: string;
    properties: Record<string, unknown>;
    geometry: { type: string; coordinates: unknown };
  }>;
}

const FALLBACK: Array<Pick<TrackFeature, 'id' | 'name' | 'location' | 'opened' | 'length'> & { shape: [number, number][] }> = [
  {
    id: 'it-1922',
    name: 'Autodromo Nazionale Monza',
    location: 'Monza',
    opened: 1922,
    length: 5793,
    shape: [
      [0, -420], [0, -200], [0, 80], [0, 330], [10, 380], [42, 400], [78, 385],
      [96, 352], [110, 300], [128, 268], [160, 258], [188, 276], [205, 320],
      [222, 350], [250, 340], [268, 300], [272, 210], [270, 90], [268, -40],
      [272, -160], [286, -250], [300, -330], [292, -382], [266, -405], [236, -392],
      [214, -356], [196, -318], [176, -290], [150, -280], [124, -296], [106, -330],
      [84, -356], [52, -366], [22, -352], [4, -400],
    ],
  },
  {
    id: 'nl-1948',
    name: 'Circuit Zandvoort',
    location: 'Zandvoort',
    opened: 1948,
    length: 4259,
    shape: [
      [0, -180], [0, 40], [8, 88], [38, 108], [70, 100], [92, 72], [104, 30],
      [100, -14], [116, -52], [142, -66], [172, -50], [188, -12], [196, 34],
      [214, 66], [246, 72], [272, 52], [282, 14], [268, -24], [242, -48],
      [222, -76], [216, -112], [230, -146], [258, -164], [262, -198], [240, -224],
      [204, -232], [172, -220], [148, -196], [118, -186], [86, -198], [56, -214],
      [26, -208], [4, -200],
    ],
  },
  {
    id: 'mc-1929',
    name: 'Circuit de Monaco',
    location: 'Monaco',
    opened: 1929,
    length: 3337,
    shape: [
      [0, -140], [0, 40], [10, 70], [36, 78], [62, 66], [80, 40], [92, 10],
      [110, -6], [132, -2], [146, -24], [140, -54], [116, -70], [96, -88],
      [94, -118], [112, -140], [112, -168], [88, -184], [58, -180], [30, -166],
      [8, -152],
    ],
  },
];

const BUDDH_SHAPE: [number, number][] = [
  [0, -300], [0, -100], [0, 120], [0, 300], [4, 342], [20, 370], [50, 385],
  [84, 376], [104, 350], [110, 320], [130, 296], [160, 290], [186, 306],
  [206, 336], [228, 346], [250, 330], [268, 300], [278, 200], [284, 50],
  [290, -100], [300, -250], [320, -350], [332, -402], [340, -440], [330, -470],
  [308, -480], [294, -464], [280, -430], [260, -400], [236, -380], [216, -350],
  [200, -310], [190, -270], [174, -240], [150, -230], [130, -246], [114, -276],
  [94, -290], [74, -274], [64, -240], [44, -224], [20, -234], [5, -262],
];

function metersToLonLat(shape: [number, number][], lon0: number, lat0: number): LonLat[] {
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return shape.map(([x, z]) => [lon0 + x / mPerDegLon, lat0 - z / mPerDegLat] as LonLat);
}

/** The upstream GeoJSON omits Buddh; add it so the full historic open-wheel roster is selectable. */
function buildBuddh(): TrackFeature {
  return {
    id: 'in-2011',
    name: 'Buddh International Circuit',
    location: 'Greater Noida',
    opened: 2011,
    length: 5140,
    coordinates: metersToLonLat(BUDDH_SHAPE, 77.5335, 28.3505),
  };
}

const RALLY_STAGES: Array<{
  id: string;
  name: string;
  location: string;
  length: number;
  shape: [number, number][];
}> = [
  {
    id: 'rally-silverpine',
    name: 'Silverpine Gravel Stage',
    location: 'Silverpine Forest',
    length: 3240,
    shape: [
      [0, -400], [16, -308], [76, -258], [158, -282], [220, -356], [298, -382],
      [360, -326], [348, -246], [288, -202], [302, -140], [382, -102], [420, -30],
      [382, 58], [324, 84], [302, 158], [252, 222], [182, 204], [158, 124],
      [104, 102], [64, 158], [52, 246], [0, 302], [-50, 244], [-62, 154],
      [-120, 104], [-184, 124], [-232, 182], [-300, 152], [-332, 82], [-282, 0],
      [-222, -30], [-202, -120], [-252, -202], [-202, -302], [-122, -332], [-62, -382],
    ],
  },
  {
    id: 'rally-red-mesa',
    name: 'Red Mesa Rally Stage',
    location: 'Red Mesa',
    length: 2760,
    shape: [
      [0, -300], [28, -218], [96, -180], [172, -198], [230, -260], [306, -266],
      [356, -210], [340, -132], [276, -92], [232, -34], [252, 42], [322, 76],
      [348, 146], [302, 214], [228, 222], [184, 164], [126, 142], [72, 188],
      [44, 252], [-10, 280], [-62, 226], [-66, 150], [-128, 112], [-198, 136],
      [-250, 198], [-314, 174], [-340, 104], [-286, 28], [-224, 4], [-204, -72],
      [-252, -146], [-214, -232], [-138, -266], [-72, -282],
    ],
  },
];

function buildRallyStage(stage: (typeof RALLY_STAGES)[number]): TrackFeature {
  return {
    id: stage.id,
    name: stage.name,
    location: stage.location,
    opened: 2024,
    length: stage.length,
    coordinates: metersToLonLat(stage.shape, 9.28, 45.62),
  };
}

function normalizeFeature(raw: RawGeoJSON['features'][number]): TrackFeature | null {
  const p = raw.properties ?? {};
  const id = String(p.id ?? '').trim();
  const name = String(p.Name ?? p.name ?? '').trim();
  if (!id || !name) return null;
  if (!raw.geometry || raw.geometry.type !== 'LineString') return null;
  const rawCoords = raw.geometry.coordinates as unknown;
  if (!Array.isArray(rawCoords)) return null;
  const coordinates: LonLat[] = [];
  for (const pair of rawCoords) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const lon = Number(pair[0]);
    const lat = Number(pair[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    coordinates.push([lon, lat]);
  }
  // A closed ring repeats its first point; the spline closes itself.
  if (coordinates.length > 2) {
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    if (Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) {
      coordinates.pop();
    }
  }
  if (coordinates.length < 12) return null;
  const length = Number(p.length);
  if (!Number.isFinite(length) || length < 800) return null;
  return {
    id,
    name,
    location: String(p.Location ?? p.location ?? ''),
    opened: Number(p.opened) || 0,
    length,
    coordinates,
  };
}

interface OsmGeometry {
  length: number;
  coordinates: [number, number][];
}

async function loadOsmGeometry(): Promise<Record<string, OsmGeometry>> {
  try {
    const res = await fetch(TRACK_OSM_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { tracks?: Record<string, OsmGeometry> };
    return json?.tracks ?? {};
  } catch (err) {
    // Offline or not imported yet: the coarse GeoJSON ring is still usable.
    console.warn('[tracks] OSM geometry unavailable, keeping source outlines:', err);
    return {};
  }
}

let cachedCatalog: TrackCatalog | null = null;

export async function loadTrackCatalog(): Promise<TrackCatalog> {
  if (cachedCatalog) return cachedCatalog;
  let catalog: TrackCatalog | null = null;
  try {
    const res = await fetch(TRACK_GEOJSON_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as RawGeoJSON;
    if (!json || !Array.isArray(json.features)) throw new Error('Malformed FeatureCollection');
    const features = json.features
      .map(normalizeFeature)
      .filter((f): f is TrackFeature => f !== null);
    if (features.length < 10) throw new Error('Too few usable circuits');
    if (!features.some((f) => f.name.toLowerCase().includes('buddh'))) features.push(buildBuddh());
    for (const stage of RALLY_STAGES) if (!features.some((f) => f.id === stage.id)) features.push(buildRallyStage(stage));
    features.sort((a, b) => a.name.localeCompare(b.name));
    catalog = { features, source: TRACK_GEOJSON_URL, fallback: false };
  } catch (err) {
    console.warn('[tracks] GeoJSON unavailable, using embedded fallback:', err);
    const features: TrackFeature[] = FALLBACK.map((f) => ({
      id: f.id,
      name: f.name,
      location: f.location,
      opened: f.opened,
      length: f.length,
      coordinates: metersToLonLat(f.shape, 9.28, 45.62),
    }));
    features.push(buildBuddh());
    for (const stage of RALLY_STAGES) features.push(buildRallyStage(stage));
    features.sort((a, b) => a.name.localeCompare(b.name));
    catalog = { features, source: 'embedded fallback', fallback: true };
  }
  await applyOsmGeometry(catalog);
  cachedCatalog = catalog;
  return catalog;
}

/** Swap the coarse source outline for the imported OSM ring where available. */
async function applyOsmGeometry(catalog: TrackCatalog): Promise<void> {
  const osm = await loadOsmGeometry();
  let replaced = 0;
  for (const feature of catalog.features) {
    const ring = osm[feature.id];
    if (!ring || !Array.isArray(ring.coordinates) || ring.coordinates.length < 40) continue;
    const coordinates: LonLat[] = [];
    for (const pair of ring.coordinates) {
      const lon = Number(pair[0]);
      const lat = Number(pair[1]);
      if (Number.isFinite(lon) && Number.isFinite(lat)) coordinates.push([lon, lat]);
    }
    if (coordinates.length < 40) continue;
    // The imported ring starts wherever the way happened to be split. Rotate it
    // so index 0 sits on the original start/finish point: the grid slot, the
    // pit entry and exit and the finish line all key off lap fraction 0.
    const anchor = feature.coordinates[0];
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < coordinates.length; i++) {
      const dLat = (coordinates[i][1] - anchor[1]) * 111320;
      const dLon = (coordinates[i][0] - anchor[0]) * 111320 * Math.cos((anchor[1] * Math.PI) / 180);
      const d = dLat * dLat + dLon * dLon;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    feature.coordinates = [...coordinates.slice(best), ...coordinates.slice(0, best)];
    replaced++;
  }
  if (replaced > 0) {
    catalog.source = `${TRACK_OSM_URL} (${replaced} circuits, OpenStreetMap contributors, ODbL)`;
  }
}

export function findFeature(catalog: TrackCatalog, id: string): TrackFeature | undefined {
  return catalog.features.find((f) => f.id === id);
}

// ---------------------------------------------------------------------------
// Live 2D SVG previews
// ---------------------------------------------------------------------------

interface PreviewPoint {
  x: number;
  y: number;
}

function previewPoints(coords: LonLat[]): { pts: PreviewPoint[]; cumulative: number[]; total: number } {
  let lon0 = 0;
  let lat0 = 0;
  for (const [lon, lat] of coords) {
    lon0 += lon;
    lat0 += lat;
  }
  lon0 /= coords.length;
  lat0 /= coords.length;
  const mPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const pts: PreviewPoint[] = coords.map(([lon, lat]) => ({
    x: (lon - lon0) * mPerDegLon,
    // SVG y grows downward; north should be up.
    y: (lat - lat0) * 111320,
  }));
  const cumulative: number[] = [0];
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
    cumulative.push(total);
  }
  return { pts, cumulative, total };
}

function pathSlice(pts: PreviewPoint[], cumulative: number[], from: number, to: number): string {
  // Keep every vertex whose arc position falls inside the range, then close
  // the ends by interpolation so sectors join cleanly.
  const out: PreviewPoint[] = [];
  const n = pts.length;
  const total = cumulative[n];
  const step = total / n;
  const at = (d: number): PreviewPoint => {
    const wrapped = ((d % total) + total) % total;
    let i = 0;
    while (i < n - 1 && cumulative[i + 1] < wrapped) i++;
    const segLen = cumulative[i + 1] - cumulative[i] || 1;
    const t = Math.max(0, Math.min(1, (wrapped - cumulative[i]) / segLen));
    const a = pts[i];
    const b = pts[(i + 1) % n];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  for (let i = 0; i <= n; i++) {
    const d = i * step;
    if (d >= from && d <= to) out.push(pts[i % n]);
  }
  out.unshift(at(from));
  out.push(at(to));
  return out.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

/** Builds the live sector-coloured SVG thumbnail for a circuit card. */
export function createTrackPreviewSvg(feature: TrackFeature, width = 260, height = 150): string {
  const { pts, cumulative, total } = previewPoints(feature.coordinates);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const pad = 14;
  const scale = Math.min((width - pad * 2) / Math.max(1, maxX - minX), (height - pad * 2) / Math.max(1, maxY - minY));
  const ox = (width - (maxX - minX) * scale) / 2;
  const oy = (height - (maxY - minY) * scale) / 2;
  const transform = (p: PreviewPoint): PreviewPoint => ({
    x: ox + (p.x - minX) * scale,
    y: oy + (p.y - minY) * scale,
  });
  const mapped = pts.map(transform);
  // Cumulative distances must be recomputed after scaling into the viewBox.
  const mappedCumulative: number[] = [0];
  let mappedTotal = 0;
  for (let i = 0; i < mapped.length; i++) {
    const a = mapped[i];
    const b = mapped[(i + 1) % mapped.length];
    mappedTotal += Math.hypot(b.x - a.x, b.y - a.y);
    mappedCumulative.push(mappedTotal);
  }
  const sectors: Array<[string, number, number]> = [
    ['#e10600', 0, mappedCumulative[Math.floor(mapped.length / 3)]],
    ['#ffd400', mappedCumulative[Math.floor(mapped.length / 3)], mappedCumulative[Math.floor((mapped.length * 2) / 3)]],
    ['#19d3ff', mappedCumulative[Math.floor((mapped.length * 2) / 3)], mappedTotal],
  ];
  const body = sectors
    .map(([color, a, b], idx) => {
      const d = pathSlice(mapped, mappedCumulative, a, b);
      return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${idx === 0 ? 4.4 : 3.4}" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>`;
    })
    .join('');
  const start = mapped[0];
  const sectorLabel = ['S1', 'S2', 'S3']
    .map(
      (s, i) =>
        `<g transform="translate(${10 + i * 26},${height - 12})"><rect width="22" height="10" rx="2" fill="${
          ['#e10600', '#ffd400', '#19d3ff'][i]
        }" opacity=".85"/><text x="11" y="7.6" text-anchor="middle" font-size="6.2" font-family="system-ui,sans-serif" font-weight="700" fill="#06080c">${s}</text></g>`,
    )
    .join('');
  return `<svg class="track-thumb" viewBox="0 0 ${width} ${height}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs><filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <g filter="url(#glow)"><path d="${pathSlice(mapped, mappedCumulative, 0, mappedTotal)}" fill="none" stroke="#ffffff" stroke-width="6" stroke-linejoin="round" opacity="0.10"/></g>
    ${body}
    <circle cx="${start.x.toFixed(1)}" cy="${start.y.toFixed(1)}" r="3.4" fill="#ffffff" stroke="#06080c" stroke-width="1.4"/>
    <circle cx="${start.x.toFixed(1)}" cy="${start.y.toFixed(1)}" r="6.6" fill="none" stroke="#ffffff" stroke-width="0.8" opacity="0.5">
      <animate attributeName="r" values="5;9;5" dur="2.6s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.6;0;0.6" dur="2.6s" repeatCount="indefinite"/>
    </circle>
    ${sectorLabel}
  </svg>`;
}
