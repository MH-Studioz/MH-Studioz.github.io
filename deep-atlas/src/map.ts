import L from 'leaflet';
import {
  categoryLabel,
  formatNumber,
  compact,
  type Category,
  type EntryLike,
  type Place,
  type RegionId,
} from './data';

// Keyless basemaps. CARTO now watermarks unauthenticated tiles, so the dark
// canvas comes from Esri (labels baked in) plus its city-label reference layer,
// and Hardcore swaps to NASA Blue Marble imagery with no labels at all.
const DARK_CANVAS =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
const DARK_REFERENCE =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}';
const BLUE_MARBLE =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
const ATTR_CANVAS =
  '&copy; <a href="https://www.esri.com" target="_blank" rel="noreferrer">Esri</a>, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';
const ATTR_EARTH =
  'Imagery &copy; NASA <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noreferrer">GIBS</a> · Blue Marble';

const REGION_VIEW: Record<RegionId, { center: [number, number]; zoom: number }> = {
  world: { center: [18, 10], zoom: 2.4 },
  europe: { center: [52, 14], zoom: 3.6 },
  asia: { center: [32, 88], zoom: 2.8 },
  americas: { center: [4, -74], zoom: 2.6 },
  africa: { center: [2, 20], zoom: 3.1 },
  oceania: { center: [-24, 152], zoom: 3.2 },
};

function zoomFor(place: Place): number {
  switch (place.category) {
    case 'country':
      return (place.area ?? 0) < 100_000 ? 4.6 : 3.5;
    case 'city':
      return (place.population ?? 0) < 80_000 ? 6.4 : 5.2;
    case 'peak':
      return 6.2;
    case 'river':
      return 4.4;
    default:
      return (place.area ?? 0) < 5_000 ? 6 : 4.4;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function popupHtml(place: Place, depth: number, trap: boolean): string {
  const stats =
    place.category === 'country'
      ? `${compact(place.population ?? 0)} people · ${formatNumber(place.area ?? 0)} km² · ${escapeHtml(place.capitalName ?? '—')}`
      : place.category === 'city'
        ? `${compact(place.population ?? 0)} people · ${escapeHtml(place.country ?? '—')} · ${formatNumber(place.elevation ?? 0)} m`
        : place.category === 'river'
          ? `${formatNumber(place.length ?? 0)} km · ${escapeHtml(place.outflow ?? '—')}`
          : place.category === 'peak'
            ? `${formatNumber(place.elevation ?? 0)} m · ${escapeHtml(place.range ?? '—')}`
            : `${formatNumber(place.area ?? 0, 2)} km² · ${escapeHtml(place.continent)}`;

  return `
    <div class="popup-card">
      <div class="popup-kicker">${categoryLabel(place)}</div>
      <div class="popup-name">${escapeHtml(place.name)}</div>
      <div class="popup-stat">${stats}</div>
      <div class="popup-depth">${trap ? '⚠ TOURIST TRAP · ' : ''}+${formatNumber(depth)} m depth</div>
    </div>`;
}

export class AtlasMap {
  private map: L.Map;
  private base: L.TileLayer;
  private labels: L.TileLayer;
  private earth: L.TileLayer | null = null;
  private hard = false;
  private session: L.LayerGroup;
  private crosshair: L.Marker | null = null;

  constructor(element: HTMLElement) {
    this.map = L.map(element, {
      zoomControl: false,
      attributionControl: true,
      minZoom: 2,
      maxZoom: 9,
      maxBounds: L.latLngBounds([-85, -180], [85, 180]),
      maxBoundsViscosity: 0.9,
      worldCopyJump: false,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      fadeAnimation: true,
      inertia: true,
    });

    this.map.setView(REGION_VIEW.world.center, REGION_VIEW.world.zoom);
    this.base = L.tileLayer(DARK_CANVAS, {
      attribution: ATTR_CANVAS,
      maxZoom: 9,
      noWrap: true,
    }).addTo(this.map);
    this.labels = L.tileLayer(DARK_REFERENCE, {
      attribution: '',
      maxZoom: 9,
      noWrap: true,
      opacity: 0.9,
    }).addTo(this.map);

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    this.session = L.layerGroup().addTo(this.map);
  }

  /** Hardcore swaps the labeled canvas for raw, label-free Blue Marble. */
  setHardcore(enabled: boolean): void {
    if (this.hard === enabled) return;
    this.hard = enabled;
    document.body.classList.toggle('hardcore-map', enabled);

    if (enabled) {
      this.map.removeLayer(this.base);
      this.map.removeLayer(this.labels);
      this.earth = L.tileLayer(BLUE_MARBLE, {
        attribution: ATTR_EARTH,
        maxZoom: 9,
        maxNativeZoom: 8,
        noWrap: true,
      }).addTo(this.map);
    } else {
      if (this.earth) {
        this.map.removeLayer(this.earth);
        this.earth = null;
      }
      this.base.addTo(this.map);
      this.labels.addTo(this.map);
    }
  }

  flyRegion(region: RegionId): void {
    const view = REGION_VIEW[region] ?? REGION_VIEW.world;
    this.map.flyTo(view.center, view.zoom, { duration: 1.1 });
  }

  flyTo(place: Place, zoomOverride?: number): void {
    this.map.flyTo([place.lat, place.lng], zoomOverride ?? zoomFor(place), {
      duration: 1.9,
      easeLinearity: 0.2,
    });
  }

  clearSession(): void {
    this.session.clearLayers();
    if (this.crosshair) {
      this.map.removeLayer(this.crosshair);
      this.crosshair = null;
    }
  }

  placeMarker(place: Place, depth: number, kind: 'guess' | 'gem' | 'target'): L.Marker {
    const icon = L.divIcon({
      className: 'atlas-marker',
      html: `<div class="atlas-pin ${kind === 'guess' ? '' : 'gem'}"><i></i></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    const marker = L.marker([place.lat, place.lng], {
      icon,
      zIndexOffset: kind === 'gem' ? 400 : 600,
      keyboard: false,
    })
      .bindPopup(popupHtml(place, depth, place.trap), {
        closeButton: false,
        autoPanPadding: [40, 120],
        offset: [0, -6],
      })
      .addTo(this.session);

    if (kind !== 'target') marker.openPopup();
    return marker;
  }

  showCrosshair(lat: number, lng: number): void {
    this.hideCrosshair();
    const icon = L.divIcon({
      className: 'atlas-marker',
      html: '<div class="crosshair"><i></i></div>',
      iconSize: [52, 52],
      iconAnchor: [26, 26],
    });
    this.crosshair = L.marker([lat, lng], { icon, keyboard: false, zIndexOffset: 900 }).addTo(
      this.map
    );
    this.map.flyTo([lat, lng], 6, { duration: 2.1, easeLinearity: 0.2 });
  }

  hideCrosshair(): void {
    if (this.crosshair) {
      this.map.removeLayer(this.crosshair);
      this.crosshair = null;
    }
  }

  /** Plots numbered guesses plus gold stars for the rarest valid answers. */
  showSummary(entries: EntryLike[], revealTarget?: Place): void {
    this.clearSession();

    const points: [number, number][] = [];

    entries.forEach((entry, index) => {
      if (!entry.answer) return;
      points.push([entry.answer.lat, entry.answer.lng]);
      const icon = L.divIcon({
        className: 'atlas-marker',
        html: `<div class="guess-pin">${index + 1}</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      L.marker([entry.answer.lat, entry.answer.lng], { icon, keyboard: false, zIndexOffset: 500 })
        .bindPopup(popupHtml(entry.answer, entry.depth, entry.trap), {
          closeButton: false,
          autoPanPadding: [40, 120],
        })
        .addTo(this.session);
    });

    entries.forEach((entry) => {
      const gem = entry.best;
      if (!gem) return;
      if (entry.answer && entry.answer.id === gem.id) return;
      points.push([gem.lat, gem.lng]);
      const icon = L.divIcon({
        className: 'atlas-marker',
        html: `<div class="gem-pin">★</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      L.marker([gem.lat, gem.lng], { icon, keyboard: false, zIndexOffset: 450 })
        .bindPopup(popupHtml(gem, entry.bestDepth, gem.trap), {
          closeButton: false,
          autoPanPadding: [40, 120],
        })
        .addTo(this.session);
    });

    if (revealTarget) {
      points.push([revealTarget.lat, revealTarget.lng]);
      this.placeMarker(revealTarget, 0, 'target');
    }

    if (points.length === 1) {
      this.map.setView(points[0], 4.5, { animate: false });
    } else if (points.length > 1) {
      // Instant fit: the summary must land framed even if rAF is throttled
      // (background tab) or the player has reduced motion enabled.
      const bounds = L.latLngBounds(points).pad(0.3);
      this.map.fitBounds(bounds, { animate: false, maxZoom: 5 });
    }
  }

  reset(): void {
    this.clearSession();
    this.flyRegion('world');
  }

  invalidate(): void {
    this.map.invalidateSize({ animate: false });
  }
}

export type { Category };
