import {
  CAR_CLASSES,
  loadCarConfig,
  saveCarConfig,
  type CarClass,
  type CarConfig,
} from '../garage/carConfig';
import {
  AI_DIFFICULTY_LABELS,
  loadRaceSettings,
  saveRaceSettings,
  type AiDifficulty,
  type RaceAiCount,
  type RaceSelection,
  type RaceSettings,
  type TimeOfDay,
  type WeatherMode,
} from '../app/raceOptions';
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
  private config: CarConfig;
  private classButtons: HTMLButtonElement[] = [];

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
    laps.value = String(this.laps);
    laps.addEventListener('input', () => {
      this.laps = Number(laps.value);
      this.refreshSummary();
    });
    element('race-start').addEventListener('click', () => {
      this.callbacks.onStart({
        mode: 'quick',
        featureId: this.library.selected.id,
        laps: this.laps,
        settings: { ...this.settings },
      });
    });
  }

  private buildClassGrid(): void {
    const grid = element('race-car-class-grid');
    grid.innerHTML = '';
    for (const value of ['hybrid', 'v10', 'junior', 'gt', 'prototype', 'kart'] as CarClass[]) {
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
    const s = this.settings;

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
    const ai = segment<RaceAiCount>(
      [
        { label: '0', value: 0 },
        { label: '5', value: 5 },
        { label: '9', value: 9 },
      ],
      s.aiCount,
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
      field('WEATHER', weather, 'DRY GRIP OR WET TYRES'),
      field('TIME OF DAY', time, 'LIGHTING & VISIBILITY'),
      field('AI OPPONENTS', ai, 'SIZE OF THE FIELD'),
      field('AI DIFFICULTY', difficulty, 'PACE OF THE GRID'),
      field('TRACK LIMITS', limits, 'OFF, LENIENT OR STRICT'),
      field('RACE FLAGS', flags, 'RACE CONTROL MESSAGES'),
    );
    panel.appendChild(grid);
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
      button.classList.toggle('active', (['hybrid', 'v10', 'junior', 'gt', 'prototype', 'kart'] as CarClass[])[index] === this.config.carClass);
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

  refreshTrack(feature: TrackFeature): void {
    element('race-track-map').innerHTML = createTrackPreviewSvg(feature, 430, 210);
    element('race-track-name').textContent = feature.name;
    element('race-track-meta').textContent = `${feature.location.toUpperCase()} · ${(feature.length / 1000).toFixed(3)} KM · OPENED ${feature.opened || '—'}`;
    this.refreshSummary();
  }

  private refreshSummary(): void {
    const spec = CAR_CLASSES[this.config.carClass];
    const settings = this.settings;
    element('race-summary-car').textContent = `${this.config.livery.tag} · ${spec.label.toUpperCase()}`;
    element('race-summary-track').textContent = this.library.selected.name.toUpperCase();
    element('race-summary-conditions').textContent = `${settings.weather.toUpperCase()} · ${settings.timeOfDay.toUpperCase()} · ${settings.aiCount === 0 ? 'SOLO' : `${settings.aiCount} AI`}`;
    element('race-summary-rules').textContent = `${AI_DIFFICULTY_LABELS[settings.aiDifficulty].toUpperCase()} · LIMITS ${settings.trackLimits.toUpperCase()} · FLAGS ${settings.flags ? 'ON' : 'OFF'}`;
    element('race-summary-laps').textContent = `${this.laps} LAPS`;
  }
}
