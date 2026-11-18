import * as THREE from 'three';
import type { RacingLineMode } from '../physics/settings';
import { inRangeWrap } from '../tracks/trackMath';
import type { TrackData, TrackSample } from '../tracks/types';
import { createAsphaltTexture, createSignTexture } from '../garage/liveryTextures';

const ASPHALT_TEXTURE = createAsphaltTexture();

function basisFor(sample: TrackSample): THREE.Matrix4 {
  return new THREE.Matrix4().makeBasis(sample.right, sample.up, sample.tangent);
}

function placeOnTrack(obj: THREE.Object3D, sample: TrackSample, lateral: number, lift = 0): void {
  obj.position.copy(sample.pos).addScaledVector(sample.right, lateral).addScaledVector(sample.up, lift);
  obj.quaternion.setFromRotationMatrix(basisFor(sample));
}

function buildRibbon(
  track: TrackData,
  offset: number,
  width: number,
  lift: number,
  material: THREE.Material,
  uvScale = 7,
): THREE.Mesh {
  const samples = track.samples;
  const n = samples.length;
  const positions = new Float32Array((n + 1) * 2 * 3);
  const uvs = new Float32Array((n + 1) * 2 * 2);
  const indices: number[] = [];
  let distance = 0;
  for (let i = 0; i <= n; i++) {
    const s = samples[i % n];
    if (i > 0) distance += samples[(i - 1) % n].pos.distanceTo(s.pos);
    const a = new THREE.Vector3().copy(s.pos).addScaledVector(s.right, offset - width / 2).addScaledVector(s.up, lift);
    const b = new THREE.Vector3().copy(s.pos).addScaledVector(s.right, offset + width / 2).addScaledVector(s.up, lift);
    positions.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    uvs.set([0, distance / uvScale, 1, distance / uvScale], i * 4);
    if (i < n) {
      const k = i * 2;
      indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return mesh;
}

function buildKerbs(track: TrackData): THREE.Mesh {
  const samples = track.samples;
  const n = samples.length;
  const positions: number[] = [];
  const colors: number[] = [];
  const red = new THREE.Color('#d3161d');
  const white = new THREE.Color('#f2f2f2');
  const addQuad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: THREE.Color) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, b.x, b.y, b.z, d.x, d.y, d.z, c.x, c.y, c.z);
    for (let i = 0; i < 6; i++) colors.push(color.r, color.g, color.b);
  };
  for (const side of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      const next = samples[(i + 1) % n];
      if (!s.kerb && !next.kerb) continue;
      const edge = s.width / 2;
      const inner = edge - 0.04;
      const outer = edge + 0.95;
      const a = new THREE.Vector3().copy(s.pos).addScaledVector(s.right, side * inner).addScaledVector(s.up, 0.028);
      const b = new THREE.Vector3().copy(s.pos).addScaledVector(s.right, side * outer).addScaledVector(s.up, 0.028);
      const c = new THREE.Vector3().copy(next.pos).addScaledVector(next.right, side * inner).addScaledVector(next.up, 0.028);
      const d = new THREE.Vector3().copy(next.pos).addScaledVector(next.right, side * outer).addScaledVector(next.up, 0.028);
      const color = Math.floor(i / 2) % 2 === 0 ? red : white;
      addQuad(a, b, c, d, color);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.02 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function buildBarriers(track: TrackData): THREE.Mesh {
  const samples = track.samples;
  const n = samples.length;
  const positions: number[] = [];
  const colors: number[] = [];
  const white = new THREE.Color('#e8e8e8');
  const red = new THREE.Color('#c8102e');
  const blue = new THREE.Color('#1f4fa3');
  const pushQuad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: THREE.Color) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, b.x, b.y, b.z, d.x, d.y, d.z, c.x, c.y, c.z);
    for (let k = 0; k < 6; k++) colors.push(color.r, color.g, color.b);
  };
  for (const side of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      const next = samples[(i + 1) % n];
      const inPit = inRangeWrap(s.u, track.pitEntryU, track.pitExitU);
      if (side > 0 && inPit) continue;
      const offset = side * (s.width / 2 + 3.4);
      const height = 1.15;
      const a = new THREE.Vector3().copy(s.pos).addScaledVector(s.right, offset);
      const b = new THREE.Vector3().copy(s.pos).addScaledVector(s.right, offset).addScaledVector(s.up, height);
      const c = new THREE.Vector3().copy(next.pos).addScaledVector(next.right, offset);
      const d = new THREE.Vector3().copy(next.pos).addScaledVector(next.right, offset).addScaledVector(next.up, height);
      const band = Math.floor(i / 10) % 4;
      const color = band === 0 ? red : band === 2 ? blue : white;
      pushQuad(a, b, c, d, color);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.1, side: THREE.DoubleSide });
  return new THREE.Mesh(geo, mat);
}

function buildPitLane(track: TrackData): THREE.Group {
  const group = new THREE.Group();
  const pts = track.pitLane;
  if (pts.length < 2) return group;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const width = 9;
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i];
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const tangent = new THREE.Vector3().subVectors(next, prev).setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), tangent).normalize();
    const a = new THREE.Vector3().copy(cur).addScaledVector(right, -width / 2);
    const b = new THREE.Vector3().copy(cur).addScaledVector(right, width / 2);
    positions.push(a.x, a.y + 0.03, a.z, b.x, b.y + 0.03, b.z);
    uvs.push(0, i / 4, 1, i / 4);
    if (i < pts.length - 1) {
      const k = i * 2;
      indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: ASPHALT_TEXTURE, roughness: 0.92 })));

  // Pit wall, garages and a lit pit box marker.
  const boxSample = track.samples[Math.round(track.pitBoxU * track.samples.length) % track.samples.length];
  const wallMat = new THREE.MeshStandardMaterial({ color: '#cfd2d6', roughness: 0.55, metalness: 0.2 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#1a1e26', roughness: 0.4, metalness: 0.35 });
  const garageGroup = new THREE.Group();
  placeOnTrack(garageGroup, boxSample, track.width / 2 + 10.0, 0);
  // Long along the pit lane (local Z), shallow across it (local X).
  const row = new THREE.Mesh(new THREE.BoxGeometry(8, 5.2, 44), darkMat);
  row.position.set(5.2, 2.6, 0);
  garageGroup.add(row);
  for (let i = 0; i < 9; i++) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.2, 2.7), new THREE.MeshStandardMaterial({ color: '#2c3542', roughness: 0.35, metalness: 0.35 }));
    door.position.set(1.15, 1.6, -16 + i * 4.0);
    garageGroup.add(door);
  }
  const roofLine = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 44), new THREE.MeshStandardMaterial({ color: '#e10600', emissive: '#e10600', emissiveIntensity: 0.5 }));
  roofLine.position.set(1.1, 5.1, 0);
  garageGroup.add(roofLine);
  group.add(garageGroup);

  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.0, 34), wallMat);
  wall.position.copy(boxSample.pos).addScaledVector(boxSample.right, track.width / 2 + 8.4);
  wall.quaternion.setFromRotationMatrix(basisFor(boxSample));
  wall.position.y += 0.5;
  group.add(wall);
  const pitSign = makeBoard('PIT', '#e10600', '#ffffff');
  pitSign.scale.setScalar(0.7);
  placeOnTrack(pitSign, boxSample, track.width / 2 + 10.5, 2.2);
  group.add(pitSign);
  return group;
}

function makeBoard(text: string, bg: string, fg: string): THREE.Group {
  const group = new THREE.Group();
  const tex = createSignTexture(text, bg, fg);
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), mat);
  panel.position.y = 1.55;
  panel.rotation.y = Math.PI;
  group.add(panel);
  const legMat = new THREE.MeshStandardMaterial({ color: '#50555c', metalness: 0.6, roughness: 0.4 });
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.3, 0.06), legMat);
    leg.position.set(side * 0.5, 0.65, 0);
    group.add(leg);
  }
  return group;
}

function addStartGantry(group: THREE.Group, track: TrackData): void {
  const sample = track.samples[0];
  const gantry = new THREE.Group();
  placeOnTrack(gantry, sample, 0, 0);
  const postMat = new THREE.MeshStandardMaterial({ color: '#30353d', metalness: 0.65, roughness: 0.35 });
  const span = track.width + 4;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 0.55, 0.6), postMat);
  beam.position.y = 6.1;
  gantry.add(beam);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.42, 6.2, 0.42), postMat);
    post.position.set(side * span * 0.5, 3.1, 0);
    gantry.add(post);
  }
  const signTex = createSignTexture('APEX\nGP 2026', '#080a0f', '#ffffff');
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(4.8, 4.8),
    new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false, side: THREE.DoubleSide }),
  );
  sign.position.set(0, 4.9, -0.32);
  sign.rotation.y = Math.PI;
  gantry.add(sign);

  // Checkered start/finish strip.
  const check = document.createElement('canvas');
  check.width = 256;
  check.height = 64;
  const ctx = check.getContext('2d');
  if (ctx) {
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 4; y++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#f5f5f5' : '#121417';
        ctx.fillRect(x * 16, y * 16, 16, 16);
      }
    }
  }
  const checkTex = new THREE.CanvasTexture(check);
  checkTex.colorSpace = THREE.SRGBColorSpace;
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(track.width, 1.3),
    new THREE.MeshBasicMaterial({ map: checkTex, side: THREE.DoubleSide }),
  );
  strip.rotation.x = -Math.PI / 2;
  strip.position.set(0, 0.035, 0.4);
  gantry.add(strip);
  group.add(gantry);
}

function addBrakingBoards(group: THREE.Group, track: TrackData): void {
  const ds = track.length / track.samples.length;
  const major = track.corners.filter((c) => c.radius < 190).slice(0, 7);
  for (const corner of major) {
    for (const distance of [300, 200, 100]) {
      const back = Math.round(distance / ds);
      const idx = (corner.index - back + track.samples.length) % track.samples.length;
      const sample = track.samples[idx];
      const board = makeBoard(String(distance), distance === 100 ? '#e10600' : '#f8f8f8', distance === 100 ? '#ffffff' : '#0a0b0d');
      const side = corner.direction;
      placeOnTrack(board, sample, side * (sample.width / 2 + 2.4), 0);
      board.scale.setScalar(distance === 100 ? 0.9 : 0.8);
      group.add(board);
    }
  }
}

function addDrsBoards(group: THREE.Group, track: TrackData): void {
  for (const zone of track.drsZones) {
    const idx = Math.round(zone.start * track.samples.length) % track.samples.length;
    const sample = track.samples[idx];
    const board = makeBoard('DRS', '#0b1f3a', '#38e8ff');
    placeOnTrack(board, sample, sample.width / 2 + 2.8, 0);
    group.add(board);
    // Painted DRS line across the asphalt.
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(track.width, 0.35),
      new THREE.MeshBasicMaterial({ color: '#38e8ff', transparent: true, opacity: 0.6 }),
    );
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.045, 0);
    const holder = new THREE.Group();
    placeOnTrack(holder, sample, 0, 0);
    holder.add(line);
    group.add(holder);
  }
}

function addOverpass(group: THREE.Group, track: TrackData): void {
  if (!track.overpass) return;
  const sample = track.samples[track.overpass.index];
  const concrete = new THREE.MeshStandardMaterial({ color: '#8f9197', roughness: 0.85, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: '#4b4e55', roughness: 0.8 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(15, 0.9, 60), concrete);
  deck.position.copy(sample.pos).addScaledVector(sample.up, -0.55);
  deck.quaternion.setFromRotationMatrix(basisFor(sample));
  group.add(deck);
  for (const side of [-1, 1]) {
    for (const along of [-18, 18]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.1, Math.max(1, sample.pos.y - 1), 12), dark);
      const p = new THREE.Vector3().copy(sample.pos).addScaledVector(sample.right, side * 6.2).addScaledVector(sample.tangent, along);
      pillar.position.set(p.x, Math.max(0.5, sample.pos.y / 2 - 0.5), p.z);
      group.add(pillar);
    }
  }
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.1, 60), new THREE.MeshStandardMaterial({ color: '#dfe2e5', roughness: 0.5 }));
    rail.position.copy(sample.pos).addScaledVector(sample.right, side * 7.2).addScaledVector(sample.up, 0.6);
    rail.quaternion.setFromRotationMatrix(basisFor(sample));
    group.add(rail);
  }
}

function addPitEntryLines(group: THREE.Group, track: TrackData): void {
  const mat = new THREE.MeshBasicMaterial({ color: '#f2f2f2', transparent: true, opacity: 0.75 });
  for (const u of [track.pitEntryU, track.pitExitU]) {
    const sample = track.samples[Math.round(u * track.samples.length) % track.samples.length];
    const line = new THREE.Mesh(new THREE.PlaneGeometry(track.width * 0.9, 1.4), mat);
    line.rotation.x = -Math.PI / 2;
    const holder = new THREE.Group();
    placeOnTrack(holder, sample, 0, 0);
    holder.add(line);
    group.add(holder);
  }
}

export function buildTrackGroup(track: TrackData): THREE.Group {
  const group = new THREE.Group();
  group.name = 'circuit';

  const asphalt = new THREE.MeshStandardMaterial({
    map: ASPHALT_TEXTURE,
    color: track.night ? '#8d9096' : '#ffffff',
    roughness: 0.93,
    metalness: 0.02,
  });
  group.add(buildRibbon(track, 0, track.width, 0.01, asphalt, 7));

  // Run-off aprons.
  const runoffMat = new THREE.MeshStandardMaterial({
    color: track.night ? '#2c2f35' : '#5a4630',
    roughness: 0.98,
  });
  for (const side of [-1, 1]) {
    group.add(buildRibbon(track, side * (track.width / 2 + 3.0), 6.0, -0.01, runoffMat, 18));
  }

  const white = new THREE.MeshStandardMaterial({ color: '#efefef', roughness: 0.6 });
  for (const side of [-1, 1]) {
    group.add(buildRibbon(track, side * (track.width / 2 - 0.22), 0.14, 0.022, white, 4));
  }

  group.add(buildKerbs(track));
  group.add(buildBarriers(track));
  group.add(buildPitLane(track));
  addStartGantry(group, track);
  addBrakingBoards(group, track);
  addDrsBoards(group, track);
  addOverpass(group, track);
  addPitEntryLines(group, track);
  return group;
}

export function buildRacingLineMesh(track: TrackData, mode: RacingLineMode): THREE.Object3D | null {
  if (mode === 'off') return null;
  const samples = track.samples;
  const n = samples.length;
  const positions: number[] = [];
  const colors: number[] = [];
  const green = new THREE.Color('#21ff9d');
  const yellow = new THREE.Color('#ffe04a');
  const red = new THREE.Color('#ff2e2e');
  const color = new THREE.Color();
  const pushVertex = (p: THREE.Vector3, c: THREE.Color) => {
    positions.push(p.x, p.y, p.z);
    colors.push(c.r, c.g, c.b);
  };
  for (let i = 0; i < n; i++) {
    const next = samples[(i + 1) % n];
    const s = samples[i];
    const braking = Math.max(track.racingLine.braking[i], track.racingLine.braking[(i + 1) % n]);
    const show = mode === 'full' || braking > 0.015 || s.radius < 260 || next.radius < 260;
    if (!show) continue;
    const t = Math.min(1, braking * 1.8);
    color.copy(green).lerp(yellow, Math.min(1, t * 2));
    if (t > 0.5) color.lerp(red, (t - 0.5) * 2);
    const offA = track.racingLine.offsets[i];
    const offB = track.racingLine.offsets[(i + 1) % n];
    const a1 = new THREE.Vector3().copy(s.pos).addScaledVector(s.right, offA - 0.09).addScaledVector(s.up, 0.055);
    const a2 = new THREE.Vector3().copy(s.pos).addScaledVector(s.right, offA + 0.09).addScaledVector(s.up, 0.055);
    const b1 = new THREE.Vector3().copy(next.pos).addScaledVector(next.right, offB - 0.09).addScaledVector(next.up, 0.055);
    const b2 = new THREE.Vector3().copy(next.pos).addScaledVector(next.right, offB + 0.09).addScaledVector(next.up, 0.055);
    pushVertex(a1, color);
    pushVertex(b1, color);
    pushVertex(a2, color);
    pushVertex(b1, color);
    pushVertex(b2, color);
    pushVertex(a2, color);
  }
  if (positions.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  return mesh;
}
