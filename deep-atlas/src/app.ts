import {
  DATASET_COUNTS,
  categoryLabel,
  formatDepth,
  formatNumber,
  statLine,
  type RegionId,
} from './data';
import { Game, type Entry, type RoundConfig, type RoundResult } from './engine';
import { SoundEngine } from './audio';
import { AtlasMap } from './map';
import {
  dateKey,
  dailyNumber,
  hashSeed,
  type ModeId,
  type Prompt,
} from './prompts';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

interface ModeDef {
  id: ModeId;
  name: string;
  tag: string;
  card: string;
  blurb: string;
  meta: string[];
}

const MODES: ModeDef[] = [
  {
    id: 'daily',
    name: 'DAILY 7',
    tag: 'DAILY 7',
    card: 'Shared daily seed',
    blurb:
      'The world’s shared descent. Seven prompts drawn deterministically from the date — identical for every player until midnight. Day one is 23 November 2026. Your streak, best depth and history stay in this browser.',
    meta: ['7 PROMPTS', '20 SECONDS', 'SHARED SEED'],
  },
  {
    id: 'blitz',
    name: 'CONTINENT BLITZ',
    tag: 'CONTINENT BLITZ',
    card: 'Five prompts, one region',
    blurb:
      'Five prompts, one region, no time to think. Pick a continent and every prompt is locked to its places — the map starts framed on your choice.',
    meta: ['5 PROMPTS', '20 SECONDS', 'REGION LOCKED'],
  },
  {
    id: 'hardcore',
    name: 'HARDCORE BLIND',
    tag: 'HARDCORE BLIND MAP',
    card: 'No labels, no borders',
    blurb:
      'The full seven-prompt descent with every label stripped off the map. No country names, no city text — pure geography memory, dark tiles only.',
    meta: ['7 PROMPTS', '20 SECONDS', 'NO LABELS'],
  },
  {
    id: 'endless',
    name: 'ENDLESS DIVE',
    tag: 'ENDLESS CORE DIVE',
    card: 'One clock, no mercy',
    blurb:
      'One clock and no fixed length. Every valid answer banks +5 seconds and buys another prompt. One miss and the drill stops exactly where it is.',
    meta: ['NO LIMIT', '+5s PER HIT', 'ONE MISS ENDS IT'],
  },
  {
    id: 'pinpoint',
    name: 'PINPOINT',
    tag: 'PINPOINT REVERSE',
    card: 'Name the crosshair',
    blurb:
      'The map dives to a mystery coordinate. Identify the place under the crosshair — or any real place within 300 km of it. The closer your guess, the deeper the cut.',
    meta: ['5 PINS', '300 KM TOLERANCE', 'REVERSE MODE'],
  },
];

const MODE_BY_ID = new Map(MODES.map((m) => [m.id, m]));

const REGION_LABEL: Record<RegionId, string> = {
  world: 'World',
  europe: 'Europe',
  asia: 'Asia',
  americas: 'Americas',
  africa: 'Africa',
  oceania: 'Oceania',
};

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

interface HistoryRow {
  date: string;
  depth: number;
  hits: number;
  prompts: number;
}

interface DailySave {
  date: string;
  streak: number;
  best: number;
  history: HistoryRow[];
}

const KEY_DAILY = 'deepatlas.daily.v1';
const KEY_RECORDS = 'deepatlas.records.v1';
const KEY_MUTED = 'deepatlas.muted.v1';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage may be blocked — the run still counts */
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function el<T extends Element = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as unknown as T;
}

function cleanupEmojis(entries: Entry[]): string {
  return entries
    .map((entry) => {
      if (entry.missed) return '⬛';
      if (entry.trap) return '⚠️';
      if (entry.depth >= 700) return '💎';
      if (entry.depth >= 300) return '🟦';
      return '🟨';
    })
    .join('');
}

function gradeFor(total: number): string {
  if (total >= 6000) return 'MAGMA CLASS';
  if (total >= 4800) return 'CORE HUNTER';
  if (total >= 3600) return 'MANTLE RUNNER';
  if (total >= 2400) return 'CRUST BREAKER';
  if (total >= 1200) return 'SHALLOW DIVER';
  return 'SURFACE SCRATCHER';
}

function badgeFor(entry: Entry): { text: string; className: string } {
  if (entry.missed) return { text: '⬛ MISSED', className: 'trap' };
  if (entry.trap) return { text: '⚠ TOURIST TRAP', className: 'trap' };
  if (entry.gem) return { text: '💎 DEEP GEM', className: '' };
  if (entry.depth >= 300) return { text: 'SOLID CUT', className: '' };
  return { text: 'SHALLOW CUT', className: '' };
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export class App {
  private map: AtlasMap;
  private sound: SoundEngine;
  private game: Game;
  private mode: ModeId = 'daily';
  private region: RegionId = 'world';
  private result: RoundResult | null = null;
  private daily: DailySave = { date: '', streak: 0, best: 0, history: [] };
  private records: Record<string, number> = {};
  private feedbackTimer: number | null = null;
  private lastTickSecond = -1;

  constructor() {
    this.sound = new SoundEngine(this.readMuted());
    this.map = new AtlasMap(el('map'));

    this.game = new Game({
      onPrompt: (prompt, index, total) => this.handlePrompt(prompt, index, total),
      onTick: (secondsLeft, totalSeconds) => this.handleTick(secondsLeft, totalSeconds),
      onReveal: (entry) => this.handleReveal(entry),
      onReject: (message) => this.handleReject(message),
      onPause: (paused) => this.handlePause(paused),
      onEnd: (result) => this.handleEnd(result),
    });

    this.daily = readJson<DailySave>(KEY_DAILY, { date: '', streak: 0, best: 0, history: [] });
    this.records = readJson<Record<string, number>>(KEY_RECORDS, {});

    this.buildModeTabs();
    this.buildRegions();
    this.wire();
    this.refreshHome();
    this.syncSound();
    this.updateRail(0);

    // Leaflet needs a tick after the page settles.
    window.setTimeout(() => this.map.invalidate(), 120);
    window.setTimeout(() => {
      const bootEl = document.getElementById('boot');
      bootEl?.classList.add('done');
      window.setTimeout(() => bootEl?.remove(), 700);
    }, 420);
  }

  /* ---------------- setup ---------------- */

  private buildModeTabs(): void {
    const tabs = el('mode-tabs');
    tabs.innerHTML = '';
    MODES.forEach((mode, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mode-card';
      button.setAttribute('role', 'tab');
      button.dataset.mode = mode.id;
      button.setAttribute('aria-selected', String(mode.id === this.mode));
      button.innerHTML = `<span class="mode-num">0${index + 1}</span><strong>${mode.name}</strong><small>${mode.card}</small>`;
      button.addEventListener('click', () => {
        this.mode = mode.id;
        for (const node of tabs.querySelectorAll<HTMLElement>('.mode-card')) {
          node.setAttribute('aria-selected', String(node.dataset.mode === mode.id));
        }
        this.sound.click();
        this.updateModeInfo();
      });
      tabs.appendChild(button);
    });
    this.updateModeInfo();
  }

  private buildRegions(): void {
    const chips = el('region-chips');
    chips.innerHTML = '';
    (Object.keys(REGION_LABEL) as RegionId[]).forEach((id) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'region-chip';
      button.textContent = REGION_LABEL[id];
      button.setAttribute('aria-pressed', String(id === this.region));
      button.addEventListener('click', () => {
        this.region = id;
        for (const node of chips.querySelectorAll<HTMLElement>('.region-chip')) {
          node.setAttribute('aria-pressed', String(node.textContent === REGION_LABEL[id]));
        }
        this.sound.click();
        this.updateModeInfo();
      });
      chips.appendChild(button);
    });
  }

  private updateModeInfo(): void {
    const mode = MODE_BY_ID.get(this.mode) ?? MODES[0];
    el('mode-desc').textContent = mode.blurb;
    const regionRow = el('region-row');
    regionRow.hidden = this.mode !== 'blitz';

    const bits = [...mode.meta];
    if (this.mode === 'blitz') bits.splice(2, 1, `${REGION_LABEL[this.region].toUpperCase()} LOCK`);
    if (this.mode === 'daily') bits.push(`#${dailyNumber(new Date())} · ${dateKey()}`);
    el('run-meta').innerHTML = bits.map((bit) => `<span><b>•</b> ${bit}</span>`).join('');

    el('btn-start').querySelector('span')!.textContent =
      this.mode === 'endless' ? 'BEGIN THE DIVE' : 'START THE DESCENT';
  }

  private wire(): void {
    el('btn-start').addEventListener('click', () => this.start());
    el('guess-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const input = el<HTMLInputElement>('guess-input');
      this.game.submit(input.value);
    });
    el('btn-next').addEventListener('click', () => this.game.next());
    el('btn-reveal-next').addEventListener('click', () => this.game.next());
    el('btn-quit').addEventListener('click', () => {
      if (this.game.isRevealing()) return;
      this.game.pause(true);
    });
    el('btn-resume').addEventListener('click', () => this.game.pause(false));
    el('btn-abandon').addEventListener('click', () => {
      this.game.abandon();
      this.handlePause(false);
      this.showHome();
    });

    el('btn-help').addEventListener('click', () => this.toggleHelp(true));
    el('btn-help-2').addEventListener('click', () => this.toggleHelp(true));
    el('btn-help-close').addEventListener('click', () => this.toggleHelp(false));
    el('btn-help-done').addEventListener('click', () => this.toggleHelp(false));
    el('modal-help').addEventListener('click', (event) => {
      if (event.target === el('modal-help')) this.toggleHelp(false);
    });

    el('btn-share').addEventListener('click', () => this.copyShare());
    el('btn-home').addEventListener('click', () => this.showHome());
    el('btn-again').addEventListener('click', () => this.start(this.mode, this.region));

    el('btn-sound').addEventListener('click', () => this.toggleSound());
    el('btn-sound-hud').addEventListener('click', () => this.toggleSound());

    el('prompt-card').addEventListener('click', (event) => {
      if (this.game.isRevealing() || this.game.isPaused()) return;
      if ((event.target as HTMLElement).closest('button')) return;
      el<HTMLInputElement>('guess-input').focus();
    });

    document.addEventListener('keydown', (event) => this.handleKey(event));
    window.addEventListener('resize', () => this.map.invalidate());
  }

  private handleKey(event: KeyboardEvent): void {
    const helpOpen = !el('modal-help').hidden;
    const pauseOpen = !el('modal-pause').hidden;
    const homeVisible = el('screen-home').classList.contains('is-active');
    const hudVisible = !el('hud').hidden;

    if (event.key === 'Escape') {
      if (helpOpen) {
        this.toggleHelp(false);
        return;
      }
      if (pauseOpen) {
        this.game.pause(false);
        return;
      }
      if (hudVisible && !this.game.isRevealing()) {
        event.preventDefault();
        this.game.pause(true);
      }
      return;
    }

    if (event.key === 'Enter') {
      if (hudVisible && this.game.isRevealing() && !pauseOpen) {
        const active = document.activeElement;
        if (active instanceof HTMLButtonElement && active.id === 'btn-share') return;
        event.preventDefault();
        this.game.next();
        return;
      }
      if (homeVisible && !helpOpen) {
        const tag = (document.activeElement?.tagName ?? '').toLowerCase();
        if (tag === 'button' || tag === 'input' || tag === 'a') return;
        event.preventDefault();
        this.start();
      }
    }
  }

  /* ---------------- round flow ---------------- */

  private start(mode: ModeId = this.mode, region: RegionId = this.region): void {
    this.sound.unlock();
    this.mode = mode;
    this.region = region;
    this.result = null;

    el('screen-home').classList.remove('is-active');
    el('screen-home').hidden = true;
    el('screen-summary').hidden = true;
    el('screen-summary').classList.remove('is-active');
    el('hud').hidden = false;
    document.body.classList.add('in-round');
    document.body.classList.remove('summary-open');

    this.map.clearSession();
    this.map.setHardcore(mode === 'hardcore');
    this.map.flyRegion(region);
    this.updateRail(0);
    el('reveal').hidden = true;
    el('btn-next').hidden = true;
    el('feedback').textContent = '';
    el('timer').classList.remove('warning', 'paused');
    this.lastTickSecond = -1;

    const seed =
      mode === 'daily' ? hashSeed(`${dateKey()}-deep-atlas`) : Math.floor(Math.random() * 0xffffffff);
    const config: RoundConfig = {
      mode,
      region,
      seed,
      number: mode === 'daily' ? dailyNumber(new Date()) : 0,
    };

    const modeDef = MODE_BY_ID.get(mode) ?? MODES[0];
    el('hud-mode').textContent = modeDef.tag;
    el('time-bank').hidden = mode !== 'endless';

    this.game.start(config);
  }

  private handlePrompt(prompt: Prompt, index: number, total: number | null): void {
    const counter = total ? `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}` : `${String(index + 1).padStart(2, '0')} / ∞`;
    el('hud-progress').textContent = counter;
    el('prompt-index').textContent = counter;
    el('prompt-text').textContent = prompt.text;
    el('prompt-chip').textContent =
      prompt.chip === 'pinpoint'
        ? 'REVERSE'
        : prompt.chip === 'mixed'
          ? 'ANY PLACE'
          : prompt.chip.toUpperCase();

    const input = el<HTMLInputElement>('guess-input');
    input.value = '';
    input.disabled = false;
    el('btn-next').hidden = true;
    el('reveal').hidden = true;
    el('prompt-card').classList.remove('shake');
    el('feedback').textContent = '';
    el('feedback').className = 'feedback';

    const pinpoint = prompt.category === 'pinpoint' && prompt.target;
    el('pinpoint-note').hidden = !pinpoint;
    el('prompt-hint').textContent = pinpoint
      ? 'NAME IT OR ANY PLACE WITHIN 300 KM'
      : this.mode === 'hardcore'
        ? 'NO LABELS ON THIS MAP — TRUST YOUR MEMORY'
        : 'TYPO-TOLERANT · ENTER TO SUBMIT';

    if (pinpoint && prompt.target) {
      this.map.showCrosshair(prompt.target.lat, prompt.target.lng);
      this.sound.sonar();
    } else {
      this.map.hideCrosshair();
    }

    window.setTimeout(() => {
      if (!this.game.isRevealing()) input.focus({ preventScroll: true });
    }, 60);
  }

  private handleTick(secondsLeft: number, totalSeconds: number): void {
    const seconds = Math.max(0, Math.ceil(secondsLeft));
    el('timer-seconds').textContent = String(seconds);

    const circumference = 2 * Math.PI * 19.5;
    const fraction = Math.max(0, Math.min(1, secondsLeft / Math.max(1, totalSeconds)));
    const ring = document.getElementById('timer-ring') as SVGCircleElement | null;
    if (ring) {
      ring.style.strokeDasharray = `${circumference}`;
      ring.style.strokeDashoffset = `${circumference * (1 - fraction)}`;
    }

    el('timer').classList.toggle('warning', secondsLeft <= 5);
    if (this.mode === 'endless') {
      el('time-bank').textContent = `BANK ${Math.round(totalSeconds)}s`;
    }

    if (seconds !== this.lastTickSecond) {
      this.lastTickSecond = seconds;
      if (seconds > 0 && secondsLeft > 0) this.sound.tick(seconds <= 5);
    }
  }

  private handleReveal(entry: Entry): void {
    const input = el<HTMLInputElement>('guess-input');
    input.disabled = true;
    el('btn-next').hidden = false;

    const badge = badgeFor(entry);
    el('reveal-badge').textContent = badge.text;
    el('reveal-badge').className = `reveal-badge ${badge.className}`;

    const pinpoint = entry.prompt.category === 'pinpoint' && entry.prompt.target;
    const shownPlace = entry.missed ? entry.best : (entry.answer ?? entry.best);

    el('reveal-name').textContent = shownPlace.name;
    el('reveal-category').textContent = categoryLabel(shownPlace);

    if (entry.missed) {
      el('reveal-meta').textContent = `TIME EXPIRED · THE RAREST ANSWER WAS ${entry.best.name.toUpperCase()}`;
    } else if (pinpoint && entry.prompt.target) {
      el('reveal-meta').textContent = `${statLine(entry.prompt.target)} · ${Math.round(entry.distanceKm ?? 0)} km from your answer`;
    } else {
      el('reveal-meta').textContent = statLine(shownPlace);
    }

    el('reveal-depth').textContent = `+${formatNumber(entry.depth)} m`;
    el('reveal-percentile').textContent = `RARITY P${entry.percentile}`;

    if (pinpoint) {
      this.map.hideCrosshair();
      if (entry.answer) this.map.placeMarker(entry.answer, entry.depth, 'guess');
      if (entry.prompt.target) {
        this.map.flyTo(entry.prompt.target, 6.2);
        this.map.placeMarker(entry.prompt.target, entry.depth, 'target');
      }
    } else {
      this.map.flyTo(shownPlace);
      this.map.placeMarker(shownPlace, entry.depth, entry.missed ? 'gem' : 'guess');
    }

    this.sound.sonar();
    window.setTimeout(() => {
      if (entry.missed) this.sound.miss();
      else this.sound.chime(entry.gem);
    }, 130);

    this.updateRail(this.game.getTotalDepth());

    el('reveal').hidden = false;
  }

  private handleReject(message: string): void {
    const card = el('prompt-card');
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');

    const feedback = el('feedback');
    feedback.textContent = message;
    feedback.className = 'feedback bad';

    const input = el<HTMLInputElement>('guess-input');
    input.value = '';
    input.focus({ preventScroll: true });

    this.sound.buzz();

    if (this.feedbackTimer !== null) window.clearTimeout(this.feedbackTimer);
    this.feedbackTimer = window.setTimeout(() => {
      feedback.textContent = '';
      feedback.className = 'feedback';
      card.classList.remove('shake');
    }, 2400);
  }

  private handlePause(paused: boolean): void {
    el('modal-pause').hidden = !paused;
    el('timer').classList.toggle('paused', paused);
    if (paused) this.sound.click();
  }

  private handleEnd(result: RoundResult): void {
    this.result = result;
    this.sound.finish();
    this.saveProgress(result);
    this.renderSummary(result);

    el('hud').hidden = true;
    el('reveal').hidden = true;
    el('pinpoint-note').hidden = true;
    document.body.classList.remove('in-round');
    document.body.classList.add('summary-open');

    const summary = el('screen-summary');
    summary.hidden = false;
    summary.classList.add('is-active');
    summary.scrollTop = 0;
  }

  private saveProgress(result: RoundResult): void {
    const key = result.config.mode;
    const best = Math.max(this.records[key] ?? 0, result.totalDepth);
    this.records = { ...this.records, [key]: best };
    writeJson(KEY_RECORDS, this.records);

    if (key !== 'daily') return;

    const today = dateKey();
    const yesterday = dateKey(new Date(Date.now() - 86_400_000));
    if (this.daily.date !== today) {
      this.daily.streak = this.daily.date === yesterday ? this.daily.streak + 1 : 1;
      this.daily.date = today;
    }
    this.daily.best = Math.max(this.daily.best, result.totalDepth);
    this.daily.history = [
      {
        date: today,
        depth: result.totalDepth,
        hits: result.hits,
        prompts: result.entries.length,
      },
      ...this.daily.history,
    ].slice(0, 30);
    writeJson(KEY_DAILY, this.daily);
  }

  /* ---------------- summary ---------------- */

  private renderSummary(result: RoundResult): void {
    const mode = MODE_BY_ID.get(result.config.mode) ?? MODES[0];
    const regionSuffix = result.config.mode === 'blitz' ? ` · ${REGION_LABEL[result.config.region]}` : '';
    el('sum-mode').textContent = `${mode.tag}${regionSuffix}`;
    el('sum-title').textContent =
      result.config.mode === 'endless' ? 'DRILL TERMINATED' : 'DESCENT COMPLETE';
    const total = result.entries.length;
    const streakLine = result.config.mode === 'daily' ? ` · ${this.daily.streak} DAY STREAK` : '';
    el('sum-sub').textContent = `${result.hits} / ${total} prompts charted${streakLine} · ${formatNumber(result.totalDepth)} m of crust removed`;
    el('sum-depth').textContent = formatDepth(result.totalDepth);
    el('sum-grade').textContent = gradeFor(result.totalDepth);

    const number =
      result.config.mode === 'daily'
        ? result.config.number === 1
          ? '#1 · FIRST DESCENT'
          : `#${result.config.number}`
        : mode.name;
    el('share-grid').innerHTML = `<span class="share-total">🌍 DEEP ATLAS ${number} — ${formatNumber(result.totalDepth)}m Depth</span>${cleanupEmojis(result.entries)}`;

    const body = el('sum-body');
    body.innerHTML = '';
    result.entries.forEach((entry, index) => {
      const tr = document.createElement('tr');
      const answer = entry.answer;
      const answerLabel = answer
        ? `${answer.name}<span class="answer-meta">${categoryLabel(answer)}${
            entry.trap ? ' · ⚠ TRAP' : entry.gem ? ' · 💎 GEM' : ''
          }</span>`
        : `<span class="missed">— missed —</span><span class="answer-meta">NO ANSWER</span>`;
      const rarity = entry.missed
        ? `<span class="rarity-cell">—</span>`
        : `<span class="rarity-cell">P${entry.percentile}</span><span class="rarity-bar"><i style="width:${entry.percentile}%"></i></span>`;

      tr.innerHTML = `
        <td class="col-i"><span class="row-index">${String(index + 1).padStart(2, '0')}</span></td>
        <td class="row-prompt">${entry.prompt.text}</td>
        <td class="row-answer ${entry.missed ? 'missed' : ''}">${answerLabel}</td>
        <td class="num">${rarity}</td>
        <td class="num"><span class="depth-cell ${entry.missed ? 'miss' : ''}">${entry.missed ? '+0 m' : `+${formatNumber(entry.depth)} m`}</span></td>
        <td class="gem-cell"><b>${entry.best.name}</b>${entry.best.trap ? '<span class="trap-flag">⚠</span>' : ''}<span class="answer-meta">+${formatNumber(entry.bestDepth)} m · P${entry.bestPercentile}</span></td>
      `;
      body.appendChild(tr);
    });

    const pinpointTarget =
      result.config.mode === 'pinpoint'
        ? result.entries[result.entries.length - 1]?.prompt.target
        : undefined;

    this.map.setHardcore(result.config.mode === 'hardcore');
    window.setTimeout(() => this.map.showSummary(result.entries, pinpointTarget), 220);
  }

  private shareText(): string {
    if (!this.result) return '';
    const mode = MODE_BY_ID.get(this.result.config.mode) ?? MODES[0];
    const tag =
      this.result.config.mode === 'daily'
        ? this.result.config.number === 1
          ? '#1 · FIRST DESCENT'
          : `#${this.result.config.number}`
        : mode.name.toUpperCase();
    return [
      `🌍 DEEP ATLAS ${tag} — ${formatNumber(this.result.totalDepth)}m Depth`,
      `${mode.name} · ${this.result.hits}/${this.result.entries.length} charted · ${gradeFor(this.result.totalDepth)}`,
      cleanupEmojis(this.result.entries),
    ].join('\n');
  }

  private async copyShare(): Promise<void> {
    const text = this.shareText();
    if (!text) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
      }
      this.toast('SHARE GRID COPIED');
    } catch {
      this.toast('COPY BLOCKED — SELECT THE GRID MANUALLY');
    }
  }

  private toast(message: string): void {
    const node = el('toast');
    node.textContent = message;
    node.classList.add('show');
    window.setTimeout(() => node.classList.remove('show'), 2200);
  }

  /* ---------------- navigation ---------------- */

  private showHome(): void {
    this.game.stop();
    el('hud').hidden = true;
    el('modal-pause').hidden = true;
    el('pinpoint-note').hidden = true;
    el('reveal').hidden = true;

    const summary = el('screen-summary');
    summary.hidden = true;
    summary.classList.remove('is-active');

    const home = el('screen-home');
    home.hidden = false;
    home.classList.add('is-active');

    document.body.classList.remove('in-round', 'summary-open');
    this.map.setHardcore(false);
    this.map.reset();
    this.refreshHome();
    this.updateModeInfo();
  }

  private refreshHome(): void {
    const number = dailyNumber(new Date());
    el('daily-number').textContent = `#${number}`;
    el('stat-streak').textContent = String(this.daily.streak);
    el('stat-best').textContent = this.daily.best ? formatDepth(this.daily.best) : '—';
    el('stat-runs').textContent = String(this.daily.history.length);
    const record = Object.values(this.records).reduce((max, value) => Math.max(max, value), 0);
    el('stat-record').textContent = record ? formatDepth(record) : '—';

    el('dataset-line').innerHTML = `${DATASET_COUNTS.total} places · ${DATASET_COUNTS.countries} countries<br>${DATASET_COUNTS.cities} cities · ${DATASET_COUNTS.rivers} rivers · ${DATASET_COUNTS.peaks} peaks<br>${DATASET_COUNTS.islands} islands · ${DATASET_COUNTS.lakes} lakes`;
    el('foot-dataset').textContent = `${DATASET_COUNTS.total} PLACES CHARTED`;
    el('time-bank').hidden = true;
  }

  private toggleHelp(open: boolean): void {
    el('modal-help').hidden = !open;
    if (open) this.sound.click();
  }

  /* ---------------- misc ---------------- */

  private updateRail(meters: number): void {
    const km = meters / 1000;
    const progress =
      Math.log10(1 + Math.max(0, km)) / Math.log10(1 + 6371);
    el('rail-fill').style.height = `${(Math.max(0, Math.min(1, progress)) * 100).toFixed(3)}%`;
    el('rail-value').textContent = km.toFixed(3);
    el('hud-depth').textContent = formatDepth(meters);
  }

  private readMuted(): boolean {
    try {
      return localStorage.getItem(KEY_MUTED) === '1';
    } catch {
      return false;
    }
  }

  private toggleSound(): void {
    this.sound.muted = !this.sound.muted;
    try {
      localStorage.setItem(KEY_MUTED, this.sound.muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (!this.sound.muted) {
      this.sound.unlock();
      this.sound.click();
    }
    this.syncSound();
  }

  private syncSound(): void {
    const label = this.sound.muted ? 'MUTED' : 'SOUND ON';
    el('btn-sound').textContent = label;
    el('btn-sound').setAttribute('aria-pressed', String(this.sound.muted));
    el('btn-sound-hud').textContent = this.sound.muted ? '✕' : '♪';
    el('btn-sound-hud').setAttribute('aria-label', this.sound.muted ? 'Unmute sound' : 'Mute sound');
  }
}

export function boot(): void {
  const app = new App();
  (window as unknown as { deepAtlas?: App }).deepAtlas = app;
  const foot = document.getElementById('foot-dataset');
  if (foot) foot.title = `${DATASET_COUNTS.total} bundled geographic entries`;
}
