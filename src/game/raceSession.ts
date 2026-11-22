import type { CarConfig } from '../garage/carConfig';
import { TEAM_PRESETS, teamConfig } from '../garage/carConfig';
import { AIDriver } from '../ai/aiDriver';
import { EngineAudio } from '../audio/engineAudio';
import { carContact } from '../physics/collisionBox';
import { COMPOUNDS, reMount, type CompoundId } from '../physics/tyres';
import { RaceCar } from '../physics/vehicle';
import type { DriverInput } from '../physics/vehicle';
import { clamp, type DifficultySettings } from '../physics/settings';
import { AI_AGGRESSION_SCALE, type AiAggression } from '../app/raceOptions';
import type { PartyCarFrame } from '../net/party';
import { RaceRenderer } from '../render/raceRenderer';
import type { TrackData } from '../tracks/types';
import { progressDelta } from '../tracks/trackMath';
import { formatTime, HUD, type SessionSnapshot, type TimingEntry } from '../ui/hud';
import { Minimap } from '../ui/minimap';

const FIXED_STEP = 1 / 120;
const MAX_FRAME = 0.08;

export type RaceMode = 'quick' | 'timetrial' | 'weekend' | 'party';

export interface RaceSessionOptions {
  canvas: HTMLCanvasElement;
  track: TrackData;
  playerConfig: CarConfig;
  difficulty: DifficultySettings;
  mode: RaceMode;
  laps: number;
  aiCount?: number;
  aiAggression?: AiAggression;
  aiMistakes?: boolean;
  weather?: 'dry' | 'wet';
  /** Weekend only: free-practice length, minutes (0 skips practice). */
  practiceMinutes?: number;
  /** Weekend only: timed qualifying length, minutes. */
  qualifyingMinutes?: number;
  flags?: boolean;
  template: import('three').Group | null;
  onExit: () => void;
  /** Emits the local car pose for party races. */
  onCarFrame?: (frame: PartyCarFrame) => void;
}

interface Racer {
  car: RaceCar;
  ai: AIDriver | null;
  config: CarConfig;
  name: string;
  tag: string;
  isPlayer: boolean;
  laps: number;
  distance: number;
  prevU: number;
  hasCrossedStart: boolean;
  lapStart: number;
  lastLap: number;
  bestLap: number;
  finished: boolean;
  finishTime: number;
  /** Invisible pit-lane time loss, folded into the finish time. */
  pitLoss: number;
  penalty: number;
  penaltyApplied: number;
  position: number;
  topSpeed: number;
  compounds: CompoundId[];
  prevPitCount: number;
  wasServicing: boolean;
  gridSlot: number;
}

type Phase =
  | 'practice'
  | 'qualifying'
  | 'qualifying_complete'
  | 'countdown'
  | 'running'
  | 'finished';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

function dryCompounds(compounds: CompoundId[]): Set<CompoundId> {
  return new Set(compounds.filter((c) => c === 'soft' || c === 'medium' || c === 'hard'));
}

export class RaceSession {
  private opts: RaceSessionOptions;
  private renderer: RaceRenderer;
  private hud: HUD;
  private minimap: Minimap;
  private audio = new EngineAudio();
  private racers: Racer[] = [];
  private playerIndex = 0;
  private phase: Phase = 'countdown';
  private paused = false;
  private disposed = false;
  private clock = 0;
  private countdown = 0;
  private greenTimer = -1;
  private lightsOutDelay = 1.35;
  private transitionTimer = 0;
  private accumulator = 0;
  private lastTime = 0;
  private raf = 0;
  private hudTimer = 0;
  private keys = new Set<string>();
  private shiftUpQueued = false;
  private shiftDownQueued = false;
  private qualifyingTime = 180;
  private qualifyingBest = 0;
  private qualifyingLaps = 0;
  /** Session lengths from race setup, seconds. */
  private qualifyingLimit = 180;
  private qualifyingLapsLimit = 3;
  private practiceTime = 0;
  private qualifyingTimes = new Map<Racer, number>();
  private lastDelta = 0;
  private deltaIsBest = false;
  private audioMuted = false;
  private resultsBuilt = false;
  private netTimer = 0;
  private remoteFrames = new Map<string, PartyCarFrame>();

  constructor(opts: RaceSessionOptions) {
    this.opts = opts;
    if (opts.weather === 'wet') opts.playerConfig.livery.compound = 'wet';
    const aiCount = opts.mode === 'timetrial' ? 0 : clamp(Math.round(opts.aiCount ?? 9), 0, 20);
    const aiConfigs = TEAM_PRESETS.slice(0, aiCount).map((team) => teamConfig(team, opts.playerConfig.carClass));
    if (opts.weather === 'wet') {
      for (const config of aiConfigs) config.livery.compound = 'wet';
    }
    this.renderer = new RaceRenderer(
      opts.canvas,
      opts.track,
      opts.playerConfig,
      aiConfigs,
      opts.template,
      opts.weather,
    );

    const hudCallbacks = {
      onPitCompound: (compound: CompoundId) => {
        const car = this.playerRacer.car;
        car.pitCompound = compound;
        this.hud.setPitCompound(compound);
        this.hud.toast(`PIT TYRE SELECTED: ${COMPOUNDS[compound].label.toUpperCase()}`);
      },
      onMute: () => {
        this.audioMuted = !this.audioMuted;
        this.audio.setMuted(this.audioMuted);
        this.hud.setMuted(this.audioMuted);
      },
      onPause: () => this.togglePause(),
    };
    this.hud = new HUD(opts.track, hudCallbacks);
    this.minimap = new Minimap(document.getElementById('minimap') as HTMLElement, opts.track);
    this.hud.setPitCompound(opts.playerConfig.livery.compound);

    this.buildRacers();
    this.bindUi();
    this.bindInput();
    this.prepareMode();
    this.hud.show();
    void this.audio.start();
    this.audio.setMuted(this.audioMuted);
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private get playerRacer(): Racer {
    return this.racers[this.playerIndex];
  }

  /** Add a party member's lightweight car visual. */
  addRemoteCar(id: string, config: CarConfig): void {
    this.renderer.addRemoteCar(id, config);
  }

  /** Store the latest network pose; it is drawn on the next animation frame. */
  updateRemoteCar(id: string, frame: PartyCarFrame): void {
    this.remoteFrames.set(id, frame);
  }

  removeRemoteCar(id: string): void {
    this.remoteFrames.delete(id);
    this.renderer.removeRemoteCar(id);
  }

  private buildRacers(): void {
    const opts = this.opts;
    const wetness = opts.weather === 'wet' ? 1 : 0;
    const playerCar = new RaceCar(opts.track, opts.playerConfig, opts.difficulty.assists, opts.difficulty.sim, wetness);
    playerCar.pitCompound = opts.playerConfig.livery.compound;
    this.racers.push({
      car: playerCar,
      ai: null,
      config: opts.playerConfig,
      name: opts.playerConfig.driverName || 'YOU',
      tag: opts.playerConfig.livery.tag,
      isPlayer: true,
      laps: 0,
      distance: 0,
      prevU: playerCar.u,
      hasCrossedStart: false,
      lapStart: 0,
      lastLap: 0,
      bestLap: 0,
      finished: false,
      finishTime: 0,
      pitLoss: 0,
      penalty: 0,
      penaltyApplied: 0,
      position: 1,
      topSpeed: 0,
      compounds: [opts.playerConfig.livery.compound],
      prevPitCount: 0,
      wasServicing: false,
      gridSlot: 4,
    });

    if (opts.mode !== 'timetrial') {
      const aiAssists = { brakingAssist: 'off' as const, abs: true, tractionControl: 'full' as const, racingLine: 'off' as const, gearbox: 'auto' as const };
      const aiSim = { ...opts.difficulty.sim, damage: 'off' as const };
      const aiCount = clamp(Math.round(opts.aiCount ?? 9), 0, 20);
      TEAM_PRESETS.slice(0, aiCount).forEach((team, i) => {
        const config = teamConfig(team, opts.playerConfig.carClass);
        if (opts.weather === 'wet') config.livery.compound = 'wet';
        const spread = [1.5, -1, 2.5, 0, -2, 3, -1.5, 1, -0.5, 2, -2.5, 0.5, 1.2, -1.2, 2.2, -0.2, 0.8, -1.8, 1.8, -0.8];
        const pace = clamp(opts.difficulty.aiPace + spread[i % spread.length], 50, 110);
        const car = new RaceCar(opts.track, config, aiAssists, aiSim, wetness);
        const ai = new AIDriver(car, team.tag, team.name, pace, {
          aggression: AI_AGGRESSION_SCALE[opts.aiAggression ?? 'normal'],
          mistakes: opts.aiMistakes !== false,
        });
        this.racers.push({
          car,
          ai,
          config,
          name: team.name,
          tag: team.tag,
          isPlayer: false,
          laps: 0,
          distance: 0,
          prevU: car.u,
          hasCrossedStart: false,
          lapStart: 0,
          lastLap: 0,
          bestLap: 0,
          finished: false,
          finishTime: 0,
          pitLoss: 0,
          penalty: 0,
          penaltyApplied: 0,
          position: i + 2,
          topSpeed: 0,
          compounds: [config.livery.compound],
          prevPitCount: 0,
          wasServicing: false,
          gridSlot: i + 1,
        });
        const base = opts.track.length / 55;
        const time = base * (1.06 - ((pace - 50) / 60) * 0.14) + (Math.random() - 0.5) * 1.2;
        this.qualifyingTimes.set(this.racers[this.racers.length - 1], time);
      });
    }
  }

  private bindUi(): void {
    // onclick (not addEventListener) because the buttons persist between sessions.
    const resume = document.getElementById('pause-resume');
    const restart = document.getElementById('pause-restart');
    const quit = document.getElementById('pause-quit');
    const again = document.getElementById('btn-race-again');
    const back = document.getElementById('btn-results-menu');
    if (resume) resume.onclick = () => this.togglePause(false);
    if (restart) restart.onclick = () => this.restart();
    if (quit) quit.onclick = () => this.exit();
    if (again) again.onclick = () => this.restart();
    if (back) back.onclick = () => this.exit();
  }

  private bindInput(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('resize', this.onResize);
  }

  private onResize = (): void => {
    this.renderer.resize();
  };

  private onBlur = (): void => {
    this.keys.clear();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const code = event.code;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code)) event.preventDefault();
    if (event.repeat) {
      this.keys.add(code);
      return;
    }
    this.keys.add(code);
    if (code === 'Escape') {
      if (this.phase !== 'finished') this.togglePause();
      return;
    }
    if (this.phase === 'finished' || this.paused) return;
    if (code === 'KeyC') {
      const mode = this.renderer.cycleCamera();
      this.hud.toast(`CAMERA: ${mode.toUpperCase()}`);
    } else if (code === 'KeyM') {
      this.hud.toggleMfd();
    } else if (code === 'KeyR') {
      this.playerRacer.car.resetToTrack();
      this.hud.toast('CAR RECOVERED TO TRACK');
    } else if (code === 'ShiftLeft' || code === 'ShiftRight') {
      this.shiftUpQueued = true;
    } else if (code === 'ControlLeft' || code === 'ControlRight') {
      this.shiftDownQueued = true;
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private prepareMode(): void {
    const mode = this.opts.mode;
    // Real starts hold the five red lamps for an unpredictable beat before
    // they go out. Deriving the hold from the circuit keeps it deterministic
    // for a given track while still avoiding a fixed countdown feel.
    this.lightsOutDelay = 1.05 + ((this.opts.track.length % 997) / 997) * 0.95;
    this.hud.setStartLights(0, 'GET READY');
    this.hud.hideStartLights();
    this.hud.setPitCompound(this.opts.playerConfig.livery.compound);
    this.lastDelta = 0;
    this.deltaIsBest = false;
    this.greenTimer = -1;
    this.resultsBuilt = false;
    if (mode === 'weekend') {
      // Both sessions are set from race setup. The lap cap is one flying lap
      // per qualifying minute, so a longer session is not cut short at three
      // laps while the clock still has ten minutes on it.
      this.qualifyingLimit = Math.max(60, Math.round((this.opts.qualifyingMinutes ?? 3) * 60));
      this.qualifyingLapsLimit = Math.max(1, Math.round(this.qualifyingLimit / 60));
      const practice = Math.max(0, Math.round((this.opts.practiceMinutes ?? 0) * 60));
      if (practice > 0) this.beginPractice(practice);
      else this.beginQualifying();
    } else if (mode === 'timetrial') {
      const car = this.playerRacer.car;
      car.resetSession(this.opts.playerConfig.livery.compound);
      car.placeAt(0.003, 0, 0);
      this.resetPlayerLapState();
      this.playerRacer.hasCrossedStart = true;
      this.playerRacer.lapStart = 0;
      this.phase = 'countdown';
      this.countdown = 0;
      this.clock = 0;
      this.renderer.createGhost(this.opts.playerConfig, this.opts.template);
      this.renderer.beginGhostLap();
    } else {
      // Quick race: player starts from the middle of the grid.
      const ai = this.racers.slice(1);
      const order: Racer[] = [...ai.slice(0, 4), this.playerRacer, ...ai.slice(4)];
      this.lineUpGrid(order);
      this.phase = 'countdown';
      this.countdown = 0;
      this.clock = 0;
      this.hud.setStartLights(0, 'FORMATION COMPLETE');
      this.renderer.setStartLights(0, false);
    }
  }

  /** FREE PRACTICE: the whole field runs until the session clock hits zero. */
  private beginPractice(seconds: number): void {
    this.phase = 'practice';
    this.practiceTime = seconds;
    this.clock = 0;
    this.qualifyingBest = 0;
    this.qualifyingLaps = 0;
    this.lineUpGrid(this.racers);
    const car = this.playerRacer.car;
    car.placeAt(0.003, 0, 0);
    this.resetPlayerLapState();
    this.playerRacer.hasCrossedStart = true;
    this.playerRacer.lapStart = 0;
    this.hud.showMessage(`PRACTICE · ${Math.round(seconds / 60)} MIN`, 'flag-yellow', 3200);
  }

  /** Single-car timed qualifying before the feature race. */
  private beginQualifying(): void {
    this.phase = 'qualifying';
    this.clock = 0;
    this.qualifyingTime = this.qualifyingLimit;
    this.qualifyingLaps = 0;
    this.qualifyingBest = 0;
    this.playerRacer.car.resetSession(this.opts.playerConfig.livery.compound);
    this.playerRacer.car.placeAt(0.003, 0, 0);
    this.resetPlayerLapState();
    this.playerRacer.hasCrossedStart = true;
    this.playerRacer.lapStart = 0;
    this.racers.forEach((r, i) => {
      if (i === this.playerIndex) return;
      this.renderer.setCarVisible(i, false);
      r.car.placeOnGrid(r.gridSlot);
    });
    this.hud.showMessage(`QUALIFYING · ${Math.round(this.qualifyingLimit / 60)} MIN`, 'flag-yellow', 3200);
  }

  private stepPractice(dt: number): void {
    this.clock += dt;
    this.practiceTime -= dt;
    const cars = this.racers.map((r) => r.car);
    this.racers.forEach((racer) => {
      const car = racer.car;
      if (racer.isPlayer) car.setInput(this.playerInput());
      else if (racer.ai) car.setInput(racer.ai.update(dt, cars));
      car.setDirtyAir(this.dirtyAirFor(racer));
      car.drsAllowed = this.drsAllowedFor(racer);
      car.update(dt);
      racer.topSpeed = Math.max(racer.topSpeed, car.speedKmh);
      this.consumePenalty(racer);
    });
    this.resolveCarContacts();
    this.racers.forEach((racer) => this.updateLapProgress(racer));
    this.updateStandings();
    if (this.practiceTime <= 0) this.beginQualifying();
  }

  private resetPlayerLapState(): void {
    const p = this.playerRacer;
    p.laps = 0;
    p.distance = 0;
    p.bestLap = 0;
    p.lastLap = 0;
    p.finished = false;
    p.finishTime = 0;
    p.pitLoss = 0;
    p.penalty = 0;
    p.penaltyApplied = 0;
    p.topSpeed = 0;
    p.compounds = [this.opts.playerConfig.livery.compound];
    p.prevPitCount = 0;
    p.wasServicing = false;
    p.prevU = p.car.u;
  }

  private lineUpGrid(order: Racer[]): void {
    order.forEach((racer, slot) => {
      racer.gridSlot = slot;
      racer.car.resetSession(racer.config.livery.compound);
      racer.car.placeOnGrid(slot);
      racer.car.pitCompound = racer.config.livery.compound;
      racer.laps = 0;
      racer.distance = 0;
      racer.prevU = racer.car.u;
      racer.hasCrossedStart = false;
      racer.lapStart = 0;
      racer.lastLap = 0;
      racer.bestLap = 0;
      racer.finished = false;
      racer.finishTime = 0;
      racer.pitLoss = 0;
      racer.penalty = 0;
      racer.penaltyApplied = 0;
      racer.topSpeed = 0;
      racer.compounds = [racer.config.livery.compound];
      racer.prevPitCount = 0;
      racer.wasServicing = false;
    });
    this.racers.forEach((_, i) => this.renderer.setCarVisible(i, true));
    this.hud.hideStartLights();
    this.updateStandings();
  }

  private startRaceFromQualifying(): void {
    const entries = this.racers.map((racer) => ({
      racer,
      time: racer.isPlayer ? (this.qualifyingBest > 0 ? this.qualifyingBest : Number.POSITIVE_INFINITY) : (this.qualifyingTimes.get(racer) ?? Number.POSITIVE_INFINITY),
    }));
    entries.sort((a, b) => a.time - b.time);
    this.lineUpGrid(entries.map((e) => e.racer));
    this.phase = 'countdown';
    this.countdown = 0;
    this.clock = 0;
    this.greenTimer = -1;
    this.resultsBuilt = false;
    this.hud.setStartLights(0, 'GRID SET');
    this.renderer.setStartLights(0, false);
    this.hud.showMessage('QUALIFYING COMPLETE · GRID SET', 'flag-green', 2400);
  }

  private restart(): void {
    document.getElementById('screen-pause')?.classList.add('hidden');
    document.getElementById('screen-results')?.classList.remove('active');
    this.paused = false;
    this.phase = 'countdown';
    this.accumulator = 0;
    this.lastDelta = 0;
    this.resultsBuilt = false;
    this.racers.forEach((r) => {
      r.car.damage = { wingFL: 1, wingFR: 1, floor: 1, suspension: 0 };
      r.car.pendingPenalty = 0;
      r.car.pitCount = 0;
    });
    this.audio.start();
    this.renderer.removeGhost();
    this.prepareMode();
    this.hud.show();
    this.hud.hideMessage();
    this.lastTime = performance.now();
  }

  private exit(): void {
    this.opts.onExit();
  }

  private togglePause(force?: boolean): void {
    if (this.phase === 'finished') return;
    const next = force ?? !this.paused;
    this.paused = next;
    const modal = document.getElementById('screen-pause');
    if (!modal) return;
    modal.classList.toggle('hidden', !next);
    if (next) {
      this.keys.clear();
      this.audio.stop();
      const session = document.getElementById('pause-session');
      if (session) {
        session.textContent = `${this.opts.track.name.toUpperCase()} · LAP ${Math.min(this.playerRacer.laps + 1, this.opts.laps)} / ${this.opts.laps}`;
      }
    } else {
      this.lastTime = performance.now();
      void this.audio.start();
    }
  }

  private frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(MAX_FRAME, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    if (this.paused || this.phase === 'finished') {
      this.renderer.render();
      return;
    }
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < 12) {
      this.step(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
      steps++;
    }
    if (steps === 12) this.accumulator = 0;

    if (this.opts.mode === 'timetrial') {
      this.renderer.updateGhost(dt);
    }
    for (const [id, frame] of this.remoteFrames) this.renderer.updateRemoteCar(id, frame, dt);
    this.renderer.update(dt, this.racers.map((r) => r.car), this.playerIndex);

    if (this.opts.onCarFrame) {
      this.netTimer += dt;
      if (this.netTimer >= 0.05) {
        this.netTimer = 0;
        const car = this.playerRacer.car;
        this.opts.onCarFrame({
          index: car.index,
          u: car.u,
          lateral: car.lateral,
          heading: car.heading,
          speed: car.speedKmh,
          pos: [car.pos.x, car.pos.y, car.pos.z],
          compound: car.getCompound(),
        });
      }
    }

    this.hudTimer += dt;
    if (this.hudTimer > 0.075) {
      this.hudTimer = 0;
      this.updateHud();
      this.minimap.update(this.racers.map((r) => r.car), this.playerIndex);
    }
    this.updateAudio();
  };

  private step(dt: number): void {
    if (this.phase === 'finished') return;

    if (this.phase === 'practice') {
      this.stepPractice(dt);
      return;
    }
    if (this.phase === 'qualifying') {
      this.stepQualifying(dt);
      this.updateStandings();
      return;
    }
    if (this.phase === 'qualifying_complete') {
      this.transitionTimer -= dt;
      this.racers[this.playerIndex].car.setInput({ throttle: 0, brake: 1, steer: 0 });
      this.racers[this.playerIndex].car.update(dt);
      if (this.transitionTimer <= 0) this.startRaceFromQualifying();
      return;
    }
    if (this.phase === 'countdown') {
      this.stepCountdown(dt);
      return;
    }

    // Running.
    this.clock += dt;
    if (this.greenTimer > 0) {
      this.greenTimer -= dt;
      if (this.greenTimer <= 0) this.hud.hideStartLights();
    }

    const cars = this.racers.map((r) => r.car);
    this.racers.forEach((racer) => {
      const car = racer.car;
      if (racer.finished) {
        car.setInput({ throttle: 0, brake: 0.6, steer: 0 });
      } else if (racer.isPlayer) {
        car.setInput(this.playerInput());
      } else if (racer.ai) {
        car.setInput(racer.ai.update(dt, cars));
      }
      car.setDirtyAir(this.dirtyAirFor(racer));
      car.drsAllowed = this.drsAllowedFor(racer);
      car.update(dt);
      racer.topSpeed = Math.max(racer.topSpeed, car.speedKmh);
      this.consumePenalty(racer);
      this.checkPit(racer);
    });

    this.resolveCarContacts();
    this.racers.forEach((racer) => this.updateLapProgress(racer));
    this.updateStandings();

    if (this.opts.mode === 'timetrial') {
      this.renderer.recordGhost(dt, this.playerRacer.car);
    }

    if (this.playerRacer.finished) {
      this.finishRace();
    }
  }

  private stepCountdown(dt: number): void {
    this.countdown += dt;
    const firstLightAt = 0.55;
    const interval = 0.82;
    const allOnAt = firstLightAt + interval * 4;
    const releaseAt = allOnAt + this.lightsOutDelay;
    const lights = clamp(Math.floor((this.countdown - firstLightAt) / interval) + 1, 0, 5);
    if (this.countdown < releaseAt) {
      if (lights > 0) {
        this.hud.setStartLights(lights, lights >= 5 ? 'HOLD…' : 'LIGHTS ON');
        this.renderer.setStartLights(lights, false);
      }
    }
    this.racers.forEach((racer) => {
      racer.car.setInput({ throttle: 0, brake: 0, steer: 0 });
      racer.car.update(dt);
      racer.prevU = racer.car.u;
    });
    this.updateStandings();
    if (this.countdown >= releaseAt) {
      this.phase = 'running';
      this.clock = 0;
      this.greenTimer = 1.5;
      this.hud.setStartLights(0, 'LIGHTS OUT', true);
      this.renderer.setStartLights(0, true);
      this.hud.showMessage('LIGHTS OUT AND AWAY WE GO', 'flag-green', 1800);
      this.racers.forEach((racer) => {
        racer.lapStart = 0;
        racer.prevU = racer.car.u;
      });
    }
  }

  private stepQualifying(dt: number): void {
    this.clock += dt;
    this.qualifyingTime -= dt;
    const car = this.playerRacer.car;
    car.setInput(this.playerInput());
    car.update(dt);
    this.consumePenalty(this.playerRacer);
    this.playerRacer.topSpeed = Math.max(this.playerRacer.topSpeed, car.speedKmh);
    this.updateLapProgress(this.playerRacer);

    if (this.qualifyingLaps >= this.qualifyingLapsLimit || this.qualifyingTime <= 0) {
      this.phase = 'qualifying_complete';
      this.transitionTimer = 2.6;
      this.qualifyingTime = Math.max(0, this.qualifyingTime);
      this.hud.showMessage('QUALIFYING COMPLETE', 'flag-checkered', 2400);
      this.hud.hideStartLights();
    }
  }

  private playerInput(): DriverInput {
    if (this.phase !== 'running' && this.phase !== 'qualifying' && this.phase !== 'practice') {
      return { throttle: 0, brake: 0, steer: 0 };
    }
    const throttle = this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0;
    let brake = this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0;
    if (this.keys.has('Space')) brake = 1;
    // Screen-right is -X in this world basis, so the camera-relative stick is inverted.
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0;
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0;
    const steer = left - right;
    const input: DriverInput = { throttle, brake, steer };
    if (this.shiftUpQueued) {
      input.shiftUp = true;
      this.shiftUpQueued = false;
    }
    if (this.shiftDownQueued) {
      input.shiftDown = true;
      this.shiftDownQueued = false;
    }
    return input;
  }

  private dirtyAirFor(racer: Racer): number {
    const car = racer.car;
    let closest = Infinity;
    for (const other of this.racers) {
      if (other === racer) continue;
      const dx = other.car.pos.x - car.pos.x;
      const dz = other.car.pos.z - car.pos.z;
      const forward = Math.sin(car.heading) * dx + Math.cos(car.heading) * dz;
      const side = Math.abs(Math.cos(car.heading) * dx - Math.sin(car.heading) * dz);
      if (forward > 2 && forward < 60 && side < 3) closest = Math.min(closest, forward);
    }
    if (!Number.isFinite(closest)) return 0;
    const timeGap = closest / Math.max(12, Math.abs(car.vx));
    return clamp(1 - timeGap / 1.2, 0, 1);
  }

  private drsAllowedFor(racer: Racer): boolean {
    const car = racer.car;
    if (!car.sample.drs) return false;
    if (this.opts.mode === 'timetrial') return true;
    let closest = Infinity;
    for (const other of this.racers) {
      if (other === racer) continue;
      const dx = other.car.pos.x - car.pos.x;
      const dz = other.car.pos.z - car.pos.z;
      const forward = Math.sin(car.heading) * dx + Math.cos(car.heading) * dz;
      const side = Math.abs(Math.cos(car.heading) * dx - Math.sin(car.heading) * dz);
      if (forward > 0 && forward < 80 && side < 3.5) closest = Math.min(closest, forward);
    }
    if (!Number.isFinite(closest)) return false;
    return closest / Math.max(10, Math.abs(car.vx)) <= 1.0;
  }

  private consumePenalty(racer: Racer): void {
    const pending = racer.car.pendingPenalty;
    if (pending > racer.penaltyApplied) {
      const extra = pending - racer.penaltyApplied;
      racer.penalty += extra;
      racer.penaltyApplied = pending;
      if (racer.isPlayer) {
        this.hud.showMessage(`TRACK LIMITS · +${Math.round(extra)}s PENALTY`, 'flag-yellow', 2200);
        this.hud.toast(`PENALTY ADDED: +${Math.round(extra)}s`);
      }
    }
  }

  private checkPit(racer: Racer): void {
    const car = racer.car;
    if (car.servicing && !racer.wasServicing && racer.isPlayer) {
      this.hud.showMessage('PIT STOP · TYRES + REPAIRS', '', 2000);
    }
    if (car.pitCount > racer.prevPitCount) {
      racer.prevPitCount = car.pitCount;
      const compound = car.getCompound();
      racer.compounds.push(compound);
      if (racer.isPlayer) {
        this.hud.toast(`TYRES FITTED: ${COMPOUNDS[compound].label.toUpperCase()} · WING REPAIRED`);
        this.hud.setPitCompound(car.pitCompound);
      }
    }
    racer.wasServicing = car.servicing;
  }

  private resolveCarContacts(): void {
    // Oriented boxes at the drawn body extents. The previous two-circle capsule
    // was shorter and narrower than the mesh (a 5.6 m car sat in a 4.9 m shape),
    // so cars sank into each other nose-to-tail and wheel-to-wheel.
    //
    // One pass only pushes the shallowest pair clear; in a three-car scrum that
    // left up to ~0.4 m of visible interpenetration, so relax the pairs a few
    // times per substep. Three passes converge without overshooting.
    const touches: Array<[RaceCar, RaceCar, number]> = [];
    for (let pass = 0; pass < 3; pass++) {
      let anyContact = false;
      for (let i = 0; i < this.racers.length; i++) {
        for (let j = i + 1; j < this.racers.length; j++) {
          const a = this.racers[i].car;
          const b = this.racers[j].car;
          const contact = carContact(
            {
              x: a.pos.x,
              z: a.pos.z,
              heading: a.heading,
              halfLength: a.collisionHalfLength,
              halfWidth: a.collisionHalfWidth,
              centerOffset: a.collisionCenterZ,
            },
            {
              x: b.pos.x,
              z: b.pos.z,
              heading: b.heading,
              halfLength: b.collisionHalfLength,
              halfWidth: b.collisionHalfWidth,
              centerOffset: b.collisionCenterZ,
            },
          );
          if (!contact) continue;
          anyContact = true;
          // Correct only the shallowest axis, split between the pair, and cap the
          // step so a restart overlap cannot fling a car across the track.
          const push = Math.min(contact.overlap, 0.8) * 0.52;
          a.pos.x -= contact.nx * push;
          a.pos.z -= contact.nz * push;
          b.pos.x += contact.nx * push;
          b.pos.z += contact.nz * push;
          if (pass === 0) {
            const relativeSpeed = Math.abs(a.vx - b.vx) + Math.abs(a.vy - b.vy) * 0.5;
            touches.push([a, b, relativeSpeed]);
          }
        }
      }
      if (!anyContact) break;
    }

    for (const [a, b, relativeSpeed] of touches) {
      // Contact scrub, not a hard stop: preserve momentum so a light rub
      // does not turn into a multi-frame jitter or a sudden spin.
      // Position correction does the real work. A heavy per-substep speed
      // scrub made a tight start pack crawl at 0 km/h forever.
      const scrub = 0.992 - Math.min(0.006, relativeSpeed / 500);
      a.vx *= scrub;
      b.vx *= scrub;
      a.vy *= 0.985;
      b.vy *= 0.985;
      a.yawRate *= 0.985;
      b.yawRate *= 0.985;
      a.impactPulse = Math.max(a.impactPulse, Math.min(0.6, 0.1 + relativeSpeed / 90));
      b.impactPulse = Math.max(b.impactPulse, Math.min(0.6, 0.1 + relativeSpeed / 90));
    }
    for (const racer of this.racers) racer.car.refreshTrackPose();
  }

  private updateLapProgress(racer: Racer): void {
    const car = racer.car;
    const prev = racer.prevU;
    const u = car.u;
    const delta = progressDelta(prev, u);
    if (Math.abs(delta) < 0.5) racer.distance += delta;

    const crossed = prev > 0.8 && u < 0.2 && car.vx > 0.5;
    if (crossed) {
      if (!racer.hasCrossedStart) {
        racer.hasCrossedStart = true;
        racer.lapStart = this.clock;
      } else {
        const lapTime = this.clock - racer.lapStart;
        if (lapTime > 8) {
          racer.lastLap = lapTime;
          if (!racer.bestLap || lapTime < racer.bestLap) {
            racer.bestLap = lapTime;
            if (racer.isPlayer) {
              this.deltaIsBest = true;
              this.lastDelta = lapTime;
            }
          } else if (racer.isPlayer) {
            this.deltaIsBest = false;
            this.lastDelta = lapTime - racer.bestLap;
          }
        }
        racer.laps++;
        racer.lapStart = this.clock;
        this.onLapCompleted(racer, lapTime);
      }
    }
    racer.prevU = u;
  }

  private onLapCompleted(racer: Racer, lapTime: number): void {
    if (racer.isPlayer) {
      if (lapTime > 8) {
        const label =
          this.phase !== 'practice' && racer.laps >= this.opts.laps
            ? 'RACE FINISH'
            : `LAP ${racer.laps} COMPLETE`;
        this.hud.showMessage(`${label} · ${formatTime(lapTime)}`, 'flag-checkered', 1900);
      }
      if (this.opts.mode === 'timetrial') {
        this.renderer.completeGhostLap(lapTime);
        this.renderer.beginGhostLap();
      }
      if (this.opts.mode === 'weekend' && this.phase === 'qualifying') {
        if (lapTime > 8 && (!this.qualifyingBest || lapTime < this.qualifyingBest)) this.qualifyingBest = lapTime;
        this.qualifyingLaps++;
        if (this.qualifyingLaps >= this.qualifyingLapsLimit) {
          this.phase = 'qualifying_complete';
          this.transitionTimer = 2.4;
          this.hud.showMessage('QUALIFYING COMPLETE', 'flag-checkered', 2200);
        }
      }
    }

    if (!racer.isPlayer && racer.ai && !racer.finished) {
      if (racer.ai.wantsPit && racer.laps < this.opts.laps) {
        const next: CompoundId = racer.car.getCompound() === 'medium' ? 'hard' : 'medium';
        reMount(racer.car.wheels, next, racer.car.ambient);
        racer.car.pitCount++;
        racer.car.stintCompounds.push(next);
        racer.compounds.push(next);
        racer.prevPitCount = racer.car.pitCount;
        racer.pitLoss += 21.5; // invisible pit-lane time for AI
        racer.car.damage.wingFL = 1;
        racer.car.damage.wingFR = 1;
      }
    }

    const total = this.opts.mode === 'weekend' ? this.opts.laps : this.opts.mode === 'timetrial' ? 0 : this.opts.laps;
    if (this.phase === 'running' && total > 0 && racer.laps >= total && !racer.finished) {
      racer.finished = true;
      racer.finishTime = this.clock + racer.pitLoss;
      if (racer.isPlayer) {
        this.hud.showMessage('CHEQUERED FLAG', 'flag-checkered', 2200);
      }
    }
  }

  private updateStandings(): void {
    const sorted = this.sortedRacers();
    sorted.forEach((r, i) => {
      r.position = i + 1;
    });
  }

  private sortedRacers(): Racer[] {
    return [...this.racers].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime + a.penalty - (b.finishTime + b.penalty);
      if (a.finished) return -1;
      if (b.finished) return 1;
      if (this.phase === 'countdown') return a.gridSlot - b.gridSlot;
      return b.distance - a.distance || a.gridSlot - b.gridSlot;
    });
  }

  private finishRace(): void {
    if (this.phase === 'finished') return;
    this.phase = 'finished';
    this.paused = false;
    document.getElementById('screen-pause')?.classList.add('hidden');
    this.audio.stop();

    const player = this.playerRacer;
    if (this.opts.mode === 'weekend') {
      const dry = dryCompounds(player.compounds);
      if (dry.size < 2) player.penalty += 30;
    }
    this.hud.hide();
    this.buildResults();
  }

  private buildResults(): void {
    if (this.resultsBuilt) return;
    this.resultsBuilt = true;
    const sorted = this.sortedRacers();
    const player = this.playerRacer;
    const position = sorted.indexOf(player) + 1;
    const winner = sorted[0];
    const screen = document.getElementById('screen-results');
    fillText('results-eyebrow', this.opts.mode === 'weekend' ? 'RACE CLASSIFICATION' : 'RACE RESULT');
    fillText('results-title', this.opts.mode === 'weekend' ? 'FEATURE RACE' : 'RACE RESULT');
    fillText('results-sub', `${this.opts.track.name.toUpperCase()} · ${this.opts.laps} LAPS`);
    fillText('results-stat-label', player.finished ? 'YOUR RACE TIME' : 'CLASSIFIED');
    fillText('results-stat-value', player.finished ? formatTime(player.finishTime + player.penalty) : `P${position}`);
    fillText('results-stat-note', `P${position} OF ${this.racers.length} · ${COMPOUNDS[player.car.getCompound()].label.toUpperCase()}`);

    const table = document.getElementById('results-table');
    if (table) {
      let html = '<thead><tr><th>POS</th><th>DRIVER</th><th>TIME / GAP</th><th>BEST LAP</th><th>STOPS</th><th>TYRES</th></tr></thead><tbody>';
      sorted.forEach((racer, i) => {
        let timeText = '';
        if (racer.finished) {
          const total = racer.finishTime + racer.penalty;
          timeText = i === 0 ? formatTime(total) : `+${(total - (winner.finishTime + winner.penalty)).toFixed(3)}s`;
        } else {
          const gapLaps = Math.max(0, winner.distance - racer.distance);
          timeText = gapLaps >= 1 ? `+${Math.floor(gapLaps)} LAP` : `+${(gapLaps * (racer.bestLap || 92)).toFixed(1)}s`;
        }
        if (racer.penalty > 0) timeText += ` · +${Math.round(racer.penalty)}s`;
        const compound = COMPOUNDS[racer.car.getCompound()];
        html += `<tr class="${racer.isPlayer ? 'player' : ''}">
          <td>${i + 1}</td>
          <td><span class="rt-name">${escapeHtml(racer.tag)}</span> ${escapeHtml(racer.name)}</td>
          <td class="rt-gap">${timeText}</td>
          <td class="rt-gap">${racer.bestLap ? formatTime(racer.bestLap) : '—'}</td>
          <td>${racer.car.pitCount}</td>
          <td><span class="rt-dot" style="color:${compound.color}"></span>${compound.short}</td>
        </tr>`;
      });
      html += '</tbody>';
      table.innerHTML = html;
    }

    let fastest = 0;
    let fastestTag = '';
    for (const racer of this.racers) {
      if (racer.bestLap && (!fastest || racer.bestLap < fastest)) {
        fastest = racer.bestLap;
        fastestTag = racer.tag;
      }
    }
    const dry = [...dryCompounds(player.compounds)].map((c) => COMPOUNDS[c].short).join(' · ') || 'NONE';
    const side = document.getElementById('results-side');
    if (side) {
      side.innerHTML = `
        <div class="result-card">
          <h4>YOUR RACE</h4>
          <div class="result-stat-row"><span>Best lap</span><b>${player.bestLap ? formatTime(player.bestLap) : '—'}</b></div>
          <div class="result-stat-row"><span>Top speed</span><b>${Math.round(player.topSpeed)} KM/H</b></div>
          <div class="result-stat-row"><span>Pit stops</span><b>${player.car.pitCount}</b></div>
          <div class="result-stat-row"><span>Dry compounds</span><b>${dry}</b></div>
          <div class="result-stat-row"><span>Penalties</span><b>${player.penalty > 0 ? `+${Math.round(player.penalty)}s` : 'NONE'}</b></div>
        </div>
        <div class="result-card">
          <h4>SESSION</h4>
          <div class="result-stat-row"><span>Fastest lap</span><b>${fastest ? `${formatTime(fastest)} · ${fastestTag}` : '—'}</b></div>
          <div class="result-stat-row"><span>Circuit</span><b>${(this.opts.track.length / 1000).toFixed(3)} KM</b></div>
          <div class="result-stat-row"><span>Conditions</span><b>${this.opts.track.night ? 'NIGHT' : 'DRY'}</b></div>
          <div class="result-stat-row"><span>AI pace</span><b>${Math.round(this.opts.difficulty.aiPace)}%</b></div>
        </div>
        <div class="result-highlight">
          <b>${this.opts.mode === 'weekend' ? 'Race weekend complete.' : 'Race complete.'}</b>
          ${this.opts.mode === 'weekend' ? ' The mandatory two-compound rule applies to the Feature Race distance.' : ''}
          ${player.penalty > 0 ? ` Stewards added ${Math.round(player.penalty)}s to your time.` : ' Clean race — no time penalties.'}
        </div>
      `;
    }
    screen?.classList.add('active');
  }

  private updateHud(): void {
    const player = this.playerRacer;
    const telemetry = player.car.getTelemetry();
    const inTimedSession = this.phase === 'qualifying' || this.phase === 'practice';
    const lapTime = inTimedSession ? 0 : Math.max(0, this.clock - player.lapStart);
    const total =
      this.opts.mode === 'timetrial' || this.phase === 'practice'
        ? 0
        : this.opts.mode === 'weekend' && this.phase === 'qualifying'
          ? this.qualifyingLapsLimit
          : this.opts.laps;
    const leader = this.sortedRacers()[0];
    const dry = [...dryCompounds(player.compounds)].map((c) => COMPOUNDS[c].short).join(', ') || 'NONE';
    const notes =
      this.phase === 'practice'
        ? `FREE PRACTICE · ${formatTime(Math.max(0, this.practiceTime))} LEFT · PIT ANY TIME`
        : this.phase === 'qualifying'
          ? `TIMED QUALIFYING · ${formatTime(Math.max(0, this.qualifyingTime))} LEFT · ${player.laps} LAP(S)`
          : this.opts.mode === 'weekend'
            ? `2-COMPOUND RULE · DRY SETS: ${dry} · ${player.car.pitCount} STOP(S)`
            : this.opts.mode === 'timetrial'
          ? `GHOST CAR · BEST LAP ${player.bestLap ? formatTime(player.bestLap) : '—'} · SPACE BRAKES`
          : `DRS: WITHIN 1.0S IN ZONES · TYRES: ${COMPOUNDS[player.car.getCompound()].label.toUpperCase()} · ${Math.round(player.car.tyreLife * 100)}% LIFE`;

    const timingEntries = this.timings(leader);
    const session: SessionSnapshot = {
      modeLabel:
        this.phase === 'practice'
          ? 'PRACTICE'
          : this.phase === 'qualifying'
            ? 'QUALIFYING'
            : this.opts.mode === 'weekend'
            ? 'FEATURE RACE'
            : this.opts.mode === 'timetrial'
              ? 'TIME TRIAL'
              : this.opts.mode === 'party'
                ? 'PARTY RACE'
                : 'QUICK RACE',
      trackName: this.opts.track.name.toUpperCase(),
      lap: this.phase === 'qualifying' ? Math.min(this.qualifyingLapsLimit, player.laps + 1) : player.laps + 1,
      totalLaps: total,
      position: player.position,
      fieldSize: this.racers.length,
      time:
        this.phase === 'qualifying'
          ? formatTime(Math.max(0, this.qualifyingTime))
          : this.phase === 'practice'
            ? formatTime(Math.max(0, this.practiceTime))
            : formatTime(lapTime),
      delta: this.deltaString(),
      deltaSlow: !this.deltaIsBest && this.lastDelta > 0,
      weather: this.opts.weather === 'wet' ? 'WET · 18°C' : this.opts.track.night ? 'NIGHT · 19°C' : 'DRY · 27°C',
      notes: `${notes}${this.opts.flags === false ? ' · FLAGS OFF' : ''}`,
      penalty: player.penalty > 0 ? `STEWARDS +${Math.round(player.penalty)}s` : '',
      status: this.phase,
    };
    this.hud.update(telemetry, session, timingEntries);
  }

  private timings(leader: Racer): TimingEntry[] {
    if (this.phase === 'qualifying') {
      const p = this.playerRacer;
      return [
        {
          position: 1,
          name: p.name,
          tag: p.tag,
          gap: this.qualifyingBest ? formatTime(this.qualifyingBest) : 'NO TIME',
          compoundColor: p.car.getCompoundColor(),
          isPlayer: true,
          life: p.car.tyreLife,
        },
      ];
    }
    return this.sortedRacers().map((racer) => {
      let gap = 'LEADER';
      if (racer !== leader) {
        if (racer.finished && leader.finished) {
          gap = `+${(racer.finishTime + racer.penalty - (leader.finishTime + leader.penalty)).toFixed(1)}`;
        } else {
          const laps = Math.max(0, leader.distance - racer.distance);
          gap = laps >= 1 ? `+${Math.floor(laps)} LAP` : `+${(laps * (racer.bestLap || 92)).toFixed(1)}`;
        }
      }
      return {
        position: racer.position,
        name: racer.name,
        tag: racer.tag,
        gap,
        compoundColor: racer.car.getCompoundColor(),
        isPlayer: racer.isPlayer,
        life: racer.car.tyreLife,
      };
    });
  }

  private deltaString(): string {
    if (this.opts.mode === 'timetrial') {
      if (this.deltaIsBest) return 'BEST';
      if (!this.lastDelta) return '—';
      return `${this.lastDelta > 0 ? '+' : ''}${this.lastDelta.toFixed(3)}`;
    }
    const player = this.playerRacer;
    if (!player.bestLap) return '—';
    if (this.deltaIsBest) return 'BEST';
    return this.lastDelta !== 0 ? `${this.lastDelta > 0 ? '+' : ''}${this.lastDelta.toFixed(3)}` : '—';
  }

  private updateAudio(): void {
    const player = this.playerRacer;
    const telemetry = player.car.getTelemetry();
    const slip = telemetry.tyres.reduce((max, tyre) => Math.max(max, Math.abs(tyre.slipAngle)), 0) * telemetry.speedKmh / 420;
    this.audio.update({
      rpm: telemetry.rpm,
      throttle: telemetry.throttle,
      speed: telemetry.speedKmh,
      slip: clamp(slip, 0, 1),
      brake: telemetry.brake,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('resize', this.onResize);
    this.audio.dispose();
    this.hud.hide();
    this.renderer.dispose();
    document.getElementById('screen-pause')?.classList.add('hidden');
    document.getElementById('screen-results')?.classList.remove('active');
  }
}

function fillText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
