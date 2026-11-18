import {
  haversineKm,
  rawDepth,
  rarestIn,
  resolveGuess,
  timedDepth,
  type Place,
  type RegionId,
} from './data';
import {
  buildPinpointPrompts,
  buildPrompts,
  createPromptFactory,
  type ModeId,
  type Prompt,
} from './prompts';

export interface Entry {
  prompt: Prompt;
  answer: Place | null;
  distanceKm: number | null;
  depth: number;
  percentile: number;
  trap: boolean;
  gem: boolean;
  missed: boolean;
  best: Place;
  bestDepth: number;
  bestPercentile: number;
  bonusMs: number;
  secondsLeft: number;
}

export interface RoundConfig {
  mode: ModeId;
  region: RegionId;
  seed: number;
  number: number;
}

export interface RoundResult {
  config: RoundConfig;
  entries: Entry[];
  totalDepth: number;
  hits: number;
  completedAt: number;
}

export interface EngineHooks {
  onPrompt(prompt: Prompt, index: number, total: number | null, seconds: number): void;
  onTick(secondsLeft: number, totalSeconds: number): void;
  onReveal(entry: Entry, final: boolean): void;
  onReject(message: string): void;
  onPause(paused: boolean): void;
  onEnd(result: RoundResult): void;
}

const PROMPT_SECONDS = 20;
const REVEAL_MS = 2600;
const MISS_REVEAL_MS = 3000;
const ENDLESS_BONUS_MS = 5000;

export function promptCountFor(mode: ModeId): number | null {
  if (mode === 'blitz') return 5;
  if (mode === 'pinpoint') return 5;
  if (mode === 'endless') return null;
  return 7;
}

export class Game {
  private hooks: EngineHooks;
  private config: RoundConfig | null = null;
  private prompts: Prompt[] = [];
  private endlessFactory: (() => Prompt) | null = null;
  private entries: Entry[] = [];
  private index = 0;
  private totalDepth = 0;
  private hits = 0;
  private used = new Set<string>();

  private running = false;
  private paused = false;
  private revealing = false;
  private pendingFinish = false;

  private timeLeftMs = PROMPT_SECONDS * 1000;
  private timeTotalMs = PROMPT_SECONDS * 1000;
  private bankMs = PROMPT_SECONDS * 1000;
  private lastNow = 0;
  private lastSecond = PROMPT_SECONDS;

  private interval: number | null = null;
  private autoTimer: number | null = null;

  constructor(hooks: EngineHooks) {
    this.hooks = hooks;
  }

  start(config: RoundConfig): void {
    this.stop();
    this.config = config;
    this.entries = [];
    this.index = 0;
    this.totalDepth = 0;
    this.hits = 0;
    this.used.clear();
    this.bankMs = PROMPT_SECONDS * 1000;
    this.pendingFinish = false;
    this.revealing = false;
    this.paused = false;
    this.running = true;

    if (config.mode === 'endless') {
      this.endlessFactory = createPromptFactory(config.seed, config.region);
      this.prompts = [this.endlessFactory()];
    } else if (config.mode === 'pinpoint') {
      this.prompts = buildPinpointPrompts(promptCountFor('pinpoint') ?? 5, config.seed, config.region);
    } else {
      this.prompts = buildPrompts(promptCountFor(config.mode) ?? 7, config.seed, config.region);
    }

    this.begin(0);
    this.interval = window.setInterval(() => this.tick(), 100);
  }

  private begin(index: number): void {
    const prompt = this.prompts[index];
    if (!prompt) {
      this.finish();
      return;
    }
    this.index = index;
    this.revealing = false;
    this.paused = false;

    this.timeTotalMs = this.config?.mode === 'endless' ? this.bankMs : PROMPT_SECONDS * 1000;
    this.timeLeftMs = this.timeTotalMs;
    this.lastNow = performance.now();
    this.lastSecond = Math.ceil(this.timeLeftMs / 1000);

    this.hooks.onPrompt(
      prompt,
      index,
      promptCountFor(this.config?.mode ?? 'daily'),
      this.timeTotalMs / 1000
    );
    this.hooks.onTick(this.timeLeftMs / 1000, this.timeTotalMs / 1000);
  }

  private tick(): void {
    const now = performance.now();
    const delta = now - this.lastNow;
    this.lastNow = now;

    if (!this.running || this.paused || this.revealing) return;

    this.timeLeftMs -= delta;
    if (this.timeLeftMs <= 0) {
      this.timeLeftMs = 0;
      this.hooks.onTick(0, this.timeTotalMs / 1000);
      this.timeout();
      return;
    }

    const seconds = Math.ceil(this.timeLeftMs / 1000);
    if (seconds !== this.lastSecond) {
      this.lastSecond = seconds;
    }
    this.hooks.onTick(this.timeLeftMs / 1000, this.timeTotalMs / 1000);
  }

  submit(raw: string): void {
    if (!this.running || this.revealing || this.paused) return;
    const prompt = this.prompts[this.index];
    if (!prompt) return;

    const value = raw.trim();
    if (value.length < 2) return;

    // Pass the pool so a name shared by two categories (e.g. Madagascar the
    // country and Madagascar the island) resolves to the answer the prompt wants.
    const resolution = resolveGuess(value, prompt.pool);
    if (!resolution) {
      this.hooks.onReject('NO MATCH IN THE ATLAS — CHECK THE SPELLING');
      return;
    }

    if (this.used.has(resolution.place.id)) {
      this.hooks.onReject('ALREADY CHARTED THIS RUN — FIND SOMETHING NEW');
      return;
    }

    if (prompt.category === 'pinpoint' && prompt.target) {
      const distance = haversineKm(resolution.place, prompt.target);
      if (distance > 300) {
        this.hooks.onReject(
          `${resolution.place.name.toUpperCase()} IS ${Math.round(distance)} KM FROM THE CROSSHAIR`
        );
        return;
      }
      this.accept(resolution.place, distance);
      return;
    }

    if (!prompt.pool.includes(resolution.place)) {
      this.hooks.onReject(
        `${resolution.place.name.toUpperCase()} IS REAL — BUT NOT A VALID ANSWER HERE`
      );
      return;
    }

    this.accept(resolution.place, null);
  }

  private accept(place: Place, distance: number | null): void {
    const prompt = this.prompts[this.index];
    if (!prompt) return;

    this.used.add(place.id);

    let depthBase: number;
    let percentile: number;
    let trap: boolean;
    let gem: boolean;

    if (prompt.category === 'pinpoint' && prompt.target) {
      const target = prompt.target;
      const raw = rawDepth(target, prompt.pool);
      const proximity = Math.max(0, 1 - (distance ?? 0) / 300);
      depthBase = Math.round(raw.depth * (0.4 + 0.6 * proximity));
      percentile = raw.percentile;
      trap = target.trap;
      gem = depthBase >= 700 && !trap;
    } else {
      const raw = rawDepth(place, prompt.pool);
      depthBase = raw.depth;
      percentile = raw.percentile;
      trap = raw.trap;
      gem = raw.gem;
    }

    const secondsLeft = this.timeLeftMs / 1000;
    const timed = timedDepth(depthBase, secondsLeft, this.timeTotalMs / 1000);
    // Tourist traps stay capped at 150 m and a single answer can never exceed 1000 m.
    const depth = trap ? Math.min(150, timed) : Math.min(1000, timed);
    const best = rarestIn(prompt.pool) ?? { place, result: { depth: depthBase, percentile, trap, gem } };

    const entry: Entry = {
      prompt,
      answer: place,
      distanceKm: distance,
      depth,
      percentile,
      trap,
      gem,
      missed: false,
      best: best.place,
      bestDepth: best.result.depth,
      bestPercentile: best.result.percentile,
      bonusMs: this.config?.mode === 'endless' ? ENDLESS_BONUS_MS : 0,
      secondsLeft: Math.round(secondsLeft),
    };

    this.entries.push(entry);
    this.totalDepth += depth;
    this.hits += 1;

    if (this.config?.mode === 'endless') {
      this.bankMs = Math.max(0, this.timeLeftMs + ENDLESS_BONUS_MS);
    }

    this.revealing = true;
    const isFinal =
      this.config?.mode !== 'endless' &&
      this.index + 1 >= (promptCountFor(this.config?.mode ?? 'daily') ?? this.prompts.length);
    this.pendingFinish = isFinal;
    this.hooks.onReveal(entry, isFinal);
    this.scheduleNext(REVEAL_MS);
  }

  private timeout(): void {
    const prompt = this.prompts[this.index];
    if (!prompt) return;
    this.revealing = true;

    const best = rarestIn(prompt.pool);
    const entry: Entry = {
      prompt,
      answer: null,
      distanceKm: null,
      depth: 0,
      percentile: 0,
      trap: false,
      gem: false,
      missed: true,
      best: best?.place ?? prompt.pool[0],
      bestDepth: best?.result.depth ?? 0,
      bestPercentile: best?.result.percentile ?? 0,
      bonusMs: 0,
      secondsLeft: 0,
    };
    this.entries.push(entry);

    const endless = this.config?.mode === 'endless';
    const isFinal =
      endless ||
      this.index + 1 >= (promptCountFor(this.config?.mode ?? 'daily') ?? this.prompts.length);
    this.pendingFinish = isFinal;
    this.hooks.onReveal(entry, isFinal);
    this.scheduleNext(MISS_REVEAL_MS);
  }

  private scheduleNext(delay: number): void {
    if (this.autoTimer !== null) window.clearTimeout(this.autoTimer);
    this.autoTimer = window.setTimeout(() => {
      this.autoTimer = null;
      this.next();
    }, delay);
  }

  next(): void {
    if (!this.running || !this.revealing) return;
    if (this.autoTimer !== null) {
      window.clearTimeout(this.autoTimer);
      this.autoTimer = null;
    }
    if (this.pendingFinish) {
      this.finish();
      return;
    }

    const total = promptCountFor(this.config?.mode ?? 'daily');
    if (total !== null && this.index + 1 >= this.prompts.length) {
      this.finish();
      return;
    }

    if (this.config?.mode === 'endless' && this.endlessFactory) {
      let nextPrompt = this.endlessFactory();
      for (let i = 0; i < 40; i++) {
        if (!this.prompts.some((p) => p.id === nextPrompt.id)) break;
        nextPrompt = this.endlessFactory();
      }
      this.prompts.push(nextPrompt);
    }

    this.begin(this.index + 1);
  }

  pause(paused: boolean): void {
    if (!this.running || this.revealing) return;
    this.paused = paused;
    this.lastNow = performance.now();
    this.hooks.onPause(paused);
  }

  togglePause(): void {
    this.pause(!this.paused);
  }

  isPaused(): boolean {
    return this.paused;
  }

  isRevealing(): boolean {
    return this.revealing;
  }

  getTotalDepth(): number {
    return this.totalDepth;
  }

  getEntryCount(): number {
    return this.entries.length;
  }

  getHits(): number {
    return this.hits;
  }

  stop(): void {
    this.running = false;
    this.paused = false;
    this.revealing = false;
    if (this.interval !== null) {
      window.clearInterval(this.interval);
      this.interval = null;
    }
    if (this.autoTimer !== null) {
      window.clearTimeout(this.autoTimer);
      this.autoTimer = null;
    }
  }

  abandon(): void {
    this.stop();
    this.entries = [];
  }

  private finish(): void {
    if (!this.running || !this.config) return;
    const config = this.config;
    const result: RoundResult = {
      config,
      entries: [...this.entries],
      totalDepth: this.totalDepth,
      hits: this.hits,
      completedAt: Date.now(),
    };
    this.stop();
    this.hooks.onEnd(result);
  }
}

