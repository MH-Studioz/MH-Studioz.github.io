/**
 * Duplicate-outline guard for TRACE.
 *
 * Resamples every centerline in games/trace/data/circuits.json to 128
 * arc-length points, normalises centroid and size, then compares all pairs over
 * rotations (and a mirror). The score is the RMS distance between the two
 * outlines, so 0 is identical. Outlines that read as the same blob at tile size
 * sit well under ~0.05; the current worst pair is 0.0516, so SHAPE_LIMIT leaves
 * a little headroom while still rejecting near-copies.
 *
 * Run: node scripts/check-trace-outlines.mjs [limit]
 * Exits 1 if any pair scores under the limit.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SHAPE_LIMIT = 0.045;
const SAMPLES = 128;
const ROTATIONS = 72;
const DATA = new URL('../games/trace/data/circuits.json', import.meta.url);

function resample(points) {
  const ring = points.concat([points[0]]);
  const lengths = [0];
  for (let i = 1; i < ring.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]));
  }
  const total = lengths[lengths.length - 1] || 1;
  const out = [];
  let segment = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const target = (i / SAMPLES) * total;
    while (segment < lengths.length - 2 && lengths[segment + 1] < target) segment++;
    const span = lengths[segment + 1] - lengths[segment] || 1;
    const t = (target - lengths[segment]) / span;
    const [x1, y1] = ring[segment];
    const [x2, y2] = ring[segment + 1];
    out.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
  }
  return out;
}

function normalise(points) {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of points) {
    cx += x;
    cy += y;
  }
  cx /= points.length;
  cy /= points.length;
  const centered = points.map(([x, y]) => [x - cx, y - cy]);
  let sum = 0;
  for (const [x, y] of centered) sum += x * x + y * y;
  const scale = Math.sqrt(sum / centered.length) || 1;
  return centered.map(([x, y]) => [x / scale, y / scale]);
}

/** Best RMS score over rotations and a mirror; 0 = identical outline. */
function similarity(a, b) {
  let best = Infinity;
  for (let pass = 0; pass < 2; pass++) {
    for (let r = 0; r < ROTATIONS; r++) {
      const angle = (r / ROTATIONS) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      let sum = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const ax = pass ? -a[i][0] : a[i][0];
        const x = ax * cos - a[i][1] * sin;
        const y = ax * sin + a[i][1] * cos;
        const dx = x - b[i][0];
        const dy = y - b[i][1];
        sum += dx * dx + dy * dy;
      }
      if (sum < best) best = sum;
    }
  }
  return Math.sqrt(best / SAMPLES);
}

/**
 * Closest pairs under `limit`, worst first.
 * @param {{id: string, points: number[][]}[]} circuits
 * @param {number} limit
 */
export function findDuplicateOutlines(circuits, limit = SHAPE_LIMIT) {
  const shapes = circuits.map((circuit) => ({
    id: circuit.id,
    points: normalise(resample(circuit.points)),
  }));
  const hits = [];
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const score = similarity(shapes[i].points, shapes[j].points);
      if (score < limit) hits.push({ score, a: shapes[i].id, b: shapes[j].id });
    }
  }
  return hits.sort((x, y) => x.score - y.score);
}

function main() {
  const limit = Number(process.argv[2] ?? SHAPE_LIMIT);
  if (!Number.isFinite(limit) || limit <= 0) {
    console.error(`bad limit: ${process.argv[2]}`);
    process.exit(2);
  }

  const { circuits } = JSON.parse(readFileSync(DATA, 'utf8'));
  const hits = findDuplicateOutlines(circuits, limit);
  const pairs = (circuits.length * (circuits.length - 1)) / 2;

  console.log(`TRACE outlines — ${circuits.length} circuits, ${pairs} pairs`);
  if (hits.length) {
    console.log(`\nFAILED — ${hits.length} pair(s) closer than ${limit}`);
    for (const hit of hits) console.log(`  ✕ ${hit.score.toFixed(4)}  ${hit.a} ~ ${hit.b}`);
    console.log('\nGive one of the pair a different plan (oval corners/lean/bend, or new points) or cut it.');
    process.exit(1);
  }
  console.log(`\nOK — no pair closer than ${limit}.`);
}

const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invoked) main();
