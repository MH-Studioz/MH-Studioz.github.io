import { CAR_CLASSES, type CarConfig, type LiveryConfig } from '../garage/carConfig';
import type { TrackCatalog, TrackFeature } from '../tracks/types';
import { createTrackPreviewSvg } from '../tracks/geojsonLoader';
import { getTrackMeta } from '../tracks/trackMetadata';

export type RaceMode = 'quick' | 'timetrial' | 'weekend';

export interface MenuSelection {
  mode: RaceMode;
  feature: TrackFeature;
  laps: number;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing menu element #${id}`);
  return el as T;
}

function escapeText(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

function isStreet(feature: TrackFeature): boolean {
  const key = `${feature.name} ${feature.location}`.toLowerCase();
  return /(monaco|singapore|baku|jeddah|vegas|miami|marina bay|street)/.test(key);
}

export class MenuUI {
  private catalog: TrackCatalog;
  private selected: TrackFeature;
  private mode: RaceMode = 'quick';
  private laps = 10;
  private onStart: (selection: MenuSelection) => void;
  private onGarage: () => void;
  private cards = new Map<string, HTMLElement>();
  private filter: 'all' | 'night' | 'street' | 'classic' = 'all';
  private searchQuery = '';
  private heroPreview = byId('hero-preview');
  private heroName = byId('hero-name');
  private heroMeta = byId('hero-meta');
  private heroTags = byId('hero-tags');
  private heroNum = byId('hero-num');
  private trackGrid = byId('track-grid');
  private modal = byId('modal-tracks');
  private lapSetting = byId('lap-setting');
  private lapSlider = byId<HTMLInputElement>('lap-slider');
  private lapValue = byId('lap-value');
  private sessionLength = byId('session-length');
  private sessionMeta = byId('session-meta');
  private startButton = byId<HTMLButtonElement>('btn-start');
  private profile = byId('profile-strip');
  private count = byId('track-count');
  private carClass: CarConfig['carClass'] = 'hybrid';

  constructor(
    catalog: TrackCatalog,
    onStart: (selection: MenuSelection) => void,
    onGarage: () => void,
  ) {
    this.catalog = catalog;
    this.onStart = onStart;
    this.onGarage = onGarage;
    this.selected =
      catalog.features.find((f) => f.id === 'it-1922') ??
      catalog.features.find((f) => f.id === 'nl-1948') ??
      catalog.features[0];
    if (!this.selected) throw new Error('No circuits available');

    this.buildTrackGrid();
    this.bind();
    this.selectTrack(this.selected, false);
    this.setMode('quick');
    this.count.textContent = String(catalog.features.length);
  }

  private bind(): void {
    byId('track-hero').addEventListener('click', () => this.openLibrary());
    byId('tracks-close').addEventListener('click', () => this.closeLibrary());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.closeLibrary();
    });
    const search = byId<HTMLInputElement>('track-search');
    search.addEventListener('input', () => {
      this.searchQuery = search.value.trim().toLowerCase();
      this.applyFilter();
    });
    byId('track-filter').addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-filter]');
      if (!btn) return;
      this.filter = (btn.dataset.filter as typeof this.filter) ?? 'all';
      document.querySelectorAll('#track-filter button').forEach((b) => b.classList.toggle('active', b === btn));
      this.applyFilter();
    });
    document.querySelectorAll<HTMLButtonElement>('.mode-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode as RaceMode;
        this.setMode(mode);
      });
    });
    this.lapSlider.addEventListener('input', () => {
      this.laps = Number(this.lapSlider.value);
      this.updateLapLabels();
    });
    this.startButton.addEventListener('click', () => {
      this.onStart({ mode: this.mode, feature: this.selected, laps: this.laps });
    });
    byId('btn-garage').addEventListener('click', () => this.onGarage());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.modal.classList.contains('hidden')) this.closeLibrary();
    });
  }

  private buildTrackGrid(): void {
    this.trackGrid.innerHTML = '';
    for (const feature of this.catalog.features) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'track-card';
      card.dataset.id = feature.id;
      card.dataset.name = `${feature.name} ${feature.location}`.toLowerCase();
      const meta = getTrackMeta(feature.id, feature.name);
      const flags: string[] = [];
      if (meta.night) {
        flags.push('<span class="tc-flag night">NIGHT</span>');
        card.dataset.night = '1';
      }
      if (meta.banking && meta.banking.length) {
        flags.push(`<span class="tc-flag bank">${Math.max(...meta.banking.map((b) => b.deg))}° BANK</span>`);
      }
      if (isStreet(feature)) {
        flags.push('<span class="tc-flag">STREET</span>');
        card.dataset.street = '1';
      }
      if (feature.opened < 1990) card.dataset.classic = '1';

      const map = document.createElement('div');
      map.className = 'track-card-map';
      map.innerHTML = createTrackPreviewSvg(feature, 260, 150);
      const title = document.createElement('h4');
      title.textContent = feature.name;
      const metaRow = document.createElement('div');
      metaRow.className = 'tc-meta';
      const loc = document.createElement('span');
      loc.textContent = `${feature.location.toUpperCase()}`;
      const len = document.createElement('span');
      len.textContent = `${(feature.length / 1000).toFixed(3)} KM`;
      metaRow.append(loc, len);
      const flagRow = document.createElement('div');
      flagRow.className = 'tc-flags';
      flagRow.innerHTML = flags.join('');
      card.append(map, title, metaRow, flagRow);
      card.addEventListener('click', () => {
        this.selectTrack(feature, true);
        this.closeLibrary();
      });
      this.trackGrid.appendChild(card);
      this.cards.set(feature.id, card);
    }
    this.applyFilter();
  }

  private applyFilter(): void {
    const q = this.searchQuery;
    for (const feature of this.catalog.features) {
      const card = this.cards.get(feature.id);
      if (!card) continue;
      const meta = getTrackMeta(feature.id, feature.name);
      let match = true;
      if (this.filter === 'night') match = Boolean(meta.night);
      if (this.filter === 'street') match = isStreet(feature);
      if (this.filter === 'classic') match = feature.opened < 1990;
      if (q) match = match && `${feature.name} ${feature.location}`.toLowerCase().includes(q);
      card.style.display = match ? '' : 'none';
    }
  }

  private updateHero(): void {
    const feature = this.selected;
    const meta = getTrackMeta(feature.id, feature.name);
    this.heroPreview.innerHTML = createTrackPreviewSvg(feature, 380, 190);
    this.heroName.textContent = feature.name;
    this.heroMeta.textContent = `${feature.location.toUpperCase()} · ${(feature.length / 1000).toFixed(3)} KM · OPENED ${feature.opened || '—'}`;
    this.heroNum.textContent = String(this.catalog.features.indexOf(feature) + 1).padStart(2, '0');
    const tags: string[] = [];
    if (meta.night) tags.push('<span class="track-tag night">NIGHT RACE</span>');
    if (meta.banking && meta.banking.length) tags.push(`<span class="track-tag hot">${Math.max(...meta.banking.map((b) => b.deg))}° BANKING</span>`);
    if (meta.overpass) tags.push('<span class="track-tag hot">FIGURE-8 OVERPASS</span>');
    if (meta.drs) tags.push(`<span class="track-tag">${meta.drs.length} DRS ZONES</span>`);
    if (isStreet(feature)) tags.push('<span class="track-tag">STREET CIRCUIT</span>');
    if (meta.elevation) tags.push('<span class="track-tag">ELEVATION</span>');
    this.heroTags.innerHTML = tags.join('');
  }

  selectTrack(feature: TrackFeature, updateGrid: boolean): void {
    this.selected = feature;
    this.updateHero();
    if (updateGrid) {
      for (const [id, card] of this.cards) card.classList.toggle('selected', id === feature.id);
    } else {
      const card = this.cards.get(feature.id);
      card?.classList.add('selected');
    }
    this.updateLapLabels();
  }

  setMode(mode: RaceMode): void {
    this.mode = mode;
    document.querySelectorAll<HTMLButtonElement>('.mode-card').forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === mode));
    const startSpan = this.startButton.querySelector('span');
    if (this.mode === 'timetrial') {
      this.lapSetting.style.display = 'none';
      if (startSpan) startSpan.textContent = 'START TIME TRIAL';
      this.sessionMeta.textContent = 'Ghost car · saved best lap · no AI';
      this.sessionLength.textContent = '∞ LAPS';
    } else if (this.mode === 'weekend') {
      this.lapSetting.style.display = '';
      this.lapSlider.disabled = false;
      if (startSpan) startSpan.textContent = 'START QUALIFYING';
      this.sessionMeta.textContent = 'Qualifying + Feature Race · 2-compound rule';
      this.updateLapLabels();
    } else {
      this.lapSetting.style.display = '';
      this.lapSlider.disabled = false;
      if (startSpan) startSpan.textContent = 'START RACE';
      this.sessionMeta.textContent = `Grid 10 · ${CAR_CLASSES[this.carClass].label} · ${CAR_CLASSES[this.carClass].drs ? 'DRS enabled' : 'no DRS'}`;
      this.updateLapLabels();
    }
  }

  private updateLapLabels(): void {
    if (this.mode === 'timetrial') {
      this.lapValue.textContent = 'UNLIMITED';
      return;
    }
    this.lapValue.textContent = `${this.laps} LAPS`;
    const avg = 48;
    const seconds = (this.selected.length / avg) * this.laps + 28;
    this.sessionLength.textContent = `~ ${Math.max(1, Math.round(seconds / 60))} MIN`;
    this.sessionMeta.textContent =
      this.mode === 'weekend'
        ? `Qualifying + ${this.laps}-lap GP · 2-compound rule`
        : `Grid 10 · ${this.laps} laps · ${CAR_CLASSES[this.carClass].short}`;
  }

  openLibrary(): void {
    this.modal.classList.remove('hidden');
    this.applyFilter();
    byId<HTMLInputElement>('track-search').focus();
  }

  closeLibrary(): void {
    this.modal.classList.add('hidden');
  }

  get selection(): MenuSelection {
    return { mode: this.mode, feature: this.selected, laps: this.laps };
  }

  refreshProfile(config: CarConfig): void {
    const livery: LiveryConfig = config.livery;
    this.carClass = config.carClass;
    this.setMode(this.mode);
    this.profile.innerHTML = `
      <span class="profile-swatch" style="background:${livery.primary}"></span>
      <div><strong>${escapeText(config.teamName).toUpperCase()}</strong><small>${escapeText(config.driverName)} · ${livery.tag} · ${CAR_CLASSES[config.carClass].short} · ${livery.aero.toUpperCase()}</small></div>
      <span class="profile-num">${livery.number}</span>
    `;
  }
}
