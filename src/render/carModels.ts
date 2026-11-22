import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { CarClass } from '../garage/carConfig';

export interface ClassCarModel {
  /** File under assets/models/cars/. */
  file: string;
  /** Extra yaw that turns this model's nose to +Z (the game's forward axis). */
  yaw: number;
}

/**
 * One uploaded scan per closed-wheel class. `hybrid` keeps the original 2026
 * open-wheel template, which the three formula classes share.
 */
export const CLASS_CAR_MODELS: Partial<Record<CarClass, ClassCarModel>> = {
  v10: { file: 'v10_huracan.glb', yaw: 0 },
  junior: { file: 'junior_f4.glb', yaw: 0 },
  gt: { file: 'gt_mustang.glb', yaw: 0 },
  prototype: { file: 'prototype_alpine.glb', yaw: 0 },
  hypercar: { file: 'hypercar_kralz.glb', yaw: 0 },
  stock: { file: 'stock_nascar.glb', yaw: 0 },
  rally: { file: 'rally_yaris.glb', yaw: 0 },
};

/**
 * The uploads carry a different attribute set per part (extra UV channels,
 * vertex colours, skin weights), which makes mergeGeometries refuse to combine
 * them. Keep only position and normal, and swap skinned meshes for static ones
 * so the game's merge pass can collapse the car into a few draw calls.
 */
function normaliseScan(root: THREE.Group): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const mesh of meshes) {
    // Skinned parts (several uploads bind their wheels to bones) only land in the
    // right place through their skeleton, so they are rendered untouched and kept
    // out of the merge pass.
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      mesh.userData.noMerge = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      continue;
    }
    const target = mesh;
    target.castShadow = true;
    target.receiveShadow = true;
    const geometry = target.geometry;
    // Meshopt-compressed uploads arrive interleaved; mergeGeometries reads raw
    // arrays, so an interleaved attribute merged into the car came out as a
    // cube. Copy every attribute into a plain float buffer first.
    for (const name of Object.keys(geometry.attributes)) {
      const attribute = geometry.getAttribute(name);
      if (!(attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) continue;
      const interleaved = attribute as THREE.InterleavedBufferAttribute;
      const array = new Float32Array(interleaved.count * interleaved.itemSize);
      for (let i = 0; i < interleaved.count; i += 1) {
        for (let c = 0; c < interleaved.itemSize; c += 1) {
          array[i * interleaved.itemSize + c] = interleaved.getComponent(i, c);
        }
      }
      geometry.setAttribute(name, new THREE.BufferAttribute(array, interleaved.itemSize));
    }
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
    }
    geometry.morphAttributes = {};
    geometry.clearGroups();
    // The loader fills these from the interleaved accessors; leaving them would
    // make Box3.setFromObject report the old (scrambled) extents.
    geometry.boundingBox = null;
    geometry.boundingSphere = null;
  }
}

const loaded = new Map<CarClass, THREE.Group | null>();
const pending = new Map<CarClass, Promise<THREE.Group | null>>();

/** The model if it has already downloaded, otherwise null (procedural fallback). */
export function getClassCarModel(carClass: CarClass): THREE.Group | null {
  return loaded.get(carClass) ?? null;
}

/**
 * Downloads (once) the scan for a class. Every car of that class — the player's
 * and all twenty AI — clones this same scene, so the geometry and materials are
 * uploaded a single time.
 */
export function ensureClassCarModel(carClass: CarClass): Promise<THREE.Group | null> {
  const spec = CLASS_CAR_MODELS[carClass];
  if (!spec) return Promise.resolve(null);
  if (loaded.has(carClass)) return Promise.resolve(loaded.get(carClass) ?? null);
  const inFlight = pending.get(carClass);
  if (inFlight) return inFlight;

  const promise = new Promise<THREE.Group | null>((resolve) => {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(
      `../../assets/models/cars/${spec.file}`,
      (gltf) => {
        normaliseScan(gltf.scene);
        loaded.set(carClass, gltf.scene);
        resolve(gltf.scene);
      },
      undefined,
      (err) => {
        console.warn(`[car] ${spec.file} unavailable, using the procedural ${carClass} car.`, err);
        loaded.set(carClass, null);
        resolve(null);
      },
    );
  });
  pending.set(carClass, promise);
  return promise;
}
