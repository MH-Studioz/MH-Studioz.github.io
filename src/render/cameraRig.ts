import * as THREE from 'three';

export type CameraMode = 'chase' | 'interior' | 'hood' | 'tv';

export const CAMERA_MODES: CameraMode[] = ['chase', 'interior', 'hood', 'tv'];

/**
 * Onboard cameras ride with the car, so they take their offset in car-local
 * units (metres) and look straight down the road rather than lagging behind.
 */
interface OnboardCamera {
  eye: [number, number, number];
  look: [number, number, number];
  follow: number;
  fov: number;
}

const ONBOARD: Record<'interior' | 'hood', OnboardCamera> = {
  // Driver's eye: low, behind the windscreen, level with the wheel rim.
  interior: { eye: [0, 1.14, -0.55], look: [0, 0.95, 40], follow: 42, fov: 72 },
  // Bonnet: just ahead of the screen, low over the nose.
  hood: { eye: [0, 1.02, 1.78], look: [0, 0.72, 36], follow: 46, fov: 76 },
};

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'chase';
  private look = new THREE.Vector3();
  private pos = new THREE.Vector3();
  private shake = 0;
  private initialised = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(64, aspect, 0.1, 6000);
    this.camera.position.set(0, 8, -12);
  }

  cycle(): CameraMode {
    const idx = CAMERA_MODES.indexOf(this.mode);
    this.mode = CAMERA_MODES[(idx + 1) % CAMERA_MODES.length];
    return this.mode;
  }

  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  update(dt: number, carPos: THREE.Vector3, heading: number, speed: number): void {
    const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    const right = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
    const speedFov = 63 + Math.min(16, Math.abs(speed) * 0.18);

    if (!this.initialised) {
      this.pos.copy(carPos).addScaledVector(forward, -8).add(new THREE.Vector3(0, 3.4, 0));
      this.look.copy(carPos).addScaledVector(forward, 8);
      this.initialised = true;
    }

    if (this.mode === 'chase') {
      const desired = new THREE.Vector3().copy(carPos);
      desired.add(new THREE.Vector3(0, 2.72, 0));
      desired.addScaledVector(forward, -7.4);
      const follow = 1 - Math.exp(-dt * 5.4);
      this.pos.lerp(desired, follow);
      const lookTarget = new THREE.Vector3().copy(carPos);
      lookTarget.add(new THREE.Vector3(0, 0.75, 0));
      lookTarget.addScaledVector(forward, 12);
      this.look.lerp(lookTarget, 1 - Math.exp(-dt * 8));
      this.camera.fov += (speedFov - this.camera.fov) * Math.min(1, dt * 4);
    } else if (this.mode === 'interior' || this.mode === 'hood') {
      const rig = ONBOARD[this.mode];
      const desired = new THREE.Vector3().copy(carPos);
      desired.addScaledVector(forward, rig.eye[2]);
      desired.addScaledVector(right, rig.eye[0]);
      desired.y += rig.eye[1];
      this.pos.lerp(desired, 1 - Math.exp(-dt * rig.follow));
      const lookTarget = new THREE.Vector3().copy(carPos);
      lookTarget.addScaledVector(forward, rig.look[2]);
      lookTarget.y += rig.look[1];
      this.look.lerp(lookTarget, 1 - Math.exp(-dt * (rig.follow - 6)));
      this.camera.fov += (rig.fov - this.camera.fov) * Math.min(1, dt * 6);
    } else {
      const desired = new THREE.Vector3().copy(carPos).addScaledVector(forward, -16);
      desired.y += 17;
      this.pos.lerp(desired, 1 - Math.exp(-dt * 2.4));
      const lookTarget = new THREE.Vector3().copy(carPos).addScaledVector(forward, 9);
      lookTarget.y += 0.8;
      this.look.lerp(lookTarget, 1 - Math.exp(-dt * 4.5));
      this.camera.fov += (70 - this.camera.fov) * Math.min(1, dt * 3);
    }

    this.shake = Math.max(0, this.shake - dt * 2.2);
    const jitter = this.shake * 0.16;
    this.camera.position.copy(this.pos);
    if (jitter > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * jitter;
      this.camera.position.y += (Math.random() - 0.5) * jitter * 0.6;
    }
    this.camera.lookAt(this.look);
    this.camera.updateProjectionMatrix();
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
