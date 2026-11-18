import * as THREE from 'three';
import type { CarConfig } from './carConfig';
import { CarVisual } from '../render/carVisual';

export class GaragePreview {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private car: CarVisual | null = null;
  private template: THREE.Group | null;
  private config: CarConfig;
  private angle = 0.5;
  private autoRotate = true;
  private dragging = false;
  private lastX = 0;
  private frame = 0;
  private running = false;
  private rebuildTimer: number | null = null;

  constructor(canvas: HTMLCanvasElement, config: CarConfig, template: THREE.Group | null) {
    this.canvas = canvas;
    this.config = config;
    this.template = template;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color('#080a0f');
    this.scene.fog = new THREE.Fog('#080a0f', 14, 30);
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    this.camera.position.set(5.4, 2.7, 8.4);
    this.camera.lookAt(0, 0.62, 0);

    this.buildStudio();
    this.rebuild();

    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.autoRotate = false;
      this.lastX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.angle += (e.clientX - this.lastX) * 0.008;
      this.lastX = e.clientX;
    });
    const end = () => {
      this.dragging = false;
      window.setTimeout(() => {
        if (!this.dragging) this.autoRotate = true;
      }, 1800);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => {
      this.dragging = false;
    });
  }

  private buildStudio(): void {
    const hemi = new THREE.HemisphereLight('#bcd6ff', '#08090c', 0.65);
    this.scene.add(hemi);

    const key = new THREE.SpotLight('#fff2dc', 420, 40, 0.62, 0.55, 1.5);
    key.position.set(4.5, 8, 5);
    key.target.position.set(0, 0.6, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0008;
    this.scene.add(key);
    this.scene.add(key.target);

    const rim = new THREE.SpotLight('#2f7dff', 300, 35, 0.7, 0.5, 1.6);
    rim.position.set(-6, 5, -4);
    rim.target.position.set(0, 0.6, 0);
    this.scene.add(rim);
    this.scene.add(rim.target);

    const front = new THREE.PointLight('#e10600', 90, 18, 2);
    front.position.set(0, 1.2, 6.5);
    this.scene.add(front);

    // Turn table.
    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(4.1, 4.3, 0.16, 72),
      new THREE.MeshStandardMaterial({ color: '#12151b', roughness: 0.42, metalness: 0.55 }),
    );
    floor.position.y = -0.08;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(3.62, 0.018, 8, 120),
      new THREE.MeshBasicMaterial({ color: '#e10600', toneMapped: false }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.013;
    this.scene.add(ring);

    const ring2 = new THREE.Mesh(
      new THREE.TorusGeometry(3.95, 0.008, 6, 120),
      new THREE.MeshBasicMaterial({ color: '#2f7dff', transparent: true, opacity: 0.55, toneMapped: false }),
    );
    ring2.rotation.x = Math.PI / 2;
    ring2.position.y = 0.012;
    this.scene.add(ring2);

    const grid = new THREE.GridHelper(9, 30, '#1b2430', '#11161e');
    grid.position.y = -0.155;
    this.scene.add(grid);

    // Backdrop glow panels.
    for (let i = 0; i < 5; i++) {
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(5, 0.03),
        new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? '#e10600' : '#1b4fa0', transparent: true, opacity: 0.2, toneMapped: false }),
      );
      panel.position.set(0, 1.2 + i * 0.9, -7);
      this.scene.add(panel);
    }
  }

  private rebuild(): void {
    if (this.car) {
      this.scene.remove(this.car.group);
      this.car = null;
    }
    this.car = new CarVisual(this.config, this.template);
    this.car.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).castShadow = true;
        (o as THREE.Mesh).receiveShadow = true;
      }
    });
    this.scene.add(this.car.group);
    this.car.group.rotation.y = 0;
  }

  setConfig(config: CarConfig): void {
    this.config = config;
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => {
      this.rebuildTimer = null;
      this.rebuild();
    }, 90);
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    const w = Math.max(320, parent?.clientWidth ?? window.innerWidth / 2);
    const h = Math.max(320, parent?.clientHeight ?? window.innerHeight * 0.7);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.resize();
    const loop = () => {
      if (!this.running) return;
      this.frame = requestAnimationFrame(loop);
      const dt = 1 / 60;
      if (this.autoRotate && !this.dragging) this.angle += dt * 0.22;
      if (this.car) {
        this.car.group.rotation.y = this.angle;
        this.car.update(dt, { speed: 0, steer: 0, drs: false, brake: 0 });
      }
      this.renderer.render(this.scene, this.camera);
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  dispose(): void {
    this.stop();
    this.renderer.dispose();
  }
}
