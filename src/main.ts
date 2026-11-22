import './style.css';
import './shell.css';
import type { Group } from 'three';
import { loadTrackCatalog } from './tracks/geojsonLoader';
import { buildTrack } from './tracks/trackBuilder';
import { loadCarConfig } from './garage/carConfig';
import type { CarConfig } from './garage/carConfig';
import { GaragePreview } from './garage/garagePreview';
import { loadCarTemplate } from './render/carVisual';
import { ensureClassCarModel } from './render/carModels';
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

/**
 * Yields so the boot bar can paint. Background tabs throttle timers to roughly
 * once a minute, which parked the loading screen at "43 CIRCUITS" until the tab
 * was brought forward; when nothing is on screen there is nothing to wait for.
 */
function nextPaint(ms: number): Promise<void> {
  if (document.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(done);
    window.setTimeout(done, ms);
  });
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
  await nextPaint(40);

  let template: Group | null = null;
  try {
    // The detailed scan is optional: if the download stalls, boot continues on
    // the procedural cars rather than leaving the player on the loading screen.
    template = await Promise.race([
      loadCarTemplate(),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 12000)),
    ]);
  } catch (err) {
    console.warn('[boot] car template failed; procedural car will be used.', err);
  }
  progress(64, template ? 'GP 2026 CAR LOADED · PREPARING STUDIO…' : 'PROCEDURAL CAR READY · PREPARING STUDIO…');
  await nextPaint(30);

  const config = loadCarConfig();
  // Fetch the selected class's own scan in the background; the studio shows the
  // procedural shell until it arrives.
  void ensureClassCarModel(config.carClass);
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
    syncSetupPreview();
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

  // The Car tab has its own turntable; it is built on first visit so boot stays light.
  let setupPreview: GaragePreview | null = null;
  const ensureSetupPreview = (): GaragePreview | null => {
    if (setupPreview) return setupPreview;
    const canvas = document.getElementById('race-car-canvas') as HTMLCanvasElement | null;
    if (!canvas) return null;
    setupPreview = new GaragePreview(canvas, loadCarConfig(), template, { zoom: 1.3 });
    return setupPreview;
  };
  const syncSetupPreview = (): void => {
    // Short-circuit keeps this safe to call from any screen: only the Car tab renders.
    if (currentScreen !== 'race' || raceSetup.activeTab !== 'car') {
      setupPreview?.stop();
      return;
    }
    // Start synchronously: a background tab pauses requestAnimationFrame, and
    // the stage should be sized and ready the moment the tab is looked at.
    const preview = ensureSetupPreview();
    if (!preview) return;
    preview.start();
    preview.resize();
    requestAnimationFrame(() => {
      preview.resize();
    });
  };

  raceSetup = new RaceSetupUI(library, {
    onBack: () => setScreen('home'),
    onEditCar: () => openGarage('race'),
    onStart: (selection) => void startRace(selection),
    onTabChanged: () => syncSetupPreview(),
    onCarChanged: () => setupPreview?.setConfig(loadCarConfig()),
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
    await nextPaint(60);
    try {
      const track = buildTrack(feature);
      track.night = settings.timeOfDay === 'night';
      // A gravel stage is always a solo run against the clock, whatever entry
      // point (setup screen, party, deep link) asked for it.
      const stage = track.surface === 'gravel';
      progress(76, 'PREPARING GRID · 120 HZ PHYSICS…');
      await nextPaint(40);
      setScreen(null);
      const playerConfig = playerOverride ?? loadCarConfig();
      if (settings.weather === 'wet') playerConfig.livery.compound = 'wet';
      // The grid is built immediately below, so the class scan has to be in hand
      // (bounded, so a slow or missing file cannot hold up the race).
      progress(70, `LOADING ${playerConfig.carClass.toUpperCase()} CAR…`);
      await Promise.race([
        ensureClassCarModel(playerConfig.carClass),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 8000)),
      ]);
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
  // Hide now, not from a trailing timer: a dropped or throttled timer used to
  // leave the overlay sitting over a fully booted game.
  hideBoot();

  window.addEventListener('resize', () => {
    if (currentScreen === 'home') homePreview.resize();
    if (currentScreen === 'garage') garagePreview.resize();
    if (currentScreen === 'race') setupPreview?.resize();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && currentScreen === 'garage') exitGarage();
  });
}

void bootApp().catch((err) => {
  console.error('[boot] fatal', err);
  fatal(err instanceof Error ? err.message : 'The simulator failed to initialise.');
});
