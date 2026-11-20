export interface AudioState {
  rpm: number;
  throttle: number;
  speed: number;
  slip: number;
  brake: number;
}

// The page lives two directories deep (/games/apex-gp-2026/), public assets stay at the site root.
const ENGINE_URL = '../../assets/audio/engine_loop.wav';
const TYRE_URL = '../../assets/audio/tyre_screech.wav';

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = last * 0.94 + white * 0.06;
    data[i] = last * 2.2;
  }
  return buffer;
}

/** Engine + tyre sound. Uses the bundled WAV loops, with a synthesized V6 hybrid if decode fails. */
export class EngineAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineSource: AudioBufferSourceNode | null = null;
  private tyreGain: GainNode | null = null;
  private tyreFilter: BiquadFilterNode | null = null;
  private tyreSource: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private synth: {
    oscillators: OscillatorNode[];
    gains: GainNode[];
    filter: BiquadFilterNode;
    turbo: OscillatorNode;
    turboGain: GainNode;
  } | null = null;
  private initialised = false;
  private running = false;
  private muted = false;
  private slip = 0;

  async init(): Promise<void> {
    if (this.initialised) return;
    this.initialised = true;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    this.master = master;

    // Wind / airflow bed.
    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuffer(ctx, 4);
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 900;
    windFilter.Q.value = 0.4;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.015;
    wind.connect(windFilter).connect(windGain).connect(master);
    wind.start();
    this.windGain = windGain;

    const engineBuffer = await this.load(ENGINE_URL);
    if (engineBuffer) {
      const source = ctx.createBufferSource();
      source.buffer = engineBuffer;
      source.loop = true;
      source.playbackRate.value = 1;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1800;
      filter.Q.value = 1.1;
      const gain = ctx.createGain();
      gain.gain.value = 0.0;
      source.connect(filter).connect(gain).connect(master);
      source.start();
      this.engineSource = source;
      this.engineFilter = filter;
      this.engineGain = gain;
    } else {
      this.buildSynth(master);
    }

    const tyreBuffer = await this.load(TYRE_URL);
    const tyreSource = ctx.createBufferSource();
    tyreSource.buffer = tyreBuffer ?? noiseBuffer(ctx, 2.5);
    tyreSource.loop = true;
    const tyreFilter = ctx.createBiquadFilter();
    tyreFilter.type = 'bandpass';
    tyreFilter.frequency.value = 1900;
    tyreFilter.Q.value = 5;
    const tyreGain = ctx.createGain();
    tyreGain.gain.value = 0;
    tyreSource.connect(tyreFilter).connect(tyreGain).connect(master);
    tyreSource.start();
    this.tyreSource = tyreSource;
    this.tyreFilter = tyreFilter;
    this.tyreGain = tyreGain;
  }

  private async load(url: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    try {
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.arrayBuffer();
      return await this.ctx.decodeAudioData(data);
    } catch (err) {
      console.warn('[audio] sample unavailable:', url, err);
      return null;
    }
  }

  private buildSynth(master: GainNode): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2200;
    filter.Q.value = 2.4;
    const gain = ctx.createGain();
    gain.gain.value = 0.0;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.4);
    }
    shaper.curve = curve;
    filter.connect(shaper).connect(gain).connect(master);

    const gains: GainNode[] = [];
    const oscillators: OscillatorNode[] = [];
    const specs: Array<[OscillatorType, number, number]> = [
      ['sawtooth', 1, 0.22],
      ['sawtooth', 2.01, 0.12],
      ['square', 0.5, 0.14],
      ['sine', 3.02, 0.07],
    ];
    for (const [type, mult, level] of specs) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = 110 * mult;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(filter);
      osc.start();
      oscillators.push(osc);
      gains.push(g);
    }
    const turbo = ctx.createOscillator();
    turbo.type = 'sine';
    turbo.frequency.value = 5200;
    const turboGain = ctx.createGain();
    turboGain.gain.value = 0.0;
    turbo.connect(turboGain).connect(master);
    turbo.start();
    this.synth = { oscillators, gains, filter, turbo, turboGain };
    this.engineGain = gain;
    this.engineFilter = filter;
  }

  async start(): Promise<void> {
    await this.init();
    if (!this.ctx || !this.master) return;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.running = true;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, now, 0.12);
  }

  stop(): void {
    this.running = false;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.master && this.running) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  update(state: AudioState): void {
    if (!this.ctx || !this.running) return;
    const t = this.ctx.currentTime;
    const rpmNorm = Math.max(0, Math.min(1, state.rpm / 13000));
    const speedNorm = Math.max(0, Math.min(1, state.speed / 95));

    if (this.engineSource && this.engineFilter && this.engineGain) {
      this.engineSource.playbackRate.setTargetAtTime(0.62 + rpmNorm * 1.05, t, 0.03);
      this.engineFilter.frequency.setTargetAtTime(1000 + state.throttle * 5200 + rpmNorm * 2200, t, 0.06);
      this.engineGain.gain.setTargetAtTime(0.12 + state.throttle * 0.2 + speedNorm * 0.03, t, 0.05);
    }
    if (this.synth) {
      const base = 34 + rpmNorm * 118;
      this.synth.oscillators.forEach((osc, i) => {
        const mult = i === 0 ? 1 : i === 1 ? 2.01 : i === 2 ? 0.5 : 3.02;
        osc.frequency.setTargetAtTime(base * mult, t, 0.035);
      });
      this.synth.filter.frequency.setTargetAtTime(700 + state.throttle * 3800 + rpmNorm * 1600, t, 0.08);
      if (this.engineGain) this.engineGain.gain.setTargetAtTime(0.16 + state.throttle * 0.28, t, 0.06);
      this.synth.turbo.frequency.setTargetAtTime(3800 + rpmNorm * 4200, t, 0.05);
      this.synth.turboGain.gain.setTargetAtTime(state.throttle * 0.016 + speedNorm * 0.006, t, 0.1);
    }

    this.slip += (state.slip - this.slip) * 0.25;
    if (this.tyreGain && this.tyreFilter) {
      this.tyreGain.gain.setTargetAtTime(Math.min(0.55, this.slip * 0.5), t, 0.05);
      this.tyreFilter.frequency.setTargetAtTime(1500 + this.slip * 1700, t, 0.1);
    }
    if (this.tyreSource) this.tyreSource.playbackRate.setTargetAtTime(0.9 + this.slip * 0.22, t, 0.1);
    if (this.windGain) this.windGain.gain.setTargetAtTime(0.01 + speedNorm * 0.05, t, 0.15);
  }

  dispose(): void {
    try {
      this.engineSource?.stop();
      this.tyreSource?.stop();
      this.synth?.oscillators.forEach((o) => o.stop());
      this.synth?.turbo.stop();
      void this.ctx?.close();
    } catch {
      /* already stopped */
    }
    this.ctx = null;
    this.initialised = false;
  }
}
