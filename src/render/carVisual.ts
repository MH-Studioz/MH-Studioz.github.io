import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CAR_CLASSES, type CarConfig } from '../garage/carConfig';
import { COMPOUNDS, type CompoundId } from '../physics/tyres';
import { createNumberTexture, createSidewallTexture } from '../garage/liveryTextures';

export interface CarVisualState {
  speed: number;
  steer: number;
  drs: boolean;
  brake: number;
  damage?: { wingFL: number; wingFR: number; floor: number };
  compound?: CompoundId;
}

interface WheelRig {
  pivot: THREE.Group;
  spin: THREE.Object3D;
  front: boolean;
  axis: 'x' | 'z';
  radius: number;
}

interface LiveryUniforms {
  uCarInv: { value: THREE.Matrix4 };
  uMin: { value: THREE.Vector3 };
  uSize: { value: THREE.Vector3 };
  uPrimary: { value: THREE.Color };
  uSecondary: { value: THREE.Color };
  uAccent: { value: THREE.Color };
  uPattern: { value: number };
  uFinish: { value: number };
}

const CAR_LENGTH = 5.6;
const DRIVER_NUMBER_ON_NOSE = true;

let templatePromise: Promise<THREE.Group | null> | null = null;
const SIDEWALL_CACHE = new Map<CompoundId, THREE.CanvasTexture>();

function sidewallTexture(compound: CompoundId): THREE.CanvasTexture {
  const cached = SIDEWALL_CACHE.get(compound);
  if (cached) return cached;
  const tex = createSidewallTexture(compound, COMPOUNDS[compound].color);
  SIDEWALL_CACHE.set(compound, tex);
  return tex;
}

/** Loads the optional high-detail 2026 car; the procedural car is used on failure. */
export function loadCarTemplate(): Promise<THREE.Group | null> {
  if (templatePromise) return templatePromise;
  templatePromise = new Promise((resolve) => {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(
      './assets/models/car.glb',
      (gltf) => {
        gltf.scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            const mesh = o as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.frustumCulled = true;
          }
        });
        resolve(gltf.scene);
      },
      undefined,
      (err) => {
        console.warn('[car] car.glb unavailable, using procedural car.', err);
        resolve(null);
      },
    );
  });
  return templatePromise;
}

function finishParams(finish: CarConfig['livery']['finish']): { roughness: number; metalness: number } {
  if (finish === 'matte') return { roughness: 0.68, metalness: 0.05 };
  if (finish === 'carbon') return { roughness: 0.3, metalness: 0.72 };
  return { roughness: 0.22, metalness: 0.24 };
}

function createLiveryUniforms(config: CarConfig): LiveryUniforms {
  return {
    uCarInv: { value: new THREE.Matrix4() },
    uMin: { value: new THREE.Vector3(-1, 0, -2.8) },
    uSize: { value: new THREE.Vector3(2, 1.3, 5.6) },
    uPrimary: { value: new THREE.Color(config.livery.primary) },
    uSecondary: { value: new THREE.Color(config.livery.secondary) },
    uAccent: { value: new THREE.Color(config.livery.accent) },
    uPattern: { value: ['classic', 'fade', 'chevron', 'halftone', 'minimal'].indexOf(config.livery.pattern) },
    uFinish: { value: config.livery.finish === 'carbon' ? 2 : config.livery.finish === 'matte' ? 1 : 0 },
  };
}

const LIVERY_VERTEX = `
varying vec3 vLiveryPos;
uniform mat4 uCarInv;
`;

const LIVERY_FRAGMENT = `
varying vec3 vLiveryPos;
uniform vec3 uMin;
uniform vec3 uSize;
uniform vec3 uPrimary;
uniform vec3 uSecondary;
uniform vec3 uAccent;
uniform float uPattern;
uniform float uFinish;
`;

const LIVERY_BODY = `
vec3 lp = clamp((vLiveryPos - uMin) / max(uSize, vec3(0.001)), 0.0, 1.0);
float px = abs(lp.x - 0.5) * 2.0;
float py = lp.y;
float pz = lp.z;
vec3 livery = uPrimary;
if (uPattern < 0.5) {
  float stripe = 1.0 - smoothstep(0.035, 0.085, abs(px - 0.62));
  livery = mix(livery, uAccent, stripe * 0.95);
  livery = mix(livery, uSecondary, smoothstep(0.42, 0.0, py) * 0.55);
  float noseBand = smoothstep(0.88, 0.94, pz) * (1.0 - smoothstep(0.94, 0.99, pz));
  livery = mix(livery, uAccent, noseBand * 0.55);
} else if (uPattern < 1.5) {
  livery = mix(uPrimary, uSecondary, (1.0 - smoothstep(0.12, 0.82, pz)) * 0.88);
  livery = mix(livery, uAccent, smoothstep(0.88, 1.0, py) * 0.55);
  livery = mix(livery, uAccent, smoothstep(0.06, 0.0, abs(px - 0.3)) * 0.35);
} else if (uPattern < 2.5) {
  float band = fract(pz * 6.2 + px * 1.15);
  float chev = smoothstep(0.0, 0.05, band) * (1.0 - smoothstep(0.1, 0.19, band));
  livery = mix(livery, uAccent, chev * 0.82 * smoothstep(0.1, 0.55, py));
  livery = mix(livery, uSecondary, (1.0 - py) * 0.35);
} else if (uPattern < 3.5) {
  vec2 grid = vec2(px * 13.0, pz * 27.0 + py * 4.0);
  float dots = smoothstep(0.34, 0.16, length(fract(grid) - 0.5));
  livery = mix(livery, uAccent, dots * 0.5);
  livery = mix(livery, uSecondary, (1.0 - dots) * 0.2);
} else {
  livery = mix(uSecondary, uPrimary, smoothstep(0.08, 0.8, pz));
  livery = mix(livery, uAccent, (1.0 - smoothstep(0.018, 0.055, abs(px - 0.17))) * 0.9);
}
livery *= 1.0 - step(1.5, uFinish) * 0.36;
diffuseColor.rgb = livery;
`;

function createLiveryMaterial(config: CarConfig, uniforms: LiveryUniforms): THREE.MeshStandardMaterial {
  const finish = finishParams(config.livery.finish);
  const mat = new THREE.MeshStandardMaterial({
    // The shader overrides this per-fragment; the base colour keeps the car
    // from flashing white if a driver/context rejects the custom livery shader.
    color: new THREE.Color(config.livery.primary),
    roughness: finish.roughness,
    metalness: finish.metalness,
    envMapIntensity: config.livery.finish === 'gloss' ? 1.3 : 0.7,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCarInv = uniforms.uCarInv;
    shader.uniforms.uMin = uniforms.uMin;
    shader.uniforms.uSize = uniforms.uSize;
    shader.uniforms.uPrimary = uniforms.uPrimary;
    shader.uniforms.uSecondary = uniforms.uSecondary;
    shader.uniforms.uAccent = uniforms.uAccent;
    shader.uniforms.uPattern = uniforms.uPattern;
    shader.uniforms.uFinish = uniforms.uFinish;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${LIVERY_VERTEX}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvLiveryPos = (uCarInv * modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${LIVERY_FRAGMENT}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${LIVERY_BODY}`);
  };
  mat.customProgramCacheKey = () => 'apex-gp-livery-v1';
  return mat;
}

function solidMaterial(color: string, roughness = 0.4, metalness = 0.2): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function roleForNode(name: string): 'body' | 'accent' | 'carbon' | 'titanium' | 'wheel' | 'metal' {
  const n = name.toLowerCase();
  if (n.includes('wheel')) return 'wheel';
  if (n.includes('wing') || n.includes('sidepod')) return n.includes('sidepod') ? 'body' : 'accent';
  if (n.includes('floor') || n.includes('suspension')) return 'carbon';
  if (n.includes('halo')) return 'titanium';
  if (n.includes('exhaust')) return 'metal';
  return 'body';
}

function ancestorName(obj: THREE.Object3D | null): string {
  let cur = obj;
  while (cur) {
    if (cur.name) return cur.name;
    cur = cur.parent;
  }
  return '';
}

function taperedBoxGeometry(wRear: number, wFront: number, hRear: number, hFront: number, len: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(1, 1, len, 2, 2, 10);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const t = z / len + 0.5;
    const w = THREE.MathUtils.lerp(wRear, wFront, t);
    const h = THREE.MathUtils.lerp(hRear, hFront, t);
    pos.setX(i, pos.getX(i) * w);
    pos.setY(i, pos.getY(i) * h);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function tubeBetween(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(radius, radius, len, 8);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

/** One open-wheel car: either the fetched 2026 GLB or the procedural car. */
export class CarVisual {
  readonly group = new THREE.Group();
  readonly config: CarConfig;
  readonly wheels: WheelRig[] = [];
  readonly brakeMaterials: THREE.MeshStandardMaterial[] = [];
  readonly ringMaterials: THREE.MeshStandardMaterial[] = [];
  readonly endplates: THREE.Object3D[] = [];

  private uniforms: LiveryUniforms;
  private modelRoot: THREE.Group | null = null;
  private drsFlap: THREE.Object3D | null = null;
  private drsAxis: 'x' = 'x';
  private drsCurrent = 0;
  private drsMax = Math.PI * (65 / 180);
  private wheelSpin = 0;
  private frontWingNode: THREE.Object3D | null = null;
  private rearWingNode: THREE.Object3D | null = null;
  private helmetVisor: THREE.MeshStandardMaterial | null = null;
  private usingGlb = false;
  private modelScale = 1;
  private mergeAfterBuild = false;
  private readonly lowDetail: boolean;

  constructor(config: CarConfig, template: THREE.Group | null = null, lowDetail = false) {
    this.config = config;
    this.lowDetail = lowDetail;
    this.uniforms = createLiveryUniforms(config);
    const category = CAR_CLASSES[config.carClass].category;
    if (category === 'gt') {
      this.buildGT();
    } else if (category === 'prototype') {
      this.buildPrototype();
    } else if (category === 'kart') {
      this.buildKart();
    } else if (template) {
      try {
        this.buildFromTemplate(template);
      } catch (err) {
        console.warn('[car] GLB setup failed, falling back to procedural.', err);
        this.buildProcedural();
      }
    } else {
      this.buildProcedural();
    }
    this.mergeStaticBody();
    this.group.updateMatrixWorld(true);
    this.addNumberDecals();
    this.updateLiveryBounds();
    this.setCompound(config.livery.compound);
  }

  private getMaterial(kind: 'body' | 'accent' | 'carbon' | 'titanium' | 'wheel' | 'metal' | 'secondary'): THREE.Material {
    const finish = finishParams(this.config.livery.finish);
    switch (kind) {
      case 'body':
        return createLiveryMaterial(this.config, this.uniforms);
      case 'accent':
        return solidMaterial(this.config.livery.accent, finish.roughness, finish.metalness);
      case 'secondary':
        return solidMaterial(this.config.livery.secondary, finish.roughness, finish.metalness);
      case 'carbon':
        return solidMaterial('#14161a', 0.36, 0.58);
      case 'titanium':
        return solidMaterial('#5a5f66', 0.3, 0.85);
      case 'wheel':
        return solidMaterial('#0b0c0e', 0.82, 0.05);
      case 'metal':
        return solidMaterial('#8a8f96', 0.24, 0.95);
    }
  }

  private buildFromTemplate(template: THREE.Group): void {
    this.usingGlb = true;
    const scene = template.clone(true);
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const name = ancestorName(mesh);
      const role = roleForNode(name);
      mesh.material = this.getMaterial(role);
    });

    scene.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(scene);
    let size = box.getSize(new THREE.Vector3());
    if (size.x > size.z) {
      scene.rotation.y = Math.PI / 2;
      scene.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(scene);
      size = box.getSize(new THREE.Vector3());
    }
    const length = Math.max(size.x, size.z, 0.001);
    const scale = CAR_LENGTH / length;
    scene.scale.multiplyScalar(scale);
    scene.updateMatrixWorld(true);

    // Front wing must point at +Z (our forward axis).
    const fw = scene.getObjectByName('front-wing');
    const rw = scene.getObjectByName('rear-wing');
    if (fw && rw) {
      const fwPos = new THREE.Box3().setFromObject(fw).getCenter(new THREE.Vector3());
      const rwPos = new THREE.Box3().setFromObject(rw).getCenter(new THREE.Vector3());
      if (fwPos.z < rwPos.z) {
        scene.rotation.y += Math.PI;
        scene.updateMatrixWorld(true);
      }
    }

    box = new THREE.Box3().setFromObject(scene);
    const center = box.getCenter(new THREE.Vector3());
    scene.position.x -= center.x;
    scene.position.z -= center.z;
    scene.position.y -= box.min.y;
    scene.updateMatrixWorld(true);
    this.modelScale = scene.scale.x || 1;
    this.modelRoot = scene;
    this.group.add(scene);

    // Wrap named wheels so steering and spin never fight each other.
    const wheelNames: Array<[string, boolean]> = [
      ['front-left-wheel', true],
      ['front-right-wheel', true],
      ['rear-left-wheel', false],
      ['rear-right-wheel', false],
    ];
    for (const [name, front] of wheelNames) {
      const node = scene.getObjectByName(name);
      if (!node || !node.parent) continue;
      const parent = node.parent;
      const pivot = new THREE.Group();
      pivot.position.copy(node.position);
      pivot.quaternion.copy(node.quaternion);
      parent.add(pivot);
      pivot.add(node);
      node.position.set(0, 0, 0);
      node.quaternion.identity();
      const worldBox = new THREE.Box3().setFromObject(node);
      const ws = worldBox.getSize(new THREE.Vector3());
      const worldRadius = Math.max(ws.x, ws.y, ws.z) / 2 || 0.36;
      this.addWheelDetails(pivot, front, worldRadius, 'z');
      this.wheels.push({ pivot, spin: node, front, axis: 'z', radius: worldRadius });
    }

    this.frontWingNode = scene.getObjectByName('front-wing') ?? null;
    this.rearWingNode = scene.getObjectByName('rear-wing') ?? null;
    if (this.rearWingNode) {
      this.drsFlap = this.rearWingNode;
      this.drsAxis = 'x';
    }

    const cockpitY = box.max.y * 0.72;
    this.addHelmet(0, cockpitY, 0.22);
    this.addMirrorGlass();

    // The scanned car has no UVs: paint roles come from named nodes and the
    // livery stripe shader works from car-local position.
  }

  private addWheelDetails(pivot: THREE.Group, front: boolean, worldRadius: number, axis: 'x' | 'z'): void {
    const localR = worldRadius / this.modelScale;
    const halfWidth = (front ? 0.17 : 0.2) / this.modelScale;
    const compound = COMPOUNDS[this.config.livery.compound];
    const ringMat = new THREE.MeshStandardMaterial({
      color: compound.color,
      emissive: new THREE.Color(compound.color).multiplyScalar(0.16),
      roughness: 0.45,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });
    this.ringMaterials.push(ringMat);
    for (const side of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(localR * 0.9, 0.011 / this.modelScale, 8, 44), ringMat);
      if (axis === 'z') {
        ring.position.z = side * halfWidth;
      } else {
        ring.rotation.y = Math.PI / 2;
        ring.position.x = side * halfWidth;
      }
      pivot.add(ring);
    }
    const brakeMat = new THREE.MeshStandardMaterial({
      color: '#3a1008',
      emissive: new THREE.Color('#ff4500'),
      emissiveIntensity: 0.2,
      roughness: 0.45,
      metalness: 0.3,
    });
    this.brakeMaterials.push(brakeMat);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(localR * 0.56, localR * 0.56, 0.014 / this.modelScale, 24), brakeMat);
    if (axis === 'z') disc.rotation.x = Math.PI / 2;
    else disc.rotation.z = Math.PI / 2;
    pivot.add(disc);
  }

  private addHelmet(x: number, y: number, z: number): void {
    const helmet = new THREE.Group();
    helmet.position.set(x, y, z);
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.145, 24, 18),
      solidMaterial(this.config.livery.accent, 0.24, 0.35),
    );
    shell.scale.set(1, 1.02, 1.08);
    helmet.add(shell);
    const visorMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.config.livery.visorTint),
      metalness: 0.95,
      roughness: 0.08,
      emissive: new THREE.Color(this.config.livery.visorTint).multiplyScalar(0.15),
    });
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.148, 20, 12, -0.9, 1.8, 1.0, 0.6), visorMat);
    visor.rotation.y = 0;
    helmet.add(visor);
    this.helmetVisor = visorMat;
    this.group.add(helmet);
  }

  private addMirrorGlass(): void {
    const glass = new THREE.MeshStandardMaterial({ color: '#b9c8d2', metalness: 0.9, roughness: 0.1 });
    for (const side of [-1, 1]) {
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.055, 0.02), glass);
      mirror.position.set(side * 0.58, 0.86, 0.55);
      this.group.add(mirror);
    }
  }

  private addWheelRig(
    root: THREE.Group,
    front: boolean,
    x: number,
    z: number,
    width: number,
    radius: number,
  ): void {
    const tireMat = this.getMaterial('wheel');
    const metalMat = this.getMaterial('metal');
    const secondaryMat = this.getMaterial('secondary');
    const steer = new THREE.Group();
    steer.position.set(x, radius, z);
    steer.userData.wheelRig = true;
    root.add(steer);
    const spin = new THREE.Group();
    steer.add(spin);
    const tireGeo = new THREE.CylinderGeometry(radius, radius, width, 28, 1, false);
    tireGeo.rotateZ(Math.PI / 2);
    spin.add(new THREE.Mesh(tireGeo, tireMat));
    const rimGeo = new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width + 0.008, 20);
    rimGeo.rotateZ(Math.PI / 2);
    spin.add(new THREE.Mesh(rimGeo, metalMat));
    if (!this.lowDetail) {
      const sidewallMat = new THREE.MeshStandardMaterial({
        map: sidewallTexture(this.config.livery.compound),
        roughness: 0.74,
        metalness: 0.04,
        side: THREE.DoubleSide,
      });
      this.ringMaterials.push(sidewallMat);
      for (const side of [-1, 1]) {
        const wall = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.92, 32), sidewallMat);
        wall.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        wall.position.x = side * (width / 2 + 0.002);
        spin.add(wall);
      }
      const brakeMat = new THREE.MeshStandardMaterial({
        color: '#411208',
        emissive: new THREE.Color('#ff4d00'),
        emissiveIntensity: 0.25,
        roughness: 0.4,
        metalness: 0.35,
      });
      this.brakeMaterials.push(brakeMat);
      const discGeo = new THREE.CylinderGeometry(radius * 0.52, radius * 0.52, 0.026, 20);
      discGeo.rotateZ(Math.PI / 2);
      const disc = new THREE.Mesh(discGeo, brakeMat);
      steer.add(disc);
      const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.18), secondaryMat);
      caliper.position.set(front ? 0.12 : -0.12, 0.12, 0);
      steer.add(caliper);
    }
    this.wheels.push({ pivot: steer, spin, front, axis: 'x', radius });
  }

  private buildGT(): void {
    this.usingGlb = false;
    this.modelScale = 1;
    this.mergeAfterBuild = true;
    const root = new THREE.Group();
    this.modelRoot = root;
    this.group.add(root);

    const bodyMat = this.getMaterial('body');
    const accentMat = this.getMaterial('accent');
    const secondaryMat = this.getMaterial('secondary');
    const carbonMat = this.getMaterial('carbon');
    const glassMat = new THREE.MeshStandardMaterial({
      color: '#101820',
      roughness: 0.16,
      metalness: 0.65,
      transparent: true,
      opacity: 0.88,
    });

    // Wide, low GT3 silhouette with a proper roof and fenders.
    const floor = new THREE.Mesh(new RoundedBoxGeometry(1.86, 0.16, 4.35, 3, 0.07), carbonMat);
    floor.position.set(0, 0.22, -0.05);
    root.add(floor);
    const shell = new THREE.Mesh(taperedBoxGeometry(1.8, 1.54, 0.68, 0.5, 3.95), bodyMat);
    shell.position.set(0, 0.63, 0.02);
    root.add(shell);
    const hood = new THREE.Mesh(new RoundedBoxGeometry(1.48, 0.2, 1.22, 3, 0.08), bodyMat);
    hood.position.set(0, 0.91, 1.28);
    root.add(hood);
    const cabin = new THREE.Mesh(taperedBoxGeometry(1.46, 1.2, 0.68, 0.52, 1.7), bodyMat);
    cabin.position.set(0, 1.15, -0.35);
    root.add(cabin);
    const roof = new THREE.Mesh(new RoundedBoxGeometry(1.28, 0.1, 1.25, 3, 0.05), bodyMat);
    roof.position.set(0, 1.48, -0.36);
    root.add(roof);

    const windscreen = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.34, 0.05), glassMat);
    windscreen.position.set(0, 1.29, 0.52);
    windscreen.rotation.x = -0.34;
    root.add(windscreen);
    for (const side of [-1, 1]) {
      const window = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.3, 1.02), glassMat);
      window.position.set(side * 0.73, 1.29, -0.3);
      root.add(window);
      const fender = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.34, 1.12, 3, 0.1), bodyMat);
      fender.position.set(side * 0.87, 0.69, 1.35);
      root.add(fender);
      const rearFender = fender.clone();
      rearFender.position.z = -1.35;
      root.add(rearFender);
    }

    // Aero and lights.
    const splitter = new THREE.Mesh(new RoundedBoxGeometry(1.96, 0.06, 0.5, 2, 0.03), carbonMat);
    splitter.position.set(0, 0.22, 2.13);
    root.add(splitter);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.2, 0.06), carbonMat);
    grille.position.set(0, 0.58, 2.16);
    root.add(grille);
    for (const side of [-1, 1]) {
      const headlight = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.13, 0.06),
        new THREE.MeshStandardMaterial({ color: '#eff6ff', emissive: '#bfe0ff', emissiveIntensity: 1.7 }),
      );
      headlight.position.set(side * 0.55, 0.77, 2.17);
      root.add(headlight);
      const mirror = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.09, 0.08, 2, 0.02), accentMat);
      mirror.position.set(side * 0.8, 1.0, 0.34);
      root.add(mirror);
    }
    const tail = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.1, 0.05),
      new THREE.MeshStandardMaterial({ color: '#ff1616', emissive: '#ff0000', emissiveIntensity: 2.1 }),
    );
    tail.position.set(0, 0.72, -2.18);
    root.add(tail);
    const rearWing = new THREE.Group();
    rearWing.position.set(0, 1.15, -2.02);
    root.add(rearWing);
    const rearPlane = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.055, 0.42), accentMat);
    rearWing.add(rearPlane);
    for (const side of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.46, 0.5), secondaryMat);
      plate.position.set(side * 0.91, -0.02, 0.02);
      rearWing.add(plate);
    }
    for (const side of [-1, 1]) {
      const support = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.1), carbonMat);
      support.position.set(side * 0.45, -0.22, -2.0);
      root.add(support);
    }
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.24, 0.48), carbonMat);
    diffuser.position.set(0, 0.24, -2.18);
    root.add(diffuser);

    this.addWheelRig(root, true, -0.86, 1.42, 0.3, 0.34);
    this.addWheelRig(root, true, 0.86, 1.42, 0.3, 0.34);
    this.addWheelRig(root, false, -0.88, -1.4, 0.34, 0.35);
    this.addWheelRig(root, false, 0.88, -1.4, 0.34, 0.35);
    this.addHelmet(0, 1.2, -0.3);
  }

  private buildKart(): void {
    this.usingGlb = false;
    this.modelScale = 1;
    this.mergeAfterBuild = true;
    const root = new THREE.Group();
    this.modelRoot = root;
    this.group.add(root);

    const bodyMat = this.getMaterial('body');
    const accentMat = this.getMaterial('accent');
    const carbonMat = this.getMaterial('carbon');
    const secondaryMat = this.getMaterial('secondary');
    const chromeMat = this.getMaterial('metal');

    const pan = new THREE.Mesh(new RoundedBoxGeometry(0.82, 0.05, 1.55, 2, 0.02), carbonMat);
    pan.position.set(0, 0.18, -0.02);
    root.add(pan);
    const nose = new THREE.Mesh(new RoundedBoxGeometry(0.55, 0.16, 0.5, 3, 0.06), bodyMat);
    nose.position.set(0, 0.28, 0.85);
    root.add(nose);
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.58, 0.44, 3, 0.1), accentMat);
    seat.position.set(0, 0.53, -0.3);
    seat.rotation.x = -0.12;
    root.add(seat);
    for (const side of [-1, 1]) {
      const pod = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.16, 0.72, 3, 0.04), bodyMat);
      pod.position.set(side * 0.42, 0.28, -0.06);
      root.add(pod);
    }

    // Exposed tube frame.
    for (const side of [-1, 1]) {
      root.add(tubeBetween(new THREE.Vector3(side * 0.48, 0.22, -0.78), new THREE.Vector3(side * 0.48, 0.22, 0.72), 0.025, chromeMat));
      root.add(tubeBetween(new THREE.Vector3(side * 0.48, 0.22, 0.72), new THREE.Vector3(side * 0.25, 0.32, 1.02), 0.023, chromeMat));
      root.add(tubeBetween(new THREE.Vector3(side * 0.48, 0.22, -0.78), new THREE.Vector3(side * 0.2, 0.42, -0.9), 0.023, chromeMat));
    }
    root.add(tubeBetween(new THREE.Vector3(-0.48, 0.22, 0.72), new THREE.Vector3(0.48, 0.22, 0.72), 0.023, chromeMat));
    root.add(tubeBetween(new THREE.Vector3(-0.48, 0.22, -0.78), new THREE.Vector3(0.48, 0.22, -0.78), 0.023, chromeMat));
    const bumper = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.025, 6, 20, Math.PI), chromeMat);
    bumper.rotation.x = Math.PI / 2;
    bumper.position.set(0, 0.25, 0.92);
    root.add(bumper);

    const engine = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.36), secondaryMat);
    engine.position.set(0, 0.43, -0.66);
    root.add(engine);
    const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.28, 10), chromeMat);
    cylinder.rotation.z = Math.PI / 2;
    cylinder.position.set(0, 0.52, -0.7);
    root.add(cylinder);
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.42, 10), chromeMat);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(0.12, 0.3, -0.95);
    root.add(exhaust);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.025, 8, 28), carbonMat);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(0, 0.72, 0.35);
    root.add(wheel);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.38, 8), chromeMat);
    column.position.set(0, 0.56, 0.45);
    column.rotation.x = 0.5;
    root.add(column);

    this.addWheelRig(root, true, -0.6, 0.74, 0.12, 0.14);
    this.addWheelRig(root, true, 0.6, 0.74, 0.12, 0.14);
    this.addWheelRig(root, false, -0.62, -0.76, 0.17, 0.15);
    this.addWheelRig(root, false, 0.62, -0.76, 0.17, 0.15);
    this.addHelmet(0, 0.74, -0.3);
  }

  private buildPrototype(): void {
    this.usingGlb = false;
    this.modelScale = 1;
    this.mergeAfterBuild = true;
    const root = new THREE.Group();
    this.modelRoot = root;
    this.group.add(root);

    const bodyMat = this.getMaterial('body');
    const accentMat = this.getMaterial('accent');
    const secondaryMat = this.getMaterial('secondary');
    const carbonMat = this.getMaterial('carbon');
    const glassMat = new THREE.MeshStandardMaterial({
      color: '#0b141d',
      roughness: 0.12,
      metalness: 0.72,
      transparent: true,
      opacity: 0.9,
    });
    const headlightMat = new THREE.MeshStandardMaterial({
      color: '#eff6ff',
      emissive: '#bfe0ff',
      emissiveIntensity: 1.8,
      roughness: 0.3,
    });
    const tailMat = new THREE.MeshStandardMaterial({
      color: '#ff1616',
      emissive: '#ff0000',
      emissiveIntensity: 2.2,
      roughness: 0.3,
    });

    // Low, wide endurance-prototype body with a closed canopy.
    const floor = new THREE.Mesh(new RoundedBoxGeometry(1.96, 0.12, 4.72, 3, 0.06), carbonMat);
    floor.position.set(0, 0.2, -0.02);
    root.add(floor);
    const shell = new THREE.Mesh(taperedBoxGeometry(1.78, 1.92, 0.58, 0.42, 4.42), bodyMat);
    shell.position.set(0, 0.53, 0);
    root.add(shell);
    const nose = new THREE.Mesh(new RoundedBoxGeometry(1.3, 0.23, 1.28, 3, 0.08), bodyMat);
    nose.position.set(0, 0.72, 1.6);
    root.add(nose);
    const deck = new THREE.Mesh(taperedBoxGeometry(1.42, 1.18, 0.28, 0.34, 1.82), bodyMat);
    deck.position.set(0, 0.84, -1.0);
    root.add(deck);

    for (const side of [-1, 1]) {
      const frontFender = new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.31, 1.3, 3, 0.1), bodyMat);
      frontFender.position.set(side * 0.99, 0.59, 1.5);
      root.add(frontFender);
      const rearFender = new THREE.Mesh(new RoundedBoxGeometry(0.47, 0.34, 1.38, 3, 0.11), bodyMat);
      rearFender.position.set(side * 1.0, 0.61, -1.5);
      root.add(rearFender);
      const sidepod = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.33, 1.62, 3, 0.08), secondaryMat);
      sidepod.position.set(side * 0.94, 0.47, 0.02);
      root.add(sidepod);
      const intake = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.19, 0.52), carbonMat);
      intake.position.set(side * 1.04, 0.53, 0.34);
      root.add(intake);
      const divePlane = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.035, 0.5, 2, 0.015), accentMat);
      divePlane.position.set(side * 0.93, 0.3, 2.1);
      root.add(divePlane);
    }

    const cabin = new THREE.Mesh(taperedBoxGeometry(1.28, 1.02, 0.66, 0.44, 1.5), bodyMat);
    cabin.position.set(0, 1.17, -0.18);
    root.add(cabin);
    const roof = new THREE.Mesh(new RoundedBoxGeometry(1.03, 0.11, 1.03, 3, 0.045), bodyMat);
    roof.position.set(0, 1.55, -0.28);
    root.add(roof);
    const windscreen = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.38, 0.045), glassMat);
    windscreen.position.set(0, 1.37, 0.52);
    windscreen.rotation.x = -0.55;
    root.add(windscreen);
    for (const side of [-1, 1]) {
      const window = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.31, 0.86), glassMat);
      window.position.set(side * 0.635, 1.3, -0.16);
      root.add(window);
    }
    const scoop = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.2, 0.55, 3, 0.05), carbonMat);
    scoop.position.set(0, 1.66, -0.55);
    root.add(scoop);

    const splitter = new THREE.Mesh(new RoundedBoxGeometry(2.0, 0.055, 0.58, 2, 0.025), carbonMat);
    splitter.position.set(0, 0.23, 2.24);
    root.add(splitter);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.16, 0.045), carbonMat);
    grille.position.set(0, 0.56, 2.2);
    root.add(grille);
    for (const side of [-1, 1]) {
      const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.11, 0.045), headlightMat);
      headlight.position.set(side * 0.56, 0.76, 2.21);
      root.add(headlight);
    }
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.09, 0.045), tailMat);
    tail.position.set(0, 0.76, -2.22);
    root.add(tail);

    const rearWing = new THREE.Group();
    rearWing.position.set(0, 1.3, -2.08);
    root.add(rearWing);
    const rearPlane = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.055, 0.46), accentMat);
    rearWing.add(rearPlane);
    for (const side of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.55, 0.62), secondaryMat);
      plate.position.set(side * 0.98, -0.02, 0.03);
      rearWing.add(plate);
      const support = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.55, 0.1), carbonMat);
      support.position.set(side * 0.48, 0.95, -2.03);
      root.add(support);
    }
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.24, 0.54), carbonMat);
    diffuser.position.set(0, 0.27, -2.2);
    root.add(diffuser);

    this.addWheelRig(root, true, -0.9, 1.52, 0.33, 0.35);
    this.addWheelRig(root, true, 0.9, 1.52, 0.33, 0.35);
    this.addWheelRig(root, false, -0.94, -1.5, 0.34, 0.36);
    this.addWheelRig(root, false, 0.94, -1.5, 0.34, 0.36);
  }

  private buildProcedural(): void {
    this.usingGlb = false;
    this.mergeAfterBuild = true;
    const root = new THREE.Group();
    this.modelRoot = root;
    this.group.add(root);

    const bodyMat = this.getMaterial('body');
    const accentMat = this.getMaterial('accent');
    const secondaryMat = this.getMaterial('secondary');
    const carbonMat = this.getMaterial('carbon');
    const titaniumMat = this.getMaterial('titanium');
    const tireMat = this.getMaterial('wheel');
    const metalMat = this.getMaterial('metal');

    // Floor and plank.
    const floor = new THREE.Mesh(new RoundedBoxGeometry(1.64, 0.055, 4.55, 2, 0.025), carbonMat);
    floor.position.set(0, 0.14, -0.15);
    root.add(floor);
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.014, 3.4), solidMaterial('#2a2118', 0.9, 0));
    plank.position.set(0, 0.105, -0.25);
    root.add(plank);

    // Monocoque, nose and engine cover.
    const chassis = new THREE.Mesh(taperedBoxGeometry(0.82, 0.52, 0.64, 0.48, 2.25), bodyMat);
    chassis.position.set(0, 0.5, 0.05);
    root.add(chassis);
    const nose = new THREE.Mesh(taperedBoxGeometry(0.48, 0.17, 0.34, 0.15, 1.95), bodyMat);
    nose.position.set(0, 0.4, 1.68);
    root.add(nose);
    const noseTip = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.28, 12), accentMat);
    noseTip.rotation.x = Math.PI / 2;
    noseTip.position.set(0, 0.4, 2.72);
    root.add(noseTip);
    const cover = new THREE.Mesh(taperedBoxGeometry(0.2, 0.56, 0.16, 0.72, 1.85), bodyMat);
    cover.position.set(0, 0.55, -1.5);
    root.add(capCover(cover));
    const airbox = new THREE.Mesh(new RoundedBoxGeometry(0.38, 0.32, 0.62, 3, 0.09), secondaryMat);
    airbox.position.set(0, 1.0, -0.22);
    root.add(airbox);
    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.05), solidMaterial('#050607', 0.9, 0));
    intake.position.set(0, 1.04, 0.09);
    root.add(intake);

    // Shark fin.
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(1.05, 0);
    finShape.lineTo(0.16, 0.42);
    finShape.lineTo(0, 0.42);
    const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(finShape, { depth: 0.022, bevelEnabled: false }), bodyMat);
    fin.rotation.y = Math.PI / 2;
    fin.position.set(0.011, 0.94, -2.3);
    root.add(fin);

    // Sidepods with undercut and inlets.
    for (const side of [-1, 1]) {
      const pod = new THREE.Mesh(new RoundedBoxGeometry(0.52, 0.4, 1.94, 3, 0.13), bodyMat);
      pod.position.set(side * 0.62, 0.4, -0.5);
      pod.scale.set(1, 1, 1);
      root.add(pod);
      const undercut = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.28, 1.25, 2, 0.1), carbonMat);
      undercut.position.set(side * 0.44, 0.27, -0.42);
      root.add(undercut);
      const inlet = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.05), solidMaterial('#060708', 0.95, 0));
      inlet.position.set(side * 0.62, 0.46, 0.48);
      root.add(inlet);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.1, 1.6), accentMat);
      stripe.position.set(side * 0.88, 0.36, -0.5);
      root.add(stripe);
    }

    // Cockpit opening, rain light, exhaust.
    const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.06, 0.7), solidMaterial('#060708', 0.95, 0));
    cockpit.position.set(0, 0.83, 0.36);
    root.add(cockpit);
    const rainLight = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.08, 0.035),
      new THREE.MeshStandardMaterial({ color: '#ff1010', emissive: '#ff0000', emissiveIntensity: 2.4 }),
    );
    rainLight.position.set(0, 0.5, -2.62);
    root.add(rainLight);

    // Halo: titanium ring and centre pillar.
    const haloCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.46, 0.9, 0.72),
      new THREE.Vector3(-0.48, 1.02, 0.32),
      new THREE.Vector3(-0.3, 1.06, 0.02),
      new THREE.Vector3(0, 1.055, -0.08),
      new THREE.Vector3(0.3, 1.06, 0.02),
      new THREE.Vector3(0.48, 1.02, 0.32),
      new THREE.Vector3(0.46, 0.9, 0.72),
    ]);
    const halo = new THREE.Mesh(new THREE.TubeGeometry(haloCurve, 48, 0.036, 10, false), titaniumMat);
    root.add(halo);
    const haloPillar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 0.09), titaniumMat);
    haloPillar.position.set(0, 0.96, 0.66);
    haloPillar.rotation.x = 0.55;
    root.add(haloPillar);
    this.addHelmet(0, 0.94, 0.27);

    // Mirrors.
    for (const side of [-1, 1]) {
      const mirror = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.08, 0.05, 2, 0.02), accentMat);
      mirror.position.set(side * 0.56, 0.86, 0.42);
      root.add(mirror);
      const stalk = tubeBetween(
        new THREE.Vector3(side * 0.44, 0.76, 0.42),
        new THREE.Vector3(side * 0.53, 0.84, 0.42),
        0.012,
        carbonMat,
      );
      root.add(stalk);
    }

    // Front wing: multi-element, aero package changes chord and angles.
    const pkg = this.config.livery.aero;
    const frontChord = pkg === 'low-drag' ? 0.38 : pkg === 'balanced' ? 0.5 : 0.58;
    const frontSpan = pkg === 'low-drag' ? 2.0 : pkg === 'balanced' ? 1.9 : 1.8;
    const flapAngles = pkg === 'low-drag' ? [0.05, 0.12, 0.18] : pkg === 'balanced' ? [0.12, 0.22, 0.3] : [0.2, 0.34, 0.44];
    const frontWing = new THREE.Group();
    frontWing.position.set(0, 0.16, 2.48);
    root.add(frontWing);
    this.frontWingNode = frontWing;

    const mainPlane = new THREE.Mesh(new THREE.BoxGeometry(frontSpan, 0.028, frontChord), accentMat);
    mainPlane.position.y = 0;
    frontWing.add(mainPlane);
    for (let i = 0; i < 3; i++) {
      const flap = new THREE.Mesh(
        new THREE.BoxGeometry(frontSpan * (0.98 - i * 0.035), 0.022, frontChord * (0.42 - i * 0.06)),
        i === 0 ? secondaryMat : accentMat,
      );
      flap.position.set(0, 0.035 + i * 0.032, -frontChord * 0.25 - i * 0.06);
      flap.rotation.x = -flapAngles[i];
      frontWing.add(flap);
    }
    for (const side of [-1, 1]) {
      const endplate = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.37, frontChord * 1.35), accentMat);
      endplate.position.set(side * frontSpan * 0.5, 0.12, -frontChord * 0.15);
      endplate.userData.side = side;
      frontWing.add(endplate);
      this.endplates.push(endplate);
    }
    const pylons = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.3, 0.32), carbonMat);
    pylons.position.set(0, 0.12, 2.18);
    root.add(pylons);

    // Rear wing + DRS flap.
    const rearWing = new THREE.Group();
    rearWing.position.set(0, 1.02, -2.5);
    root.add(rearWing);
    this.rearWingNode = rearWing;
    const rearSpan = pkg === 'high-downforce' ? 1.1 : 1.02;
    const rearChord = pkg === 'high-downforce' ? 0.42 : pkg === 'low-drag' ? 0.3 : 0.35;
    const rearMain = new THREE.Mesh(new THREE.BoxGeometry(rearSpan, 0.03, rearChord), accentMat);
    rearMain.position.z = 0;
    rearWing.add(rearMain);
    for (const side of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.62, rearChord * 1.6), secondaryMat);
      plate.position.set(side * rearSpan * 0.5, -0.12, -0.02);
      rearWing.add(plate);
      const numberPlate = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.3, 0.36), accentMat);
      numberPlate.position.set(side * (rearSpan * 0.5 + 0.016), -0.02, 0.02);
      rearWing.add(numberPlate);
    }
    const flapPivot = new THREE.Group();
    flapPivot.position.set(0, 0.06, 0.12);
    rearWing.add(flapPivot);
    const flap = new THREE.Mesh(new THREE.BoxGeometry(rearSpan * 0.95, 0.022, rearChord * 0.62), accentMat);
    flap.position.set(0, 0, -rearChord * 0.31);
    flapPivot.add(flap);
    this.drsFlap = flapPivot;
    const beamWing = new THREE.Mesh(new THREE.BoxGeometry(rearSpan * 0.8, 0.025, 0.2), carbonMat);
    beamWing.position.set(0, -0.42, 0.02);
    rearWing.add(beamWing);
    const swan = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.55, 0.14), carbonMat);
    swan.position.set(0, -0.3, 0.06);
    rearWing.add(swan);

    // Wheels, brakes, suspension.
    const wheelPos: Array<[boolean, number, number]> = [
      [true, -0.78, 1.62],
      [true, 0.78, 1.62],
      [false, -0.8, -1.72],
      [false, 0.8, -1.72],
    ];
    for (const [front, x, z] of wheelPos) {
      const steer = new THREE.Group();
      steer.position.set(x, 0.36, z);
      root.add(steer);
      const spin = new THREE.Group();
      steer.add(spin);
      const width = front ? 0.33 : 0.4;
      const tireGeo = new THREE.CylinderGeometry(0.36, 0.36, width, 32, 1, false);
      tireGeo.rotateZ(Math.PI / 2);
      const tire = new THREE.Mesh(tireGeo, tireMat);
      spin.add(tire);
      const rimGeo = new THREE.CylinderGeometry(0.225, 0.225, width + 0.008, 24);
      rimGeo.rotateZ(Math.PI / 2);
      const rim = new THREE.Mesh(rimGeo, metalMat);
      spin.add(rim);
      if (!this.lowDetail) {
        const sidewallMat = new THREE.MeshStandardMaterial({
          map: sidewallTexture(this.config.livery.compound),
          roughness: 0.7,
          metalness: 0.05,
          side: THREE.DoubleSide,
        });
        this.ringMaterials.push(sidewallMat);
        for (const side of [-1, 1]) {
          const wall = new THREE.Mesh(new THREE.CircleGeometry(0.33, 40), sidewallMat);
          wall.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
          wall.position.x = side * (width / 2 + 0.002);
          spin.add(wall);
        }
        const brakeMat = new THREE.MeshStandardMaterial({
          color: '#411208',
          emissive: new THREE.Color('#ff4d00'),
          emissiveIntensity: 0.25,
          roughness: 0.4,
          metalness: 0.35,
        });
        this.brakeMaterials.push(brakeMat);
        const discGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.026, 24);
        discGeo.rotateZ(Math.PI / 2);
        const disc = new THREE.Mesh(discGeo, brakeMat);
        disc.position.x = front ? -width * 0.08 : width * 0.08;
        steer.add(disc);
        const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.18), secondaryMat);
        caliper.position.set(front ? 0.12 : -0.12, 0.12, 0);
        steer.add(caliper);
      }

      this.wheels.push({ pivot: steer, spin, front, axis: 'x', radius: 0.36 });

      // Suspension wishbones.
      for (const dz of [-0.35, 0.32]) {
        const inner = new THREE.Vector3(x * 0.35, 0.24, z + dz * 0.6);
        const outer = new THREE.Vector3(x, 0.36, z + dz * 0.45);
        root.add(tubeBetween(inner, outer, 0.016, carbonMat));
      }
    }

    // Front camera pods.
    for (const side of [-1, 1]) {
      const cam = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.12), secondaryMat);
      cam.position.set(side * 0.2, 1.17, -0.35);
      root.add(cam);
    }

    // Diffuser.
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.3, 0.5), carbonMat);
    diffuser.position.set(0, 0.16, -2.3);
    diffuser.rotation.x = -0.28;
    root.add(diffuser);

    // Number plate on the engine cover side (canvas texture added later).
    this.modelScale = 1;
  }

  /**
   * Collapse static body meshes by material. The wheels, DRS flap and damage
   * endplates stay separate because they animate; everything else becomes a
   * handful of draw calls instead of dozens per car.
   */
  private mergeStaticBody(): void {
    if (!this.modelRoot || !this.mergeAfterBuild) return;
    const root = this.modelRoot;
    root.updateMatrixWorld(true);
    const protectedNodes = new Set<THREE.Object3D>();
    for (const w of this.wheels) protectedNodes.add(w.pivot);
    if (this.frontWingNode) protectedNodes.add(this.frontWingNode);
    if (this.rearWingNode) protectedNodes.add(this.rearWingNode);
    if (this.drsFlap) protectedNodes.add(this.drsFlap);
    const isProtected = (obj: THREE.Object3D): boolean => {
      let cur: THREE.Object3D | null = obj;
      while (cur && cur !== root) {
        if (protectedNodes.has(cur)) return true;
        cur = cur.parent;
      }
      return false;
    };
    const rootInv = root.matrixWorld.clone().invert();
    const groups = new Map<THREE.Material, THREE.Mesh[]>();
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || isProtected(mesh) || mesh.userData.noMerge) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (mats.length !== 1) return;
      const list = groups.get(mats[0]) ?? [];
      list.push(mesh);
      groups.set(mats[0], list);
    });
    for (const [material, meshes] of groups) {
      if (meshes.length < 2) continue;
      const geos: THREE.BufferGeometry[] = [];
      for (const mesh of meshes) {
        mesh.updateMatrixWorld(true);
        const rel = new THREE.Matrix4().multiplyMatrices(rootInv, mesh.matrixWorld);
        const cloned = mesh.geometry.clone().applyMatrix4(rel);
        geos.push(cloned.index ? cloned.toNonIndexed() : cloned);
      }
      try {
        const merged = mergeGeometries(geos, false);
        if (merged) {
          for (const mesh of meshes) mesh.parent?.remove(mesh);
          const mesh = new THREE.Mesh(merged, material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          root.add(mesh);
        }
      } catch {
        // Keep the original meshes if a material has mismatched attributes.
      }
      for (const geo of geos) geo.dispose();
    }
  }

  private addNumberDecals(): void {
    if (!this.modelRoot) return;
    const category = CAR_CLASSES[this.config.carClass].category;
    this.group.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.modelRoot);
    const height = bounds.max.y - bounds.min.y;
    const noseTex = createNumberTexture(this.config.livery.number, this.config.livery.accent, null);
    const tagTex = createNumberTexture(this.config.livery.number, this.config.livery.accent, this.config.livery.tag);

    if (category === 'gt' || category === 'prototype') {
      const roof = this.createDecal(tagTex, 0.78, 0.78);
      roof.position.set(0, bounds.max.y + 0.018, -0.36);
      roof.rotation.x = -Math.PI / 2;
      this.group.add(roof);
      for (const side of [-1, 1]) {
        const door = this.createDecal(noseTex, 0.46, 0.46);
        door.position.set(side * 0.905, bounds.min.y + height * 0.56, 0.08);
        door.rotation.y = side * Math.PI / 2;
        this.group.add(door);
      }
      return;
    }
    if (category === 'kart') {
      const nose = this.createDecal(tagTex, 0.34, 0.34);
      nose.position.set(0, 0.375, 0.88);
      nose.rotation.x = -Math.PI / 2 + 0.08;
      this.group.add(nose);
      return;
    }

    const ray = new THREE.Raycaster();
    const origin = new THREE.Vector3();

    const surfaceY = (z: number, fallback: number): number => {
      origin.set(0, bounds.max.y + 4, z);
      ray.set(origin, new THREE.Vector3(0, -1, 0));
      ray.far = 12;
      const hits = ray.intersectObject(this.modelRoot as THREE.Object3D, true);
      return hits.length ? hits[0].point.y : fallback;
    };

    const noseZ = bounds.max.z - 0.95;
    const engineZ = bounds.min.z + 1.55;
    const engineTex = tagTex;

    if (DRIVER_NUMBER_ON_NOSE) {
      const nose = this.createDecal(noseTex, 0.62, 0.62);
      nose.position.set(0, surfaceY(noseZ, bounds.min.y + height * 0.45) + 0.012, noseZ);
      nose.rotation.x = -Math.PI / 2 + 0.035;
      this.group.add(nose);
    }
    const engine = this.createDecal(engineTex, 0.7, 0.7);
    engine.position.set(0, surfaceY(engineZ, bounds.min.y + height * 0.8) + 0.014, engineZ);
    engine.rotation.x = -Math.PI / 2 + 0.02;
    this.group.add(engine);

    // Tag repeated on both rear-wing endplates, readable from the side.
    for (const side of [-1, 1]) {
      const decal = this.createDecal(tagTex, 0.4, 0.4);
      decal.position.set(side * 0.56, bounds.min.y + height * 0.74, bounds.min.z + 0.55);
      decal.rotation.y = side * Math.PI / 2;
      this.group.add(decal);
    }
  }

  private createDecal(
    texture: THREE.Texture,
    width: number,
    height: number,
  ): THREE.Mesh {
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      roughness: 0.35,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    mesh.renderOrder = 3;
    return mesh;
  }

  private updateLiveryBounds(): void {
    if (!this.modelRoot) return;
    const box = new THREE.Box3().setFromObject(this.modelRoot);
    this.uniforms.uMin.value.copy(box.min);
    this.uniforms.uSize.value.subVectors(box.max, box.min);
    this.group.updateMatrixWorld(true);
    this.uniforms.uCarInv.value.copy(this.group.matrixWorld).invert();
  }

  setCompound(compound: CompoundId): void {
    const color = new THREE.Color(COMPOUNDS[compound].color);
    for (const mat of this.ringMaterials) {
      if ('color' in mat) (mat as THREE.MeshStandardMaterial).color.copy(color);
      if ('emissive' in mat) {
        (mat as THREE.MeshStandardMaterial).emissive.copy(color).multiplyScalar(0.12);
      }
    }
  }

  update(dt: number, state: CarVisualState): void {
    const speed = state.speed;
    this.wheelSpin += (speed * dt) / 0.36;
    for (const w of this.wheels) {
      if (w.front) w.pivot.rotation.y = state.steer * 0.9;
      if (w.axis === 'x') w.spin.rotation.x = this.wheelSpin;
      else w.spin.rotation.z = this.wheelSpin;
    }

    const target = state.drs ? this.drsMax : 0;
    this.drsCurrent += (target - this.drsCurrent) * Math.min(1, dt * 12);
    if (this.drsFlap) {
      if (this.usingGlb) {
        // The scanned wing is a single assembly; rotate it around its span axis
        // as an active-aero element.
        this.drsFlap.rotation.x = -this.drsCurrent * 0.28;
      } else {
        this.drsFlap.rotation.x = -this.drsCurrent;
      }
    }

    const glow = 0.15 + Math.min(1, state.brake) * 2.6;
    for (const mat of this.brakeMaterials) {
      mat.emissiveIntensity = glow;
    }

    if (state.damage) {
      const wingSum = state.damage.wingFL + state.damage.wingFR;
      if (this.endplates.length >= 2) {
        this.endplates[0].visible = state.damage.wingFL > 0.3;
        this.endplates[1].visible = state.damage.wingFR > 0.3;
      }
      if (this.frontWingNode) {
        this.frontWingNode.visible = wingSum > 0.15;
        this.frontWingNode.scale.x = 0.88 + 0.12 * Math.min(1, wingSum / 2);
        this.frontWingNode.rotation.z = (1 - state.damage.wingFL) * 0.06 - (1 - state.damage.wingFR) * 0.06;
      }
    }

    this.group.updateMatrixWorld();
    this.uniforms.uCarInv.value.copy(this.group.matrixWorld).invert();
  }

  /** Switch the livery on a live car (garage turntable). */
  setConfig(config: CarConfig): void {
    this.uniforms.uPrimary.value.set(config.livery.primary);
    this.uniforms.uSecondary.value.set(config.livery.secondary);
    this.uniforms.uAccent.value.set(config.livery.accent);
    this.uniforms.uPattern.value = ['classic', 'fade', 'chevron', 'halftone', 'minimal'].indexOf(config.livery.pattern);
    this.uniforms.uFinish.value = config.livery.finish === 'carbon' ? 2 : config.livery.finish === 'matte' ? 1 : 0;
    this.setCompound(config.livery.compound);
    if (this.helmetVisor) this.helmetVisor.color.set(config.livery.visorTint);
  }

  get isGlb(): boolean {
    return this.usingGlb;
  }
}

// Small helper to keep the long procedural chain readable.
function capCover(mesh: THREE.Mesh): THREE.Mesh {
  mesh.castShadow = true;
  return mesh;
}
