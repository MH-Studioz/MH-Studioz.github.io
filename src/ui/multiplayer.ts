import { CAR_CLASSES, loadCarConfig } from '../garage/carConfig';
import type { DriverAccount } from '../account/account';
import { loadRaceSettings } from '../app/raceOptions';
import {
  makePartyMember,
  PartyClient,
  type PartyCarFrame,
  type PartyRaceConfig,
  type PartySnapshot,
  type PartyStatus,
} from '../net/party';
import type { TrackLibrary } from './trackLibrary';

export interface MultiplayerCallbacks {
  onBack: () => void;
  requestAccount: (after: () => void) => void;
  onRaceStart: (race: PartyRaceConfig) => void;
  onFrame: (from: string, frame: PartyCarFrame) => void;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing multiplayer element #${id}`);
  return el as T;
}

function escapeText(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

function fillWait(text: string): void {
  const el = document.getElementById('mp-wait');
  if (el) el.textContent = text;
}

export class MultiplayerUI {
  private readonly callbacks: MultiplayerCallbacks;
  private readonly library: TrackLibrary;
  private client = new PartyClient();
  private account: DriverAccount | null = null;
  private accountCallback: (() => void) | null = null;
  private status: PartyStatus = 'idle';

  private createButton = byId<HTMLButtonElement>('mp-create');
  private joinButton = byId<HTMLButtonElement>('mp-join');
  private codeInput = byId<HTMLInputElement>('mp-code');
  private lobby = byId('mp-lobby');
  private statusEl = byId('mp-status');
  private accountEl = byId('mp-account');
  private playersEl = byId('mp-players');
  private codeEl = byId('mp-lobby-code');

  constructor(library: TrackLibrary, callbacks: MultiplayerCallbacks) {
    this.library = library;
    this.callbacks = callbacks;
    this.client.onState = (state) => this.renderLobby(state);
    this.client.onStatus = (status, message) => {
      this.status = status;
      this.setStatus(message, status);
      if (status === 'closed' || status === 'idle') this.renderLobby(null);
    };
    this.client.onRaceStart = (race) => this.callbacks.onRaceStart(race);
    this.client.onFrame = (from, frame) => this.callbacks.onFrame(from, frame);
    byId('mp-back').addEventListener('click', () => {
      this.client.leave();
      this.callbacks.onBack();
    });
    this.accountEl.addEventListener('click', () => this.callbacks.requestAccount(() => this.open()));
    this.createButton.addEventListener('click', () => this.requireAccount(() => void this.createParty()));
    this.joinButton.addEventListener('click', () => this.requireAccount(() => void this.joinParty()));
    this.codeInput.addEventListener('input', () => {
      this.codeInput.value = this.codeInput.value.replace(/\D/g, '').slice(0, 6);
      this.joinButton.disabled = this.codeInput.value.length !== 6;
    });
    this.codeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && this.codeInput.value.length === 6) {
        this.requireAccount(() => void this.joinParty());
      }
    });
    byId('mp-copy').addEventListener('click', () => void this.copyCode());
    byId('mp-start-race').addEventListener('click', () => this.startPartyRace());
    byId('mp-change-track').addEventListener('click', () => {
      if (this.client.role === 'host') this.library.open();
    });
    byId('mp-leave').addEventListener('click', () => {
      this.client.leave();
      this.status = 'idle';
      this.renderLobby(null);
      this.setStatus('READY', 'idle');
    });
    this.joinButton.disabled = true;
  }

  open(): void {
    this.setAccount(this.account);
    this.library.onSelect = (feature) => this.client.setTrack(feature.id, feature.name);
    this.renderLobby(this.client.state);
  }

  /** Forward the local car pose into the party connection. */
  sendCarFrame(frame: PartyCarFrame): void {
    this.client.sendFrame(frame);
  }

  isInParty(): boolean {
    return Boolean(this.client.state);
  }

  setAccount(account: DriverAccount | null): void {
    this.account = account;
    this.accountEl.innerHTML = account
      ? `<span class="account-dot"></span><span>${escapeText(account.name)}</span>${account.guest ? '<small>GUEST</small>' : '<small>DRIVER</small>'}`
      : '<span>SIGN IN TO HOST OR JOIN</span>';
    this.accountEl.classList.toggle('signed-in', Boolean(account));
  }

  private requireAccount(action: () => void): void {
    if (this.account) {
      action();
      return;
    }
    this.accountCallback = action;
    this.callbacks.requestAccount(() => {
      const callback = this.accountCallback;
      this.accountCallback = null;
      callback?.();
    });
  }

  private async createParty(): Promise<void> {
    if (!this.account) return;
    this.createButton.disabled = true;
    this.joinButton.disabled = true;
    this.setStatus('OPENING PARTY…', 'connecting');
    const config = loadCarConfig();
    const cls = CAR_CLASSES[config.carClass];
    await this.client.host(
      makePartyMember(this.account),
      this.library.selected.id,
      this.library.selected.name,
      `${config.livery.tag} · ${cls.label}`,
      this.conditionLabel(),
    );
    this.createButton.disabled = false;
    this.joinButton.disabled = this.codeInput.value.length !== 6;
    this.renderLobby(this.client.state);
  }

  private async joinParty(): Promise<void> {
    if (!this.account) return;
    const code = this.codeInput.value.trim();
    if (code.length !== 6) {
      this.setStatus('ENTER A 6-DIGIT CODE', 'error');
      return;
    }
    this.createButton.disabled = true;
    this.joinButton.disabled = true;
    this.setStatus('CONNECTING TO PARTY…', 'connecting');
    await this.client.join(code, makePartyMember(this.account));
    this.createButton.disabled = false;
    this.joinButton.disabled = this.codeInput.value.length !== 6;
    this.renderLobby(this.client.state);
  }

  private renderLobby(state: PartySnapshot | null): void {
    if (!state) {
      this.lobby.classList.add('hidden');
      return;
    }
    this.lobby.classList.remove('hidden');
    this.codeEl.textContent = state.code;
    this.playersEl.innerHTML = state.members
      .map((member) => `
        <div class="mp-player ${member.isHost ? 'host' : ''}">
          <span class="mp-player-icon">${member.isHost ? 'H' : 'P'}</span>
          <div><strong>${escapeText(member.name)}</strong><small>${member.isHost ? 'HOST' : member.guest ? 'GUEST' : 'DRIVER'}</small></div>
          <i>${member.isHost ? '◆' : '●'}</i>
        </div>
      `)
      .join('');
    byId('mp-detail-track').textContent = state.trackName.toUpperCase();
    byId('mp-detail-car').textContent = state.carName.toUpperCase();
    byId('mp-detail-conditions').textContent = state.conditions.toUpperCase();
    byId('mp-player-count').textContent = `${state.members.length} / 10`;
    if (this.client.role === 'host') {
      this.setStatus('PARTY LIVE · SHARE THE CODE', 'live');
      byId('mp-start-race').classList.remove('hidden');
      byId('mp-change-track').classList.remove('hidden');
      fillWait('READY TO START WHEN YOU ARE');
    } else if (this.client.role === 'guest') {
      this.setStatus('IN THE PARTY', 'live');
      byId('mp-start-race').classList.add('hidden');
      byId('mp-change-track').classList.add('hidden');
      fillWait('WAITING FOR THE HOST TO START…');
    }
  }

  private conditionLabel(): string {
    const settings = loadRaceSettings();
    return `${settings.weather.toUpperCase()} · ${settings.timeOfDay.toUpperCase()} · ${settings.aiCount} AI`;
  }

  private startPartyRace(): void {
    if (!this.account || this.client.role !== 'host' || !this.client.state) return;
    const config = loadCarConfig();
    const settings = { ...loadRaceSettings() };
    const car = {
      ...config,
      driverName: this.account.name,
      livery: { ...config.livery },
      setup: { ...config.setup },
    };
    const race: PartyRaceConfig = {
      trackId: this.library.selected.id,
      trackName: this.library.selected.name,
      laps: 10,
      settings,
      car,
      members: this.client.state.members.map((member) => ({ id: member.id, name: member.name })),
    };
    this.client.startRace(race);
    this.setStatus('RACE STARTED · LIGHTS OUT', 'live');
    this.callbacks.onRaceStart(race);
  }

  private setStatus(message: string, status: PartyStatus): void {
    this.statusEl.textContent = message;
    this.statusEl.dataset.status = status;
  }

  private async copyCode(): Promise<void> {
    const code = this.client.state?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      this.setStatus('CODE COPIED', 'live');
    } catch {
      this.setStatus(`CODE: ${code}`, 'live');
    }
  }
}
