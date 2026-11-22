import {
  CAR_CLASS_ORDER,
  CAR_CLASSES,
  loadCarConfig,
  saveCarConfig,
  type CarClass,
  type CarConfig,
} from '../garage/carConfig';
import {
  AI_AGGRESSION_LABELS,
  AI_DIFFICULTY_LABELS,
  loadRaceSettings,
  MAX_AI_OPPONENTS,
  MAX_LAPS,
  saveRaceSettings,
  type AiAggression,
  type AiDifficulty,
  type RaceSelection,
  type RaceSettings,
  type TimeOfDay,
  type WeatherMode,
} from '../app/raceOptions';
import { getTrackMeta } from '../tracks/trackMetadata';
import type { TrackFeature } from '../tracks/types';
import type { TrackLibrary } from './trackLibrary';
import { createTrackPreviewSvg } from '../tracks/geojsonLoader';

export interface RaceSetupCallbacks {
  onBack: () => void;
  onEditCar: () => void;
  onStart: (selection: RaceSelection) => void;
  onTrackChanged: (feature: TrackFeature) => void;
}

const CLASS_TOP_SPEED: Record<CarClass, number> = {
  hybrid: 341,
  v10: 350,
  junior: 289,
  gt: 305,
  prototype: 330,
  hypercar: 352,
  stock: 310,
  kart: 115,
};

function element<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing race setup element #${id}`);
  return el as T;
}

function segment<T extends string | number>(
  options: Array<{ label: string; value: T }>,
  current: T,
  onChange: (value: T) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'gp-seg';
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = option.label;
    button.dataset.value = String(option.value);
    if (option.value === current) button.classList.add('active');
    button.addEventListener('click', () => {
      for (const child of wrap.querySelectorAll('button')) child.classList.remove('active');
      button.classList.add('active');
      onChange(option.value);
    });
    wrap.appendChild(button);
  }
  return wrap;
}

function slider(
  min: number,
  max: number,
  step: number,
  value: number,
  format: (v: number) => string,
  onChange: (v: number) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'gp-slider';
  const out = document.createElement('b');
  out.className = 'gp-slider-value';
  out.textContent = format(value);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = format(v);
    onChange(v);
  });
  wrap.append(out, input);
  return wrap;
}

function field(label: string, control: HTMLElement, hint = ''): HTMLElement {
  const row = document.createElement('div');
  row.className = 'gp-field';
  const copy = document.createElement('div');
  copy.className = 'gp-field-label';
  copy.innerHTML = `<span>${label}</span>${hint ? `<small>${hint}</small>` : ''}`;
  row.append(copy, control);
  return row;
}

export class RaceSetupUI {
  private readonly library: TrackLibrary;
  private readonly callbacks: RaceSetupCallbacks;
  private settings: RaceSettings;
  private laps = 10;
  private mode: 'quick' | 'weekend' = 'quick';
  private config: CarConfig;
  private classButtons: HTMLButtonElement[] = [];
  private weekendFields: HTMLElement[] = [];

  constructor(library: TrackLibrary, callbacks: RaceSetupCallbacks) {
    this.library = library;
    this.callbacks = callbacks;
    this.settings = loadRaceSettings();
    this.config = loadCarConfig();
    this.library.subscribe((feature) => {
      this.refreshTrack(feature);
      this.callbacks.onTrackChanged(feature);
    });
    this.buildClassGrid();
    this.buildSettings();
    this.bind();
  }

  open(): void {
    this.config = loadCarConfig();
    this.settings = loadRaceSettings();
    this.refresh();
  }

  private bind(): void {
    element('race-back').addEventListener('click', () => this.callbacks.onBack());
    element('race-edit-car').addEventListener('click', () => this.callbacks.onEditCar());
    element('race-track-card').addEventListener('click', () => this.library.open());
    element('race-track-change').addEventListener('click', () => this.library.open());
    const laps = element<HTMLInputElement>('race-laps');
    laps.max = String(MAX_LAPS);
    laps.value = String(this.laps);
    laps.addEventListener('input', () => {
      this.laps = Math.max(1, Math.min(MAX_LAPS, Number(laps.value)));
      element('race-lap-value').textContent = `${this.laps} LAPS`;
      this.refreshSummary();
    });
    element('race-start').addEventListener('click', () => {
      // A gravel stage is a solo run against the clock, so the whole grid and
      // the track-limit rules are dropped for it.
      const rally = this.isRally;
      const settings: RaceSettings = { ...this.settings };
      if (rally) {
        settings.aiCount = 0;
        settings.trackLimits = 'off';
        settings.flags = false;
      }
      this.callbacks.onStart({
        mode: rally ? 'timetrial' : this.mode,
        featureId: this.library.selected.id,
        laps: rally ? 1 : this.laps,
        settings,
      });
    });
  }

  private buildClassGrid(): void {
    const grid = element('race-car-class-grid');
    grid.innerHTML = '';
    for (const value of CAR_CLASS_ORDER) {
      const spec = CAR_CLASSES[value];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gp-class-chip';
      button.innerHTML = `<b>${spec.label}</b><small>${spec.short}</small>`;
      button.addEventListener('click', () => {
        this.config.carClass = value;
        saveCarConfig(this.config);
        this.refresh();
      });
      grid.appendChild(button);
      this.classButtons.push(button);
    }
  }

  private buildSettings(): void {
    const panel = element('race-settings-panel');
    panel.innerHTML = '';
    this.weekendFields = [];
    const s = this.settings;

    const format = segment<'quick' | 'weekend'>(
      [
        { label: 'QUICK RACE', value: 'quick' },
        { label: 'WEEKEND', value: 'weekend' },
      ],
      this.mode,
      (value) => {
        this.mode = value;
        this.refreshFormat();
      },
    );
    const practice = slider(
      0,
      30,
      1,
      s.practiceMinutes,
      (v) => (v === 0 ? 'SKIP' : `${v} MIN`),
      (value) => this.updateSetting('practiceMinutes', value),
    );
    const qualifying = slider(
      3,
      30,
      1,
      s.qualifyingMinutes,
      (v) => `${v} MIN`,
      (value) => this.updateSetting('qualifyingMinutes', value),
    );
    const practiceField = field('PRACTICE', practice, 'FREE RUNNING BEFORE QUALIFYING');
    const qualifyingField = field('QUALIFYING', qualifying, 'TIMED SESSION · SETS THE GRID');
    this.weekendFields = [practiceField, qualifyingField];

    const weather = segment<WeatherMode>(
      [
        { label: 'DRY', value: 'dry' },
        { label: 'WET', value: 'wet' },
      ],
      s.weather,
      (value) => this.updateSetting('weather', value),
    );
    const time = segment<TimeOfDay>(
      [
        { label: 'DAY', value: 'day' },
        { label: 'NIGHT', value: 'night' },
      ],
      s.timeOfDay,
      (value) => this.updateSetting('timeOfDay', value),
    );
    const ai = slider(
      0,
      MAX_AI_OPPONENTS,
      1,
      s.aiCount,
      (v) => (v === 0 ? 'SOLO' : `${v} CARS`),
      (value) => this.updateSetting('aiCount', value),
    );
    const difficulty = segment<AiDifficulty>(
      (['rookie', 'club', 'pro', 'ace'] as AiDifficulty[]).map((value) => ({
        label: AI_DIFFICULTY_LABELS[value].toUpperCase(),
        value,
      })),
      s.aiDifficulty,
      (value) => this.updateSetting('aiDifficulty', value),
    );
    const aggression = segment<AiAggression>(
      (['low', 'normal', 'high'] as AiAggression[]).map((value) => ({
        label: AI_AGGRESSION_LABELS[value].toUpperCase(),
        value,
      })),
      s.aiAggression,
      (value) => this.updateSetting('aiAggression', value),
    );
    const mistakes = segment<'on' | 'off'>(
      [
        { label: 'ON', value: 'on' },
        { label: 'OFF', value: 'off' },
      ],
      s.aiMistakes ? 'on' : 'off',
      (value) => this.updateSetting('aiMistakes', value === 'on'),
    );
    const limits = segment<RaceSettings['trackLimits']>(
      [
        { label: 'OFF', value: 'off' },
        { label: 'LENIENT', value: 'lenient' },
        { label: 'STRICT', value: 'strict' },
      ],
      s.trackLimits,
      (value) => this.updateSetting('trackLimits', value),
    );
    const flags = segment<'on' | 'off'>(
      [
        { label: 'ON', value: 'on' },
        { label: 'OFF', value: 'off' },
      ],
      s.flags ? 'on' : 'off',
      (value) => this.updateSetting('flags', value === 'on'),
    );

    const grid = document.createElement('div');
    grid.className = 'gp-settings-grid';
    grid.append(
      field('RACE FORMAT', format, 'QUICK RACE OR FULL WEEKEND'),
      practiceField,
      qualifyingField,
      field('WEATHER', weather, 'DRY GRIP OR WET TYRES'),
      field('TIME OF DAY', time, 'LIGHTING & VISIBILITY'),
      field('AI OPPONENTS', ai, 'SLIDER · UP TO 20 CARS'),
      field('AI DIFFICULTY', difficulty, 'PACE OF THE GRID'),
      field('AI AGGRESSION', aggression, 'OVERTAKING AND DEFENDING'),
      field('AI MISTAKES', mistakes, 'SMALL HUMAN ERRORS'),
      field('TRACK LIMITS', limits, 'OFF, LENIENT OR STRICT'),
      field('RACE FLAGS', flags, 'RACE CONTROL MESSAGES'),
    );
    panel.appendChild(grid);
    this.refreshFormat();
  }

  /** Show the session-length sliders only for a weekend, and relabel Start. */
  private refreshFormat(): void {
    for (const row of this.weekendFields) {
      row.style.display = this.mode === 'weekend' ? '' : 'none';
    }
    const startLabel = element('race-start').querySelector('span');
    if (startLabel) {
      startLabel.textContent = this.isRally
        ? 'START STAGE'
        : this.mode === 'weekend'
          ? 'START WEEKEND'
          : 'START RACE';
    }
    this.refreshSummary();
  }

  private updateSetting<K extends keyof RaceSettings>(key: K, value: RaceSettings[K]): void {
    this.settings[key] = value;
    saveRaceSettings(this.settings);
    this.refreshSummary();
  }

  refresh(): void {
    this.config = loadCarConfig();
    const spec = CAR_CLASSES[this.config.carClass];
    this.classButtons.forEach((button, index) => {
      button.classList.toggle('active', CAR_CLASS_ORDER[index] === this.config.carClass);
    });
    const carName = element('race-car-title');
    carName.textContent = `${this.config.driverName.toUpperCase()} · ${spec.label.toUpperCase()}`;
    element('race-car-team').textContent = `${this.config.teamName.toUpperCase()} · ${this.config.livery.tag} · ${spec.blurb.toUpperCase()}`;
    element('race-car-spec').textContent = `${CLASS_TOP_SPEED[this.config.carClass]} KM/H · ${spec.category.toUpperCase()} · ${this.config.livery.aero.toUpperCase()}`;
    element<HTMLElement>('race-car-swatch').style.background = `linear-gradient(135deg, ${this.config.livery.primary}, ${this.config.livery.secondary} 62%, ${this.config.livery.accent})`;
    element<HTMLElement>('race-lap-value').textContent = `${this.laps} LAPS`;
    element<HTMLInputElement>('race-laps').value = String(this.laps);
    this.refreshTrack(this.library.selected);
    this.refreshSummary();
  }

  private get isRally(): boolean {
    const feature = this.library.selected;
    return (getTrackMeta(feature.id, feature.name).surface ?? 'asphalt') === 'gravel';
  }

  refreshTrack(feature: TrackFeature): void {
    const rally = (getTrackMeta(feature.id, feature.name).surface ?? 'asphalt') === 'gravel';
    element('race-track-map').innerHTML = createTrackPreviewSvg(feature, 430, 210);
    element('race-track-name').textContent = feature.name;
    element('race-track-meta').textContent = `${feature.location.toUpperCase()} · ${(feature.length / 1000).toFixed(3)} KM · ${rally ? 'GRAVEL STAGE' : `OPENED ${feature.opened || '—'}`}`;
    element('race-lap-value').textContent = rally ? 'STAGE' : `${this.laps} LAPS`;
    this.refreshFormat();
  }

  private refreshSummary(): void {
    const spec = CAR_CLASSES[this.config.carClass];
    const settings = this.settings;
    const rally = this.isRally;
    element('race-summary-car').textContent = `${this.config.livery.tag} · ${spec.label.toUpperCase()}`;
    element('race-summary-track').textContent = this.library.selected.name.toUpperCase();
    element('race-summary-conditions').textContent = rally
      ? `${settings.weather.toUpperCase()} · ${settings.timeOfDay.toUpperCase()} · STAGE SOLO`
      : `${settings.weather.toUpperCase()} · ${settings.timeOfDay.toUpperCase()} · ${settings.aiCount === 0 ? 'SOLO' : `${settings.aiCount} AI`}`;
    element('race-summary-rules').textContent = rally
      ? 'STAGE TIME TRIAL · NO TRAFFIC · LIMITS OFF'
      : this.mode === 'weekend'
        ? `WEEKEND · P ${settings.practiceMinutes === 0 ? 'SKIP' : `${settings.practiceMinutes} MIN`} · Q ${settings.qualifyingMinutes} MIN · ${AI_DIFFICULTY_LABELS[settings.aiDifficulty].toUpperCase()}`
        : `${AI_DIFFICULTY_LABELS[settings.aiDifficulty].toUpperCase()} · ${AI_AGGRESSION_LABELS[settings.aiAggression].toUpperCase()} AGGRO · LIMITS ${settings.trackLimits.toUpperCase()} · FLAGS ${settings.flags ? 'ON' : 'OFF'}`;
    element('race-summary-laps').textContent = rally
      ? 'STAGE RUN'
      : this.mode === 'weekend'
        ? `${this.laps} LAP GP`
        : `${this.laps} LAPS`;
  }
}
