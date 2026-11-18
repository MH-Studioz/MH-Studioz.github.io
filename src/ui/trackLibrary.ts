import type { TrackCatalog, TrackFeature } from '../tracks/types';
import { createTrackPreviewSvg } from '../tracks/geojsonLoader';
import { getTrackMeta } from '../tracks/trackMetadata';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing track library element #${id}`);
  return el as T;
}

function isStreet(feature: TrackFeature): boolean {
  const key = `${feature.name} ${feature.location}`.toLowerCase();
  return /(monaco|singapore|baku|jeddah|vegas|miami|marina bay|street)/.test(key);
}

export class TrackLibrary {
  readonly catalog: TrackCatalog;
  selected: TrackFeature;
  onSelect: ((feature: TrackFeature) => void) | null = null;
  private listeners = new Set<(feature: TrackFeature) => void>();

  private cards = new Map<string, HTMLButtonElement>();
  private filter: 'all' | 'night' | 'street' | 'classic' = 'all';
  private searchQuery = '';
  private modal = byId('modal-tracks');
  private grid = byId('track-grid');
  private count = byId('track-count');

  constructor(catalog: TrackCatalog) {
    this.catalog = catalog;
    this.selected =
      catalog.features.find((f) => f.id === 'it-1922') ??
      catalog.features.find((f) => f.id === 'nl-1948') ??
      catalog.features[0];
    if (!this.selected) throw new Error('No circuits available');
    this.build();
    this.bind();
    this.applyFilter();
    this.count.textContent = String(catalog.features.length);
  }

  private bind(): void {
    byId('tracks-close').addEventListener('click', () => this.close());
    this.modal.addEventListener('click', (event) => {
      if (event.target === this.modal) this.close();
    });
    const search = byId<HTMLInputElement>('track-search');
    search.addEventListener('input', () => {
      this.searchQuery = search.value.trim().toLowerCase();
      this.applyFilter();
    });
    byId('track-filter').addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-filter]');
      if (!button) return;
      this.filter = (button.dataset.filter as typeof this.filter) ?? 'all';
      document.querySelectorAll('#track-filter button').forEach((b) => b.classList.toggle('active', b === button));
      this.applyFilter();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.modal.classList.contains('hidden')) this.close();
    });
  }

  private build(): void {
    this.grid.innerHTML = '';
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
      if (meta.surface === 'gravel') {
        flags.push('<span class="tc-flag gravel">GRAVEL</span>');
        card.dataset.gravel = '1';
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
      loc.textContent = feature.location.toUpperCase();
      const len = document.createElement('span');
      len.textContent = `${(feature.length / 1000).toFixed(3)} KM`;
      metaRow.append(loc, len);
      const flagRow = document.createElement('div');
      flagRow.className = 'tc-flags';
      flagRow.innerHTML = flags.join('');
      card.append(map, title, metaRow, flagRow);
      card.addEventListener('click', () => {
        this.select(feature);
        this.close();
      });
      this.grid.appendChild(card);
      this.cards.set(feature.id, card);
    }
  }

  private applyFilter(): void {
    for (const feature of this.catalog.features) {
      const card = this.cards.get(feature.id);
      if (!card) continue;
      const meta = getTrackMeta(feature.id, feature.name);
      let match = true;
      if (this.filter === 'night') match = Boolean(meta.night);
      if (this.filter === 'street') match = isStreet(feature);
      if (this.filter === 'classic') match = feature.opened < 1990;
      if (this.searchQuery) match = match && `${feature.name} ${feature.location}`.toLowerCase().includes(this.searchQuery);
      card.style.display = match ? '' : 'none';
    }
  }

  select(feature: TrackFeature): void {
    this.selected = feature;
    for (const [id, card] of this.cards) card.classList.toggle('selected', id === feature.id);
    this.onSelect?.(feature);
    for (const listener of this.listeners) listener(feature);
  }

  subscribe(listener: (feature: TrackFeature) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  open(): void {
    this.modal.classList.remove('hidden');
    this.applyFilter();
    const search = byId<HTMLInputElement>('track-search');
    search.focus();
  }

  close(): void {
    this.modal.classList.add('hidden');
  }
}
