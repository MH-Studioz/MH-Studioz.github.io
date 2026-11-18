/**
 * All audio is synthesised at runtime with the Web Audio API — no assets,
 * no network, no keys. The context is created on the first user gesture.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  muted = false;

  constructor(muted = false) {
    this.muted = muted;
  }

  unlock(): void {
    if (this.muted) return;
    try {
      const ctx = this.ensure();
      if (ctx.state === 'suspended') void ctx.resume();
    } catch {
      /* audio unsupported — the game stays playable */
    }
  }

  private ensure(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error('Web Audio unavailable');
      this.ctx = new Ctor();
    }
    return this.ctx;
  }

  private tone(opts: {
    freq: number;
    to?: number;
    type?: OscillatorType;
    duration?: number;
    gain?: number;
    delay?: number;
    filter?: number;
  }): void {
    if (this.muted) return;
    let ctx: AudioContext;
    try {
      ctx = this.ensure();
    } catch {
      return;
    }
    if (ctx.state === 'suspended') void ctx.resume();

    const start = ctx.currentTime + (opts.delay ?? 0);
    const duration = opts.duration ?? 0.18;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, start);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(30, opts.to), start + duration);

    let node: AudioNode = osc;
    if (opts.filter) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = opts.filter;
      osc.connect(lp);
      node = lp;
    }

    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(opts.gain ?? 0.06, start + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    node.connect(amp);
    amp.connect(ctx.destination);

    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  tick(urgent: boolean): void {
    this.tone({
      freq: urgent ? 1560 : 1050,
      type: 'square',
      duration: 0.028,
      gain: urgent ? 0.035 : 0.018,
      filter: 2600,
    });
  }

  sonar(): void {
    this.tone({ freq: 1320, to: 720, type: 'sine', duration: 0.55, gain: 0.035 });
    this.tone({ freq: 660, to: 380, type: 'sine', duration: 0.75, gain: 0.02, delay: 0.08 });
  }

  buzz(): void {
    this.tone({ freq: 148, to: 86, type: 'sawtooth', duration: 0.24, gain: 0.055, filter: 700 });
  }

  click(): void {
    this.tone({ freq: 1800, type: 'square', duration: 0.02, gain: 0.02, filter: 3200 });
  }

  chime(deep: boolean): void {
    const notes = deep ? [523.25, 659.25, 830.61, 1046.5] : [440, 554.37, 659.25];
    notes.forEach((freq, i) => {
      this.tone({
        freq,
        type: 'sine',
        duration: 0.42,
        gain: 0.045,
        delay: i * 0.075,
      });
    });
  }

  miss(): void {
    this.tone({ freq: 300, to: 180, type: 'triangle', duration: 0.4, gain: 0.04 });
    this.tone({ freq: 150, to: 96, type: 'sine', duration: 0.5, gain: 0.035, delay: 0.08 });
  }

  finish(): void {
    [392, 523.25, 659.25, 783.99].forEach((freq, i) => {
      this.tone({ freq, type: 'sine', duration: 0.7, gain: 0.04, delay: i * 0.13 });
    });
  }
}
