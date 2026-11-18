import { CAR_CLASSES, loadCarConfig, type CarConfig } from '../garage/carConfig';
import { idealTrialSettings, type RaceSelection } from '../app/raceOptions';
import { createTrackPreviewSvg } from '../tracks/geojsonLoader';
import type { TrackFeature } from '../tracks/types';
import type { TrackLibrary } from './trackLibrary';

export interface TimeTrialCallbacks {
  onBack: () => void;
  onEditCar: () => void;
  onStart: (selection: RaceSelection) => void;
}

function element<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing time trial element #${id}`);
  return el as T;
}

const TOP_SPEED: Record<CarConfig['carClass'], number> = {
  hybrid: 341,
  v10: 350,
  junior: 289,
  gt: 305,
  prototype: 330,
  kart: 115,
};

export class TimeTrialUI {
  private readonly library: TrackLibrary;
  private readonly callbacks: TimeTrialCallbacks;
  private config: CarConfig;

  constructor(library: TrackLibrary, callbacks: TimeTrialCallbacks) {
    this.library = library;
    this.callbacks = callbacks;
    this.config = loadCarConfig();
    this.library.subscribe((feature) => this.refreshTrack(feature));
    element('tt-back').addEventListener('click', () => this.callbacks.onBack());
    element('tt-edit-car').addEventListener('click', () => this.callbacks.onEditCar());
    element('tt-track-card').addEventListener('click', () => this.library.open());
    element('tt-track-change').addEventListener('click', () => this.library.open());
    element('tt-start').addEventListener('click', () => {
      this.callbacks.onStart({
        mode: 'timetrial',
        featureId: this.library.selected.id,
        laps: 1,
        settings: idealTrialSettings(),
      });
    });
  }

  open(): void {
    this.config = loadCarConfig();
    this.refresh();
  }

  refresh(): void {
    const spec = CAR_CLASSES[this.config.carClass];
    element('tt-car-title').textContent = `${this.config.driverName.toUpperCase()} · ${spec.label.toUpperCase()}`;
    element('tt-car-team').textContent = `${this.config.teamName.toUpperCase()} · ${this.config.livery.tag}`;
    element('tt-car-spec').textContent = `${TOP_SPEED[this.config.carClass]} KM/H · ${this.config.livery.aero.toUpperCase()}`;
    element<HTMLElement>('tt-car-swatch').style.background = `linear-gradient(135deg, ${this.config.livery.primary}, ${this.config.livery.secondary} 62%, ${this.config.livery.accent})`;
    this.refreshTrack(this.library.selected);
  }

  refreshTrack(feature: TrackFeature): void {
    element('tt-track-map').innerHTML = createTrackPreviewSvg(feature, 520, 240);
    element('tt-track-name').textContent = feature.name;
    element('tt-track-meta').textContent = `${feature.location.toUpperCase()} · ${(feature.length / 1000).toFixed(3)} KM`;
    element('tt-track-note').textContent = `OPTIMAL CONDITIONS · DRY · DAYLIGHT · NO AI · TRACK LIMITS OFF`;
  }
}
