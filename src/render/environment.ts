import * as THREE from 'three';
import { createGravelTexture, createGrassTexture } from '../garage/liveryTextures';
import type { TrackData } from '../tracks/types';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

type Palette = 'park' | 'desert' | 'urban' | 'forest';

function paletteFor(track: TrackData): Palette {
  const key = `${track.id} ${track.name} ${track.location}`.toLowerCase();
  if (/(vegas|bahrain|sakhir|jeddah|lusail|qatar|abu dhabi|yas marina|madrid)/.test(key)) return 'desert';
  if (/(monaco|singapore|baku|miami|las vegas)/.test(key)) return 'urban';
  if (/(spa|zandvoort|austria|spielberg|nurburg|mugello|imola|portim)/.test(key)) return 'forest';
  return 'park';
}

const GROUND_COLORS: Record<Palette, string> = {
  park: '#3c5030',
  desert: '#88734f',
  urban: '#383d45',
  forest: '#253c27',
};

function skyMaterial(night: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(night ? '#030714' : '#2a6aa8') },
      horizonColor: { value: new THREE.Color(night ? '#101a2c' : '#cfe1ee') },
      bottomColor: { value: new THREE.Color(night ? '#05070b' : '#dbe6e4') },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vPos;
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      void main() {
        float h = normalize(vPos).y;
        vec3 col = mix(bottomColor, horizonColor, smoothstep(-0.18, 0.08, h));
        col = mix(col, topColor, smoothstep(0.02, 0.7, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

function makeCrowdTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#1a1d23';
    ctx.fillRect(0, 0, 256, 128);
    const colors = ['#e9e9e9', '#d94b3d', '#3f7ed8', '#f0c14b', '#4fa86a', '#b05cc7', '#ff7b39'];
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 30; col++) {
        if (Math.random() < 0.18) continue;
        ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
        ctx.fillRect(4 + col * 8.3 + Math.random() * 2, 5 + row * 12, 5.4, 6.5);
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    for (let row = 0; row < 10; row++) ctx.fillRect(0, 2 + row * 12, 256, 1.2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  return tex;
}

function addGrandstands(group: THREE.Group, track: TrackData, crowd: THREE.CanvasTexture): void {
  const mat = new THREE.MeshStandardMaterial({ map: crowd, roughness: 0.82, metalness: 0.03 });
  const frame = new THREE.MeshStandardMaterial({ color: '#7d838c', roughness: 0.6, metalness: 0.35 });
  const us = [0.012, 0.05, 0.1, 0.3, 0.7, 0.9];
  us.forEach((u, index) => {
    const sample = track.samples[Math.round(u * track.samples.length) % track.samples.length];
    const side = index % 2 === 0 ? 1 : -1;
    const stand = new THREE.Group();
    const basis = new THREE.Matrix4().makeBasis(sample.right, sample.up, sample.tangent);
    stand.quaternion.setFromRotationMatrix(basis);
    stand.position.copy(sample.pos).addScaledVector(sample.right, side * (sample.width / 2 + 14));
    const tiers = 5;
    for (let t = 0; t < tiers; t++) {
      const tier = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 26), mat);
      tier.position.set(side * t * 1.2, 0.6 + t * 0.85, 0);
      tier.rotation.z = side * -0.12;
      stand.add(tier);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(8, 0.3, 28), frame);
    roof.position.set(side * 3.2, 6.1, 0);
    stand.add(roof);
    for (const dz of [-12, 12]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6.2, 0.3), frame);
      post.position.set(side * 6.2, 3.1, dz);
      stand.add(post);
    }
    group.add(stand);
  });
}

function addInstanced(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  transforms: THREE.Matrix4[],
  castShadow = false,
): void {
  if (transforms.length === 0) return;
  const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
  transforms.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  group.add(mesh);
}

function addScenery(group: THREE.Group, track: TrackData, palette: Palette): void {
  const rng = mulberry32(seedFrom(track.id));
  const size = Math.max(track.bounds.maxX - track.bounds.minX, track.bounds.maxZ - track.bounds.minZ);
  const center = track.center;
  const samples = track.samples;

  if (palette === 'urban') {
    const buildingMats = ['#3a4049', '#4c525c', '#2b3038', '#555c66'].map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.72, metalness: 0.18 }),
    );
    const boxes = buildingMats.map(() => [] as THREE.Matrix4[]);
    const lights: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 130; i++) {
      const angle = rng() * Math.PI * 2;
      const radius = size * (0.58 + rng() * 0.95);
      const x = center.x + Math.cos(angle) * radius;
      const z = center.z + Math.sin(angle) * radius;
      let closest = Infinity;
      for (let k = 0; k < samples.length; k += 5) {
        const p = samples[k].pos;
        closest = Math.min(closest, Math.hypot(p.x - x, p.z - z));
        if (closest < 32) break;
      }
      if (closest < 32) continue;
      const height = 12 + rng() * 55;
      const w = 8 + rng() * 16;
      const d = 8 + rng() * 16;
      dummy.position.set(x, height / 2, z);
      dummy.rotation.set(0, rng() * Math.PI, 0);
      dummy.scale.set(w, height, d);
      dummy.updateMatrix();
      boxes[i % boxes.length].push(dummy.matrix.clone());
      if (track.night) {
        dummy.position.set(x, height * 0.55, z + d / 2);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(w * 0.9, 0.15, 0.1);
        dummy.updateMatrix();
        lights.push(dummy.matrix.clone());
      }
    }
    boxes.forEach((transforms, i) => addInstanced(group, new THREE.BoxGeometry(1, 1, 1), buildingMats[i], transforms));
    addInstanced(
      group,
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: '#ffe6a3', toneMapped: false }),
      lights,
    );
    return;
  }

  if (palette === 'desert') {
    const rockMat = new THREE.MeshStandardMaterial({ color: '#8b7658', roughness: 1, flatShading: true });
    const rocks: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 46; i++) {
      const angle = rng() * Math.PI * 2;
      const radius = size * (0.75 + rng() * 0.8);
      const h = 15 + rng() * 60;
      dummy.position.set(center.x + Math.cos(angle) * radius, h / 2 - 4, center.z + Math.sin(angle) * radius);
      dummy.rotation.set(0, rng() * Math.PI, 0);
      dummy.scale.set(h * 0.9, h, h * (0.9 + rng() * 0.3));
      dummy.updateMatrix();
      rocks.push(dummy.matrix.clone());
    }
    addInstanced(group, new THREE.ConeGeometry(1, 1, 6), rockMat, rocks);
    return;
  }

  // Batched trees and bushes: hundreds of objects, only a handful of draws.
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#4a3524', roughness: 0.95 });
  const leafMats = [
    new THREE.MeshStandardMaterial({ color: '#2b4a26', roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ color: '#365b2c', roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ color: '#1f3a20', roughness: 0.95 }),
  ];
  const trunks: THREE.Matrix4[] = [];
  const crowns: THREE.Matrix4[][] = [[], [], []];
  const bushes: THREE.Matrix4[] = [];
  const hills: THREE.Matrix4[] = [];
  const dummy = new THREE.Object3D();
  const count = palette === 'forest' ? 320 : 240;
  for (let i = 0; i < count; i++) {
    const sample = samples[Math.floor(rng() * samples.length)];
    const side = rng() < 0.5 ? -1 : 1;
    const offset = 22 + rng() * 90;
    const x = sample.pos.x + sample.right.x * side * offset;
    const z = sample.pos.z + sample.right.z * side * offset;
    if (Math.hypot(x - center.x, z - center.z) > size * 1.6) continue;
    const h = 4 + rng() * 8;
    const groundY = sample.pos.y * Math.max(0, 1 - (offset - 6) / 115) - 0.06;
    dummy.position.set(x, groundY + h * 0.25, z);
    dummy.rotation.set(0, rng() * Math.PI, 0);
    dummy.scale.set(1, h * 0.5, 1);
    dummy.updateMatrix();
    trunks.push(dummy.matrix.clone());
    dummy.position.set(x, groundY + h * 0.72, z);
    dummy.scale.set(h * 0.55, h, h * 0.55);
    dummy.updateMatrix();
    crowns[i % 3].push(dummy.matrix.clone());
    if (i % 5 === 0) {
      dummy.position.set(x + (rng() - 0.5) * 8, groundY + 0.35, z + (rng() - 0.5) * 8);
      dummy.rotation.set(0, rng() * Math.PI, 0);
      dummy.scale.set(0.7 + rng() * 0.8, 0.45 + rng() * 0.5, 0.7 + rng() * 0.8);
      dummy.updateMatrix();
      bushes.push(dummy.matrix.clone());
    }
  }
  addInstanced(group, new THREE.CylinderGeometry(0.18, 0.26, 1, 5), trunkMat, trunks, true);
  crowns.forEach((transforms, i) => addInstanced(group, new THREE.ConeGeometry(0.34, 1, 6), leafMats[i], transforms, true));
  addInstanced(
    group,
    new THREE.SphereGeometry(1, 7, 5),
    new THREE.MeshStandardMaterial({ color: '#31502b', roughness: 0.95 }),
    bushes,
  );
  const hillMat = new THREE.MeshStandardMaterial({ color: '#3d5237', roughness: 1, flatShading: true });
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2 + rng() * 0.2;
    const radius = size * (1.2 + rng() * 0.5);
    const h = 55 + rng() * 90;
    dummy.position.set(center.x + Math.cos(angle) * radius, h / 2 - 8, center.z + Math.sin(angle) * radius);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(h * 1.7, h, h * 1.7);
    dummy.updateMatrix();
    hills.push(dummy.matrix.clone());
  }
  addInstanced(group, new THREE.ConeGeometry(1, 1, 7), hillMat, hills);
}

function addFloodlights(group: THREE.Group, track: TrackData): THREE.Group {
  const lights = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: '#5f666f', metalness: 0.7, roughness: 0.35 });
  const bulbMat = new THREE.MeshBasicMaterial({ color: '#fff4d6', toneMapped: false });
  const count = 10;
  for (let i = 0; i < count; i++) {
    const sample = track.samples[Math.round((i / count) * track.samples.length) % track.samples.length];
    const side = i % 2 === 0 ? 1 : -1;
    const pole = new THREE.Group();
    const base = sample.pos.clone().addScaledVector(sample.right, side * (sample.width / 2 + 26));
    pole.position.set(base.x, 0, base.z);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.4, 21, 8), poleMat);
    mast.position.y = 10.5;
    pole.add(mast);
    const head = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 0.6), poleMat);
    head.position.y = 21;
    pole.add(head);
    for (let k = -2; k <= 2; k++) {
      const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.12), bulbMat);
      bulb.position.set(k * 0.42, 21, 0.35);
      pole.add(bulb);
    }
    lights.add(pole);
  }
  // A handful of real spotlights, enough to read the track without killing FPS.
  for (let i = 0; i < 6; i++) {
    const sample = track.samples[Math.round((i / 6) * track.samples.length) % track.samples.length];
    const side = i % 2 === 0 ? 1 : -1;
    const spot = new THREE.SpotLight('#fff1cf', 900, 260, 0.55, 0.65, 1.2);
    spot.position.copy(sample.pos).addScaledVector(sample.right, side * (sample.width / 2 + 24));
    spot.position.y = 22;
    spot.target.position.copy(sample.pos);
    spot.castShadow = false;
    lights.add(spot);
    lights.add(spot.target);
  }
  group.add(lights);
  return lights;
}

export function buildEnvironment(track: TrackData, wet = false): THREE.Group {
  const group = new THREE.Group();
  group.name = 'environment';
  const palette = paletteFor(track);
  const night = track.night;
  const size = Math.max(track.bounds.maxX - track.bounds.minX, track.bounds.maxZ - track.bounds.minZ);

  const sky = new THREE.Mesh(new THREE.SphereGeometry(3200, 32, 20), skyMaterial(night));
  group.add(sky);

  if (wet) {
    // Rain reads as streaks, not dots: 900 points spread over 760 m looked like
    // distant snow and were invisible from the cockpit. This field is dense,
    // made of short vertical lines, and follows the car (see RaceRenderer).
    const rainGeo = new THREE.BufferGeometry();
    const rainPos: number[] = [];
    const rainRng = mulberry32(seedFrom(track.id) + 991);
    const spread = 150;
    for (let i = 0; i < 2400; i++) {
      const x = (rainRng() - 0.5) * spread * 2;
      const y = 1 + rainRng() * 55;
      const z = (rainRng() - 0.5) * spread * 2;
      rainPos.push(x, y, z, x - 0.5, y + 1.7, z - 0.12);
    }
    rainGeo.setAttribute('position', new THREE.Float32BufferAttribute(rainPos, 3));
    const rain = new THREE.LineSegments(
      rainGeo,
      new THREE.LineBasicMaterial({ color: '#dceef8', transparent: true, opacity: 0.42, depthWrite: false }),
    );
    rain.name = 'rain';
    rain.position.set(track.center.x, 0, track.center.z);
    rain.frustumCulled = false;
    group.userData.rain = rain;
    group.add(rain);
  }

  if (night) {
    const starGeo = new THREE.BufferGeometry();
    const starPos: number[] = [];
    const rng = mulberry32(seedFrom(track.id) + 77);
    for (let i = 0; i < 1200; i++) {
      const theta = rng() * Math.PI * 2;
      const phi = Math.acos(rng() * 0.9 + 0.05);
      const r = 2600;
      starPos.push(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    group.add(
      new THREE.Points(
        starGeo,
        new THREE.PointsMaterial({ color: '#dfe9ff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.8 }),
      ),
    );
  }

  group.add(new THREE.HemisphereLight(night ? '#1b2b4a' : '#cfe6ff', night ? '#050608' : GROUND_COLORS[palette], night ? 0.75 : 1.15));

  const sun = new THREE.DirectionalLight(night ? '#a9c7ff' : '#fff3dc', night ? 0.9 : 2.4);
  sun.position.set(track.center.x + size * 0.5, Math.max(120, size * 0.7), track.center.z + size * 0.35);
  if (!night) {
    const sunDir = sun.position.clone().sub(track.center).normalize();
    const disc = new THREE.Mesh(
      new THREE.SphereGeometry(42, 20, 12),
      new THREE.MeshBasicMaterial({ color: '#fff4cf', fog: false, toneMapped: false }),
    );
    disc.position.copy(track.center).addScaledVector(sunDir, 3000);
    group.add(disc);
  }
  sun.target.position.copy(track.center);
  sun.castShadow = !night;
  const shadowSize = Math.min(320, size * 0.9 + 120);
  sun.shadow.camera.left = -shadowSize;
  sun.shadow.camera.right = shadowSize;
  sun.shadow.camera.top = shadowSize;
  sun.shadow.camera.bottom = -shadowSize;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 900;
  sun.shadow.mapSize.set(1536, 1536);
  sun.shadow.bias = -0.0006;
  group.add(sun);
  group.add(sun.target);

  if (night) addFloodlights(group, track);
  else {
    const fill = new THREE.DirectionalLight('#b9d7ff', 0.35);
    fill.position.set(track.center.x - size, 160, track.center.z - size);
    group.add(fill);
  }

  // Ground.
  const groundTex = palette === 'desert' ? createGravelTexture() : palette === 'urban' ? null : createGrassTexture();
  if (groundTex) groundTex.repeat.set(palette === 'desert' ? 90 : 180, palette === 'desert' ? 90 : 180);
  const groundMat = new THREE.MeshStandardMaterial({
    map: groundTex,
    color: GROUND_COLORS[palette],
    roughness: 0.98,
    metalness: 0.01,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(5200, 5200), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(track.center.x, -0.06, track.center.z);
  ground.receiveShadow = true;
  group.add(ground);

  addScenery(group, track, palette);
  addGrandstands(group, track, makeCrowdTexture());

  const fogColor = wet ? (night ? '#07101a' : '#9eb3c2') : night ? '#050912' : palette === 'desert' ? '#c6b28d' : '#b9cedb';
  const fog = new THREE.Fog(fogColor, Math.max(220, size * 0.35), Math.max(1200, size * 2.4));
  (group.userData as { fog?: THREE.Fog }).fog = fog;

  if (night) {
    const glow = new THREE.PointLight('#ffb15a', 30, 80, 2);
    glow.position.copy(track.samples[0].pos).add(new THREE.Vector3(0, 4, 0));
    group.add(glow);
  }
  return group;
}
