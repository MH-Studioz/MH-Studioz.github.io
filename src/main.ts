import './style.css';
import type { Group } from 'three';
import { loadTrackCatalog } from './tracks/geojsonLoader';
import { buildTrack } from './tracks/trackBuilder';
import { loadCarConfig } from './garage/carConfig';
import { GaragePreview } from './garage/garagePreview';
import { loadCarTemplate } from './render/carVisual';
import { MenuUI, type MenuSelection } from './ui/menu';
import { DifficultyPanel } from './ui/difficulty';
import { GarageUI } from './ui/garage';
import { RaceSession } from './game/raceSession';

declare global {
  interface Window {
    __apex?: { getSession: () => RaceSession | null };
  }
}

const boot = document.getElementById('boot');
const bootBar = document.getElementById('boot-bar-fill');
const bootStatus = document.getElementById('boot-status');

function progress(percent: number, status: string): void {
  if (bootBar) bootBar.style.width = `${percent}%`;
  if (bootStatus) bootStatus.textContent = status;
}

function hideBoot(): void {
  boot?.classList.add('done');
}

function showBoot(status: string, percent: number): void {
  boot?.classList.remove('done');
  progress(percent, status);
}

function fatal(message: string): void {
  hideBoot();
  const el = document.getElementById('fatal');
  const msg = document.getElementById('fatal-message');
  if (msg) msg.textContent = message;
  el?.classList.remove('hidden');
}

function setScreen(id: 'menu' | 'garage' | null): void {
  document.getElementById('screen-menu')?.classList.toggle('active', id === 'menu');
  document.getElementById('screen-garage')?.classList.toggle('active', id === 'garage');
  if (id !== null) {
    document.getElementById('screen-results')?.classList.remove('active');
  }
}

async function bootApp(): Promise<void> {
  progress(8, 'LOADING CIRCUIT DATA…');
  const catalog = await loadTrackCatalog();
  progress(38, `${catalog.features.length} CIRCUITS · BUILDING TRACK LIBRARY…`);
  await new Promise((resolve) => setTimeout(resolve, 40));

  let template: Group | null = null;
  try {
    template = await loadCarTemplate();
  } catch (err) {
    console.warn('[boot] car template failed; procedural car will be used.', err);
  }
  progress(64, template ? '2026 OPEN-WHEEL CAR LOADED · PREPARING GARAGE…' : 'PROCEDURAL OPEN-WHEEL CAR · PREPARING GARAGE…');
  await new Promise((resolve) => setTimeout(resolve, 30));

  const config = loadCarConfig();
  const canvas = document.getElementById('race-canvas') as HTMLCanvasElement | null;
  const garageCanvas = document.getElementById('garage-canvas') as HTMLCanvasElement | null;
  const garageControls = document.getElementById('garage-controls');
  const garageSpec = document.getElementById('garage-spec');
  if (!canvas || !garageCanvas || !garageControls || !garageSpec) {
    throw new Error('Required simulator DOM elements are missing.');
  }

  const garagePreview = new GaragePreview(garageCanvas, config, template);
  progress(80, 'WIRING RACE CONTROL…');

  let session: RaceSession | null = null;
  let garage: GarageUI | null = null;
  let menu: MenuUI | null = null;

  if (import.meta.env.DEV) {
    window.__apex = { getSession: () => session };
  }

  const exitGarage = (): void => {
    garagePreview.stop();
    setScreen('menu');
    menu?.refreshProfile(loadCarConfig());
  };

  garage = new GarageUI(garageControls, garageSpec, garagePreview, exitGarage);
  const difficulty = new DifficultyPanel(document.getElementById('difficulty-panel') as HTMLElement, () => {
    /* The panel persists its own settings; the race reads the live object. */
  });

  const openGarage = (): void => {
    if (session) return;
    menu?.closeLibrary();
    setScreen('garage');
    garage?.open();
    requestAnimationFrame(() => garagePreview.start());
  };

  const endRace = (): void => {
    session?.dispose();
    session = null;
    setScreen('menu');
    menu?.refreshProfile(loadCarConfig());
  };

  const startRace = async (selection: MenuSelection): Promise<void> => {
    if (session) return;
    menu?.closeLibrary();
    showBoot(`BUILDING ${selection.feature.name.toUpperCase()}…`, 42);
    await new Promise((resolve) => setTimeout(resolve, 60));
    try {
      const track = buildTrack(selection.feature);
      progress(76, 'PREPARING GRID · 120 HZ PHYSICS…');
      await new Promise((resolve) => setTimeout(resolve, 40));
      setScreen(null);
      document.getElementById('screen-results')?.classList.remove('active');
      session = new RaceSession({
        canvas,
        track,
        playerConfig: loadCarConfig(),
        difficulty: difficulty.settings,
        mode: selection.mode,
        laps: selection.laps,
        template,
        onExit: endRace,
      });
      hideBoot();
    } catch (err) {
      console.error('[race] failed to start', err);
      fatal(err instanceof Error ? err.message : 'Could not build the selected circuit.');
    }
  };

  menu = new MenuUI(
    catalog,
    (selection) => {
      void startRace(selection);
    },
    openGarage,
  );
  menu.refreshProfile(loadCarConfig());
  setScreen('menu');
  progress(100, 'READY');

  window.addEventListener('resize', () => {
    if (document.getElementById('screen-garage')?.classList.contains('active')) {
      garagePreview.resize();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.getElementById('screen-garage')?.classList.contains('active')) {
      exitGarage();
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 260));
  hideBoot();
}

void bootApp().catch((err) => {
  console.error('[boot] fatal', err);
  fatal(err instanceof Error ? err.message : 'The simulator failed to initialise.');
});
