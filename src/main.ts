import './style.css';
import './shell.css';
import type { Group } from 'three';
import { loadTrackCatalog } from './tracks/geojsonLoader';
import { buildTrack } from './tracks/trackBuilder';
import { loadCarConfig } from './garage/carConfig';
import type { CarConfig } from './garage/carConfig';
import { GaragePreview } from './garage/garagePreview';
import { loadCarTemplate } from './render/carVisual';
import { HomeUI } from './ui/home';
import { RaceSetupUI } from './ui/raceSetup';
import { TimeTrialUI } from './ui/timeTrial';
import { MultiplayerUI } from './ui/multiplayer';
import { AccountUI } from './ui/account';
import { TrackLibrary } from './ui/trackLibrary';
import { bindTouchControls } from './ui/touchControls';
import { GarageUI } from './ui/garage';
import { RaceSession } from './game/raceSession';
import { currentAccount, type DriverAccount } from './account/account';
import { difficultyForRace, type RaceSelection } from './app/raceOptions';
import type { PartyRaceConfig } from './net/party';

declare global {
  interface Window {
    __apex?: {
      getSession: () => RaceSession | null;
      /** Dev-only shortcut used for visual checks and screenshots. */
      startRace: (overrides?: Partial<RaceSelection>) => Promise<void>;
    };
  }
}

type ScreenId = 'home' | 'race' | 'timetrial' | 'multiplayer' | 'garage' | null;

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
  progress(64, template ? 'GP 2026 CAR LOADED · PREPARING STUDIO…' : 'PROCEDURAL CAR READY · PREPARING STUDIO…');
  await new Promise((resolve) => setTimeout(resolve, 30));

  const config = loadCarConfig();
  const canvas = document.getElementById('race-canvas') as HTMLCanvasElement | null;
  const garageCanvas = document.getElementById('garage-canvas') as HTMLCanvasElement | null;
  const homeCanvas = document.getElementById('home-car-canvas') as HTMLCanvasElement | null;
  const garageControls = document.getElementById('garage-controls');
  const garageSpec = document.getElementById('garage-spec');
  if (!canvas || !garageCanvas || !homeCanvas || !garageControls || !garageSpec) {
    throw new Error('Required simulator DOM elements are missing.');
  }

  progress(76, 'WIRING GARAGE & RACE CONTROL…');
  const homePreview = new GaragePreview(homeCanvas, config, template);
  const garagePreview = new GaragePreview(garageCanvas, config, template);
  const library = new TrackLibrary(catalog);

  let session: RaceSession | null = null;
  let garageReturn: 'home' | 'race' | 'timetrial' = 'home';
  let account: DriverAccount | null = currentAccount();
  let partyRaceActive = false;

  if (import.meta.env.DEV) {
    window.__apex = {
      getSession: () => session,
      startRace: (overrides) =>
        startRace({
          mode: 'quick',
          featureId: library.selected.id,
          laps: 3,
          settings: {
            weather: 'dry',
            timeOfDay: 'day',
            aiCount: 9,
            aiDifficulty: 'pro',
            aiAggression: 'normal',
            aiMistakes: true,
            trackLimits: 'strict',
            flags: true,
            practiceMinutes: 10,
            qualifyingMinutes: 10,
          },
          ...overrides,
        }),
    };
  }

  const screens: Record<Exclude<ScreenId, null>, HTMLElement | null> = {
    home: document.getElementById('screen-menu'),
    race: document.getElementById('screen-race-setup'),
    timetrial: document.getElementById('screen-timetrial'),
    multiplayer: document.getElementById('screen-multiplayer'),
    garage: document.getElementById('screen-garage'),
  };

  let currentScreen: ScreenId = 'home';

  const setScreen = (id: ScreenId): void => {
    currentScreen = id;
    for (const [key, el] of Object.entries(screens)) {
      el?.classList.toggle('active', key === id);
    }
    document.getElementById('screen-results')?.classList.remove('active');
    if (id === 'home') {
      homePreview.start();
    } else {
      homePreview.stop();
    }
    if (id !== 'garage') garagePreview.stop();
  };

  const accountUI = new AccountUI();

  const refreshAccount = (next: DriverAccount | null): void => {
    account = next;
    home.setAccount(account);
    multiplayer.setAccount(account);
  };

  const home = new HomeUI({
    onAction: (action) => {
      if (action === 'race') {
        raceSetup.open();
        setScreen('race');
      } else if (action === 'car') {
        openGarage('home');
      } else if (action === 'timetrial') {
        timeTrial.open();
        setScreen('timetrial');
      } else if (action === 'multiplayer') {
        multiplayer.open();
        setScreen('multiplayer');
      }
    },
    onAccount: () => accountUI.open(),
    onEditCar: () => openGarage('home'),
  });

  let garage!: GarageUI;

  const openGarage = (returnTo: 'home' | 'race' | 'timetrial'): void => {
    if (session) return;
    garageReturn = returnTo;
    setScreen('garage');
    garage.open();
    requestAnimationFrame(() => garagePreview.start());
  };

  const exitGarage = (): void => {
    garagePreview.stop();
    if (garageReturn === 'race') {
      raceSetup.open();
      setScreen('race');
    } else if (garageReturn === 'timetrial') {
      timeTrial.open();
      setScreen('timetrial');
    } else {
      home.refresh(loadCarConfig());
      homePreview.setConfig(loadCarConfig());
      setScreen('home');
    }
  };

  let raceSetup!: RaceSetupUI;
  let timeTrial!: TimeTrialUI;
  let multiplayer!: MultiplayerUI;

  raceSetup = new RaceSetupUI(library, {
    onBack: () => setScreen('home'),
    onEditCar: () => openGarage('race'),
    onStart: (selection) => void startRace(selection),
    onTrackChanged: () => {
      /* The shared library updates every screen that subscribes to it. */
    },
  });

  timeTrial = new TimeTrialUI(library, {
    onBack: () => setScreen('home'),
    onEditCar: () => openGarage('timetrial'),
    onStart: (selection) => void startRace(selection),
  });

  multiplayer = new MultiplayerUI(library, {
    onBack: () => setScreen('home'),
    requestAccount: (after) => accountUI.open(after),
    onRaceStart: (race) => void startPartyRace(race),
    onFrame: (from, frame) => session?.updateRemoteCar(from, frame),
  });

  const endRace = (): void => {
    const returnToParty = partyRaceActive;
    partyRaceActive = false;
    session?.dispose();
    session = null;
    if (returnToParty && multiplayer.isInParty()) {
      multiplayer.open();
      setScreen('multiplayer');
      return;
    }
    home.refresh(loadCarConfig());
    homePreview.setConfig(loadCarConfig());
    setScreen('home');
  };

  const startRace = async (
    selection: RaceSelection,
    playerOverride?: CarConfig,
  ): Promise<void> => {
    if (session) return;
    const feature = catalog.features.find((f) => f.id === selection.featureId) ?? library.selected;
    const settings = { ...selection.settings };
    showBoot(`BUILDING ${feature.name.toUpperCase()}…`, 42);
    await new Promise((resolve) => setTimeout(resolve, 60));
    try {
      const track = buildTrack(feature);
      track.night = settings.timeOfDay === 'night';
      // A gravel stage is always a solo run against the clock, whatever entry
      // point (setup screen, party, deep link) asked for it.
      const stage = track.surface === 'gravel';
      progress(76, 'PREPARING GRID · 120 HZ PHYSICS…');
      await new Promise((resolve) => setTimeout(resolve, 40));
      setScreen(null);
      const playerConfig = playerOverride ?? loadCarConfig();
      if (settings.weather === 'wet') playerConfig.livery.compound = 'wet';
      session = new RaceSession({
        canvas,
        track,
        playerConfig,
        difficulty: difficultyForRace(settings),
        mode: stage ? 'timetrial' : selection.mode,
        laps: stage ? 1 : selection.laps,
        aiCount: stage ? 0 : settings.aiCount,
        aiAggression: settings.aiAggression,
        aiMistakes: settings.aiMistakes,
        weather: settings.weather,
        flags: settings.flags,
        practiceMinutes: settings.practiceMinutes,
        qualifyingMinutes: settings.qualifyingMinutes,
        template,
        onExit: endRace,
        onCarFrame: selection.mode === 'party' ? (frame) => multiplayer.sendCarFrame(frame) : undefined,
      });
      hideBoot();
    } catch (err) {
      console.error('[race] failed to start', err);
      fatal(err instanceof Error ? err.message : 'Could not build the selected circuit.');
    }
  };

  const startPartyRace = async (race: PartyRaceConfig): Promise<void> => {
    if (session) return;
    const feature = catalog.features.find((f) => f.id === race.trackId) ?? library.selected;
    const car: CarConfig = {
      ...race.car,
      driverName: account?.name ?? race.car.driverName,
      livery: { ...race.car.livery },
      setup: { ...race.car.setup },
    };
    partyRaceActive = true;
    try {
      await startRace(
        {
          mode: 'party',
          featureId: feature.id,
          laps: Math.max(1, Math.round(race.laps)),
          settings: { ...race.settings },
        },
        car,
      );
      if (session) {
        for (const member of race.members) {
          if (member.id === account?.id) continue;
          session.addRemoteCar(member.id, car);
        }
      } else {
        partyRaceActive = false;
      }
    } catch (err) {
      partyRaceActive = false;
      console.error('[party] failed to start race', err);
    }
  };

  accountUI.onAccountChange = (next) => refreshAccount(next);
  home.setAccount(account);
  multiplayer.setAccount(account);
  garage = new GarageUI(garageControls, garageSpec, garagePreview, exitGarage);
  home.refresh(loadCarConfig());
  bindTouchControls();
  setScreen('home');
  homePreview.start();
  progress(100, 'READY');

  window.addEventListener('resize', () => {
    if (currentScreen === 'home') homePreview.resize();
    if (currentScreen === 'garage') garagePreview.resize();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && currentScreen === 'garage') exitGarage();
  });

  await new Promise((resolve) => setTimeout(resolve, 260));
  hideBoot();
}

void bootApp().catch((err) => {
  console.error('[boot] fatal', err);
  fatal(err instanceof Error ? err.message : 'The simulator failed to initialise.');
});
