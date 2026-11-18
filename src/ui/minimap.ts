import type { RaceCar } from '../physics/vehicle';
import type { TrackData } from '../tracks/types';

interface Point {
  x: number;
  y: number;
}

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private track: TrackData;
  private points: Point[] = [];
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private width = 600;
  private height = 336;

  constructor(container: HTMLElement, track: TrackData) {
    this.track = track;
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    container.innerHTML = '';
    container.appendChild(canvas);
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('minimap canvas unavailable');
    this.ctx = ctx;
    this.buildProjection();
  }

  private buildProjection(): void {
    const samples = this.track.samples;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const s of samples) {
      minX = Math.min(minX, s.pos.x);
      maxX = Math.max(maxX, s.pos.x);
      minZ = Math.min(minZ, s.pos.z);
      maxZ = Math.max(maxZ, s.pos.z);
    }
    const pad = 34;
    const sx = (this.width - pad * 2) / Math.max(1, maxX - minX);
    const sz = (this.height - pad * 2) / Math.max(1, maxZ - minZ);
    this.scale = Math.min(sx, sz);
    this.offsetX = (this.width - (maxX - minX) * this.scale) / 2 - minX * this.scale;
    this.offsetY = (this.height - (maxZ - minZ) * this.scale) / 2 - minZ * this.scale;
    this.points = samples.map((s) => ({
      x: s.pos.x * this.scale + this.offsetX,
      y: s.pos.z * this.scale + this.offsetY,
    }));
  }

  private pointAt(index: number): Point {
    const n = this.track.samples.length;
    const p = this.points[((index % n) + n) % n];
    return p;
  }

  update(cars: RaceCar[], playerIndex = 0): void {
    const ctx = this.ctx;
    const track = this.track;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = 'rgba(6,8,12,0.36)';
    ctx.fillRect(0, 0, this.width, this.height);

    // DRS glow.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(56,232,255,0.18)';
    ctx.lineWidth = 12;
    for (let i = 0; i < this.points.length; i += 2) {
      if (!track.samples[i].drs) continue;
      const a = this.pointAt(i);
      const b = this.pointAt(i + 2);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Track base.
    ctx.strokeStyle = '#2c333d';
    ctx.lineWidth = 9;
    this.strokePath(0, this.points.length, 1);
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 5;
    this.strokePath(0, this.points.length, 1);

    // Sector overlays.
    const sectorColors = ['#e10600', '#ffd400', '#19d3ff'];
    for (let sector = 0; sector < 3; sector++) {
      ctx.strokeStyle = sectorColors[sector];
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < this.points.length; i++) {
        if (track.samples[i].sector !== sector + 1) continue;
        const p = this.points[i];
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else {
          ctx.lineTo(p.x, p.y);
        }
      }
      ctx.stroke();
    }

    // Start line.
    const start = this.pointAt(0);
    const startNext = this.pointAt(2);
    const angle = Math.atan2(startNext.y - start.y, startNext.x - start.x);
    ctx.save();
    ctx.translate(start.x, start.y);
    ctx.rotate(angle);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-2, -11, 4, 22);
    ctx.restore();

    // Cars.
    for (let i = cars.length - 1; i >= 0; i--) {
      const car = cars[i];
      const idx = car.index;
      const n = track.samples.length;
      const s = track.samples[((idx % n) + n) % n];
      const x = (car.pos.x) * this.scale + this.offsetX;
      const y = (car.pos.z) * this.scale + this.offsetY;
      const isPlayer = i === playerIndex;
      if (isPlayer) {
        ctx.beginPath();
        ctx.arc(x, y, 6.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(225,6,0,0.28)';
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x, y, isPlayer ? 4.6 : 3.2, 0, Math.PI * 2);
      ctx.fillStyle = isPlayer ? '#ffffff' : car.getCompoundColor();
      ctx.fill();
      if (isPlayer) {
        ctx.strokeStyle = '#e10600';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
      void s;
    }
  }

  private strokePath(from: number, to: number, step: number): void {
    this.ctx.beginPath();
    for (let i = from; i < to; i += step) {
      const p = this.points[i];
      if (i === from) this.ctx.moveTo(p.x, p.y);
      else this.ctx.lineTo(p.x, p.y);
    }
    this.ctx.closePath();
    this.ctx.stroke();
  }
}
