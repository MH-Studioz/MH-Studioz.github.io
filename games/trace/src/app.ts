import {
  BY_ID,
  CHAMPIONSHIPS,
  CIRCUITS,
  PODIUM_SEASONS,
  SERIES,
  TAGGED,
  championshipName,
  circuitsForChampionship,
  formatLength,
  type ChampionshipId,
  type Circuit,
  type PodiumRace,
} from './data';
import {
  DIFFICULTIES,
  buildShare,
  dailyNumber,
  dailySeed,
  difficultyById,
  findSuggestions,
  formatClock,
  formatRunTime,
  gradeFor,
  hashSeed,
  matchesAnswer,
  maxRoundScore,
  normalize,
  pickRounds,
  scoreRound,
  type DifficultyDef,
  type DifficultyId,
  type RoundResult,
  type Suggestion,
} from './engine';
import { PartyClient, type PartyGame, type PartyLobby, type PartyPlayer, type PartyStatus } from './net';

type Mode = 'championship' | 'daily' | 'party' | 'podium';
type Screen = 'home' | 'play' | 'summary';

const ROUNDS_PER_RUN = 8;
const STORE_KEY = 'trace.v1';

interface ModeDef {
  id: Mode;
  label: string;
  desc: string;
  meta: string[];
}

const MODES: ModeDef[] = [
  {
    id: 'championship',
    label: 'CHAMPIONSHIP',
    desc: 'Eight circuits from one championship, drawn fresh every run. Take a single series or a mixed grid — MIXED spans all seven, FEEDER the Formula ladder, AMERICAN the ovals and streets. The order is never the same twice.',
    meta: ['8 CIRCUITS', '10 TITLES', 'CLOCK SCORED'],
  },
  {
    id: 'daily',
    label: 'DAILY TRACE',
    desc: 'One trace a day, identical for every player until local midnight. The seed is the date, so the friend you text is reading the exact same eight centerlines.',
    meta: ['8 CIRCUITS', 'SHARED SEED', 'SHARE GRID'],
  },
  {
    id: 'party',
    label: 'PARTY',
    desc: 'One host, one code, one live board. The host picks the championship and difficulty; everyone in the room gets the same eight outlines at the same time.',
    meta: ['8 CIRCUITS', 'LIVE BOARD', 'PEER-TO-PEER'],
  },
  {
    id: 'podium',
    label: 'PODIUM',
    desc: 'Every round of 2024 and 2025, top three only. Pick a season, pick a Grand Prix, and the podium is there: winner, second, third with teams and the gap to the leader.',
    meta: ['48 PODIUMS', '2024 · 2025', 'TOP THREE'],
  },
];

interface Save {
  runs: number;
  best: number;
  bestDaily: number;
  streak: number;
  lastDaily: number;
  name: string;
}

function el<T extends Element = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as unknown as T;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function readSave(): Save {
  const fallback: Save = { runs: 0, best: 0, bestDaily: 0, streak: 0, lastDaily: 0, name: 'DRIVER' };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Save>;
    return {
      runs: Number(parsed.runs) || 0,
      best: Number(parsed.best) || 0,
      bestDaily: Number(parsed.bestDaily) || 0,
      streak: Number(parsed.streak) || 0,
      lastDaily: Number(parsed.lastDaily) || 0,
      name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.slice(0, 14) : 'DRIVER',
    };
  } catch {
    return fallback;
  }
}

function writeSave(save: Save): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(save));
  } catch {
    /* private mode: the run still works, it just does not persist */
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export class TraceApp {
  private mode: Mode = 'championship';
  private championship: ChampionshipId = 'f1';
  private difficultyId: DifficultyId = 'pro';
  private screen: Screen = 'home';

  private rounds: Circuit[] = [];
  private index = 0;
  private results: RoundResult[] = [];
  private attempts: boolean[] = [];
  private wrong = 0;
  private open = false;
  private roundStart = 0;
  private runStart = 0;
  private ticker = 0;
  private runTitle = 'TRACE RUN';
  private runKind = 'CHAMPIONSHIP';
  private shareText = '';

  private save = readSave();
  private selfId = `p-${Math.random().toString(36).slice(2, 10)}`;
  private party = new PartyClient();
  private suggestionList: Suggestion[] = [];
  private activeSuggestion = -1;
  private toastTimer = 0;
  private dailyTimer = 0;

  boot(): void {
    this.renderModeTabs();
    this.renderSeriesChips();
    this.renderDifficultyChips();
    this.renderPodium();
    this.renderMode();
    this.updateDaily();
    this.wire();
    this.wireParty();
    window.clearInterval(this.dailyTimer);
    this.dailyTimer = window.setInterval(() => this.updateDaily(), 1000);
  }

  /* ------------------------------------------------------------------ */
  /* Chrome                                                             */
  /* ------------------------------------------------------------------ */

  private wire(): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>('#mode-tabs .mode-tab')) {
      button.addEventListener('click', () => {
        this.mode = button.dataset.mode as Mode;
        this.renderMode();
      });
    }

    el('btn-start').addEventListener('click', () => this.startRun());
    el('btn-daily').addEventListener('click', () => {
      this.mode = 'daily';
      this.renderMode();
      this.startRun();
    });

    el('btn-help').addEventListener('click', () => {
      el('modal-help').hidden = false;
    });
    el('btn-help-close').addEventListener('click', () => {
      el('modal-help').hidden = true;
    });
    el('modal-help').addEventListener('click', (event) => {
      if (event.target === el('modal-help')) el('modal-help').hidden = true;
    });

    const input = el<HTMLInputElement>('guess-input');
    input.addEventListener('input', () => this.renderSuggestions());
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (this.activeSuggestion >= 0) {
          this.pickSuggestion(this.activeSuggestion, true);
          return;
        }
        this.submitGuess();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (!this.suggestionList.length) return;
        event.preventDefault();
        const count = this.suggestionList.length;
        const next =
          event.key === 'ArrowDown'
            ? this.activeSuggestion + 1 >= count
              ? 0
              : this.activeSuggestion + 1
            : this.activeSuggestion <= 0
              ? count - 1
              : this.activeSuggestion - 1;
        this.setActiveSuggestion(next);
      } else if (event.key === 'Escape') {
        this.hideSuggestions();
      }
    });

    el('btn-guess').addEventListener('click', () => this.submitGuess());
    el('btn-skip').addEventListener('click', () => this.finishRound(false, false));
    el('btn-next').addEventListener('click', () => this.nextRound());
    el('btn-copy').addEventListener('click', () => void this.copyShare());
    el('btn-again').addEventListener('click', () => {
      if (this.mode === 'party') this.goHome();
      else this.startRun();
    });
    el('btn-home').addEventListener('click', () => this.goHome());
    el('btn-quit').addEventListener('click', () => this.goHome());

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON')) return;
      if (this.screen === 'home' && (this.mode === 'championship' || this.mode === 'daily')) {
        event.preventDefault();
        this.startRun();
      }
    });
  }

  private wireParty(): void {
    this.party.onStatus = (status: PartyStatus, message: string) => {
      el('party-status').textContent = message;
      el('party-status').className = `party-status${status === 'error' ? ' is-error' : ''}`;
    };
    this.party.onLobby = (lobby) => this.renderLobby(lobby);
    this.party.onGame = (game) => this.beginPartyRun(game);
    this.party.onScores = (players) => this.renderPartyScores(players);

    el<HTMLInputElement>('party-name').value = this.save.name;
    el<HTMLInputElement>('party-name').addEventListener('change', () => {
      const value = el<HTMLInputElement>('party-name').value.trim().slice(0, 14) || 'DRIVER';
      this.save.name = value;
      writeSave(this.save);
      el<HTMLInputElement>('party-name').value = value;
    });

    el('btn-host').addEventListener('click', () => {
      const name = this.partyName();
      void this.party.host({ id: this.selfId, name });
    });
    el('btn-join').addEventListener('click', () => {
      const code = el<HTMLInputElement>('party-code').value.replace(/\D/g, '').slice(0, 6);
      if (code.length !== 6) {
        this.toast('ENTER THE SIX-DIGIT CODE');
        return;
      }
      void this.party.join(code, { id: this.selfId, name: this.partyName() });
    });
    el('btn-party-start').addEventListener('click', () => this.launchParty());
    el('btn-party-leave').addEventListener('click', () => {
      this.party.leave();
      this.renderLobby(null);
    });
  }

  private partyName(): string {
    const value = el<HTMLInputElement>('party-name').value.trim().slice(0, 14) || 'DRIVER';
    this.save.name = value;
    writeSave(this.save);
    return value;
  }

  private renderModeTabs(): void {
    el('mode-tabs').innerHTML = MODES.map(
      (mode) => `<button class="mode-tab" type="button" role="tab" data-mode="${mode.id}">${mode.label}</button>`,
    ).join('');
  }

  private renderSeriesChips(): void {
    el('series-chips').innerHTML = CHAMPIONSHIPS.map(
      (championship) =>
        `<button class="chip" type="button" data-championship="${championship.id}"><strong>${championship.label}</strong><small>${championship.note}</small></button>`,
    ).join('');
    for (const button of document.querySelectorAll<HTMLButtonElement>('#series-chips .chip')) {
      button.addEventListener('click', () => {
        this.championship = button.dataset.championship as ChampionshipId;
        this.renderSeriesChips();
        this.renderMode();
      });
    }
  }

  private renderDifficultyChips(): void {
    el('difficulty-chips').innerHTML = DIFFICULTIES.map(
      (difficulty) =>
        `<button class="chip" type="button" data-difficulty="${difficulty.id}"><strong>${difficulty.label}</strong><small>${difficulty.guesses} GUESS${difficulty.guesses > 1 ? 'ES' : ''}</small></button>`,
    ).join('');
    for (const button of document.querySelectorAll<HTMLButtonElement>('#difficulty-chips .chip')) {
      button.addEventListener('click', () => {
        this.difficultyId = button.dataset.difficulty as DifficultyId;
        this.renderDifficultyChips();
        this.renderMode();
      });
    }
  }

  private renderMode(): void {
    const def = MODES.find((mode) => mode.id === this.mode) ?? MODES[0];
    for (const tab of document.querySelectorAll<HTMLElement>('#mode-tabs .mode-tab')) {
      tab.classList.toggle('is-active', tab.dataset.mode === this.mode);
      tab.setAttribute('aria-selected', String(tab.dataset.mode === this.mode));
    }
    el('mode-desc').textContent = def.desc;
    el('series-block').hidden = this.mode === 'daily';
    el('party-panel').hidden = this.mode !== 'party';
    el('podium-block').hidden = this.mode !== 'podium';
    el('difficulty-block').hidden = this.mode === 'podium';
    el('btn-start').hidden = this.mode === 'party' || this.mode === 'podium';

    const difficulty = difficultyById(this.difficultyId);
    el('run-meta').innerHTML = def.meta.map((item) => `<span>${item}</span>`).join('');

    el('start-label').textContent =
      this.mode === 'daily' ? 'PLAY TODAY’S TRACE' : this.mode === 'party' ? 'HOST OR JOIN A PARTY' : 'START THE RUN';

    el('difficulty-note').textContent = `${difficulty.guesses} GUESS${difficulty.guesses > 1 ? 'ES' : ''} · ${difficulty.limit}s LIMIT · ×${difficulty.multiplier.toFixed(2)} · ${difficulty.tagline}`.toUpperCase();

    for (const chip of document.querySelectorAll<HTMLElement>('#series-chips .chip')) {
      chip.classList.toggle('is-active', chip.dataset.championship === this.championship);
    }
    for (const chip of document.querySelectorAll<HTMLElement>('#difficulty-chips .chip')) {
      chip.classList.toggle('is-active', chip.dataset.difficulty === this.difficultyId);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Podium archive                                                     */
  /* ------------------------------------------------------------------ */

  private pageSeason = PODIUM_SEASONS[0]?.season ?? 0;
  private pagePodium: PodiumRace | null = null;

  private renderPodium(): void {
    const season = PODIUM_SEASONS.find((entry) => entry.season === this.pageSeason) ?? PODIUM_SEASONS[0];
    if (!season) return;
    this.pageSeason = season.season;

    el('podium-years').innerHTML = PODIUM_SEASONS.map(
      (entry) =>
        `<button class="chip${entry.season === season.season ? ' is-active' : ''}" type="button" data-season="${entry.season}"><strong>${entry.season}</strong><small>${entry.races.length} ROUNDS</small></button>`,
    ).join('');
    for (const button of document.querySelectorAll<HTMLButtonElement>('#podium-years .chip')) {
      button.addEventListener('click', () => {
        this.pageSeason = Number(button.dataset.season);
        this.pagePodium = null;
        this.renderPodium();
      });
    }

    el('podium-races').innerHTML = season.races
      .map(
        (race) =>
          `<button class="podium-race${this.pagePodium?.round === race.round ? ' is-active' : ''}" type="button" data-round="${race.round}"><span>R${pad(race.round)}</span>${escapeHtml(race.short)}</button>`,
      )
      .join('');
    for (const button of document.querySelectorAll<HTMLButtonElement>('#podium-races .podium-race')) {
      button.addEventListener('click', () => {
        const race = season.races.find((entry) => entry.round === Number(button.dataset.round));
        if (race) this.showPodium(race);
      });
    }

    if (this.pagePodium) this.showPodium(this.pagePodium);
    else el('podium-card').hidden = true;
  }

  private showPodium(race: PodiumRace): void {
    this.pagePodium = race;
    for (const button of document.querySelectorAll<HTMLElement>('#podium-races .podium-race')) {
      button.classList.toggle('is-active', Number(button.dataset.round) === race.round);
    }

    const circuit = BY_ID.get(race.circuitId);
    el('podium-kicker').textContent = `${this.pageSeason} · ROUND ${race.round}`;
    el('podium-title').textContent = `${race.short.toUpperCase()} GRAND PRIX`;
    el('podium-meta').textContent = circuit
      ? `${circuit.city}, ${circuit.country} · ${formatLength(circuit.length)}`
      : race.gp.toUpperCase();

    const path = el<SVGPathElement>('podium-path');
    path.setAttribute('d', circuit ? circuit.path : '');
    path.style.display = circuit ? '' : 'none';

    el('podium-board').innerHTML = race.podium
      .map(
        (line) => `<div class="board-row">
          <span class="rank">P${line.pos}</span>
          <span class="name">${escapeHtml(line.driver)}<em>${escapeHtml(line.team)}</em></span>
          <span class="pts">${escapeHtml(line.time)}</span>
          <span class="dots">${line.pos === 1 ? 'WIN' : 'P' + line.pos}</span>
        </div>`,
      )
      .join('');

    el('podium-card').hidden = false;
  }

  private updateDaily(): void {
    const day = dailyNumber();
    el('daily-number').textContent = `#${day}`;
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const ms = Math.max(0, midnight.getTime() - now.getTime());
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    const seconds = Math.floor((ms % 60_000) / 1000);
    el('daily-note').textContent = `NEXT TRACE IN ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

    el('stat-streak').textContent = String(this.save.streak);
    el('stat-best-daily').textContent = this.save.bestDaily ? this.save.bestDaily.toLocaleString('en-US') : '—';
    el('stat-runs').textContent = String(this.save.runs);
    el('stat-best').textContent = this.save.best ? this.save.best.toLocaleString('en-US') : '—';
    el('dataset-line').textContent = `${CIRCUITS.length} CIRCUITS · ${SERIES.length} SERIES`;
  }

  /* ------------------------------------------------------------------ */
  /* Run lifecycle                                                      */
  /* ------------------------------------------------------------------ */

  private startRun(): void {
    if (this.mode === 'party' || this.mode === 'podium') {
      el('party-panel').hidden = false;
      return;
    }
    this.results = [];
    this.index = 0;
    this.runStart = performance.now();
    this.runKind = this.mode === 'daily' ? 'DAILY' : 'CHAMPIONSHIP';

    if (this.mode === 'daily') {
      const day = dailyNumber();
      this.rounds = pickRounds(TAGGED, ROUNDS_PER_RUN, dailySeed(day));
      this.runTitle = `DAILY #${day}`;
    } else {
      const pool = circuitsForChampionship(this.championship);
      const seed = hashSeed(`${Date.now()}-${Math.random()}`);
      this.rounds = pickRounds(pool, ROUNDS_PER_RUN, seed);
      this.runTitle = `${championshipName(this.championship).toUpperCase()} CHAMPIONSHIP`;
    }
    this.goPlay();
  }

  private beginPartyRun(game: PartyGame): void {
    this.mode = 'party';
    this.championship = game.championship;
    this.difficultyId = game.difficulty;
    this.rounds = game.rounds.map((id) => BY_ID.get(id)).filter((circuit): circuit is Circuit => Boolean(circuit));
    if (!this.rounds.length) {
      this.toast('THAT PARTY SENT NO CIRCUITS');
      return;
    }
    this.results = [];
    this.index = 0;
    this.runStart = performance.now();
    this.runKind = 'PARTY';
    this.runTitle = `PARTY · ${championshipName(game.championship).toUpperCase()}`;
    this.renderMode();
    this.goPlay();
  }

  private goPlay(): void {
    this.screen = 'play';
    el('screen-home').hidden = true;
    el('screen-summary').hidden = true;
    el('screen-play').hidden = false;
    el('round-card').hidden = true;
    this.showRound();
  }

  private goHome(): void {
    this.open = false;
    window.clearInterval(this.ticker);
    this.screen = 'home';
    el('screen-play').hidden = true;
    el('screen-summary').hidden = true;
    el('screen-home').hidden = false;
    el('round-card').hidden = true;
    el('party-ticker').hidden = this.mode !== 'party' || !this.party.isLive();
    this.updateDaily();
    this.renderMode();
  }

  private showRound(): void {
    const circuit = this.rounds[this.index];
    const difficulty = difficultyById(this.difficultyId);
    this.attempts = [];
    this.wrong = 0;
    this.open = true;
    this.roundStart = performance.now();

    el('round-counter').textContent = `${this.index + 1} / ${this.rounds.length}`;
    el('play-series-label').textContent = `${this.runKind === 'DAILY' ? 'MIXED' : championshipAbbrev(this.championship)} · ${difficulty.label}`;
    el('play-mode-label').textContent = this.runKind;
    el('play-clock').textContent = '0.0s';
    el('play-score').textContent = this.totalScore().toLocaleString('en-US');
    el('stage-tag').textContent = difficulty.concealed ? 'CONCEALED CENTERLINE' : 'UNLABELED CENTERLINE';

    const stage = el('stage');
    stage.classList.remove('is-revealed', 'is-missed');

    const path = el<SVGPathElement>('outline-path');
    path.setAttribute('d', circuit.path);
    path.style.transition = 'none';
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${Math.ceil(length)}`;
    path.style.strokeDashoffset = `${Math.ceil(length)}`;
    void path.getBoundingClientRect();
    path.style.transition = '';
    requestAnimationFrame(() => {
      path.style.strokeDashoffset = '0';
    });

    el('outline-group').setAttribute('transform', this.concealedTransform(circuit.id, difficulty));

    const input = el<HTMLInputElement>('guess-input');
    input.value = '';
    input.disabled = false;
    this.hideSuggestions();
    this.renderDots();
    this.renderHint();
    this.renderPartyTicker();
    el('btn-next').textContent = this.index + 1 >= this.rounds.length ? 'SEE RESULTS' : 'NEXT CIRCUIT';
    window.setTimeout(() => input.focus({ preventScroll: true }), 60);
    this.startTicker();
  }

  private concealedTransform(id: string, difficulty: DifficultyDef): string {
    if (!difficulty.concealed) return '';
    const seed = hashSeed(id);
    const angle = seed % 360;
    const mirrored = (seed >> 9) % 2 === 1;
    return `rotate(${angle} 500 500)${mirrored ? ' translate(1000 0) scale(-1 1)' : ''}`;
  }

  private startTicker(): void {
    window.clearInterval(this.ticker);
    const difficulty = difficultyById(this.difficultyId);
    this.ticker = window.setInterval(() => {
      const seconds = (performance.now() - this.roundStart) / 1000;
      el('play-clock').textContent = formatClock(seconds);
      this.renderHint();
      if (seconds >= difficulty.limit) this.finishRound(false, true);
    }, 100);
  }

  private submitGuess(): void {
    if (!this.open) return;
    const input = el<HTMLInputElement>('guess-input');
    const value = input.value.trim();
    if (!value) return;
    const circuit = this.rounds[this.index];

    if (matchesAnswer(circuit, value)) {
      this.attempts.push(true);
      this.hideSuggestions();
      this.finishRound(true, false);
      return;
    }

    this.wrong += 1;
    this.attempts.push(false);
    const difficulty = difficultyById(this.difficultyId);
    if (this.wrong >= difficulty.guesses) {
      this.hideSuggestions();
      this.finishRound(false, false);
      return;
    }

    this.flashWrong();
    input.select();
    this.renderDots();
    this.renderHint();
    this.renderSuggestions();
  }

  private flashWrong(): void {
    const stage = el('stage');
    stage.classList.add('is-missed');
    window.setTimeout(() => {
      if (this.open) stage.classList.remove('is-missed');
    }, 550);
  }

  private finishRound(solved: boolean, timedOut: boolean): void {
    if (!this.open) return;
    this.open = false;
    window.clearInterval(this.ticker);

    const circuit = this.rounds[this.index];
    const difficulty = difficultyById(this.difficultyId);
    const seconds = (performance.now() - this.roundStart) / 1000;
    const score = scoreRound(solved, this.wrong, seconds, difficulty);
    const result: RoundResult = {
      circuit,
      solved,
      attempts: [...this.attempts],
      seconds,
      score,
    };
    this.results.push(result);

    const stage = el('stage');
    stage.classList.remove('is-missed');
    stage.classList.add(solved ? 'is-revealed' : 'is-missed');
    el<HTMLInputElement>('guess-input').disabled = true;
    el('play-score').textContent = this.totalScore().toLocaleString('en-US');

    el('round-verdict').textContent = solved ? 'CORRECT' : timedOut ? 'CLOCK EXPIRED' : 'OUT OF GUESSES';
    el('round-verdict').className = `verdict${solved ? '' : ' is-miss'}`;
    el('round-answer').textContent = circuit.short;
    el('round-meta').textContent = `${circuit.city}, ${circuit.country} · ${formatLength(circuit.length)}`;
    el('round-points').textContent = solved ? `+${score.toLocaleString('en-US')}` : '+0';
    el('round-note').textContent = solved
      ? `${this.attempts.length} guess${this.attempts.length === 1 ? '' : 'es'} · ${seconds.toFixed(1)}s on the clock`
      : timedOut
        ? `The clock hit ${difficulty.limit}s before you named it.`
        : `Out of guesses after ${seconds.toFixed(1)}s.`;

    el('round-card').hidden = false;
    el('btn-next').focus({ preventScroll: true });

    if (this.party.isLive()) {
      this.party.pushScore(this.totalScore(), this.solvedCount(), false);
      this.renderPartyScores(this.party.lobby ? this.party.lobby.players : []);
    }
  }

  private nextRound(): void {
    el('round-card').hidden = true;
    this.index += 1;
    if (this.index >= this.rounds.length) {
      this.finishRun();
      return;
    }
    this.showRound();
  }

  private finishRun(): void {
    this.open = false;
    window.clearInterval(this.ticker);
    this.screen = 'summary';
    el('screen-play').hidden = true;
    el('screen-home').hidden = true;
    el('screen-summary').hidden = false;

    const difficulty = difficultyById(this.difficultyId);
    const total = this.totalScore();
    const solved = this.solvedCount();
    const elapsed = this.results.reduce((sum, result) => sum + result.seconds, 0);
    const maxTotal = maxRoundScore(difficulty) * this.rounds.length;
    const ratio = maxTotal > 0 ? total / maxTotal : 0;
    const grade = gradeFor(ratio);

    el('summary-title').textContent = this.runTitle;
    el('summary-grade').textContent = grade.letter;
    el('summary-score').textContent = total.toLocaleString('en-US');
    el('summary-meta').textContent = `${solved} / ${this.rounds.length} CORRECT`;
    el('summary-sub').textContent = `${difficulty.label} · ${total.toLocaleString('en-US')} of ${maxTotal.toLocaleString('en-US')} possible · ${formatRunTime(elapsed)} on the clock. ${grade.note}`;

    this.shareText = buildShare({
      title: this.runTitle,
      difficulty,
      guesses: difficulty.guesses,
      results: this.results,
      total,
      elapsed,
      maxTotal,
    });
    el('summary-share').textContent = this.shareText;

    el('summary-board').innerHTML = this.results
      .map((result, index) => {
        const dots = result.attempts.map((hit) => (hit ? '🟩' : '🟥')).join('') || '⬛';
        return `<div class="board-row">
          <span class="rank">${pad(index + 1)}</span>
          <span class="name">${escapeHtml(result.circuit.short)}<em>${escapeHtml(result.circuit.city)}, ${escapeHtml(result.circuit.country)}</em></span>
          <span class="pts">${result.score.toLocaleString('en-US')}</span>
          <span class="dots">${dots}</span>
        </div>`;
      })
      .join('');

    const standingsCard = el('summary-standings-card');
    if (this.party.isLive()) {
      standingsCard.hidden = false;
      this.renderPartyScores(this.party.lobby ? this.party.lobby.players : []);
    } else {
      standingsCard.hidden = true;
    }

    this.saveRun(total, solved);
    if (this.party.isLive()) this.party.pushScore(total, solved, true);
    el('btn-copy').focus({ preventScroll: true });
  }

  private saveRun(total: number, solved: number): void {
    this.save.runs += 1;
    this.save.best = Math.max(this.save.best, total);
    if (this.mode === 'daily') {
      const day = dailyNumber();
      this.save.bestDaily = Math.max(this.save.bestDaily, total);
      if (this.save.lastDaily !== day) {
        this.save.streak = this.save.lastDaily === day - 1 ? this.save.streak + 1 : 1;
        this.save.lastDaily = day;
      }
    }
    if (solved === 0) {
      /* a blank run still logs, it just does not move the best */
    }
    writeSave(this.save);
    this.updateDaily();
  }

  private totalScore(): number {
    return this.results.reduce((sum, result) => sum + result.score, 0);
  }

  private solvedCount(): number {
    return this.results.filter((result) => result.solved).length;
  }

  /* ------------------------------------------------------------------ */
  /* Guess aids                                                         */
  /* ------------------------------------------------------------------ */

  private renderHint(): void {
    if (!this.open) return;
    const circuit = this.rounds[this.index];
    const difficulty = difficultyById(this.difficultyId);
    const seconds = (performance.now() - this.roundStart) / 1000;
    const remaining = Math.max(0, difficulty.limit - seconds);
    const guessesLeft = Math.max(0, difficulty.guesses - this.wrong);
    const node = el('hint-line');

    if (this.wrong >= difficulty.countryAfter) {
      node.textContent = `COUNTRY: ${circuit.country.toUpperCase()} · ${guessesLeft} GUESS${guessesLeft === 1 ? '' : 'ES'} LEFT`;
      node.classList.add('is-hint');
      return;
    }
    node.classList.remove('is-hint');
    node.textContent = `${guessesLeft} GUESS${guessesLeft === 1 ? '' : 'ES'} LEFT · ${remaining.toFixed(0)}s ON THE CLOCK`;
  }

  private renderDots(): void {
    const difficulty = difficultyById(this.difficultyId);
    const parts: string[] = [];
    for (let i = 0; i < difficulty.guesses; i++) {
      const used = i < this.attempts.length;
      const live = i === this.attempts.length && this.open;
      parts.push(`<span class="dot${used ? ' is-used' : ''}${live ? ' is-live' : ''}"></span>`);
    }
    el('guess-dots').innerHTML = parts.join('');
  }

  private renderSuggestions(): void {
    if (!this.open) return;
    const input = el<HTMLInputElement>('guess-input');
    const query = input.value;
    if (normalize(query).length < 2) {
      this.hideSuggestions();
      return;
    }
    const pool = this.mode === 'party' || this.mode === 'championship' ? circuitsForChampionship(this.championship) : TAGGED;
    this.suggestionList = findSuggestions(pool, query);
    if (!this.suggestionList.length) {
      this.hideSuggestions();
      return;
    }
    const box = el('suggestions');
    box.innerHTML = this.suggestionList
      .map(
        (entry, index) =>
          `<button class="suggest-item" type="button" role="option" aria-selected="false" id="suggest-${index}" data-index="${index}">${escapeHtml(entry.label)}<em>${escapeHtml(entry.meta)}</em></button>`,
      )
      .join('');
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    this.setActiveSuggestion(-1);
    for (const button of box.querySelectorAll<HTMLButtonElement>('.suggest-item')) {
      button.addEventListener('click', () => this.pickSuggestion(Number(button.dataset.index)));
    }
  }

  /** Arrow-key highlight inside the open list; -1 means "nothing picked yet". */
  private setActiveSuggestion(index: number): void {
    const input = el<HTMLInputElement>('guess-input');
    const buttons = document.querySelectorAll<HTMLButtonElement>('#suggestions .suggest-item');
    this.activeSuggestion = index < 0 || index >= buttons.length ? -1 : index;
    buttons.forEach((button, position) => {
      const active = position === this.activeSuggestion;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    if (this.activeSuggestion >= 0) {
      input.setAttribute('aria-activedescendant', buttons[this.activeSuggestion].id);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  private pickSuggestion(index: number, submit = false): void {
    const pick = this.suggestionList[index];
    if (!pick) return;
    const input = el<HTMLInputElement>('guess-input');
    input.value = pick.label;
    this.hideSuggestions();
    input.focus({ preventScroll: true });
    if (submit) this.submitGuess();
  }

  private hideSuggestions(): void {
    this.suggestionList = [];
    this.activeSuggestion = -1;
    const input = el<HTMLInputElement>('guess-input');
    input.removeAttribute('aria-activedescendant');
    input.setAttribute('aria-expanded', 'false');
    el('suggestions').hidden = true;
    el('suggestions').innerHTML = '';
  }

  /* ------------------------------------------------------------------ */
  /* Party                                                              */
  /* ------------------------------------------------------------------ */

  private launchParty(): void {
    if (this.party.role !== 'host' || !this.party.isLive()) {
      this.toast('HOST A PARTY FIRST');
      return;
    }
    const pool = circuitsForChampionship(this.championship);
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
    const rounds = pickRounds(pool, ROUNDS_PER_RUN, seed);
    const game: PartyGame = {
      championship: this.championship,
      difficulty: this.difficultyId,
      rounds: rounds.map((circuit) => circuit.id),
    };
    this.party.launch(game);
    this.beginPartyRun(game);
  }

  private renderLobby(lobby: PartyLobby | null): void {
    const list = el('player-list');
    const codeBox = el('party-code-display');
    const startButton = el('btn-party-start');
    const leaveButton = el('btn-party-leave');

    if (!lobby) {
      list.innerHTML = '';
      codeBox.hidden = true;
      startButton.hidden = true;
      leaveButton.hidden = true;
      el('party-ticker').hidden = true;
      return;
    }

    el('party-code-value').textContent = lobby.code;
    codeBox.hidden = false;
    leaveButton.hidden = false;
    startButton.hidden = this.party.role !== 'host';
    el('party-ticker').hidden = this.screen !== 'play';
    list.innerHTML = lobby.players
      .map(
        (player) =>
          `<li><b>${escapeHtml(player.name)}${player.id === this.party.selfId ? ' (YOU)' : ''}</b><em>${player.score.toLocaleString('en-US')} PTS</em></li>`,
      )
      .join('');
  }

  private renderPartyScores(players: PartyPlayer[]): void {
    const sorted = [...players].sort((a, b) => b.score - a.score || b.solved - a.solved);
    if (this.party.isLive()) {
      el('player-list').innerHTML = sorted
        .map(
          (player) =>
            `<li><b>${escapeHtml(player.name)}${player.id === this.party.selfId ? ' (YOU)' : ''}</b><em>${player.score.toLocaleString('en-US')} PTS · ${player.solved}</em></li>`,
        )
        .join('');
    }

    if (this.screen === 'play') this.renderPartyTicker();
    if (this.screen === 'summary') {
      const card = el('summary-standings-card');
      if (!this.party.isLive()) {
        card.hidden = true;
        return;
      }
      card.hidden = false;
      el('summary-standings').innerHTML = sorted
        .map(
          (player, index) => `<div class="board-row${player.id === this.party.selfId ? ' is-me' : ''}">
            <span class="rank">${pad(index + 1)}</span>
            <span class="name">${escapeHtml(player.name)}${player.id === this.party.selfId ? ' (YOU)' : ''}<em>${player.done ? 'FINISHED' : 'ON TRACK'}</em></span>
            <span class="pts">${player.score.toLocaleString('en-US')}</span>
            <span class="dots">${player.solved}/${this.rounds.length || ROUNDS_PER_RUN}</span>
          </div>`,
        )
        .join('');
    }
  }

  private renderPartyTicker(): void {
    if (!this.party.isLive()) {
      el('party-ticker').hidden = true;
      return;
    }
    const players = this.party.lobby ? [...this.party.lobby.players].sort((a, b) => b.score - a.score) : [];
    el('party-ticker').hidden = false;
    el('party-ticker').innerHTML = players
      .map(
        (player) =>
          `<span><b>${escapeHtml(player.name)}</b>${player.score.toLocaleString('en-US')} · ${player.solved}/${this.rounds.length}</span>`,
      )
      .join('');
  }

  /* ------------------------------------------------------------------ */
  /* Share + toast                                                      */
  /* ------------------------------------------------------------------ */

  private async copyShare(): Promise<void> {
    if (!this.shareText) return;
    try {
      await navigator.clipboard.writeText(this.shareText);
      this.toast('RESULT COPIED');
    } catch {
      try {
        const area = document.createElement('textarea');
        area.value = this.shareText;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
        this.toast('RESULT COPIED');
      } catch {
        this.toast('COPY BLOCKED BY THE BROWSER');
      }
    }
  }

  private toast(message: string): void {
    const node = el('toast');
    node.textContent = message;
    node.classList.add('is-shown');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => node.classList.remove('is-shown'), 2400);
  }
}

function championshipAbbrev(id: ChampionshipId): string {
  return CHAMPIONSHIPS.find((championship) => championship.id === id)?.label ?? 'TRACE';
}
