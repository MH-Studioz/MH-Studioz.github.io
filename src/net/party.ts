import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import type { CarConfig } from '../garage/carConfig';
import type { RaceSettings } from '../app/raceOptions';

export interface PartyMember {
  id: string;
  name: string;
  guest: boolean;
  isHost: boolean;
}

export interface PartySnapshot {
  code: string;
  members: PartyMember[];
  trackId: string;
  trackName: string;
  carName: string;
  conditions: string;
}

export interface PartyRaceMember {
  id: string;
  name: string;
}

/** Everything both browsers need to build the same race locally. */
export interface PartyRaceConfig {
  trackId: string;
  trackName: string;
  laps: number;
  settings: RaceSettings;
  car: CarConfig;
  members: PartyRaceMember[];
}

/** A compact car pose, broadcast at 10 Hz. */
export interface PartyCarFrame {
  index: number;
  u: number;
  lateral: number;
  heading: number;
  speed: number;
  pos: [number, number, number];
  compound: string;
}

export type PartyStatus = 'idle' | 'connecting' | 'live' | 'error' | 'closed';

type ClientMessage =
  | { type: 'join'; member: Omit<PartyMember, 'isHost'> }
  | { type: 'leave' }
  | { type: 'frame'; frame: PartyCarFrame };

type HostMessage =
  | { type: 'lobby'; state: PartySnapshot }
  | { type: 'race-start'; race: PartyRaceConfig }
  | { type: 'frame'; from: string; frame: PartyCarFrame }
  | { type: 'error'; message: string };

function randomCode(): string {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(100000 + (values[0] % 900000));
}

function memberId(): string {
  return `m-${Math.random().toString(36).slice(2, 10)}`;
}

export class PartyClient {
  onState: ((state: PartySnapshot | null) => void) | null = null;
  onStatus: ((status: PartyStatus, message: string) => void) | null = null;
  onRaceStart: ((race: PartyRaceConfig) => void) | null = null;
  onFrame: ((from: string, frame: PartyCarFrame) => void) | null = null;

  state: PartySnapshot | null = null;
  role: 'host' | 'guest' | null = null;
  selfId = '';

  private peer: Peer | null = null;
  private connections = new Map<string, DataConnection>();
  private memberByPeer = new Map<string, PartyMember>();
  private guestConnection: DataConnection | null = null;
  private hostId = '';
  private disposed = false;

  async host(
    member: Omit<PartyMember, 'isHost'>,
    trackId: string,
    trackName: string,
    carName: string,
    conditions: string,
  ): Promise<void> {
    this.dispose();
    this.disposed = false;
    this.role = 'host';
    this.selfId = member.id;
    this.emitStatus('connecting', 'OPENING PARTY…');

    let lastError = 'Could not reserve a party code.';
    for (let attempt = 0; attempt < 7; attempt++) {
      const code = randomCode();
      try {
        const peer = await this.openPeer(`gp2026-${code}`);
        if (this.disposed) {
          peer.destroy();
          return;
        }
        this.peer = peer;
        this.hostId = `gp2026-${code}`;
        this.state = {
          code,
          members: [{ ...member, isHost: true }],
          trackId,
          trackName,
          carName,
          conditions,
        };
        peer.on('connection', (connection) => this.acceptConnection(connection));
        peer.on('error', (error) => this.handlePeerError(error));
        this.emitState();
        this.emitStatus('live', 'PARTY LIVE · SHARE THE CODE');
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (!/unavailable|taken|id/i.test(lastError)) break;
      }
    }
    this.role = null;
    this.emitStatus('error', lastError);
  }

  async join(code: string, member: Omit<PartyMember, 'isHost'>): Promise<void> {
    this.dispose();
    this.disposed = false;
    this.role = 'guest';
    this.selfId = member.id || memberId();
    this.emitStatus('connecting', 'CONNECTING TO PARTY…');
    try {
      const peer = await this.openPeer();
      if (this.disposed) {
        peer.destroy();
        return;
      }
      this.peer = peer;
      this.hostId = `gp2026-${code}`;
      peer.on('error', (error) => this.handlePeerError(error));
      const connection = peer.connect(this.hostId, { reliable: true });
      this.guestConnection = connection;
      const timeout = window.setTimeout(() => {
        if (connection.open) return;
        this.emitStatus('error', 'Party not found. Check the 6-digit code.');
        this.dispose();
      }, 10000);
      connection.on('open', () => {
        window.clearTimeout(timeout);
        connection.send({ type: 'join', member: { ...member, id: this.selfId } } satisfies ClientMessage);
        this.emitStatus('live', 'IN THE PARTY');
      });
      connection.on('data', (data) => this.receiveHostMessage(data));
      connection.on('close', () => {
        this.emitStatus('closed', 'HOST CLOSED THE PARTY');
        this.state = null;
        this.emitState();
      });
      connection.on('error', () => {
        window.clearTimeout(timeout);
        this.emitStatus('error', 'Party connection failed.');
      });
    } catch (error) {
      this.emitStatus('error', error instanceof Error ? error.message : 'Could not reach the party service.');
      this.dispose();
    }
  }

  leave(): void {
    if (this.role === 'guest' && this.guestConnection?.open) {
      this.guestConnection.send({ type: 'leave' } satisfies ClientMessage);
    }
    this.dispose();
    this.role = null;
    this.state = null;
    this.emitState();
    this.emitStatus('idle', 'READY');
  }

  /** Host only: update the circuit shown in the party lobby. */
  setTrack(trackId: string, trackName: string): void {
    if (this.role !== 'host' || !this.state) return;
    this.state.trackId = trackId;
    this.state.trackName = trackName;
    this.broadcast();
  }

  /** Host only: tell every guest to build and enter the same race. */
  startRace(race: PartyRaceConfig): void {
    if (this.role !== 'host' || !this.state) return;
    this.state.trackId = race.trackId;
    this.state.trackName = race.trackName;
    this.state.conditions = `${race.settings.weather.toUpperCase()} · ${race.settings.timeOfDay.toUpperCase()} · ${race.members.length} DRIVERS`;
    for (const connection of this.connections.values()) {
      if (connection.open) connection.send({ type: 'race-start', race } satisfies HostMessage);
    }
    this.broadcast();
  }

  /** Broadcast the local car pose; the host relays guest frames to everyone else. */
  sendFrame(frame: PartyCarFrame): void {
    if (this.role === 'guest' && this.guestConnection?.open) {
      this.guestConnection.send({ type: 'frame', frame } satisfies ClientMessage);
    } else if (this.role === 'host') {
      for (const connection of this.connections.values()) {
        if (connection.open) connection.send({ type: 'frame', from: this.selfId, frame } satisfies HostMessage);
      }
    }
  }

  private openPeer(id?: string): Promise<Peer> {
    return new Promise((resolve, reject) => {
      const peer = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        peer.destroy();
        reject(new Error('Party service timed out.'));
      }, 12000);
      peer.on('open', () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(peer);
      });
      peer.on('error', (error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        peer.destroy();
        reject(new Error(error.message || 'Party service unavailable.'));
      });
    });
  }

  private acceptConnection(connection: DataConnection): void {
    connection.on('open', () => {
      this.connections.set(connection.peer, connection);
      this.sendState(connection);
    });
    connection.on('data', (data) => this.receiveHostData(connection, data));
    connection.on('close', () => {
      this.connections.delete(connection.peer);
      const member = this.memberByPeer.get(connection.peer);
      if (member && this.state) {
        this.memberByPeer.delete(connection.peer);
        this.state.members = this.state.members.filter((m) => m.id !== member.id);
      }
      this.broadcast();
    });
  }

  private receiveHostData(connection: DataConnection, data: unknown): void {
    if (!this.state || !data || typeof data !== 'object') return;
    const message = data as ClientMessage;
    if (message.type === 'join' && message.member?.id && message.member.name) {
      const existing = this.state.members.find((m) => m.id === message.member.id);
      if (!existing) {
        const member: PartyMember = {
          id: message.member.id,
          name: message.member.name.slice(0, 20),
          guest: Boolean(message.member.guest),
          isHost: false,
        };
        this.state.members.push(member);
        this.memberByPeer.set(connection.peer, member);
      }
      this.sendState(connection);
      this.broadcast();
    } else if (message.type === 'leave') {
      this.connections.delete(connection.peer);
      connection.close();
      this.removeDisconnectedMembers();
    } else if (message.type === 'frame' && message.frame) {
      const member = this.memberByPeer.get(connection.peer);
      if (!member) return;
      this.onFrame?.(member.id, message.frame);
      for (const other of this.connections.values()) {
        if (other === connection || !other.open) continue;
        other.send({ type: 'frame', from: member.id, frame: message.frame } satisfies HostMessage);
      }
    }
  }

  private removeDisconnectedMembers(): void {
    if (!this.state) return;
    const connected = new Set([...this.connections.keys()]);
    this.state.members = this.state.members.filter((m) => {
      if (m.isHost) return true;
      return [...this.memberByPeer.entries()].some(([peerId, member]) => connected.has(peerId) && member.id === m.id);
    });
    for (const peerId of [...this.memberByPeer.keys()]) {
      if (!connected.has(peerId)) this.memberByPeer.delete(peerId);
    }
    this.broadcast();
  }

  private broadcast(): void {
    if (!this.state) return;
    for (const connection of this.connections.values()) this.sendState(connection);
    this.emitState();
  }

  private sendState(connection: DataConnection): void {
    if (!this.state || !connection.open) return;
    connection.send({ type: 'lobby', state: this.state } satisfies HostMessage);
  }

  private receiveHostMessage(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const message = data as HostMessage;
    if (message.type === 'lobby' && message.state) {
      this.state = message.state;
      this.emitState();
      this.emitStatus('live', 'IN THE PARTY');
    } else if (message.type === 'race-start' && message.race) {
      this.onRaceStart?.(message.race);
    } else if (message.type === 'frame' && message.frame) {
      this.onFrame?.(message.from, message.frame);
    } else if (message.type === 'error') {
      this.emitStatus('error', message.message);
    }
  }

  private handlePeerError(error: { type?: string; message?: string }): void {
    if (error.type === 'peer-unavailable') {
      this.emitStatus('error', 'Party not found. Check the 6-digit code.');
      this.dispose();
      return;
    }
    if (error.type === 'network' || error.type === 'server-error' || error.type === 'socket-error') {
      this.emitStatus('error', 'Party service is unreachable. Try again.');
      this.dispose();
      return;
    }
    if (error.type === 'unavailable-id') {
      this.emitStatus('error', 'That party code is already in use. Host again.');
    }
  }

  private emitState(): void {
    this.onState?.(this.state);
  }

  private emitStatus(status: PartyStatus, message: string): void {
    this.onStatus?.(status, message);
  }

  private dispose(): void {
    this.disposed = true;
    for (const connection of this.connections.values()) connection.close();
    this.connections.clear();
    this.guestConnection?.close();
    this.guestConnection = null;
    this.peer?.destroy();
    this.peer = null;
    this.selfId = '';
  }
}

export function makePartyMember(account: { id: string; name: string; guest: boolean }): Omit<PartyMember, 'isHost'> {
  return { id: account.id, name: account.name, guest: account.guest };
}
