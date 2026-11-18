import * as THREE from 'three';
import type { CarConfig } from '../garage/carConfig';
import type { RacingLineMode } from '../physics/settings';
import type { RaceCar } from '../physics/vehicle';
import type { TrackData } from '../tracks/types';
import { CameraRig, type CameraMode } from './cameraRig';
import { CarVisual } from './carVisual';
import { buildEnvironment } from './environment';
import { buildRacingLineMesh, buildTrackGroup } from './trackMesh';

interface GhostFrame {
  pos: THREE.Vector3;
  heading: number;
  index: number;
}

export class RaceRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly track: TrackData;
  readonly visuals: CarVisual[] = [];
  readonly trackGroup: THREE.Group;
  private racingLine: THREE.Object3D | null = null;
  private racingLineMode: RacingLineMode = 'corners';
  private ghost: CarVisual | null = null;
  private ghostFrames: GhostFrame[] = [];
  private ghostRecording: GhostFrame[] = [];
  private ghostClock = 0;
  private ghostLapTime = Number.POSITIVE_INFINITY;
  private disposed = false;
  private frameTime = 0;
  private frameSamples = 0;
  private qualityTimer = 0;
  private qualityLow = false;

  constructor(
    canvas: HTMLCanvasElement,
    track: TrackData,
    playerConfig: CarConfig,
    aiConfigs: CarConfig[],
    template: THREE.Group | null,
  ) {
    this.track = track;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = track.night ? 1.2 : 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    // A tiny procedural sky/ground probe gives painted bodywork proper
    // reflections without another copy of three.js or a large HDR download.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envCanvas = document.createElement('canvas');
    envCanvas.width = 256;
    envCanvas.height = 128;
    const envCtx = envCanvas.getContext('2d');
    if (envCtx) {
      const grad = envCtx.createLinearGradient(0, 0, 0, 128);
      grad.addColorStop(0, track.night ? '#07101f' : '#6d9bc5');
      grad.addColorStop(0.45, track.night ? '#16243a' : '#d7e2ea');
      grad.addColorStop(0.56, track.night ? '#2b2118' : '#8b8a80');
      grad.addColorStop(1, track.night ? '#050607' : '#3a3d35');
      envCtx.fillStyle = grad;
      envCtx.fillRect(0, 0, 256, 128);
    }
    const envTex = new THREE.CanvasTexture(envCanvas);
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    envTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.environment = pmrem.fromEquirectangular(envTex).texture;
    this.scene.environmentIntensity = 0.5;
    envTex.dispose();
    pmrem.dispose();

    const environment = buildEnvironment(track);
    const fog = (environment.userData as { fog?: THREE.Fog }).fog;
    if (fog) this.scene.fog = fog;
    this.scene.background = new THREE.Color(track.night ? '#04060c' : '#a9c6da');
    this.scene.add(environment);

    this.trackGroup = buildTrackGroup(track);
    this.scene.add(this.trackGroup);

    this.rig = new CameraRig(window.innerWidth / Math.max(1, window.innerHeight));

    // Player car first, then the AI field. Only the player gets the 1.2M-
    // triangle scanned model; cloning it ten times was the single biggest
    // frame-time cost in a full grid. AI use the lightweight procedural body.
    this.visuals.push(new CarVisual(playerConfig, template));
    for (const config of aiConfigs) this.visuals.push(new CarVisual(config, null, true));
    this.visuals.forEach((visual, i) => {
      visual.group.userData.index = i;
      if (i > 0) {
        visual.group.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = false;
        });
      }
      this.scene.add(visual.group);
    });

    this.racingLineMode = 'corners';
    this.refreshRacingLine();
  }

  setRacingLine(mode: RacingLineMode): void {
    this.racingLineMode = mode;
    this.refreshRacingLine();
  }

  private refreshRacingLine(): void {
    if (this.racingLine) {
      this.scene.remove(this.racingLine);
      this.racingLine = null;
    }
    const line = buildRacingLineMesh(this.track, this.racingLineMode);
    if (line) {
      this.scene.add(line);
      this.racingLine = line;
    }
  }

  syncCar(index: number, car: RaceCar, dt: number): void {
    const visual = this.visuals[index];
    if (!visual) return;
    const sample = car.sample;
    visual.group.position.copy(car.pos);
    const basis = new THREE.Matrix4().makeBasis(sample.right, sample.up, sample.tangent);
    const qTrack = new THREE.Quaternion().setFromRotationMatrix(basis);
    const trackHeading = Math.atan2(sample.tangent.x, sample.tangent.z);
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), car.heading - trackHeading);
    visual.group.quaternion.copy(qTrack).multiply(yaw);
    visual.update(dt, {
      speed: car.speed,
      steer: car.steerAngle,
      drs: car.drsOpen,
      brake: car.brake,
      damage: car.damage,
      compound: car.getCompound(),
    });
  }

  update(dt: number, cars: RaceCar[], playerIndex = 0): void {
    for (let i = 0; i < cars.length && i < this.visuals.length; i++) {
      this.syncCar(i, cars[i], dt);
    }
    const player = cars[playerIndex];
    if (player) {
      this.rig.update(dt, player.pos, player.heading, player.speed);
      this.rig.addShake(player.impactPulse * 0.5);
    }
    this.adaptQuality(dt);
    this.render();
  }

  /** Drop render resolution after a sustained slow patch, then recover. */
  private adaptQuality(dt: number): void {
    this.frameTime += dt;
    this.frameSamples++;
    this.qualityTimer += dt;
    if (this.qualityTimer < 2.2) return;
    const avg = this.frameTime / Math.max(1, this.frameSamples);
    this.qualityTimer = 0;
    this.frameTime = 0;
    this.frameSamples = 0;
    const native = Math.min(window.devicePixelRatio || 1, 1.35);
    if (avg > 0.024 && !this.qualityLow) {
      this.qualityLow = true;
      this.renderer.setPixelRatio(1);
    } else if (avg < 0.0165 && this.qualityLow) {
      this.qualityLow = false;
      this.renderer.setPixelRatio(native);
    }
  }

  render(): void {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.rig.camera);
  }

  cycleCamera(): CameraMode {
    return this.rig.cycle();
  }

  get cameraMode(): CameraMode {
    return this.rig.mode;
  }

  createGhost(config: CarConfig, template: THREE.Group | null): void {
    this.removeGhost();
    const ghost = new CarVisual(config, null, true);
    ghost.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        const m = mat as THREE.MeshStandardMaterial;
        m.transparent = true;
        m.opacity = 0.34;
        m.depthWrite = false;
        if (m.emissive) m.emissive.set('#1b6fff');
      }
      mesh.castShadow = false;
      mesh.renderOrder = 1;
    });
    ghost.group.visible = false;
    this.scene.add(ghost.group);
    this.ghost = ghost;
    this.ghostFrames = [];
    this.ghostRecording = [];
    this.ghostClock = 0;
    this.ghostLapTime = Number.POSITIVE_INFINITY;
  }

  beginGhostLap(): void {
    this.ghostRecording = [];
  }

  recordGhost(dt: number, car: RaceCar): void {
    if (!this.ghost) return;
    this.ghostClock += dt;
    // Playback samples at 20 Hz, so record at the same cadence.
    if (this.ghostClock >= 0.05) {
      this.ghostRecording.push({ pos: car.pos.clone(), heading: car.heading, index: car.index });
      this.ghostClock = 0;
      if (this.ghostRecording.length > 12000) this.ghostRecording.shift();
    }
  }

  /** Keep the fastest completed lap and start replaying it as the ghost. */
  completeGhostLap(lapTime = Number.POSITIVE_INFINITY): void {
    if (this.ghostRecording.length > 2 && lapTime < this.ghostLapTime) {
      this.ghostFrames = this.ghostRecording;
      this.ghostLapTime = lapTime;
    }
    this.ghostRecording = [];
    this.startGhostPlayback();
  }

  startGhostPlayback(): void {
    if (!this.ghost) return;
    this.ghost.group.visible = this.ghostFrames.length > 2;
    this.ghostClock = 0;
  }

  setCarVisible(index: number, visible: boolean): void {
    const visual = this.visuals[index];
    if (visual) visual.group.visible = visible;
  }

  updateGhost(dt: number, speedFactor = 1): void {
    if (!this.ghost || !this.ghost.group.visible) return;
    this.ghostClock += dt * speedFactor;
    const fps = 20;
    const raw = this.ghostClock * fps;
    const i = Math.floor(raw);
    const t = raw - i;
    const a = this.ghostFrames[Math.min(i, this.ghostFrames.length - 1)];
    const b = this.ghostFrames[Math.min(i + 1, this.ghostFrames.length - 1)];
    if (!a || !b) return;
    const pos = new THREE.Vector3().lerpVectors(a.pos, b.pos, t);
    const heading = a.heading + shortestAngle(a.heading, b.heading) * t;
    const sample = this.track.samples[a.index];
    const basis = new THREE.Matrix4().makeBasis(sample.right, sample.up, sample.tangent);
    const q = new THREE.Quaternion().setFromRotationMatrix(basis);
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading - Math.atan2(sample.tangent.x, sample.tangent.z));
    this.ghost.group.position.copy(pos);
    this.ghost.group.quaternion.copy(q).multiply(yaw);
    this.ghost.update(dt, { speed: 55, steer: 0, drs: false, brake: 0 });
    if (i >= this.ghostFrames.length - 2) this.ghost.group.visible = false;
  }

  removeGhost(): void {
    if (this.ghost) {
      this.scene.remove(this.ghost.group);
      this.ghost = null;
      this.ghostFrames = [];
      this.ghostLapTime = Number.POSITIVE_INFINITY;
    }
  }

  resize(): void {
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight);
    this.renderer.setSize(w, h, false);
    this.rig.resize(w / h);
  }

  dispose(): void {
    this.disposed = true;
    this.removeGhost();
    this.renderer.dispose();
    // Geometry and the GLB template are shared across sessions; never dispose
    // them here or a restart would render an empty car.
  }
}

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
