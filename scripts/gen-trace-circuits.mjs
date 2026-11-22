/**
 * Builds games/trace/data/circuits.json.
 *
 * Two sources:
 *  1. public/assets/tracks/circuits.geojson — real GPS centerlines from the
 *     racing game, projected to metres, simplified, normalised to a 1000 box.
 *  2. SCHEMATIC below — circuits the geojson does not carry (NASCAR ovals,
 *     street courses and a few road courses). Ovals are generated from a
 *     superellipse; road courses are hand-traced control points run through
 *     Chaikin smoothing.
 *
 * Every outline is closed, unlabeled and normalised to a 1000 x 1000 box with
 * the aspect ratio preserved, so the renderer only ever draws a centerline.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { EXTRA_TRACKS } from './trace-extra-tracks.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const BOX = 1000;
const PAD = 58;

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

function project(coords) {
  const n = coords.length;
  let lon0 = 0;
  let lat0 = 0;
  for (const [lon, lat] of coords) {
    lon0 += lon;
    lat0 += lat;
  }
  lon0 /= n;
  lat0 /= n;
  const mPerLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return coords.map(([lon, lat]) => [(lon - lon0) * mPerLon, -(lat - lat0) * 110540]);
}

function rdp(points, eps) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const [x1, y1] = points[first];
    const [x2, y2] = points[last];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    let best = -1;
    let bestIndex = -1;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      const dist = Math.abs(dy * (px - x1) - dx * (py - y1)) / len;
      if (dist > best) {
        best = dist;
        bestIndex = i;
      }
    }
    if (best > eps && bestIndex > 0) {
      keep[bestIndex] = 1;
      stack.push([first, bestIndex], [bestIndex, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Closed-ring Ramer–Douglas–Peucker: split at the two farthest-apart points. */
function simplifyRing(points, eps) {
  let far = 0;
  let farDist = -1;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - points[0][0], points[i][1] - points[0][1]);
    if (d > farDist) {
      farDist = d;
      far = i;
    }
  }
  const a = rdp(points.slice(0, far + 1), eps);
  const b = rdp(points.slice(far).concat([points[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

function normalize(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const scale = (BOX - PAD * 2) / span;
  return points.map(([x, y]) => [
    Math.round(((x - cx) * scale + BOX / 2) * 10) / 10,
    Math.round(((y - cy) * scale + BOX / 2) * 10) / 10,
  ]);
}

function chaikin(points, passes = 2) {
  let out = points;
  for (let p = 0; p < passes; p++) {
    const next = [];
    for (let i = 0; i < out.length; i++) {
      const [x1, y1] = out[i];
      const [x2, y2] = out[(i + 1) % out.length];
      next.push([x1 * 0.75 + x2 * 0.25, y1 * 0.75 + y2 * 0.25]);
      next.push([x1 * 0.25 + x2 * 0.75, y1 * 0.25 + y2 * 0.75]);
    }
    out = next;
  }
  return out;
}

/** Superellipse oval: p controls how straight the straights are. */
function oval(halfLen, halfWid, p = 3, bulge = 0, n = 220) {
  const points = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const s = Math.sin(t);
    const c = Math.cos(t);
    const x = halfLen * Math.sign(s) * Math.abs(s) ** (2 / p);
    let y = halfWid * Math.sign(c) * Math.abs(c) ** (2 / p);
    if (bulge && y > 0) y += bulge * Math.exp(-((x / (0.45 * halfLen)) ** 2));
    points.push([x, y]);
  }
  return points;
}

function poly(points, passes = 2) {
  return chaikin(points, passes);
}

/* ------------------------------------------------------------------ */
/* Existing GPS circuits: names, countries, series, aliases            */
/* ------------------------------------------------------------------ */

const FROM_GEOJSON = {
  'au-1953': ['Albert Park Circuit', 'Albert Park', 'Melbourne', 'Australia', ['melbourne', 'albert park'], ['f1', 'f2', 'f3']],
  'bh-2002': ['Bahrain International Circuit', 'Bahrain', 'Sakhir', 'Bahrain', ['sakhir'], ['f1', 'wec']],
  'cn-2004': ['Shanghai International Circuit', 'Shanghai', 'Shanghai', 'China', ['shanghai'], ['f1']],
  'es-1991': ['Circuit de Barcelona-Catalunya', 'Barcelona', 'Montmeló', 'Spain', ['barcelona', 'catalunya', 'montmelo', 'catalonia'], ['f1', 'f2', 'f3', 'f4']],
  'mc-1929': ['Circuit de Monaco', 'Monaco', 'Monte Carlo', 'Monaco', ['monte carlo', 'monte-carlo'], ['f1', 'f2', 'f3']],
  'ca-1978': ['Circuit Gilles-Villeneuve', 'Gilles Villeneuve', 'Montreal', 'Canada', ['montreal', 'gilles villeneuve', 'ile notre-dame'], ['f1']],
  'fr-1969': ['Circuit Paul Ricard', 'Paul Ricard', 'Le Castellet', 'France', ['le castellet', 'ricard'], ['f4']],
  'at-1969': ['Red Bull Ring', 'Red Bull Ring', 'Spielberg', 'Austria', ['spielberg', 'a1 ring', 'osterreichring'], ['f1', 'f2', 'f3', 'f4']],
  'gb-1948': ['Silverstone Circuit', 'Silverstone', 'Silverstone', 'United Kingdom', ['silverstone'], ['f1', 'f2', 'f3', 'f4']],
  'de-1932': ['Hockenheimring', 'Hockenheim', 'Hockenheim', 'Germany', ['hockenheim'], ['f4']],
  'hu-1986': ['Hungaroring', 'Hungaroring', 'Budapest', 'Hungary', ['budapest'], ['f1', 'f2', 'f3']],
  'be-1925': ['Circuit de Spa-Francorchamps', 'Spa-Francorchamps', 'Stavelot', 'Belgium', ['spa', 'francorchamps', 'spa francorchamps'], ['f1', 'f2', 'f3', 'f4', 'wec']],
  'it-1922': ['Autodromo Nazionale Monza', 'Monza', 'Monza', 'Italy', ['monza', 'autodromo nazionale di monza', 'temple of speed'], ['f1', 'f2', 'f3', 'f4']],
  'sg-2008': ['Marina Bay Street Circuit', 'Marina Bay', 'Singapore', 'Singapore', ['singapore', 'marina bay'], ['f1']],
  'ru-2014': ['Sochi Autodrom', 'Sochi', 'Sochi', 'Russia', ['sochi'], ['f1']],
  'jp-1962': ['Suzuka International Racing Course', 'Suzuka', 'Suzuka', 'Japan', ['suzuka'], ['f1']],
  'us-2012': ['Circuit of the Americas', 'COTA', 'Austin', 'United States', ['cota', 'austin', 'americas'], ['f1', 'nascar', 'wec']],
  'mx-1962': ['Autódromo Hermanos Rodríguez', 'Mexico City', 'Mexico City', 'Mexico', ['mexico', 'hermanos rodriguez', 'rodriguez brothers'], ['f1']],
  'br-1940': ['Autódromo José Carlos Pace', 'Interlagos', 'São Paulo', 'Brazil', ['interlagos', 'sao paulo', 'jose carlos pace'], ['f1', 'wec']],
  'ae-2009': ['Yas Marina Circuit', 'Yas Marina', 'Abu Dhabi', 'United Arab Emirates', ['abu dhabi', 'yas island', 'yas marina'], ['f1', 'f2', 'f3']],
  'it-1953': ['Autodromo Enzo e Dino Ferrari', 'Imola', 'Imola', 'Italy', ['imola', 'enzo e dino ferrari', 'san marino'], ['f4', 'wec']],
  'de-1927': ['Nürburgring', 'Nürburgring', 'Nürburg', 'Germany', ['nurburgring', 'nurburg', 'green hell'], ['f4']],
  'pt-2008': ['Autódromo Internacional do Algarve', 'Portimão', 'Portimão', 'Portugal', ['portimao', 'algarve'], ['wec']],
  'it-1914': ['Autodromo Internazionale del Mugello', 'Mugello', 'Scarperia', 'Italy', ['mugello'], ['f4']],
  'my-1999': ['Sepang International Circuit', 'Sepang', 'Sepang', 'Malaysia', ['sepang', 'kuala lumpur'], ['f1']],
  'tr-2005': ['Intercity Istanbul Park', 'Istanbul Park', 'Istanbul', 'Türkiye', ['istanbul', 'turkey'], ['f1', 'f4']],
  'nl-1948': ['Circuit Zandvoort', 'Zandvoort', 'Zandvoort', 'Netherlands', ['zandvoort'], ['f1', 'f4']],
  'fr-1960': ['Circuit de Nevers Magny-Cours', 'Magny-Cours', 'Magny-Cours', 'France', ['magny cours', 'nevers'], ['f4']],
  'pt-1972': ['Autódromo do Estoril', 'Estoril', 'Estoril', 'Portugal', ['estoril'], ['f4']],
  'br-1977': ['Autódromo Internacional Nelson Piquet', 'Jacarepaguá', 'Rio de Janeiro', 'Brazil', ['jacarepagua', 'rio', 'nelson piquet'], ['f1']],
  'sa-2021': ['Jeddah Corniche Circuit', 'Jeddah', 'Jeddah', 'Saudi Arabia', ['jeddah', 'corniche'], ['f1']],
  'us-2022': ['Miami International Autodrome', 'Miami', 'Miami Gardens', 'United States', ['miami'], ['f1']],
  'qa-2004': ['Losail International Circuit', 'Lusail', 'Lusail', 'Qatar', ['lusail', 'losail', 'qatar'], ['f1', 'f2', 'f3', 'wec']],
  'es-2026': ['Circuito de Madring', 'Madring', 'Madrid', 'Spain', ['madrid', 'ifema'], ['f1', 'f2', 'f3']],
  'az-2016': ['Baku City Circuit', 'Baku', 'Baku', 'Azerbaijan', ['baku'], ['f1', 'f2']],
  'us-2023': ['Las Vegas Street Circuit', 'Las Vegas', 'Las Vegas', 'United States', ['vegas', 'las vegas strip'], ['f1']],
  'us-1909': ['Indianapolis Motor Speedway', 'Indianapolis', 'Speedway', 'United States', ['indy', 'indianapolis', 'brickyard', 'indy 500'], ['nascar', 'indycar']],
  'ar-1952': ['Autódromo Oscar y Juan Gálvez', 'Buenos Aires', 'Buenos Aires', 'Argentina', ['galvez', 'oscar y juan galvez'], ['f1']],
  'za-1961': ['Kyalami Grand Prix Circuit', 'Kyalami', 'Johannesburg', 'South Africa', ['kyalami', 'midrand'], ['f1']],
  'us-1956': ['Watkins Glen International', 'Watkins Glen', 'Watkins Glen', 'United States', ['the glen', 'watkins glen'], ['nascar']],
};

/* ------------------------------------------------------------------ */
/* Schematic circuits                                                  */
/* ------------------------------------------------------------------ */

const SCHEMATIC = [
  /* ---- NASCAR ovals ---- */
  {
    id: 'us-daytona', name: 'Daytona International Speedway', short: 'Daytona', city: 'Daytona Beach',
    country: 'United States', length: 4023, series: ['nascar'],
    aliases: ['daytona', 'daytona 500', 'speedweeks'], shape: oval(1000, 350, 2.9, 45),
  },
  {
    id: 'us-talladega', name: 'Talladega Superspeedway', short: 'Talladega', city: 'Lincoln',
    country: 'United States', length: 4281, series: ['nascar'],
    aliases: ['talladega', 'dega'], shape: oval(1080, 360, 2.9, 60),
  },
  {
    id: 'us-atlanta', name: 'Atlanta Motor Speedway', short: 'Atlanta', city: 'Hampton',
    country: 'United States', length: 2480, series: ['nascar'],
    aliases: ['atlanta', 'echopark', 'hampton'], shape: oval(620, 300, 2.6, 40),
  },
  {
    id: 'us-charlotte', name: 'Charlotte Motor Speedway', short: 'Charlotte', city: 'Concord',
    country: 'United States', length: 2414, series: ['nascar'],
    aliases: ['charlotte', 'concord', 'coca-cola 600'], shape: oval(600, 290, 2.6, 34),
  },
  {
    id: 'us-charlotte-roval', name: 'Charlotte Motor Speedway Roval', short: 'Charlotte Roval', city: 'Concord',
    country: 'United States', length: 3670, series: ['nascar'],
    aliases: ['roval', 'charlotte roval'],
    shape: poly([
      [-600, -290], [-600, 120], [-560, 250], [-420, 320], [-150, 330], [120, 320],
      [380, 300], [520, 240], [580, 120], [590, -20], [520, -110], [380, -140],
      [220, -120], [140, -40], [40, 40], [-80, 90], [-220, 60], [-320, -30],
      [-380, -160], [-480, -250], [-560, -300],
    ], 2),
  },
  {
    id: 'us-texas', name: 'Texas Motor Speedway', short: 'Texas', city: 'Fort Worth',
    country: 'United States', length: 2400, series: ['nascar'],
    aliases: ['texas', 'fort worth'], shape: oval(590, 285, 3.0, 40),
  },
  {
    id: 'us-kansas', name: 'Kansas Speedway', short: 'Kansas', city: 'Kansas City',
    country: 'United States', length: 2400, series: ['nascar'],
    aliases: ['kansas', 'kansas city'], shape: oval(590, 285, 2.9, 30),
  },
  {
    id: 'us-michigan', name: 'Michigan International Speedway', short: 'Michigan', city: 'Brooklyn',
    country: 'United States', length: 3200, series: ['nascar'],
    aliases: ['michigan', 'brooklyn'], shape: oval(800, 360, 3.7, 50),
  },
  {
    id: 'us-pocono', name: 'Pocono Raceway', short: 'Pocono', city: 'Long Pond',
    country: 'United States', length: 4023, series: ['nascar'],
    aliases: ['pocono', 'tricky triangle', 'long pond'],
    shape: poly([[0, -760], [300, -260], [700, 560], [380, 600], [-380, 600], [-700, 560], [-300, -260]], 3),
  },
  {
    id: 'us-dover', name: 'Dover Motor Speedway', short: 'Dover', city: 'Dover',
    country: 'United States', length: 1610, series: ['nascar'],
    aliases: ['dover', 'monster mile'], shape: oval(400, 195, 5.0, 0),
  },
  {
    id: 'us-bristol', name: 'Bristol Motor Speedway', short: 'Bristol', city: 'Bristol',
    country: 'United States', length: 858, series: ['nascar'],
    aliases: ['bristol', 'thunder valley', 'last great colosseum'], shape: oval(215, 105, 3.6, 0),
  },
  {
    id: 'us-martinsville', name: 'Martinsville Speedway', short: 'Martinsville', city: 'Ridgeway',
    country: 'United States', length: 844, series: ['nascar'],
    aliases: ['martinsville', 'paperclip'], shape: oval(210, 105, 5.0, 0),
  },
  {
    id: 'us-richmond', name: 'Richmond Raceway', short: 'Richmond', city: 'Richmond',
    country: 'United States', length: 1207, series: ['nascar'],
    aliases: ['richmond'], shape: oval(300, 145, 4.0, 0),
  },
  {
    id: 'us-new-hampshire', name: 'New Hampshire Motor Speedway', short: 'New Hampshire', city: 'Loudon',
    country: 'United States', length: 1703, series: ['nascar'],
    aliases: ['new hampshire', 'loudon', 'magic mile'], shape: oval(420, 200, 3.8, 0),
  },
  {
    id: 'us-iowa', name: 'Iowa Speedway', short: 'Iowa', city: 'Newton',
    country: 'United States', length: 1400, series: ['nascar', 'indycar'],
    aliases: ['iowa', 'newton'], shape: oval(350, 170, 3.6, 0),
  },
  {
    id: 'us-gateway', name: 'World Wide Technology Raceway', short: 'Gateway', city: 'Madison',
    country: 'United States', length: 2022, series: ['nascar', 'indycar'],
    aliases: ['gateway', 'wwt', 'madison', 'st louis'], shape: oval(480, 250, 3.2, 0),
  },
  {
    id: 'us-homestead', name: 'Homestead-Miami Speedway', short: 'Homestead', city: 'Homestead',
    country: 'United States', length: 2414, series: ['nascar'],
    aliases: ['homestead', 'miami homestead'], shape: oval(600, 280, 2.7, 26),
  },
  {
    id: 'us-nashville-ss', name: 'Nashville Superspeedway', short: 'Nashville Superspeedway', city: 'Lebanon',
    country: 'United States', length: 2145, series: ['nascar'],
    aliases: ['nashville superspeedway', 'lebanon', 'concrete'], shape: oval(520, 250, 4.0, 0),
  },
  {
    id: 'us-milwaukee', name: 'Milwaukee Mile', short: 'Milwaukee', city: 'West Allis',
    country: 'United States', length: 1609, series: ['indycar'],
    aliases: ['milwaukee', 'west allis', 'wisconsin state fair'], shape: oval(400, 200, 3.6, 0),
  },
  {
    id: 'us-phoenix', name: 'Phoenix Raceway', short: 'Phoenix', city: 'Avondale',
    country: 'United States', length: 1645, series: ['nascar', 'indycar'],
    aliases: ['phoenix', 'avondale'],
    shape: poly([
      [-330, -180], [220, -180], [330, -60], [330, 120], [240, 200],
      [120, 200], [40, 130], [-40, 60], [-160, 60], [-260, 120], [-330, 80],
    ], 3),
  },
  {
    id: 'us-darlington', name: 'Darlington Raceway', short: 'Darlington', city: 'Darlington',
    country: 'United States', length: 2010, series: ['nascar'],
    aliases: ['darlington', 'lady in black', 'too tough to tame'],
    shape: poly([
      [-480, -190], [-200, -250], [200, -250], [430, -180], [480, 40],
      [400, 200], [180, 250], [-150, 250], [-380, 200], [-480, 60],
    ], 2),
  },
  {
    id: 'us-bowman-gray', name: 'Bowman Gray Stadium', short: 'Bowman Gray', city: 'Winston-Salem',
    country: 'United States', length: 402, series: ['nascar'],
    aliases: ['bowman gray', 'winston-salem', 'winston salem'], shape: oval(100, 52, 4.5, 0),
  },
  {
    id: 'us-sonoma', name: 'Sonoma Raceway', short: 'Sonoma', city: 'Sonoma',
    country: 'United States', length: 4257, series: ['nascar', 'indycar'],
    aliases: ['sonoma', 'sears point', 'infineon'],
    shape: poly([
      [-420, -180], [-200, -240], [60, -250], [300, -210], [420, -110],
      [440, 40], [380, 150], [260, 190], [300, 260], [220, 320], [90, 300],
      [20, 210], [-80, 230], [-180, 330], [-320, 330], [-410, 230], [-430, 60],
    ], 3),
  },
  {
    id: 'us-chicago', name: 'Chicago Street Course', short: 'Chicago', city: 'Chicago',
    country: 'United States', length: 3510, series: ['nascar'],
    aliases: ['chicago', 'grant park'],
    shape: poly([
      [-470, -210], [470, -210], [480, -80], [340, -60], [330, 120],
      [470, 150], [470, 280], [-100, 280], [-120, 140], [-330, 120],
      [-340, 20], [-470, 0],
    ], 1),
  },

  /* ---- IndyCar ---- */
  {
    id: 'us-st-pete', name: 'Streets of St. Petersburg', short: 'St. Petersburg', city: 'St. Petersburg',
    country: 'United States', length: 2950, series: ['indycar'],
    aliases: ['st pete', 'st. petersburg', 'saint petersburg'],
    shape: poly([
      [-420, -230], [-420, 60], [-300, 150], [-120, 160], [40, 120],
      [200, 140], [420, 60], [430, -120], [300, -220], [80, -230], [-120, -180], [-300, -240],
    ], 1),
  },
  {
    id: 'us-long-beach', name: 'Long Beach Street Circuit', short: 'Long Beach', city: 'Long Beach',
    country: 'United States', length: 3167, series: ['indycar'],
    aliases: ['long beach', 'lbgp'],
    shape: poly([
      [-460, -200], [460, -200], [470, -60], [300, -40], [280, 120],
      [450, 150], [450, 240], [-80, 240], [-100, 120], [-330, 100], [-350, 0], [-460, -20],
    ], 1),
  },
  {
    id: 'us-barber', name: 'Barber Motorsports Park', short: 'Barber', city: 'Birmingham',
    country: 'United States', length: 3800, series: ['indycar'],
    aliases: ['barber', 'birmingham', 'leeds'],
    shape: poly([
      [-400, -180], [-120, -250], [200, -230], [380, -120], [400, 30],
      [300, 120], [160, 100], [100, 200], [-40, 260], [-200, 250], [-260, 140],
      [-180, 40], [-260, -30], [-380, -40],
    ], 3),
  },
  {
    id: 'us-indy-gp', name: 'Indianapolis Motor Speedway Road Course', short: 'Indy Road Course', city: 'Speedway',
    country: 'United States', length: 3900, series: ['indycar'],
    aliases: ['indy road course', 'indianapolis road course', 'indy gp'],
    shape: poly([
      [-700, -240], [-700, 200], [-600, 260], [200, 260], [700, 260],
      [700, -60], [560, -120], [420, -80], [300, -180], [120, -140],
      [0, -40], [-160, -100], [-380, -200], [-560, -250],
    ], 1),
  },
  {
    id: 'us-detroit', name: 'Detroit Street Circuit', short: 'Detroit', city: 'Detroit',
    country: 'United States', length: 2700, series: ['indycar'],
    aliases: ['detroit', 'belle isle', 'renaissance center'],
    shape: poly([
      [-430, -210], [430, -210], [440, -40], [280, -20], [260, 120],
      [430, 160], [430, 250], [-150, 250], [-180, 120], [-350, 90], [-430, 40],
    ], 0),
  },
  {
    id: 'us-road-america', name: 'Road America', short: 'Road America', city: 'Elkhart Lake',
    country: 'United States', length: 6500, series: ['indycar'],
    aliases: ['road america', 'elkhart lake'],
    shape: poly([
      [-400, -420], [-400, 240], [-300, 400], [-100, 430], [80, 380],
      [180, 260], [340, 240], [430, 120], [420, -80], [300, -160],
      [160, -120], [80, -220], [-40, -200], [-140, -320], [-300, -420],
    ], 3),
  },
  {
    id: 'us-mid-ohio', name: 'Mid-Ohio Sports Car Course', short: 'Mid-Ohio', city: 'Lexington',
    country: 'United States', length: 3862, series: ['indycar'],
    aliases: ['mid-ohio', 'mid ohio', 'lexington'],
    shape: poly([
      [-390, -160], [-160, -230], [100, -210], [300, -120], [330, 20],
      [240, 120], [300, 210], [170, 280], [30, 240], [10, 140],
      [-110, 170], [-190, 280], [-330, 260], [-390, 130], [-330, 20],
    ], 3),
  },
  {
    id: 'us-laguna-seca', name: 'WeatherTech Raceway Laguna Seca', short: 'Laguna Seca', city: 'Salinas',
    country: 'United States', length: 3602, series: ['indycar'],
    aliases: ['laguna seca', 'monterey', 'corkscrew'],
    shape: poly([
      [-430, -190], [-200, -250], [40, -230], [180, -150], [160, -40],
      [60, 20], [120, 130], [40, 230], [-90, 260], [-170, 170],
      [-310, 150], [-430, 40],
    ], 3),
  },
  {
    id: 'us-portland', name: 'Portland International Raceway', short: 'Portland', city: 'Portland',
    country: 'United States', length: 3166, series: ['indycar'],
    aliases: ['portland', 'pacific raceways'],
    shape: poly([
      [-420, -200], [-140, -250], [160, -230], [400, -140], [440, 20],
      [380, 160], [200, 230], [60, 180], [-60, 90], [-220, 130], [-380, 120], [-440, -20],
    ], 3),
  },
  {
    id: 'us-toronto', name: 'Exhibition Place Street Circuit', short: 'Toronto', city: 'Toronto',
    country: 'Canada', length: 2898, series: ['indycar'],
    aliases: ['toronto', 'exhibition place', 'honda indy'],
    shape: poly([
      [-430, -220], [430, -220], [440, -60], [250, -40], [230, 100],
      [440, 140], [440, 240], [-120, 240], [-150, 120], [-330, 100], [-430, 30],
    ], 0),
  },

  /* ---- WEC ---- */
  {
    id: 'fr-le-mans', name: 'Circuit de la Sarthe', short: 'Le Mans', city: 'Le Mans',
    country: 'France', length: 13626, series: ['wec'],
    aliases: ['le mans', 'la sarthe', 'sarthe', '24 hours of le mans'],
    shape: poly([
      [-40, -140], [-180, -120], [-380, 20], [-640, 260], [-980, 560],
      [-1180, 800], [-1120, 930], [-940, 960], [-760, 880], [-600, 720],
      [-460, 560], [-330, 470], [-240, 500], [-210, 620], [-260, 720],
      [-400, 780], [-520, 860], [-540, 1010], [-420, 1120], [-260, 1140],
      [-140, 1060], [-120, 920], [-200, 800], [-330, 740], [-460, 640],
      [-560, 480], [-680, 300], [-820, 140], [-1020, -20], [-1220, -140],
      [-1360, -320], [-1380, -520], [-1280, -700], [-1100, -800], [-860, -830],
      [-600, -800], [-380, -720], [-220, -600], [-120, -440], [-80, -280],
    ], 1),
  },
  {
    id: 'jp-fuji', name: 'Fuji Speedway', short: 'Fuji', city: 'Oyama',
    country: 'Japan', length: 4563, series: ['wec'],
    aliases: ['fuji', 'oyama', 'mount fuji'],
    shape: poly([
      [-200, -620], [-200, 320], [-150, 450], [-20, 540], [160, 560],
      [320, 500], [410, 380], [400, 250], [300, 170], [180, 150],
      [120, 60], [180, -30], [300, -80], [380, -180], [380, -320],
      [300, -420], [160, -460], [40, -420], [-20, -330], [-60, -240],
      [-140, -260], [-190, -380],
    ], 2),
  },

  /* ---- Formula 4 road courses ---- */
  {
    id: 'it-misano', name: 'Misano World Circuit Marco Simoncelli', short: 'Misano', city: 'Misano Adriatico',
    country: 'Italy', length: 4226, series: ['f4'],
    aliases: ['misano', 'marco simoncelli', 'misano adriatico'],
    shape: poly([
      [-420, -220], [-120, -260], [200, -250], [420, -180], [440, -20],
      [380, 100], [260, 130], [200, 230], [80, 270], [-60, 230], [-120, 130],
      [-260, 110], [-400, 40],
    ], 3),
  },
  {
    id: 'it-vallelunga', name: 'Autodromo Vallelunga Piero Taruffi', short: 'Vallelunga', city: 'Campagnano',
    country: 'Italy', length: 4085, series: ['f4'],
    aliases: ['vallelunga', 'piero taruffi', 'campagnano'],
    shape: poly([
      [-430, -200], [-180, -260], [80, -240], [300, -160], [380, -40],
      [330, 80], [200, 110], [160, 210], [30, 260], [-100, 230], [-160, 130],
      [-290, 140], [-420, 60],
    ], 3),
  },
  {
    id: 'gb-brands-hatch', name: 'Brands Hatch Grand Prix Circuit', short: 'Brands Hatch', city: 'West Kingsdown',
    country: 'United Kingdom', length: 3908, series: ['f4'],
    aliases: ['brands hatch', 'west kingsdown', 'paddock hill'],
    shape: poly([
      [-330, -240], [-60, -270], [220, -220], [360, -90], [300, 40],
      [180, 60], [160, 170], [40, 250], [-90, 220], [-120, 110],
      [-240, 130], [-340, 40], [-380, -100],
    ], 3),
  },
  {
    id: 'gb-donington', name: 'Donington Park', short: 'Donington', city: 'Castle Donington',
    country: 'United Kingdom', length: 4020, series: ['f4'],
    aliases: ['donington', 'castle donington', 'redgate'],
    shape: poly([
      [-430, -230], [-160, -270], [120, -240], [320, -150], [380, -20],
      [300, 80], [160, 70], [120, 180], [-20, 260], [-170, 230], [-230, 120],
      [-360, 90], [-430, -40],
    ], 3),
  },
  {
    id: 'fr-pau', name: 'Circuit de Pau-Ville', short: 'Pau', city: 'Pau',
    country: 'France', length: 2750, series: ['f4'],
    aliases: ['pau', 'pau-ville', 'pau ville', 'grand prix de pau'],
    shape: poly([
      [-430, -260], [430, -260], [440, -110], [250, -90], [230, 60],
      [440, 90], [440, 250], [-140, 250], [-170, 120], [-340, 100], [-430, 20],
    ], 1),
  },
];

/* ------------------------------------------------------------------ */
/* Build                                                              */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Extra circuits: more ovals, streets and national road courses       */
/* ------------------------------------------------------------------ */

const EXTRA = [
  /* ---- NASCAR: more ovals and the Daytona road course ---- */
  {
    id: 'us-las-vegas-motor', name: 'Las Vegas Motor Speedway', short: 'Las Vegas Motor', city: 'Las Vegas',
    country: 'United States', length: 2414, series: ['nascar'],
    aliases: ['las vegas motor', 'lvms', 'vegas oval'], shape: oval(600, 285, 3.5, 62),
  },
  {
    id: 'us-fontana', name: 'Auto Club Speedway', short: 'Fontana', city: 'Fontana',
    country: 'United States', length: 3220, series: ['nascar'],
    aliases: ['fontana', 'auto club', 'california speedway'],
    squash: [1, 0.8],
    shape: poly([
      [-700, 300], [-320, 330], [140, 325], [520, 305], [700, 250], [775, 120], [790, -40],
      [755, -190], [660, -290], [480, -330], [180, -340], [-160, -335], [-450, -320],
      [-620, -280], [-720, -180], [-755, -30], [-735, 130],
    ], 1),
  },
  {
    id: 'us-chicagoland', name: 'Chicagoland Speedway', short: 'Chicagoland', city: 'Joliet',
    country: 'United States', length: 2414, series: ['nascar'],
    aliases: ['chicagoland', 'joliet'], shape: oval(600, 285, 3.2, 38),
  },
  {
    id: 'us-kentucky', name: 'Kentucky Speedway', short: 'Kentucky', city: 'Sparta',
    country: 'United States', length: 2414, series: ['nascar'],
    aliases: ['kentucky', 'sparta'], shape: oval(600, 285, 3.2, 26),
  },
  {
    id: 'us-north-wilkesboro', name: 'North Wilkesboro Speedway', short: 'North Wilkesboro', city: 'North Wilkesboro',
    country: 'United States', length: 1006, series: ['nascar'],
    aliases: ['north wilkesboro', 'wilkesboro', 'wilkes county'], shape: oval(250, 92, 5.6, 0),
  },
  {
    id: 'us-daytona-road', name: 'Daytona International Speedway Road Course', short: 'Daytona Road', city: 'Daytona Beach',
    country: 'United States', length: 5750, series: ['nascar'],
    aliases: ['daytona road course', 'daytona roval', 'rolex 24'],
    squash: [1, 0.78],
    shape: poly([
      [-700, 330], [-380, 340], [-300, 300], [-285, 215], [-195, 235], [-150, 145], [-45, 135],
      [10, 215], [55, 300], [200, 335], [450, 340], [640, 325], [720, 260], [765, 140],
      [775, -30], [745, -190], [655, -295], [480, -335], [200, -345], [-180, -340],
      [-470, -325], [-640, -290], [-740, -190], [-770, -40], [-750, 140], [-715, 250],
    ], 1),
  },

  /* ---- IndyCar: a street course and a desert road course ---- */
  {
    id: 'us-nashville-street', name: 'Music City Grand Prix Street Circuit', short: 'Nashville Street', city: 'Nashville',
    country: 'United States', length: 2720, series: ['indycar'],
    aliases: ['nashville street', 'music city', 'music city grand prix'],
    squash: [1, 0.7],
    shape: poly([
      [-480, -150], [-100, -182], [200, -174], [430, -152], [468, -60], [470, 60], [400, 130],
      [300, 140], [292, 228], [150, 246], [-60, 240], [-152, 190], [-300, 180], [-432, 142],
      [-482, 40], [-472, -60],
    ], 1),
  },
  {
    id: 'us-thermal', name: 'The Thermal Club', short: 'Thermal', city: 'Thermal',
    country: 'United States', length: 4936, series: ['indycar'],
    aliases: ['thermal', 'thermal club', 'palm springs'],
    squash: [1, 0.8],
    shape: poly([
      [-450, -220], [-260, -270], [-40, -285], [180, -262], [340, -200], [425, -100],
      [440, 20], [395, 130], [300, 190], [230, 265], [110, 290], [-30, 265], [-140, 200],
      [-260, 175], [-380, 110], [-455, 0],
    ], 1),
  },

  /* ---- Formula 4 national road courses ---- */
  {
    id: 'es-aragon', name: 'MotorLand Aragón', short: 'Aragón', city: 'Alcañiz',
    country: 'Spain', length: 5344, series: ['f4'],
    aliases: ['aragon', 'motorland', 'alcaniz'],
    squash: [1, 0.52],
    shape: poly([
      [-478, 132], [-140, 172], [200, 174], [420, 148], [474, 78], [442, -2], [352, -22],
      [332, -102], [394, -182], [352, -264], [252, -282], [182, -222], [162, -132],
      [40, -112], [-100, -122], [-222, -162], [-282, -252], [-382, -272], [-456, -202],
      [-480, -62],
    ], 1),
  },
  {
    id: 'es-navarra', name: 'Circuito de Navarra', short: 'Navarra', city: 'Los Arcos',
    country: 'Spain', length: 3933, series: ['f4'],
    aliases: ['navarra', 'los arcos'],
    squash: [1, 0.78],
    shape: poly([
      [-432, 190], [-100, 216], [180, 206], [360, 176], [432, 110], [420, 20], [350, -40],
      [372, -140], [300, -216], [190, -242], [90, -200], [80, -110], [-40, -90],
      [-140, -140], [-250, -160], [-350, -110], [-420, -30],
    ], 1),
  },
  {
    id: 'es-valencia', name: 'Circuit Ricardo Tormo', short: 'Valencia', city: 'Cheste',
    country: 'Spain', length: 4005, series: ['f4'],
    aliases: ['valencia', 'ricardo tormo', 'cheste'],
    squash: [1, 0.7],
    shape: poly([
      [-450, 120], [-472, 20], [-452, -100], [-380, -182], [-260, -216], [-120, -222],
      [40, -216], [200, -206], [340, -180], [422, -120], [456, -20], [456, 80], [430, 150],
      [340, 172], [300, 226], [180, 232], [120, 180], [20, 176], [-40, 226], [-160, 232],
      [-280, 226], [-400, 196],
    ], 1),
  },
  {
    id: 'es-jerez', name: 'Circuito de Jerez-Ángel Nieto', short: 'Jerez', city: 'Jerez de la Frontera',
    country: 'Spain', length: 4428, series: ['f4'],
    aliases: ['jerez', 'angel nieto', 'jerez de la frontera'],
    squash: [1, 0.68],
    shape: poly([
      [-450, 230], [-150, 250], [120, 246], [330, 216], [430, 150], [456, 50], [430, -60],
      [360, -160], [240, -220], [100, -242], [-40, -236], [-170, -206], [-260, -140],
      [-350, -100], [-430, -120], [-470, -30], [-456, 120],
    ], 1),
  },
  {
    id: 'de-oschersleben', name: 'Motorsport Arena Oschersleben', short: 'Oschersleben', city: 'Oschersleben',
    country: 'Germany', length: 3667, series: ['f4'],
    aliases: ['oschersleben', 'motorsport arena'],
    squash: [1, 0.9],
    shape: poly([
      [-432, 200], [-432, 60], [-390, -60], [-300, -152], [-180, -216], [-40, -242],
      [110, -236], [250, -202], [370, -132], [422, -20], [400, 90], [330, 160], [250, 176],
      [240, 252], [-40, 262], [-232, 256],
    ], 1),
  },
  {
    id: 'de-lausitzring', name: 'Lausitzring', short: 'Lausitzring', city: 'Klettwitz',
    country: 'Germany', length: 4565, series: ['f4'],
    aliases: ['lausitzring', 'lausitz', 'eurospeedway'],
    squash: [1, 0.75],
    shape: poly([
      [-482, 220], [-100, 246], [200, 240], [420, 226], [482, 150], [470, 40], [400, -20],
      [332, -100], [342, -200], [260, -272], [130, -286], [0, -260], [-120, -200],
      [-230, -150], [-340, -150], [-442, -90], [-482, 40],
    ], 1),
  },
  {
    id: 'be-zolder', name: 'Circuit Zolder', short: 'Zolder', city: 'Heusden-Zolder',
    country: 'Belgium', length: 4011, series: ['f4'],
    aliases: ['zolder', 'terlamen', 'heusden-zolder'],
    squash: [1, 0.8],
    shape: poly([
      [-472, 180], [-200, 216], [60, 226], [240, 210], [330, 160], [300, 80], [200, 20],
      [120, -50], [160, -150], [120, -240], [-20, -270], [-160, -246], [-250, -180],
      [-350, -160], [-442, -100], [-472, 40],
    ], 1),
  },
  {
    id: 'cz-most', name: 'Autodrom Most', short: 'Most', city: 'Most',
    country: 'Czechia', length: 4212, series: ['f4'],
    aliases: ['most', 'autodrom most'],
    squash: [1, 0.85],
    shape: poly([
      [-462, 200], [0, 228], [280, 216], [400, 150], [422, 40], [380, -60], [280, -82],
      [262, -170], [300, -262], [180, -302], [60, -262], [0, -170], [-120, -150],
      [-250, -160], [-360, -222], [-442, -150], [-472, -30],
    ], 1),
  },
];

/* ------------------------------------------------------------------ */
/* More circuits: a second batch across every series                    */
/* ------------------------------------------------------------------ */

const MORE = [
  /* ---- NASCAR ---- */
  {
    id: 'us-rockingham', name: 'Rockingham Speedway', short: 'Rockingham', city: 'Rockingham',
    country: 'United States', length: 1636, series: ['nascar'],
    aliases: ['rockingham', 'the rock', 'north carolina motor speedway'],
    shape: oval(430, 240, 3.4, 34),
  },
  {
    id: 'us-nashville-fairgrounds', name: 'Nashville Fairgrounds Speedway', short: 'Fairgrounds', city: 'Nashville',
    country: 'United States', length: 959, series: ['nascar'],
    aliases: ['fairgrounds', 'nashville fairgrounds', 'music city motorplex'],
    shape: oval(252, 120, 3.6, 18),
  },

  /* ---- IndyCar ---- */
  {
    id: 'jp-motegi-road', name: 'Twin Ring Motegi Road Course', short: 'Motegi Road', city: 'Motegi',
    country: 'Japan', length: 4801, series: ['indycar'],
    aliases: ['motegi road course', 'twin ring motegi', 'motegi'],
    squash: [0.62, 1],
    shape: poly([
      [-300, -420], [0, -432], [240, -382], [300, -250], [282, 300], [222, 400], [100, 422],
      [-60, 400], [-122, 300], [-100, 120], [-220, 80], [-322, -40], [-332, -250],
    ], 1),
  },
  {
    id: 'jp-motegi-oval', name: 'Twin Ring Motegi Oval', short: 'Motegi Oval', city: 'Motegi',
    country: 'Japan', length: 2414, series: ['indycar'],
    aliases: ['motegi oval', 'twin ring oval'],
    shape: oval(560, 300, 2.4, 22),
  },

  /* ---- WEC ---- */
  {
    id: 'us-sebring', name: 'Sebring International Raceway', short: 'Sebring', city: 'Sebring',
    country: 'United States', length: 6019, series: ['wec'],
    aliases: ['sebring', 'sebring 12 hours', 'airfield'],
    squash: [1, 0.8],
    shape: poly([
      [-482, -222], [-182, -262], [120, -256], [382, -226], [470, -140], [470, -20],
      [390, 42], [400, 152], [300, 216], [150, 222], [100, 142], [0, 122], [-120, 162],
      [-200, 242], [-330, 242], [-422, 192], [-472, 60], [-492, -80],
    ], 0),
  },

  /* ---- Formula 4 ---- */
  {
    id: 'fr-nogaro', name: 'Circuit Paul Armagnac', short: 'Nogaro', city: 'Nogaro',
    country: 'France', length: 3636, series: ['f4'],
    aliases: ['nogaro', 'paul armagnac'],
    squash: [1, 0.72],
    shape: poly([
      [-432, 150], [-140, 192], [140, 192], [350, 162], [432, 90], [420, -10], [330, -60],
      [300, -160], [200, -232], [60, -242], [-70, -200], [-140, -122], [-250, -110],
      [-340, -172], [-420, -110], [-442, 20],
    ], 1),
  },
  {
    id: 'fr-dijon', name: 'Circuit de Dijon-Prenois', short: 'Dijon', city: 'Prenois',
    country: 'France', length: 3801, series: ['f4'],
    aliases: ['dijon', 'dijon-prenois', 'prenois'],
    squash: [1, 0.62],
    shape: poly([
      [-442, -190], [-280, -252], [-80, -262], [120, -236], [300, -170], [390, -70],
      [402, 42], [342, 142], [230, 192], [140, 150], [80, 60], [-30, 40], [-120, 112],
      [-220, 172], [-330, 162], [-422, 92], [-462, -40],
    ], 1),
  },
  {
    id: 'de-sachsenring', name: 'Sachsenring', short: 'Sachsenring', city: 'Hohenstein-Ernstthal',
    country: 'Germany', length: 3671, series: ['f4'],
    aliases: ['sachsenring', 'hohenstein-ernstthal'],
    squash: [1, 0.85],
    shape: poly([
      [-332, -200], [-90, -252], [140, -242], [300, -172], [342, -60], [290, 40], [322, 130],
      [230, 216], [80, 242], [-60, 210], [-142, 130], [-250, 140], [-342, 80], [-380, -40],
      [-372, -130],
    ], 1),
  },
  {
    id: 'nl-assen', name: 'TT Circuit Assen', short: 'Assen', city: 'Assen',
    country: 'Netherlands', length: 4542, series: ['f4'],
    aliases: ['assen', 'tt circuit', 'cathedral of speed'],
    squash: [1, 0.6],
    shape: poly([
      [-472, 180], [-200, 216], [80, 222], [300, 202], [400, 142], [432, 40], [400, -60],
      [330, -82], [300, -182], [210, -252], [80, -266], [-50, -232], [-130, -150],
      [-240, -130], [-340, -172], [-432, -120], [-472, -20], [-472, 80],
    ], 1),
  },
  {
    id: 'gb-oulton-park', name: 'Oulton Park', short: 'Oulton Park', city: 'Little Budworth',
    country: 'United Kingdom', length: 4311, series: ['f4'],
    aliases: ['oulton park', 'oulton', 'little budworth'],
    squash: [1, 0.8],
    shape: poly([
      [-422, -170], [-200, -232], [20, -236], [220, -200], [342, -130], [362, -30],
      [300, 40], [322, 130], [230, 202], [100, 216], [-20, 180], [-100, 100], [-210, 80],
      [-300, 142], [-392, 110], [-442, 20], [-442, -80],
    ], 1),
  },
  {
    id: 'gb-snetterton', name: 'Snetterton Circuit', short: 'Snetterton', city: 'Norwich',
    country: 'United Kingdom', length: 4779, series: ['f4'],
    aliases: ['snetterton', 'norwich'],
    squash: [1, 0.78],
    shape: poly([
      [-452, -160], [-452, 140], [-382, 190], [-100, 196], [60, 150], [120, 60], [230, 40],
      [300, -20], [282, -120], [180, -182], [40, -182], [-40, -122], [-150, -142],
      [-260, -192], [-382, -202],
    ], 1),
  },
  {
    id: 'gb-thruxton', name: 'Thruxton Circuit', short: 'Thruxton', city: 'Andover',
    country: 'United Kingdom', length: 3793, series: ['f4'],
    aliases: ['thruxton', 'andover', 'church'],
    squash: [1, 0.62],
    shape: poly([
      [-422, -130], [-300, -216], [-120, -246], [60, -242], [240, -212], [362, -142],
      [402, -30], [372, 80], [280, 150], [150, 182], [20, 176], [-60, 120], [-150, 110],
      [-230, 162], [-332, 150], [-412, 80], [-442, -30],
    ], 1),
  },
  {
    id: 'cz-brno', name: 'Masaryk Circuit', short: 'Brno', city: 'Brno',
    country: 'Czechia', length: 5403, series: ['f4'],
    aliases: ['brno', 'masaryk', 'automotodrom brno'],
    squash: [1, 0.7],
    shape: poly([
      [-472, 190], [-150, 222], [130, 222], [330, 202], [432, 130], [442, 30], [370, -40],
      [280, -52], [240, -142], [150, -222], [20, -242], [-110, -212], [-200, -142],
      [-310, -122], [-400, -172], [-462, -100], [-476, 40],
    ], 1),
  },
  {
    id: 'sk-slovakia-ring', name: 'Slovakia Ring', short: 'Slovakia Ring', city: 'Orechová Potôň',
    country: 'Slovakia', length: 5922, series: ['f4'],
    aliases: ['slovakia ring', 'orechova poton', 'slovakiaring'],
    squash: [1, 0.72],
    shape: poly([
      [-452, -30], [-380, -172], [-240, -242], [-60, -252], [130, -222], [290, -152],
      [402, -42], [432, 80], [380, 182], [260, 216], [180, 150], [110, 60], [0, 40],
      [-110, 90], [-220, 192], [-342, 212], [-432, 130],
    ], 1),
  },
  {
    id: 'es-jarama', name: 'Circuito del Jarama', short: 'Jarama', city: 'San Sebastián de los Reyes',
    country: 'Spain', length: 3840, series: ['f4'],
    aliases: ['jarama', 'circuito del jarama'],
    squash: [1, 0.7],
    shape: poly([
      [-402, -150], [-220, -216], [-20, -226], [170, -196], [300, -130], [342, -30],
      [290, 50], [200, 70], [160, 162], [60, 216], [-60, 206], [-120, 130], [-220, 120],
      [-300, 182], [-392, 150], [-432, 50],
    ], 1),
  },
  {
    id: 'fr-ledenon', name: 'Circuit de Lédenon', short: 'Lédenon', city: 'Lédenon',
    country: 'France', length: 3156, series: ['f4'],
    aliases: ['ledenon', 'circuit de ledenon'],
    squash: [1, 0.8],
    shape: poly([
      [-432, 120], [-250, 192], [-60, 202], [110, 176], [220, 110], [232, 10], [170, -60],
      [182, -160], [90, -232], [-40, -242], [-150, -192], [-230, -122], [-330, -112],
      [-412, -172], [-452, -60],
    ], 1),
  },
];

/* ------------------------------------------------------------------ */
/* MORE_TRACKS — historic, national and club venues                    */
/* ------------------------------------------------------------------ */

const MORE_TRACKS = EXTRA_TRACKS;

const geojson = JSON.parse(readFileSync(resolve(root, 'public/assets/tracks/circuits.geojson'), 'utf8'));
const circuits = [];

for (const feature of geojson.features) {
  const meta = FROM_GEOJSON[feature.properties.id];
  if (!meta) continue;
  const coords = feature.geometry.coordinates;
  const ring = coords.map(([lon, lat]) => [lon, lat]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) ring.pop();
  if (ring.length < 12) continue;
  let meters = project(ring);
  meters = simplifyRing(meters, 3.0);
  const [name, short, city, country, extraAliases, series] = meta;
  circuits.push({
    id: feature.properties.id,
    name,
    short,
    city,
    country,
    length: Number(feature.properties.length),
    series,
    aliases: extraAliases,
    source: 'gps',
    points: normalize(meters),
  });
}

for (const entry of [...SCHEMATIC, ...EXTRA, ...MORE, ...MORE_TRACKS]) {
  const [sx, sy] = entry.squash ?? [1, 1];
  const control = entry.shape ?? poly(entry.points, entry.passes ?? 1);
  circuits.push({
    id: entry.id,
    name: entry.name,
    short: entry.short,
    city: entry.city,
    country: entry.country,
    length: entry.length,
    series: entry.series,
    aliases: entry.aliases,
    source: 'schematic',
    points: normalize(control.map(([x, y]) => [x * sx, y * sy])),
  });
}

for (const circuit of circuits) {
  const points = circuit.points;
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.abs(first[0] - last[0]) < 0.2 && Math.abs(first[1] - last[1]) < 0.2) points.pop();
  circuit.points = points.map(([x, y]) => [Math.round(x), Math.round(y)]);
}

circuits.sort((a, b) => a.name.localeCompare(b.name));

const out = {
  generated: '2026-11-20',
  note: 'Centerline-only outlines normalised to a 1000 box. GPS traces from circuits.geojson; NASCAR/IndyCar/WEC additions are schematic.',
  circuits,
};

mkdirSync(resolve(root, 'games/trace/data'), { recursive: true });
writeFileSync(resolve(root, 'games/trace/data/circuits.json'), JSON.stringify(out));

const counts = new Map();
for (const c of circuits) for (const s of c.series) counts.set(s, (counts.get(s) ?? 0) + 1);
console.log(`circuits: ${circuits.length}`);
console.log(
  [...counts.entries()]
    .sort()
    .map(([s, n]) => `${s}:${n}`)
    .join('  '),
);
console.log(`bytes: ${JSON.stringify(out).length}`);
