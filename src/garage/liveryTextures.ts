import { CanvasTexture, SRGBColorSpace, RepeatWrapping } from 'three';
import type { CompoundId } from '../physics/tyres';

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return { canvas, ctx };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const value = parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export function readableInk(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luma > 0.62 ? '#08090c' : '#ffffff';
}

function finishTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Big driver number on a transparent decal; optional 3-letter tag underneath. */
export function createNumberTexture(number: number, accent: string, includeTag: string | null): CanvasTexture {
  const { canvas, ctx } = makeCanvas(512);
  ctx.clearRect(0, 0, 512, 512);
  const ink = readableInk(accent);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 italic 300px "Arial Black", "Segoe UI", system-ui, sans-serif';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 22;
  ctx.strokeStyle = 'rgba(4,6,9,0.92)';
  const num = String(number).padStart(2, '0');
  const y = includeTag ? 246 : 268;
  ctx.strokeText(num, 256, y);
  ctx.fillStyle = accent;
  ctx.fillText(num, 256, y);
  if (includeTag) {
    ctx.font = '800 96px "Segoe UI", system-ui, sans-serif';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(4,6,9,0.9)';
    ctx.strokeText(includeTag, 256, 424);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(includeTag, 256, 424);
  }
  // Thin accent underline to read as an official number plate.
  ctx.fillStyle = accent;
  ctx.fillRect(126, includeTag ? 386 : 400, 260, 9);
  return finishTexture(canvas);
}

/** Circular sidewall with compound band and lettering. */
export function createSidewallTexture(compound: CompoundId, color: string): CanvasTexture {
  const { canvas, ctx } = makeCanvas(512);
  ctx.fillStyle = '#0b0c0e';
  ctx.beginPath();
  ctx.arc(256, 256, 255, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.arc(256, 256, 220, 0, Math.PI * 2);
  ctx.stroke();
  ctx.save();
  ctx.translate(256, 256);
  ctx.fillStyle = '#e8e8e8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI * 2) / 3);
    ctx.font = '700 34px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('APEX', 0, -168);
    ctx.font = '800 30px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(compound.toUpperCase(), 0, -128);
    ctx.fillStyle = '#e8e8e8';
    ctx.restore();
  }
  ctx.restore();
  const tex = finishTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  return tex;
}

/** Soft radial asphalt texture used on the track ribbon. */
export function createAsphaltTexture(): CanvasTexture {
  const { canvas, ctx } = makeCanvas(512);
  ctx.fillStyle = '#2b2d31';
  ctx.fillRect(0, 0, 512, 512);
  const img = ctx.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 34;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + noise));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + noise));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + noise));
  }
  ctx.putImageData(img, 0, 0);
  // faint rubbered-in racing line
  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, 'rgba(10,10,12,0)');
  grad.addColorStop(0.5, 'rgba(8,8,10,0.32)');
  grad.addColorStop(1, 'rgba(10,10,12,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);
  const tex = finishTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(1, 12);
  return tex;
}

/** Braking board / DRS signage texture. */
export function createSignTexture(text: string, bg = '#ffffff', fg = '#0a0b0d'): CanvasTexture {
  const { canvas, ctx } = makeCanvas(256);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 92px "Arial Black", "Segoe UI", sans-serif';
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    ctx.fillText(line, 128, 128 + (i - (lines.length - 1) / 2) * 88);
  });
  return finishTexture(canvas);
}
