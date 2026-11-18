import { COMPOUNDS, type CompoundId } from '../physics/tyres';
import type { TrackData } from '../tracks/types';
import type { VehicleTelemetry } from '../physics/vehicle';

export interface TimingEntry {
  position: number;
  name: string;
  tag: string;
  gap: string;
  compoundColor: string;
  isPlayer: boolean;
  life: number;
}

export interface SessionSnapshot {
  modeLabel: string;
  trackName: string;
  lap: number;
  totalLaps: number;
  position: number;
  fieldSize: number;
  time: string;
  delta: string;
  deltaSlow: boolean;
  weather: string;
  notes: string;
  penalty: string;
  status: string;
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing HUD element #${id}`);
  return el as T;
}

export class HUD {
  private root = byId('hud');
  private speed = byId('tel-speed');
  private gear = byId('tel-gear');
  private rpmLeds = byId('rpm-leds');
  private ersFill = byId('ers-fill');
  private ersVal = byId('ers-val');
  private ersBar = this.ersFill.closest('.tel-bar') as HTMLElement | null;
  private fuelFill = byId('fuel-fill');
  private fuelVal = byId('fuel-val');
  private telTyres = byId('tel-tyres');
  private drsBadge = byId('drs-badge');
  private drsNote = byId('drs-note');
  private limiterBadge = byId('limiter-badge');
  private timing = byId('timing-tower');
  private mfd = byId('mfd');
  private mfdTyres = byId('mfd-tyres');
  private messageEl = byId('race-message');
  private lights = byId('start-lights');
  private lightRail = document.querySelectorAll<HTMLElement>('.lights-rail i');
  private lightsLabel = byId('lights-label');
  private toasts = byId('toast-stack');
  private hudLap = byId('hud-lap');
  private hudTime = byId('hud-time');
  private hudDelta = byId('hud-delta');
  private hudPos = byId('hud-pos');
  private hudField = byId('hud-field');
  private hudMode = byId('hud-mode');
  private hudTrack = byId('hud-track');
  private hudWeather = byId('hud-weather');
  private pitButton = byId<HTMLButtonElement>('pit-compound-btn');
  private pitDot = byId('pit-compound-dot');
  private pitName = byId('pit-compound-name');
  private pitStatus = byId('pit-status');
  private pitLegend = byId('compound-legend');
  private mfdPenalty = byId('mfd-penalty');
  private mfdNotes = byId('mfd-notes');
  private audioBtn = byId<HTMLButtonElement>('hud-audio');
  private track: TrackData;
  private tyreCards: Array<{
    root: HTMLElement;
    ring: HTMLElement;
    val: HTMLElement;
    temp: HTMLElement;
  }> = [];
  private mfdCards: Array<{
    root: HTMLElement;
    ring: HTMLElement;
    wear: HTMLElement;
    temp: HTMLElement;
    bar: HTMLElement;
    name: HTMLElement;
  }> = [];
  private messageTimer = 0;
  private compound: CompoundId = 'medium';
  private onPitCompound: (compound: CompoundId) => void;
  private onMute: () => void;
  private onPause: () => void;

  constructor(
    track: TrackData,
    callbacks: {
      onPitCompound: (compound: CompoundId) => void;
      onMute: () => void;
      onPause: () => void;
    },
  ) {
    this.track = track;
    this.onPitCompound = callbacks.onPitCompound;
    this.onMute = callbacks.onMute;
    this.onPause = callbacks.onPause;

    // The HUD DOM is reused across sessions, so clear generated children.
    this.rpmLeds.innerHTML = '';
    this.telTyres.innerHTML = '';
    this.mfdTyres.innerHTML = '';
    this.pitLegend.innerHTML = '';
    this.tyreCards = [];
    this.mfdCards = [];

    for (let i = 0; i < 15; i++) {
      const led = document.createElement('i');
      this.rpmLeds.appendChild(led);
    }

    const order = ['FL', 'FR', 'RL', 'RR'];
    for (const pos of order) {
      const card = document.createElement('div');
      card.className = 'tel-tyre';
      card.innerHTML = `<span class="tt-pos">${pos}</span><span class="tt-ring"><b></b></span><span class="tt-val">100%</span><span class="tt-temp">—</span>`;
      this.telTyres.appendChild(card);
      this.tyreCards.push({
        root: card,
        ring: card.querySelector('.tt-ring') as HTMLElement,
        val: card.querySelector('.tt-val') as HTMLElement,
        temp: card.querySelector('.tt-temp') as HTMLElement,
      });

      const mfd = document.createElement('div');
      mfd.className = 'tyre-card';
      mfd.innerHTML = `<div class="tc-ring"><span>M</span></div><div><div class="tc-name">${pos} · MEDIUM</div><div class="tc-wear">100%</div><div class="tc-temp">CORE 100°C · SURF 90°C</div></div><div class="tc-temp" style="text-align:right">—</div><div class="tc-bar"><i></i></div>`;
      this.mfdTyres.appendChild(mfd);
      this.mfdCards.push({
        root: mfd,
        ring: mfd.querySelector('.tc-ring') as HTMLElement,
        wear: mfd.querySelector('.tc-wear') as HTMLElement,
        temp: mfd.querySelector('.tc-temp') as HTMLElement,
        bar: mfd.querySelector('.tc-bar i') as HTMLElement,
        name: mfd.querySelector('.tc-name') as HTMLElement,
      });
    }

    for (const c of Object.values(COMPOUNDS)) {
      const bar = document.createElement('span');
      bar.style.background = c.color;
      bar.title = c.label;
      this.pitLegend.appendChild(bar);
    }

    this.pitButton.onclick = () => {
      const order: CompoundId[] = ['soft', 'medium', 'hard', 'intermediate', 'wet'];
      const next = order[(order.indexOf(this.compound) + 1) % order.length];
      this.onPitCompound(next);
    };
    this.audioBtn.onclick = () => this.onMute();
    byId<HTMLButtonElement>('hud-menu').onclick = () => this.onPause();
    void this.track;
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.hideMessage();
    this.hideStartLights();
  }

  toggleMfd(): void {
    this.mfd.classList.toggle('hidden');
  }

  get mfdOpen(): boolean {
    return !this.mfd.classList.contains('hidden');
  }

  setPitCompound(compound: CompoundId): void {
    this.compound = compound;
    const c = COMPOUNDS[compound];
    this.pitDot.style.color = c.color;
    this.pitName.textContent = c.label.toUpperCase();
  }

  setMuted(muted: boolean): void {
    this.audioBtn.textContent = muted ? '✕' : '♪';
    this.audioBtn.title = muted ? 'Unmute audio' : 'Mute audio';
  }

  update(telemetry: VehicleTelemetry, session: SessionSnapshot, timings: TimingEntry[]): void {
    this.speed.textContent = String(Math.round(telemetry.speedKmh));
    this.gear.textContent = String(telemetry.gear);

    const rpmRatio = Math.max(0, Math.min(1, telemetry.rpm / 13000));
    const lit = Math.round(rpmRatio * 15);
    const leds = this.rpmLeds.children;
    for (let i = 0; i < leds.length; i++) {
      const el = leds[i] as HTMLElement;
      el.classList.toggle('on', i < lit);
      el.classList.toggle('warn', i >= 10 && i < 13 && i < lit);
      el.classList.toggle('red', i >= 13 && i < lit);
      el.classList.toggle('shift', telemetry.rpm > 12300 && i >= 13 && i < lit);
    }

    this.ersFill.style.width = `${Math.round(telemetry.ers * 100)}%`;
    this.ersVal.textContent = `${Math.round(telemetry.ers * 100)}%`;
    this.ersBar?.classList.toggle('hidden', !telemetry.ersEquipped);
    const fuelRatio = Math.max(0, Math.min(1, telemetry.fuel / 100));
    this.fuelFill.style.width = `${Math.round(fuelRatio * 100)}%`;
    this.fuelVal.textContent = `${telemetry.fuel.toFixed(0)}L`;

    this.drsBadge.textContent = telemetry.drsOpen ? 'DRS OPEN' : 'DRS';
    this.drsBadge.classList.toggle('active', telemetry.drsOpen);
    this.drsBadge.classList.toggle('available', telemetry.drsAvailable && !telemetry.drsOpen);
    this.drsBadge.classList.toggle('hidden', !telemetry.drsEquipped);
    this.drsNote.textContent = !telemetry.drsEquipped ? 'NO WING' : telemetry.drsOpen ? '65°' : telemetry.drsAvailable ? 'ARMED' : 'ZONE';
    this.limiterBadge.classList.toggle('hidden', !telemetry.pitLimiter);

    telemetry.tyres.forEach((tyre, i) => {
      const card = this.tyreCards[i];
      if (!card) return;
      const pct = Math.round(Math.max(0, tyre.life) * 100);
      card.ring.style.color = tyre.color;
      card.ring.style.setProperty('--wear', `${pct}%`);
      card.val.textContent = `${pct}%`;
      card.temp.textContent = `${Math.round(tyre.coreTemp)}°`;
      card.root.classList.toggle('critical', tyre.life < 0.25);
    });

    telemetry.tyres.forEach((tyre, i) => {
      const card = this.mfdCards[i];
      if (!card) return;
      const pct = Math.round(Math.max(0, tyre.life) * 100);
      const compound = COMPOUNDS[tyre.compound];
      card.ring.style.color = tyre.color;
      card.ring.firstElementChild!.textContent = compound.short;
      card.name.textContent = `${tyre.position} · ${compound.label.toUpperCase()}`;
      card.wear.textContent = `${pct}%`;
      card.temp.textContent = `CORE ${Math.round(tyre.coreTemp)}°C · SURF ${Math.round(tyre.surfaceTemp)}°C`;
      card.bar.style.width = `${pct}%`;
      card.bar.style.background = tyre.color;
      card.root.classList.toggle('warn', tyre.life < 0.42 && tyre.life >= 0.25);
      card.root.classList.toggle('critical', tyre.life < 0.25);
    });

    // Damage wireframe.
    const colour = (health: number) => `hsl(${Math.round(Math.max(0, Math.min(1, health)) * 118)}, 82%, 48%)`;
    const wingL = document.getElementById('dmg-wing-fl');
    const wingR = document.getElementById('dmg-wing-fr');
    const floor = document.getElementById('dmg-floor');
    const susp = document.getElementById('dmg-susp');
    const susp2 = document.getElementById('dmg-susp2');
    if (wingL) wingL.style.fill = colour(telemetry.wingFL);
    if (wingR) wingR.style.fill = colour(telemetry.wingFR);
    if (floor) floor.style.fill = colour(telemetry.floor);
    const suspHealth = 1 - telemetry.suspension;
    if (susp) susp.style.fill = colour(suspHealth);
    if (susp2) susp2.style.fill = colour(suspHealth);
    byId('dmg-fl-val').textContent = `${Math.round(telemetry.wingFL * 100)}%`;
    byId('dmg-fr-val').textContent = `${Math.round(telemetry.wingFR * 100)}%`;
    byId('dmg-floor-val').textContent = `${Math.round(telemetry.floor * 100)}%`;
    byId('dmg-susp-val').textContent = telemetry.suspension < 0.05 ? 'OK' : `${Math.round(telemetry.suspension * 100)}%`;

    this.pitStatus.textContent = telemetry.servicing
      ? `SERVICING · ${Math.max(0, telemetry.pitTimer).toFixed(1)}s REMAINING`
      : telemetry.pitLimiter
        ? 'PIT LIMITER ACTIVE · 80 KM/H'
        : telemetry.inPitLane
          ? 'PIT LANE · STOP IN YOUR BOX FOR TYRES'
          : 'PIT LANE OPEN · SPEED LIMIT 80 KM/H';
    this.mfdPenalty.textContent = session.penalty || (telemetry.pendingPenalty > 0 ? `PENALTY +${telemetry.pendingPenalty}s` : '');
    this.mfdNotes.textContent = session.notes;

    this.hudLap.textContent = `${Math.max(1, session.lap)} / ${session.totalLaps > 0 ? session.totalLaps : '∞'}`;
    this.hudTime.textContent = session.time;
    this.hudDelta.textContent = session.delta;
    this.hudDelta.classList.toggle('slow', session.deltaSlow);
    this.hudPos.textContent = String(session.position);
    this.hudField.textContent = `/ ${session.fieldSize}`;
    this.hudMode.textContent = session.modeLabel;
    this.hudTrack.textContent = session.trackName;
    this.hudWeather.textContent = session.weather;

    let html = `<div class="tower-head"><span>POS</span><span>DRIVER</span><span>GAP</span><span>TYRE</span></div>`;
    for (const entry of timings) {
      html += `<div class="tower-row${entry.isPlayer ? ' player' : ''}">
        <span class="tower-pos">${entry.position}</span>
        <span class="tower-name">${entry.tag} · ${entry.name}</span>
        <span class="tower-gap">${entry.gap}</span>
        <i class="tower-tyre" style="color:${entry.compoundColor}" title="${Math.round(entry.life * 100)}% life"></i>
      </div>`;
    }
    this.timing.innerHTML = html;
  }

  setStartLights(count: number, label: string, go = false): void {
    this.lights.classList.remove('hidden');
    this.lightsLabel.textContent = label;
    this.lightRail.forEach((el, i) => {
      el.classList.toggle('on', !go && i < count);
      el.classList.toggle('go', go);
    });
  }

  hideStartLights(): void {
    this.lights.classList.add('hidden');
  }

  showMessage(text: string, className = '', duration = 2400): void {
    window.clearTimeout(this.messageTimer);
    this.messageEl.textContent = text;
    this.messageEl.className = `race-message ${className}`;
    this.messageEl.classList.remove('hidden');
    this.messageTimer = window.setTimeout(() => {
      this.messageEl.classList.add('hidden');
    }, duration);
  }

  hideMessage(): void {
    this.messageEl.classList.add('hidden');
  }

  toast(text: string): void {
    const div = document.createElement('div');
    div.className = 'toast';
    div.textContent = text;
    this.toasts.appendChild(div);
    window.setTimeout(() => div.remove(), 3800);
    while (this.toasts.children.length > 5) this.toasts.firstElementChild?.remove();
  }

  showFatal(message: string): void {
    const el = document.getElementById('fatal');
    const msg = document.getElementById('fatal-message');
    if (el && msg) {
      msg.textContent = message;
      el.classList.remove('hidden');
    }
  }
}
