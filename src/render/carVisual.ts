import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CAR_CLASSES, type CarConfig } from '../garage/carConfig';
import { COMPOUNDS, type CompoundId } from '../physics/tyres';
import { createNumberTexture, createSidewallTexture } from '../garage/liveryTextures';
import { CLASS_CAR_MODELS, getClassCarModel, type ClassCarModel } from './carModels';

export interface CarVisualState {
  speed: number;
  steer: number;
  drs: boolean;
  brake: number;
  damage?: { wingFL: number; wingFR: number; floor: number };
  compound?: CompoundId;
  /** Body attitude, radians: positive pitches the nose down. */
  pitch?: number;
  /** Body attitude, radians: positive lifts the right-hand side. */
  roll?: number;
}

interface WheelRig {
  pivot: THREE.Group;
  spin: THREE.Object3D;
  front: boolean;
  axis: 'x' | 'z';
  radius: number;
}

/** Where a wheel sits when the body is level, used to keep it planted as the body tilts. */
interface WheelRest {
  baseY: number;
  offsetX: number;
  offsetZ: number;
  /** Scale between the pivot's parent space and the car's own space. */
  scaleY: number;
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

/**
 * AI cars of one class are the same shape; only the paint differs. The merged
 * body geometry is cached per class, so a 20-car grid uploads one set of body
 * shapes instead of twenty identical copies.
 */
const SHARED_BODY_SHAPES = new Map<string, THREE.BufferGeometry[]>();
/** Carbon, bare metal, tyres and glass look identical on every car. */
const SHARED_MATERIALS = new Map<string, THREE.MeshStandardMaterial>();
/** Wheel parts are identical for every car of a class: build each shape once. */
const SHARED_GEOMETRY = new Map<string, THREE.BufferGeometry>();

function sharedGeometry(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  const cached = SHARED_GEOMETRY.get(key);
  if (cached) return cached;
  const geo = build();
  SHARED_GEOMETRY.set(key, geo);
  return geo;
}

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
      '../../assets/models/car.glb',
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

/** A paint-independent material, created once and used by every car on the grid. */
function sharedMaterial(key: string, color: string, roughness: number, metalness: number): THREE.MeshStandardMaterial {
  const cached = SHARED_MATERIALS.get(key);
  if (cached) return cached;
  const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness });
  SHARED_MATERIALS.set(key, mat);
  return mat;
}

/** Glass is the same per class, so one tinted pane material serves every car of that class. */
function glassMaterial(key: string, color: string, roughness: number, metalness: number, opacity: number): THREE.MeshStandardMaterial {
  const cacheKey = `glass-${key}`;
  const cached = SHARED_MATERIALS.get(cacheKey);
  if (cached) return cached;
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    transparent: true,
    opacity,
  });
  SHARED_MATERIALS.set(cacheKey, mat);
  return mat;
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

/** Paint role a scanned mesh is painted with. */
type ModelRole = 'body' | 'carbon' | 'metal' | 'accent' | 'glass';

interface WheelPart {
  geometry: THREE.BufferGeometry;
  role: ModelRole;
}

interface WheelPack {
  /** Wheel centre in car space. */
  center: THREE.Vector3;
  radius: number;
  front: boolean;
  parts: WheelPart[];
}

/** One wheel's cut, measured from the scan rather than assumed from the class. */
interface WheelDisc {
  /** Axle centre in car space. */
  x: number;
  y: number;
  z: number;
  /** Tyre radius, measured from the tyre ring. */
  radius: number;
  /** Half the tyre's width, with a little margin. */
  halfWidth: number;
  /** Radius the cut uses: the tyre plus a hair, nothing more. */
  cutRadius: number;
  front: boolean;
}

/** Wheel geometry by class: every car of a class shares the same four wheels. */
const MODEL_WHEELS = new Map<string, WheelPack[]>();

/**
 * The uploaded scans are thin, often single-sided shells: with front-face culling
 * the far side of every panel shows through as a hole. Model cars therefore use a
 * double-sided copy of each non-paint role material — one copy per role for the
 * whole grid, so this costs no extra programmes.
 */
const MODEL_ROLE_MATERIALS = new Map<string, THREE.MeshStandardMaterial>();

function modelRoleMaterial(key: string, base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const cached = MODEL_ROLE_MATERIALS.get(key);
  if (cached) return cached;
  const material = base.clone();
  material.side = THREE.DoubleSide;
  MODEL_ROLE_MATERIALS.set(key, material);
  return material;
}

/** Paint roles for the uploaded closed-wheel scans, whose node names are a mix of
 *  languages and exporters. Anything unrecognised becomes bodywork. */
function modelRoleForNode(name: string): ModelRole {
  const n = name.toLowerCase();
  if (/window|glass|vitre|glace|windscreen|cristal|windshield/.test(n)) return 'glass';
  if (/carbon|cabonne|kevlar/.test(n)) return 'carbon';
  if (/rim|jant|llanta|chrome|chrom|metal|exhaust|echapp|brake|disc|disque/.test(n)) return 'metal';
  if (/light|far|phare|lamp|headlight|taillight|badge|logo|stripe|decal|mirror|miroir/.test(n)) return 'accent';
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

/**
 * Exact world-space bounds. `Box3.setFromObject` trusts each geometry's cached
 * bounding box, and these uploads arrive with boxes that do not match their
 * vertices (interleaved, then rebuilt), which put the car half a metre above the
 * road. Reading the vertices is slower but never lies.
 */
function vertexBounds(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute('position');
    if (!position) return;
    for (let i = 0; i < position.count; i += 1) {
      point.fromBufferAttribute(position as THREE.BufferAttribute, i).applyMatrix4(mesh.matrixWorld);
      box.expandByPoint(point);
    }
  });
  return box;
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
  private readonly wheelRest = new Map<WheelRig, WheelRest>();
  private modelRoot: THREE.Group | null = null;
  private drsFlap: THREE.Object3D | null = null;
  private drsAxis: 'x' = 'x';
  private drsCurrent = 0;
  private drsMax = Math.PI * (65 / 180);
  private wheelSpin = 0;
  /** Radius the tyres roll on, averaged over the four wheels (metres). */
  private spinRadius = 0.36;
  private frontWingNode: THREE.Object3D | null = null;
  private rearWingNode: THREE.Object3D | null = null;
  private helmetVisor: THREE.MeshStandardMaterial | null = null;
  private usingGlb = false;
  /** True when the shell came from an uploaded class scan rather than a builder. */
  private usingModel = false;
  private modelScale = 1;
  private mergeAfterBuild = false;
  private readonly lowDetail: boolean;
  /** One material per body role for this car, shared by every panel using it. */
  private readonly roleMaterials = new Map<string, THREE.Material>();
  /** One lens material per light type, shared by every lamp on this car. */
  private readonly lightMaterials = new Map<'head' | 'drl' | 'tail', THREE.MeshStandardMaterial>();
  private sidewallMat: THREE.MeshStandardMaterial | null = null;
  private compoundRingMat: THREE.MeshStandardMaterial | null = null;
  private brakeDiscMat: THREE.MeshStandardMaterial | null = null;

  constructor(config: CarConfig, template: THREE.Group | null = null, lowDetail = false) {
    this.config = config;
    this.lowDetail = lowDetail;
    this.uniforms = createLiveryUniforms(config);
    const modelSpec = CLASS_CAR_MODELS[config.carClass];
    const classModel = modelSpec ? getClassCarModel(config.carClass) : null;
    if (classModel && modelSpec) {
      try {
        this.buildFromModel(classModel, modelSpec);
      } catch (err) {
        console.warn('[car] class model setup failed, falling back to procedural.', err);
        this.buildFromBuilder(template);
      }
    } else {
      this.buildFromBuilder(template);
    }
    this.mergeStaticBody();
    this.group.updateMatrixWorld(true);
    this.addNumberDecals();
    this.updateLiveryBounds();
    this.setCompound(config.livery.compound);
    this.captureWheelRest();
    const radii = this.wheels.map((wheel) => wheel.radius).filter((radius) => radius > 0);
    if (radii.length) {
      this.spinRadius = radii.reduce((sum, radius) => sum + radius, 0) / radii.length;
    }
  }

  /** Procedural geometry for the classes that have no uploaded scan. */
  private buildFromBuilder(template: THREE.Group | null): void {
    const category = CAR_CLASSES[this.config.carClass].category;
    if (this.config.carClass === 'hypercar') {
      this.buildHypercar();
    } else if (this.config.carClass === 'stock') {
      this.buildStock();
    } else if (category === 'gt') {
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
  }

  /**
   * Body attitude rotates the whole car, which lifted the tail wheels clear of
   * the road (25 cm at full dive) and made the car look like it was see-sawing.
   * Remember each wheel's rest position so `update` can drop it by exactly the
   * amount the tilt raises it, leaving the shell to move on its suspension.
   */
  private captureWheelRest(): void {
    this.wheelRest.clear();
    this.group.updateMatrixWorld(true);
    const world = new THREE.Vector3();
    for (const wheel of this.wheels) {
      wheel.pivot.getWorldPosition(world);
      const local = this.group.worldToLocal(world.clone());
      this.wheelRest.set(wheel, {
        baseY: wheel.pivot.position.y,
        offsetX: local.x,
        offsetZ: local.z,
        scaleY: this.modelScale || 1,
      });
    }
  }

  /**
   * Materials are cached per role. Every panel that asks for carbon gets the
   * same instance, so `mergeStaticBody` can collapse the car into a handful of
   * draw calls and a 20-car grid holds a fixed material count, not one per mesh.
   */
  private getMaterial(kind: 'body' | 'accent' | 'carbon' | 'titanium' | 'wheel' | 'metal' | 'secondary'): THREE.Material {
    const cached = this.roleMaterials.get(kind);
    if (cached) return cached;
    const created = this.createRoleMaterial(kind);
    this.roleMaterials.set(kind, created);
    return created;
  }

  private createRoleMaterial(kind: 'body' | 'accent' | 'carbon' | 'titanium' | 'wheel' | 'metal' | 'secondary'): THREE.Material {
    const finish = finishParams(this.config.livery.finish);
    switch (kind) {
      case 'body':
        return createLiveryMaterial(this.config, this.uniforms);
      case 'accent':
        return solidMaterial(this.config.livery.accent, finish.roughness, finish.metalness);
      case 'secondary':
        return solidMaterial(this.config.livery.secondary, finish.roughness, finish.metalness);
      case 'carbon':
        return sharedMaterial('carbon', '#14161a', 0.36, 0.58);
      case 'titanium':
        return sharedMaterial('titanium', '#5a5f66', 0.3, 0.85);
      case 'wheel':
        return sharedMaterial('wheel', '#0b0c0e', 0.82, 0.05);
      case 'metal':
        return sharedMaterial('metal', '#8a8f96', 0.24, 0.95);
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
    // The 2026 scan is shared by the three open-wheel classes. Scale it from the
    // class wheelbase so a junior is a visibly smaller car than a hybrid and the
    // mesh matches the footprint the contact solver uses.
    const spec = CAR_CLASSES[this.config.carClass];
    const targetLength = CAR_LENGTH * (spec.wheelbase / CAR_CLASSES.hybrid.wheelbase);
    const scale = targetLength / length;
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

  /**
   * Builds a class from its uploaded scan. The scan is painted with the game's
   * role palette, scaled to the class footprint, and split into four wheel rigs
   * by position — the uploads name their wheels inconsistently, so geometry near
   * a corner is the only reliable signal. Everything left over goes through
   * mergeStaticBody, which shares one merged shape set across the whole grid.
   */
  private buildFromModel(model: THREE.Group, spec: ClassCarModel): void {
    this.usingGlb = true;
    this.usingModel = true;
    // Normalisation goes on the inner scene, never on the holder: mergeStaticBody
    // bakes `rootInverse * meshWorld` into the merged shape and then parents it to
    // the root, so a transformed root applied the offset twice.
    const holder = new THREE.Group();
    const scene = model.clone(true);
    holder.add(scene);
    scene.rotation.y += spec.yaw;

    const paint = this.getMaterial('body') as THREE.MeshStandardMaterial;
    paint.side = THREE.DoubleSide;
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.material = this.modelMaterial(modelRoleForNode(ancestorName(mesh)));
    });

    // Longest axis to Z, scale to the class footprint, then sit on the road.
    holder.updateMatrixWorld(true);
    let box = vertexBounds(holder);
    let size = box.getSize(new THREE.Vector3());
    if (size.x > size.z) {
      scene.rotation.y += Math.PI / 2;
      holder.updateMatrixWorld(true);
      box = vertexBounds(holder);
      size = box.getSize(new THREE.Vector3());
    }
    const classSpec = CAR_CLASSES[this.config.carClass];
    const targetLength = classSpec.collisionHalfLength * 2 * 1.02;
    const scale = targetLength / Math.max(size.z, 0.001);
    scene.scale.multiplyScalar(scale);
    holder.updateMatrixWorld(true);
    box = vertexBounds(holder);
    const center = box.getCenter(new THREE.Vector3());
    scene.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
    holder.updateMatrixWorld(true);

    this.modelScale = scale;
    this.modelRoot = holder;
    this.group.add(holder);
    this.group.updateMatrixWorld(true);

    const packs = this.extractWheels(holder, classSpec.wheelRadius);
    for (const pack of packs) {
      const steer = new THREE.Group();
      steer.position.copy(pack.center);
      steer.userData.wheelRig = true;
      holder.add(steer);
      const spin = new THREE.Group();
      steer.add(spin);
      for (const part of pack.parts) {
        const mesh = new THREE.Mesh(part.geometry, this.modelMaterial(part.role));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        spin.add(mesh);
      }
      this.wheels.push({ pivot: steer, spin, front: pack.front, axis: 'x', radius: pack.radius });
    }

    this.mergeAfterBuild = true;
  }

  /**
   * Cuts the four wheels out of a scan so they can steer and spin. Whole-mesh
   * wheels take a fast path; meshes that hold both wheels of an axle (several
   * uploads do) are split triangle by triangle. The leftover bodywork is put back
   * as plain meshes for mergeStaticBody. Wheel geometry is cached per class, so a
   * twenty-car grid shares four sets of wheel meshes.
   */
  /** Double-sided material for a scanned body part (paint is per car, rest shared). */
  private modelMaterial(role: ModelRole): THREE.Material {
    if (role === 'body') return this.getMaterial('body');
    const base =
      role === 'glass'
        ? glassMaterial('model', '#0d1620', 0.06, 0.9, 0.58)
        : (this.getMaterial(role) as THREE.MeshStandardMaterial);
    return modelRoleMaterial(`model-${role}`, base);
  }

  /**
   * Measures each wheel's axle centre, width and tyre radius from the scan. The cut
   * used to run on a disc guessed from the class spec: slightly low and slightly
   * too big, so it sliced the top of the arch off with the tyre, and the radius it
   * reported came from the bounding box of everything it caught — brake ducts
   * included — which then drove the wheel spin rate and suspension tilt.
   *
   * A generous probe collects the vertices around each corner. The tyre is a ring
   * of geometry at one distance from the provisional centre, so it stands out as
   * the peak of the distance histogram; the vertices within a narrow band of that
   * peak give the true centre, width and radius, and nothing else gets a vote.
   */
  private measureWheels(holder: THREE.Group, wheelRadius: number): Array<WheelDisc | null> {
    const size = vertexBounds(holder).getSize(new THREE.Vector3());
    const probeHalfWidth = Math.min(size.x * 0.06, wheelRadius * 0.5);
    const probeReach = wheelRadius * 1.35;
    const probes = [
      { x: -size.x * 0.355, y: wheelRadius, z: size.z * 0.3, front: true },
      { x: size.x * 0.355, y: wheelRadius, z: size.z * 0.3, front: true },
      { x: -size.x * 0.355, y: wheelRadius, z: -size.z * 0.3, front: false },
      { x: size.x * 0.355, y: wheelRadius, z: -size.z * 0.3, front: false },
    ];
    const points: number[][] = probes.map(() => []);
    const holderInverse = holder.matrixWorld.clone().invert();
    const local = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const meshes: THREE.Mesh[] = [];
    holder.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });

    for (const mesh of meshes) {
      if (mesh.userData.noMerge) continue;
      const position = mesh.geometry.getAttribute('position');
      if (!position) continue;
      const box = vertexBounds(mesh);
      const near = probes
        .map((probe, i) => ({ probe, i }))
        .filter(
          ({ probe }) =>
            box.min.x <= probe.x + probeHalfWidth && box.max.x >= probe.x - probeHalfWidth &&
            box.min.y <= probe.y + probeReach && box.max.y >= probe.y - probeReach &&
            box.min.z <= probe.z + probeReach && box.max.z >= probe.z - probeReach,
        );
      if (!near.length) continue;
      local.multiplyMatrices(holderInverse, mesh.matrixWorld);
      for (let v = 0; v < position.count; v += 1) {
        p.fromBufferAttribute(position as THREE.BufferAttribute, v).applyMatrix4(local);
        for (const { probe, i } of near) {
          if (Math.abs(p.x - probe.x) > probeHalfWidth) continue;
          if (Math.hypot(p.y - probe.y, p.z - probe.z) > probeReach) continue;
          points[i].push(p.x, p.y, p.z);
        }
      }
    }

    const discs: Array<WheelDisc | null> = probes.map(() => null);
    const found: Array<{
      index: number;
      front: boolean;
      radius: number;
      x: number;
      y: number;
      z: number;
      halfWidth: number;
    }> = [];
    probes.forEach((probe, index) => {
      const list = points[index];
      if (list.length < 90) return;
      const bins = 48;
      const histogram = new Uint32Array(bins);
      const distances: number[] = [];
      for (let i = 0; i < list.length; i += 3) {
        const d = Math.hypot(list[i + 1] - probe.y, list[i + 2] - probe.z);
        distances.push(d);
        histogram[Math.min(bins - 1, Math.floor((d / probeReach) * bins))] += 1;
      }
      let peak = 0;
      for (const count of histogram) peak = Math.max(peak, count);
      let tyreBin = -1;
      for (let b = bins - 1; b >= 0; b -= 1) {
        if (histogram[b] >= peak * 0.4) {
          tyreBin = b;
          break;
        }
      }
      if (tyreBin < 0) return;
      const tyreRadius = ((tyreBin + 0.5) / bins) * probeReach;
      const band = tyreRadius * 0.08;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      let bandCount = 0;
      for (let i = 0, k = 0; i < list.length; i += 3, k += 1) {
        if (Math.abs(distances[k] - tyreRadius) > band) continue;
        minX = Math.min(minX, list[i]);
        maxX = Math.max(maxX, list[i]);
        minY = Math.min(minY, list[i + 1]);
        maxY = Math.max(maxY, list[i + 1]);
        minZ = Math.min(minZ, list[i + 2]);
        maxZ = Math.max(maxZ, list[i + 2]);
        bandCount += 1;
      }
      if (bandCount < 24) return;
      // Both axis pairs across the ring span one diameter, so their average is the
      // tyre's radius; its x spread is the wheel's width. The band's own extents are
      // steadier than the histogram bin, which can settle on the arch.
      found.push({
        index,
        front: probe.front,
        radius: (maxY - minY + (maxZ - minZ)) / 4,
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        z: (minZ + maxZ) / 2,
        halfWidth: Math.min(
          Math.max((maxX - minX) * 0.5 * 1.08, wheelRadius * 0.16),
          wheelRadius * 1.2,
        ),
      });
    });

    if (!found.length) return discs;
    // All four wheels are the same size, and a single ring can land on a rim rather
    // than the tyre — the Huracán's right front did. Cutting to that smaller figure
    // leaves the tyre in the bodywork, standing still while the rim spins inside it,
    // so the car's tyre is the median of the four. The class spec only bounds it
    // loosely: it is a guess, and a 5.5 m Huracán scan really does sit on 0.41 m
    // tyres (the same ratio to its length as the real car).
    // The largest of the four rings: a wheel whose ring landed on its rim reads
    // small, and a small cut leaves that tyre standing still in the bodywork. The
    // piece test above is what keeps an over-generous radius from taking bodywork,
    // so erring large here is the safe direction.
    const radius = THREE.MathUtils.clamp(
      Math.max(...found.map((wheel) => wheel.radius)),
      wheelRadius * 0.6,
      wheelRadius * 1.4,
    );
    for (const wheel of found) {
      discs[wheel.index] = {
        x: wheel.x,
        y: wheel.y,
        z: wheel.z,
        radius,
        halfWidth: wheel.halfWidth,
        cutRadius: radius * 1.02,
        front: wheel.front,
      };
    }
    return discs;
  }

  private extractWheels(holder: THREE.Group, wheelRadius: number): WheelPack[] {
    holder.updateMatrixWorld(true);
    // A wheel is a disc around its axle, so the cut is a cylinder — and it is cut
    // where the tyre actually ends, not where the class spec guesses. A box, or a
    // disc even slightly too large, takes the arch above the tyre with it and
    // leaves a notch in the fender once the wheel spins away.
    const discs = this.measureWheels(holder, wheelRadius);
    if (!discs.some((disc) => disc !== null)) return [];

    const holderInverse = holder.matrixWorld.clone().invert();
    const meshes: THREE.Mesh[] = [];
    holder.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });

    interface Sink {
      role: ModelRole;
      positions: number[];
      normals: number[];
    }
    const wheelSinks: Array<Map<ModelRole, Sink>> = discs.map(() => new Map());
    const local = new THREE.Matrix4();
    const normalMatrix = new THREE.Matrix3();
    const a = new THREE.Vector3();
    const n = new THREE.Vector3();
    let anyWheel = false;

    for (const mesh of meshes) {
      if (mesh.userData.noMerge) continue;
      const geometry = mesh.geometry;
      const position = geometry.getAttribute('position');
      if (!position) continue;
      const normal = geometry.getAttribute('normal');
      const index = geometry.index;
      const vertexCount = index ? index.count : position.count;
      if (vertexCount < 3) continue;

      local.multiplyMatrices(holderInverse, mesh.matrixWorld);
      normalMatrix.getNormalMatrix(local);
      const role = modelRoleForNode(ancestorName(mesh));

      const meshBox = vertexBounds(mesh);
      if (!this.meshTouchesWheel(meshBox, discs)) continue;

      const sinkFor = (wheel: number): Sink => {
        const map = wheelSinks[wheel];
        let sink = map.get(role);
        if (!sink) {
          sink = { role, positions: [], normals: [] };
          map.set(role, sink);
        }
        return sink;
      };

      // Classify every vertex exactly once. The old fast path only checked the
      // mesh's bounding box, so a big wheel mesh also carried the box corners that
      // sit outside the tyre into the spin group, which is what made the measured
      // radius read larger than the cut.
      const placed = new Float32Array(vertexCount * 3);
      for (let v = 0; v < vertexCount; v += 1) {
        const at = index ? index.getX(v) : v;
        a.fromBufferAttribute(position as THREE.BufferAttribute, at).applyMatrix4(local);
        placed[v * 3] = a.x;
        placed[v * 3 + 1] = a.y;
        placed[v * 3 + 2] = a.z;
      }

      // Classify each vertex against the four tyres; a triangle is wheel geometry
      // only when all three of its corners sit in the same one. These scans fuse the
      // tyre into the body shell, so there is no separate wheel piece to lift out.
      const owners = new Int8Array(vertexCount).fill(-1);
      let inside = 0;
      for (let v = 0; v < vertexCount; v += 1) {
        const x = placed[v * 3];
        const y = placed[v * 3 + 1];
        const z = placed[v * 3 + 2];
        for (let d = 0; d < discs.length; d += 1) {
          const disc = discs[d];
          if (!disc) continue;
          if (Math.abs(x - disc.x) > disc.halfWidth) continue;
          if (Math.hypot(y - disc.y, z - disc.z) > disc.cutRadius) continue;
          owners[v] = d;
          inside += 1;
          break;
        }
      }
      if (!inside) continue;

      const pushVertex = (sink: Sink, v: number): void => {
        sink.positions.push(placed[v * 3], placed[v * 3 + 1], placed[v * 3 + 2]);
        if (!normal) return;
        const at = index ? index.getX(v) : v;
        n.fromBufferAttribute(normal as THREE.BufferAttribute, at).applyMatrix3(normalMatrix).normalize();
        sink.normals.push(n.x, n.y, n.z);
      };

      // Split the triangles between the wheels and the body.
      const bodyPositions: number[] = [];
      const bodyNormals: number[] = [];
      let moved = false;
      for (let t = 0; t < vertexCount; t += 3) {
        const own = owners[t];
        let wheel = own >= 0 && own === owners[t + 1] && own === owners[t + 2] ? own : -1;
        // Surfaces facing the axle are arch liners and inner panels. Lifting those
        // out beside the tyre is exactly the dark notch in the Huracán's fender, and
        // they are hidden behind the wheel anyway, so they stay with the body.
        if (wheel >= 0) {
          const disc = discs[wheel];
          if (disc) {
            const ax = placed[t * 3 + 3] - placed[t * 3];
            const ay = placed[t * 3 + 4] - placed[t * 3 + 1];
            const az = placed[t * 3 + 5] - placed[t * 3 + 2];
            const bx = placed[t * 3 + 6] - placed[t * 3];
            const by = placed[t * 3 + 7] - placed[t * 3 + 1];
            const bz = placed[t * 3 + 8] - placed[t * 3 + 2];
            const nx = ay * bz - az * by;
            const ny = az * bx - ax * bz;
            const nz = ax * by - ay * bx;
            const cy = (placed[t * 3 + 1] + placed[t * 3 + 4] + placed[t * 3 + 7]) / 3 - disc.y;
            const cz = (placed[t * 3 + 2] + placed[t * 3 + 5] + placed[t * 3 + 8]) / 3 - disc.z;
            const length = Math.hypot(ny, nz) * Math.hypot(cy, cz);
            if (length > 1e-9 && (ny * cy + nz * cz) / length < -0.3) wheel = -1;
          }
        }
        const target = wheel >= 0 ? sinkFor(wheel) : null;
        if (target) moved = true;
        for (let k = 0; k < 3; k += 1) {
          const v = t + k;
          if (target) {
            pushVertex(target, v);
            continue;
          }
          bodyPositions.push(placed[v * 3], placed[v * 3 + 1], placed[v * 3 + 2]);
          if (!normal) continue;
          const at = index ? index.getX(v) : v;
          n.fromBufferAttribute(normal as THREE.BufferAttribute, at).applyMatrix3(normalMatrix).normalize();
          bodyNormals.push(n.x, n.y, n.z);
        }
      }
      if (!moved) continue;
      anyWheel = true;
      mesh.parent?.remove(mesh);
      if (bodyPositions.length) {
        const remnant = new THREE.BufferGeometry();
        remnant.setAttribute('position', new THREE.Float32BufferAttribute(bodyPositions, 3));
        if (bodyNormals.length === bodyPositions.length) {
          remnant.setAttribute('normal', new THREE.Float32BufferAttribute(bodyNormals, 3));
        } else {
          remnant.computeVertexNormals();
        }
        const bodyMaterial = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const bodyMesh = new THREE.Mesh(remnant, bodyMaterial);
        bodyMesh.castShadow = true;
        bodyMesh.receiveShadow = true;
        holder.add(bodyMesh);
      }
    }

    if (!anyWheel) return [];

    const cached = MODEL_WHEELS.get(this.config.carClass);
    if (cached) return cached;

    const packs: WheelPack[] = [];
    wheelSinks.forEach((sinks, wheel) => {
      const disc = discs[wheel];
      if (!disc || !sinks.size) return;
      // The measured tyre radius, not the bbox of everything the cut caught: brake
      // ducts, calipers and suspension arms sit inside the wheel and inflated it,
      // and this radius drives the spin rate and the suspension tilt.
      const center = new THREE.Vector3(disc.x, disc.y, disc.z);
      // The measured tyre, shared by all four wheels: the radius the tyres roll on,
      // so it must be the rubber, not brake ducts or arch lip caught by the cut.
      const radius = disc.radius;
      const parts: WheelPart[] = [];
      for (const sink of sinks.values()) {
        const positions = new Float32Array(sink.positions.length);
        for (let i = 0; i < sink.positions.length; i += 3) {
          positions[i] = sink.positions[i] - center.x;
          positions[i + 1] = sink.positions[i + 1] - center.y;
          positions[i + 2] = sink.positions[i + 2] - center.z;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        if (sink.normals.length === sink.positions.length) {
          geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(sink.normals), 3));
        } else {
          geometry.computeVertexNormals();
        }
        parts.push({ geometry, role: sink.role });
      }
      packs.push({ center, radius, front: disc.front, parts });
    });
    MODEL_WHEELS.set(this.config.carClass, packs);
    return packs;
  }

  /** Cheap rejection test: can this mesh possibly contain wheel triangles? */
  private meshTouchesWheel(box: THREE.Box3, discs: Array<WheelDisc | null>): boolean {
    return discs.some(
      (disc) =>
        disc !== null &&
        box.min.x <= disc.x + disc.halfWidth && box.max.x >= disc.x - disc.halfWidth &&
        box.min.y <= disc.y + disc.cutRadius && box.max.y >= disc.y - disc.cutRadius &&
        box.min.z <= disc.z + disc.cutRadius && box.max.z >= disc.z - disc.cutRadius,
    );
  }

  private addWheelDetails(pivot: THREE.Group, front: boolean, worldRadius: number, axis: 'x' | 'z'): void {
    const localR = worldRadius / this.modelScale;
    const halfWidth = (front ? 0.17 : 0.2) / this.modelScale;
    const ringMat = this.compoundRingMaterial();
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
    const brakeMat = this.brakeDiscMaterial();
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
    const glass = sharedMaterial('mirror-glass', '#b9c8d2', 0.1, 0.9);
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
    const wheelKey = `${front ? 'f' : 'r'}-${radius.toFixed(3)}-${width.toFixed(3)}`;
    const tireGeo = sharedGeometry(`tire-${wheelKey}`, () => {
      const geo = new THREE.CylinderGeometry(radius, radius, width, 28, 1, false);
      geo.rotateZ(Math.PI / 2);
      return geo;
    });
    spin.add(new THREE.Mesh(tireGeo, tireMat));
    const rimGeo = sharedGeometry(`rim-${wheelKey}`, () => {
      const geo = new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width + 0.008, 20);
      geo.rotateZ(Math.PI / 2);
      return geo;
    });
    spin.add(new THREE.Mesh(rimGeo, metalMat));
    if (!this.lowDetail) {
      const sidewallMat = this.sidewallMaterial();
      const wallGeo = sharedGeometry(`wall-${wheelKey}`, () => new THREE.CircleGeometry(radius * 0.92, 32));
      for (const side of [-1, 1]) {
        const wall = new THREE.Mesh(wallGeo, sidewallMat);
        wall.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        wall.position.x = side * (width / 2 + 0.002);
        spin.add(wall);
      }
      const brakeMat = this.brakeDiscMaterial();
      const discGeo = sharedGeometry(`disc-${wheelKey}`, () => {
        const geo = new THREE.CylinderGeometry(radius * 0.52, radius * 0.52, 0.026, 20);
        geo.rotateZ(Math.PI / 2);
        return geo;
      });
      const disc = new THREE.Mesh(discGeo, brakeMat);
      steer.add(disc);
      const caliper = new THREE.Mesh(sharedGeometry('caliper', () => new THREE.BoxGeometry(0.1, 0.12, 0.18)), secondaryMat);
      caliper.position.set(front ? 0.12 : -0.12, 0.12, 0);
      steer.add(caliper);
    }
    this.wheels.push({ pivot: steer, spin, front, axis: 'x', radius });
  }

  /**
   * One lens material per light type for the whole car. Headlights, DRLs and
   * tail lamps each share a single instance, so a full grid adds two lit
   * programmes per car instead of a fresh material for every lamp.
   */
  private lightMaterial(kind: 'head' | 'drl' | 'tail'): THREE.MeshStandardMaterial {
    const cached = this.lightMaterials.get(kind);
    if (cached) return cached;
    const mat = new THREE.MeshStandardMaterial({
      color: kind === 'tail' ? '#ff1a1a' : '#ffffff',
      emissive: new THREE.Color(kind === 'tail' ? '#ff0000' : kind === 'drl' ? '#cfe9ff' : '#bfe6ff'),
      emissiveIntensity: kind === 'tail' ? 1.4 : kind === 'drl' ? 2.6 : 2.2,
      roughness: 0.22,
      metalness: 0.08,
    });
    this.lightMaterials.set(kind, mat);
    // The shared tail material is what the brake glow drives.
    if (kind === 'tail') this.brakeMaterials.push(mat);
    return mat;
  }

  /** Tyre sidewalls, compound rings and discs are shared by all four wheels. */
  private sidewallMaterial(): THREE.MeshStandardMaterial {
    if (this.sidewallMat) return this.sidewallMat;
    const mat = new THREE.MeshStandardMaterial({
      map: sidewallTexture(this.config.livery.compound),
      roughness: 0.74,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });
    this.sidewallMat = mat;
    this.ringMaterials.push(mat);
    return mat;
  }

  private compoundRingMaterial(): THREE.MeshStandardMaterial {
    if (this.compoundRingMat) return this.compoundRingMat;
    const compound = COMPOUNDS[this.config.livery.compound];
    const mat = new THREE.MeshStandardMaterial({
      color: compound.color,
      emissive: new THREE.Color(compound.color).multiplyScalar(0.16),
      roughness: 0.45,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });
    this.compoundRingMat = mat;
    this.ringMaterials.push(mat);
    return mat;
  }

  private brakeDiscMaterial(): THREE.MeshStandardMaterial {
    if (this.brakeDiscMat) return this.brakeDiscMat;
    const mat = new THREE.MeshStandardMaterial({
      color: '#3a1008',
      emissive: new THREE.Color('#ff4d00'),
      emissiveIntensity: 0.22,
      roughness: 0.42,
      metalness: 0.32,
    });
    this.brakeDiscMat = mat;
    this.brakeMaterials.push(mat);
    return mat;
  }

  /** Rear light bar wired into the brake glow, so it flares under braking. */
  private addTailBar(root: THREE.Group, width: number, height: number, y: number, z: number): void {
    const mat = this.lightMaterial('tail');
    const bar = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.045), mat);
    bar.position.set(0, y, z);
    root.add(bar);
  }

  /** Round projector lamp in a chrome bezel: a real headlight unit. */
  private addProjector(root: THREE.Group, x: number, y: number, z: number, size: number): void {
    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(size * 1.3, size * 1.3, 0.03, 16), this.getMaterial('metal'));
    bezel.rotation.x = Math.PI / 2;
    bezel.position.set(x, y, z);
    root.add(bezel);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(size, size, 0.04, 16), this.lightMaterial('head'));
    lens.rotation.x = Math.PI / 2;
    lens.position.set(x, y, z + 0.016);
    root.add(lens);
  }

  /** GT: road-car face, canards, door crease and a swan-neck wing. */
  private addGTDetails(root: THREE.Group): void {
    const accentMat = this.getMaterial('accent');
    const carbonMat = this.getMaterial('carbon');
    for (const side of [-1, 1]) {
      this.addProjector(root, side * 0.72, 0.77, 2.19, 0.06);
      this.addProjector(root, side * 0.5, 0.77, 2.19, 0.048);
      const drl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.024, 0.026), this.lightMaterial('drl'));
      drl.position.set(side * 0.62, 0.66, 2.19);
      root.add(drl);
      for (let i = 0; i < 3; i++) {
        const canard = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.018, 0.11), carbonMat);
        canard.position.set(side * 0.97, 0.46 + i * 0.055, 1.86 - i * 0.15);
        canard.rotation.z = side * 0.14;
        root.add(canard);
      }
      const crease = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.045, 2.3), accentMat);
      crease.position.set(side * 0.93, 0.62, -0.12);
      root.add(crease);
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.045, 1.9), carbonMat);
      skirt.position.set(side * 0.95, 0.25, -0.05);
      root.add(skirt);
      // Swan-neck arm rising from the deck to the wing plane.
      root.add(
        tubeBetween(
          new THREE.Vector3(side * 0.46, 0.86, -1.86),
          new THREE.Vector3(side * 0.46, 1.14, -2.05),
          0.032,
          carbonMat,
        ),
      );
    }
    this.addTailBar(root, 1.52, 0.07, 0.72, -2.21);
    const gurney = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.045, 0.028), carbonMat);
    gurney.position.set(0, 1.2, -2.21);
    root.add(gurney);
  }

  /** Prototype: endurance light strips, shark fin and a twin-element high wing. */
  private addPrototypeDetails(root: THREE.Group): void {
    const carbonMat = this.getMaterial('carbon');
    const accentMat = this.getMaterial('accent');
    const stripMat = this.lightMaterial('drl');
    for (const side of [-1, 1]) {
      for (const z of [1.78, 1.6]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.17, 0.03), stripMat);
        strip.position.set(side * 1.19, 0.67, z);
        root.add(strip);
      }
      // Vertical fence along the front fender crown.
      const fence = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.16, 1.2), accentMat);
      fence.position.set(side * 1.16, 0.76, 1.5);
      root.add(fence);
    }
    // Shark fin: the endurance silhouette cue.
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(1.2, 0);
    finShape.lineTo(0.2, 0.4);
    finShape.lineTo(0, 0.4);
    const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(finShape, { depth: 0.024, bevelEnabled: false }), carbonMat);
    fin.rotation.y = Math.PI / 2;
    // Sits on the engine cover and stops at the wing: no overhang past the tail.
    fin.position.set(0.012, 1.0, -1.15);
    root.add(fin);
    // Second wing element under the main plane.
    const second = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.05, 0.34), carbonMat);
    second.position.set(0, 1.36, -2.02);
    second.rotation.x = -0.18;
    root.add(second);
    // Twin swan-neck pylons.
    for (const side of [-1, 1]) {
      root.add(
        tubeBetween(
          new THREE.Vector3(side * 0.36, 0.92, -1.86),
          new THREE.Vector3(side * 0.36, 1.5, -2.06),
          0.038,
          carbonMat,
        ),
      );
    }
    this.addTailBar(root, 1.56, 0.08, 0.78, -2.24);
  }

  /** Hypercar: louvred engine deck, side intakes and a narrow active wing. */
  private addHypercarDetails(root: THREE.Group): void {
    const carbonMat = this.getMaterial('carbon');
    const secondaryMat = this.getMaterial('secondary');
    const trimMat = this.getMaterial('metal');
    // Engine-deck louvres.
    for (let i = 0; i < 6; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.022, 0.1), carbonMat);
      slat.position.set(0, 0.985, -2.02 + i * 0.17);
      slat.rotation.x = 0.42;
      root.add(slat);
    }
    for (const side of [-1, 1]) {
      // Deep side intake with a dark mesh panel.
      const intake = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.26, 0.62), carbonMat);
      intake.position.set(side * 1.0, 0.6, -0.28);
      root.add(intake);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.5), solidMaterial('#05070a', 0.9, 0.1));
      mesh.position.set(side * 1.04, 0.6, -0.28);
      root.add(mesh);
      // Y-shaped daytime running light.
      const armA = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.022, 0.026), this.lightMaterial('drl'));
      armA.position.set(side * 0.66, 0.74, 2.22);
      armA.rotation.z = side * -0.24;
      root.add(armA);
      const armB = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.022, 0.026), this.lightMaterial('drl'));
      armB.position.set(side * 0.58, 0.68, 2.22);
      armB.rotation.z = side * 0.4;
      root.add(armB);
      // Single centre-pylon support per side of the active wing.
      root.add(
        tubeBetween(
          new THREE.Vector3(side * 0.28, 1.0, -2.0),
          new THREE.Vector3(side * 0.28, 1.24, -2.08),
          0.03,
          trimMat,
        ),
      );
    }
    const centrePylon = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.12), secondaryMat);
    centrePylon.position.set(0, 1.1, -2.04);
    root.add(centrePylon);
    this.addTailBar(root, 1.58, 0.06, 0.7, -2.13);
  }

  /** Stock: square lamps, chrome grille, side exhausts and a deck spoiler. */
  private addStockDetails(root: THREE.Group): void {
    const chromeMat = this.getMaterial('metal');
    const carbonMat = this.getMaterial('carbon');
    // Chrome grille surround with a dark mesh insert.
    const surround = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.26, 0.04), chromeMat);
    surround.position.set(0, 0.54, 2.26);
    root.add(surround);
    const insert = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.18, 0.03), solidMaterial('#08090b', 0.92, 0.05));
    insert.position.set(0, 0.54, 2.28);
    root.add(insert);
    for (const side of [-1, 1]) {
      // Two square sealed-beam lamps per side, stock-car style.
      for (const dx of [0.16, 0.42]) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.13, 0.03), this.lightMaterial('head'));
        lamp.position.set(side * dx, 0.76, 2.27);
        root.add(lamp);
      }
      // Side-exit exhausts.
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 12), chromeMat);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(side * 0.98, 0.36, -0.5);
      root.add(pipe);
    }
    this.addTailBar(root, 1.56, 0.11, 0.74, -2.22);
    // Rear bumper under the light bar.
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.16, 0.12), carbonMat);
    bumper.position.set(0, 0.44, -2.2);
    root.add(bumper);
  }

  /** Kart: front fairing with a number panel, wide rear bumper and deflector. */
  private addKartDetails(root: THREE.Group): void {
    const accentMat = this.getMaterial('accent');
    const carbonMat = this.getMaterial('carbon');
    const secondaryMat = this.getMaterial('secondary');
    // Front fairing panel.
    const fairing = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.3, 0.12, 3, 0.04), accentMat);
    fairing.position.set(0, 0.36, 1.04);
    fairing.rotation.x = -0.18;
    root.add(fairing);
    // Wide rear bumper bar.
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.1, 0.1), carbonMat);
    bumper.position.set(0, 0.3, -1.02);
    root.add(bumper);
    for (const side of [-1, 1]) {
      const stay = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.3), carbonMat);
      stay.position.set(side * 0.44, 0.3, -0.92);
      root.add(stay);
    }
    // Rear deflector: a kart's only real "wing".
    const deflector = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.03, 0.22), secondaryMat);
    deflector.position.set(0, 0.4, -1.0);
    deflector.rotation.x = -0.32;
    root.add(deflector);
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
    const glassMat = glassMaterial('gt', '#101820', 0.16, 0.65, 0.88);

    // Wide, low GT3 silhouette with a proper roof and fenders.
    const floor = new THREE.Mesh(new RoundedBoxGeometry(1.86, 0.16, 4.35, 3, 0.07), carbonMat);
    floor.position.set(0, 0.22, -0.05);
    root.add(floor);
    const shell = new THREE.Mesh(taperedBoxGeometry(1.8, 1.54, 0.68, 0.5, 3.95), bodyMat);
    shell.position.set(0, 0.63, 0.02);
    root.add(shell);
    // Long front-engine hood, cabin pushed back: the GT signature.
    const hood = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.2, 1.5, 3, 0.08), bodyMat);
    hood.position.set(0, 0.91, 1.16);
    root.add(hood);
    const cabin = new THREE.Mesh(taperedBoxGeometry(1.46, 1.2, 0.68, 0.52, 1.45), bodyMat);
    cabin.position.set(0, 1.15, -0.62);
    root.add(cabin);
    const roof = new THREE.Mesh(new RoundedBoxGeometry(1.28, 0.1, 0.95, 3, 0.05), bodyMat);
    roof.position.set(0, 1.48, -0.66);
    root.add(roof);

    const windscreen = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.34, 0.05), glassMat);
    windscreen.position.set(0, 1.29, 0.34);
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
      const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.13, 0.06), this.lightMaterial('head'));
      headlight.position.set(side * 0.55, 0.77, 2.17);
      root.add(headlight);
      const mirror = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.09, 0.08, 2, 0.02), accentMat);
      mirror.position.set(side * 0.8, 1.0, 0.34);
      root.add(mirror);
    }
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.05), this.lightMaterial('tail'));
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
    this.addGTDetails(root);
    this.addHelmet(0, 1.2, -0.3);
  }

  private buildHypercar(): void {
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
    const glassMat = glassMaterial('hypercar', '#0a1118', 0.12, 0.8, 0.9);

    // Wide, low road-based hypercar with a cab-forward canopy.
    const floor = new THREE.Mesh(new RoundedBoxGeometry(2.0, 0.11, 4.5, 3, 0.055), carbonMat);
    floor.position.set(0, 0.2, -0.03);
    root.add(floor);
    const shell = new THREE.Mesh(taperedBoxGeometry(1.94, 1.6, 0.58, 0.4, 4.18), bodyMat);
    shell.position.set(0, 0.55, 0.03);
    root.add(shell);
    const nose = new THREE.Mesh(new RoundedBoxGeometry(1.4, 0.22, 1.1, 3, 0.07), bodyMat);
    nose.position.set(0, 0.68, 1.55);
    root.add(nose);
    const hood = new THREE.Mesh(new RoundedBoxGeometry(1.52, 0.16, 1.0, 3, 0.06), bodyMat);
    hood.position.set(0, 0.84, 0.88);
    root.add(hood);

    const cabin = new THREE.Mesh(taperedBoxGeometry(1.34, 1.08, 0.68, 0.38, 1.72), bodyMat);
    cabin.position.set(0, 1.08, -0.22);
    root.add(cabin);
    const roof = new THREE.Mesh(new RoundedBoxGeometry(1.06, 0.1, 1.18, 3, 0.05), bodyMat);
    roof.position.set(0, 1.4, -0.28);
    root.add(roof);
    const windscreen = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.34, 0.045), glassMat);
    windscreen.position.set(0, 1.23, 0.58);
    windscreen.rotation.x = -0.5;
    root.add(windscreen);
    for (const side of [-1, 1]) {
      const window = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.28, 0.86), glassMat);
      window.position.set(side * 0.65, 1.17, -0.24);
      root.add(window);
      const fender = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.3, 1.18, 3, 0.1), bodyMat);
      fender.position.set(side * 0.94, 0.56, 1.5);
      root.add(fender);
      const rearFender = fender.clone();
      rearFender.position.z = -1.48;
      root.add(rearFender);
      const sideIntake = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.7), carbonMat);
      sideIntake.position.set(side * 0.97, 0.63, 0.02);
      root.add(sideIntake);
      const mirror = new THREE.Mesh(new RoundedBoxGeometry(0.19, 0.08, 0.08, 2, 0.02), accentMat);
      mirror.position.set(side * 0.7, 1.07, 0.34);
      root.add(mirror);
    }
    const roofScoop = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.12, 0.62, 3, 0.04), carbonMat);
    roofScoop.position.set(0, 1.47, -0.66);
    root.add(roofScoop);

    const splitter = new THREE.Mesh(new RoundedBoxGeometry(2.06, 0.05, 0.52, 2, 0.02), carbonMat);
    splitter.position.set(0, 0.2, 2.18);
    root.add(splitter);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.15, 0.035), carbonMat);
    grille.position.set(0, 0.5, 2.19);
    root.add(grille);
    for (const side of [-1, 1]) {
      const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.09, 0.035), this.lightMaterial('head'));
      headlight.position.set(side * 0.55, 0.7, 2.2);
      root.add(headlight);
    }
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.075, 0.035), this.lightMaterial('tail'));
    tail.position.set(0, 0.7, -2.12);
    root.add(tail);

    const rearWing = new THREE.Group();
    rearWing.position.set(0, 1.23, -2.0);
    root.add(rearWing);
    const rearPlane = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.46), accentMat);
    rearWing.add(rearPlane);
    for (const side of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.42, 0.56), secondaryMat);
      plate.position.set(side * 0.76, -0.02, 0.02);
      rearWing.add(plate);
      const support = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.6, 0.1), carbonMat);
      support.position.set(side * 0.5, -0.28, 0.02);
      rearWing.add(support);
    }
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.22, 0.52), carbonMat);
    diffuser.position.set(0, 0.22, -2.13);
    root.add(diffuser);

    this.addHypercarDetails(root);
    this.addWheelRig(root, true, -0.91, 1.48, 0.31, 0.35);
    this.addWheelRig(root, true, 0.91, 1.48, 0.31, 0.35);
    this.addWheelRig(root, false, -0.93, -1.46, 0.35, 0.36);
    this.addWheelRig(root, false, 0.93, -1.46, 0.35, 0.36);
    this.addHelmet(0, 1.17, -0.24);
  }

  private buildStock(): void {
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
    const glassMat = glassMaterial('stock', '#0d151b', 0.2, 0.6, 0.9);

    // Long, tall sedan silhouette with a short deck and a big rear wing.
    const floor = new THREE.Mesh(new RoundedBoxGeometry(1.92, 0.14, 4.68, 3, 0.06), carbonMat);
    floor.position.set(0, 0.25, -0.02);
    root.add(floor);
    const shell = new THREE.Mesh(taperedBoxGeometry(1.88, 1.68, 0.84, 0.62, 4.36), bodyMat);
    shell.position.set(0, 0.69, 0.04);
    root.add(shell);
    const hood = new THREE.Mesh(new RoundedBoxGeometry(1.56, 0.24, 1.28, 3, 0.06), bodyMat);
    hood.position.set(0, 0.98, 1.38);
    root.add(hood);
    const deck = new THREE.Mesh(new RoundedBoxGeometry(1.7, 0.2, 0.92, 3, 0.06), bodyMat);
    deck.position.set(0, 0.98, -1.55);
    root.add(deck);

    const cabin = new THREE.Mesh(taperedBoxGeometry(1.62, 1.52, 0.92, 0.78, 1.9), bodyMat);
    cabin.position.set(0, 1.22, -0.18);
    root.add(cabin);
    const roof = new THREE.Mesh(new RoundedBoxGeometry(1.38, 0.1, 1.54, 3, 0.04), bodyMat);
    roof.position.set(0, 1.73, -0.26);
    root.add(roof);
    const windscreen = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.4, 0.045), glassMat);
    windscreen.position.set(0, 1.48, 0.72);
    windscreen.rotation.x = -0.4;
    root.add(windscreen);
    const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.34, 0.045), glassMat);
    rearGlass.position.set(0, 1.49, -1.08);
    rearGlass.rotation.x = 0.48;
    root.add(rearGlass);
    for (const side of [-1, 1]) {
      const window = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.34, 1.28), glassMat);
      window.position.set(side * 0.8, 1.43, -0.26);
      root.add(window);
      const fender = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.38, 1.16, 3, 0.08), bodyMat);
      fender.position.set(side * 0.9, 0.72, 1.5);
      root.add(fender);
      const rearFender = fender.clone();
      rearFender.position.z = -1.5;
      root.add(rearFender);
    }

    const splitter = new THREE.Mesh(new RoundedBoxGeometry(2.02, 0.07, 0.5, 2, 0.025), carbonMat);
    splitter.position.set(0, 0.23, 2.24);
    root.add(splitter);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.22, 0.05), carbonMat);
    grille.position.set(0, 0.54, 2.25);
    root.add(grille);
    for (const side of [-1, 1]) {
      const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.05), this.lightMaterial('head'));
      headlight.position.set(side * 0.56, 0.74, 2.26);
      root.add(headlight);
      const mirror = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.09, 0.08, 2, 0.02), accentMat);
      mirror.position.set(side * 0.82, 1.16, 0.35);
      root.add(mirror);
    }
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.05), this.lightMaterial('tail'));
    tail.position.set(0, 0.75, -2.2);
    root.add(tail);

    // A deck-mounted spoiler instead of a wing on endplates: the silhouette cue
    // that separates the stock car from the GT.
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.05, 0.42), accentMat);
    spoiler.position.set(0, 1.62, -2.02);
    spoiler.rotation.x = -0.5;
    root.add(spoiler);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.26, 0.1), carbonMat);
      post.position.set(side * 0.5, 1.47, -2.05);
      root.add(post);
      const fence = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.4), secondaryMat);
      fence.position.set(side * 0.86, 1.6, -2.02);
      fence.rotation.x = -0.5;
      root.add(fence);
    }
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.25, 0.48), carbonMat);
    diffuser.position.set(0, 0.27, -2.18);
    root.add(diffuser);

    this.addStockDetails(root);
    this.addWheelRig(root, true, -0.88, 1.52, 0.34, 0.37);
    this.addWheelRig(root, true, 0.88, 1.52, 0.34, 0.37);
    this.addWheelRig(root, false, -0.9, -1.5, 0.38, 0.38);
    this.addWheelRig(root, false, 0.9, -1.5, 0.38, 0.38);
    this.addHelmet(0, 1.5, -0.26);
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
      const pod = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.2, 0.82, 3, 0.05), bodyMat);
      pod.position.set(side * 0.44, 0.28, -0.06);
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

    this.addKartDetails(root);
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
    const glassMat = glassMaterial('prototype', '#0b141d', 0.12, 0.72, 0.9);
    const headlightMat = this.lightMaterial('head');
    const tailMat = this.lightMaterial('tail');

    // Low, wide endurance-prototype body with a closed canopy.
    const floor = new THREE.Mesh(new RoundedBoxGeometry(1.96, 0.12, 4.72, 3, 0.06), carbonMat);
    floor.position.set(0, 0.2, -0.02);
    root.add(floor);
    const shell = new THREE.Mesh(taperedBoxGeometry(1.78, 1.92, 0.58, 0.42, 4.42), bodyMat);
    shell.position.set(0, 0.53, 0);
    root.add(shell);
    const nose = new THREE.Mesh(new RoundedBoxGeometry(1.3, 0.23, 1.28, 3, 0.08), bodyMat);
    nose.position.set(0, 0.66, 1.6);
    root.add(nose);
    const deck = new THREE.Mesh(taperedBoxGeometry(1.42, 1.18, 0.28, 0.34, 1.82), bodyMat);
    deck.position.set(0, 0.84, -1.0);
    root.add(deck);

    for (const side of [-1, 1]) {
      const frontFender = new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.31, 1.3, 3, 0.1), bodyMat);
      frontFender.position.set(side * 0.99, 0.7, 1.5);
      root.add(frontFender);
      const rearFender = new THREE.Mesh(new RoundedBoxGeometry(0.47, 0.34, 1.38, 3, 0.11), bodyMat);
      rearFender.position.set(side * 1.0, 0.68, -1.5);
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
    rearWing.position.set(0, 1.52, -2.08);
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

    this.addPrototypeDetails(root);
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
    const mergeable = [...groups.entries()].filter(([, meshes]) => meshes.length >= 2);
    const classKey = this.config.carClass;
    const cachedShapes = SHARED_BODY_SHAPES.get(classKey);
    // Only reuse when the class builds exactly the same number of shape groups,
    // otherwise a cached shape could be paired with the wrong material.
    const reuseShapes = cachedShapes && cachedShapes.length === mergeable.length ? cachedShapes : null;
    const builtShapes: THREE.BufferGeometry[] = [];
    mergeable.forEach(([material, meshes], index) => {
      const shared = reuseShapes ? reuseShapes[index] : null;
      if (shared) {
        for (const mesh of meshes) mesh.parent?.remove(mesh);
        const mesh = new THREE.Mesh(shared, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        root.add(mesh);
        builtShapes.push(shared);
        return;
      }
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
          builtShapes.push(merged);
          return;
        }
      } catch {
        // Keep the original meshes if a material has mismatched attributes.
      } finally {
        for (const geo of geos) geo.dispose();
      }
    });
    if (!reuseShapes && builtShapes.length === mergeable.length) {
      SHARED_BODY_SHAPES.set(classKey, builtShapes);
    }
  }

  private addNumberDecals(): void {
    // The scans have their own bodywork; the decal positions below are authored
    // for the procedural shells and would float in mid-air on a model car.
    if (!this.modelRoot || this.usingModel) return;
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
    // Roll at the rate the car's own tyres would: a kart's 0.15 m wheels turned
    // as if they were 0.36 m ones, and the scanned cars keep their measured radii.
    this.wheelSpin += (speed * dt) / this.spinRadius;
    const sinPitch = Math.sin(state.pitch ?? 0);
    const sinRoll = Math.sin(state.roll ?? 0);
    for (const w of this.wheels) {
      if (w.front) w.pivot.rotation.y = state.steer * 0.9;
      if (w.axis === 'x') w.spin.rotation.x = this.wheelSpin;
      else w.spin.rotation.z = this.wheelSpin;
      const rest = this.wheelRest.get(w);
      if (rest) {
        // Lift the tilt gives this wheel's position, cancelled so the tyre stays
        // on the road while the body dives and leans over it.
        const lift = -rest.offsetZ * sinPitch + rest.offsetX * sinRoll;
        w.pivot.position.y = rest.baseY - lift / (rest.scaleY || 1);
      }
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
