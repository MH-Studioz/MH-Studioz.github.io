import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import type { ClubEntry } from './club';
import type { RegionId } from './data';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface PartyPlayer {
  id: string;
  name: string;
  depth: number;
  hits: number;
  done: boolean;
}

export interface PartyLobby {
  code: string;
  hostId: string;
  players: PartyPlayer[];
}

/** The host's seed makes every browser play the exact same seven prompts. */
export interface PartyRound {
  seed: number;
  region: RegionId;
}

export type PartyStatus = 'idle' | 'connecting' | 'live' | 'error' | 'closed';

type GuestMessage =
  | { type: 'join'; player: { id: string; name: string } }
  | { type: 'score'; depth: number; hits: number; done: boolean }
  | { type: 'club'; code: string; entries: ClubEntry[] }
  | { type: 'leave' };

type HostMessage =
  | { type: 'lobby'; lobby: PartyLobby }
  | { type: 'start'; round: PartyRound }
  | { type: 'scores'; players: PartyPlayer[] }
  | { type: 'club'; code: string; entries: ClubEntry[] }
  | { type: 'error'; message: string };

const MAX_CLUB_ENTRIES = 200;

function randomCode(): string {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(100000 + (values[0] % 900000));
}

function trimClub(entries: ClubEntry[]): ClubEntry[] {
  return entries.slice(0, MAX_CLUB_ENTRIES);
}

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

/**
 * A tiny peer-to-peer party: the host owns the lobby and the round seed,
 * every browser plays its own round, and only the scoreboard crosses the wire.
 * No server, no accounts and no state outside the room.
 */
export class PartyClient {
  onLobby: ((lobby: PartyLobby | null) => void) | null = null;
  onStatus: ((status: PartyStatus, message: string) => void) | null = null;
  onStart: ((round: PartyRound) => void) | null = null;
  onScores: ((players: PartyPlayer[]) => void) | null = null;
  onClub: ((code: string, entries: ClubEntry[]) => void) | null = null;

  role: 'host' | 'guest' | null = null;
  selfId = '';
  lobby: PartyLobby | null = null;

  private peer: Peer | null = null;
  private connections = new Map<string, DataConnection>();
  private playerByPeer = new Map<string, PartyPlayer>();
  private hostConnection: DataConnection | null = null;
  private hostId = '';
  private clubCache = new Map<string, ClubEntry[]>();
  private disposed = false;

  async host(self: { id: string; name: string }, club: { code: string; entries: ClubEntry[] } | null): Promise<void> {
    this.dispose();
    this.disposed = false;
    this.role = 'host';
    this.selfId = self.id;
    this.clubCache.clear();
    if (club?.code) this.clubCache.set(club.code, trimClub(club.entries));
    this.status('connecting', 'OPENING PARTY…');

    let lastError = 'Could not reserve a party code.';
    for (let attempt = 0; attempt < 7; attempt++) {
      const code = randomCode();
      try {
        const peer = await this.openPeer(`deepatlas-${code}`);
        if (this.disposed) {
          peer.destroy();
          return;
        }
        this.peer = peer;
        this.hostId = `deepatlas-${code}`;
        this.lobby = {
          code,
          hostId: self.id,
          players: [{ id: self.id, name: self.name, depth: 0, hits: 0, done: false }],
        };
        peer.on('connection', (connection) => this.accept(connection));
        peer.on('error', (error) => this.handlePeerError(error));
        this.emitLobby();
        this.status('live', 'PARTY LIVE · SHARE THE CODE');
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (!/unavailable|taken|id/i.test(lastError)) break;
      }
    }
    this.role = null;
    this.status('error', lastError);
  }

  async join(code: string, self: { id: string; name: string }, clubCode: string): Promise<void> {
    this.dispose();
    this.disposed = false;
    this.role = 'guest';
    this.selfId = self.id;
    this.status('connecting', 'CONNECTING TO PARTY…');
    try {
      const peer = await this.openPeer();
      if (this.disposed) {
        peer.destroy();
        return;
      }
      this.peer = peer;
      this.hostId = `deepatlas-${code}`;
      peer.on('error', (error) => this.handlePeerError(error));

      const connection = peer.connect(this.hostId, { reliable: true });
      this.hostConnection = connection;
      const timeout = window.setTimeout(() => {
        if (connection.open) return;
        this.status('error', 'PARTY NOT FOUND — CHECK THE SIX DIGITS');
        this.dispose();
      }, 12000);

      connection.on('open', () => {
        window.clearTimeout(timeout);
        connection.send({ type: 'join', player: { id: this.selfId, name: self.name } } satisfies GuestMessage);
        this.status('live', 'IN THE PARTY');
        if (clubCode) this.sendClub(clubCode, []);
      });
      connection.on('data', (data) => this.receiveHostMessage(data));
      connection.on('close', () => {
        this.status('closed', 'HOST CLOSED THE PARTY');
        this.lobby = null;
        this.emitLobby();
      });
      connection.on('error', () => {
        window.clearTimeout(timeout);
        this.status('error', 'PARTY CONNECTION FAILED');
      });
    } catch (error) {
      this.status('error', error instanceof Error ? error.message : 'COULD NOT REACH THE PARTY SERVICE');
      this.dispose();
    }
  }

  /** Host only: freeze the lobby into a round and tell everyone the seed. */
  startRound(): PartyRound | null {
    if (this.role !== 'host' || !this.lobby) return null;
    const seed = (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0) || 1;
    const round: PartyRound = { seed, region: 'world' };
    for (const player of this.lobby.players) {
      player.depth = 0;
      player.hits = 0;
      player.done = false;
    }
    for (const connection of this.connections.values()) {
      if (connection.open) connection.send({ type: 'start', round } satisfies HostMessage);
    }
    this.emitLobby();
    this.emitScores();
    return round;
  }

  /** Publish the local score; the host folds it into the standings. */
  pushScore(depth: number, hits: number, done: boolean): void {
    if (!this.lobby) return;
    if (this.role === 'guest') {
      if (this.hostConnection?.open) {
        this.hostConnection.send({ type: 'score', depth, hits, done } satisfies GuestMessage);
      }
      return;
    }
    const self = this.lobby.players.find((player) => player.id === this.selfId);
    if (self) {
      self.depth = depth;
      self.hits = hits;
      self.done = done;
    }
    this.emitScores();
    this.broadcastScores();
  }

  /** Hand the club ledger over so clubmates' boards converge while connected. */
  sendClub(code: string, entries: ClubEntry[]): void {
    if (!code) return;
    const merged = trimClub(mergeLedgers(this.clubCache.get(code) ?? [], entries));
    this.clubCache.set(code, merged);
    if (this.role === 'guest') {
      if (this.hostConnection?.open) {
        this.hostConnection.send({ type: 'club', code, entries } satisfies GuestMessage);
      }
      return;
    }
    for (const connection of this.connections.values()) {
      if (connection.open) connection.send({ type: 'club', code, entries: merged } satisfies HostMessage);
    }
  }

  leave(): void {
    if (this.role === 'guest' && this.hostConnection?.open) {
      this.hostConnection.send({ type: 'leave' } satisfies GuestMessage);
    }
    this.dispose();
    this.role = null;
    this.lobby = null;
    this.clubCache.clear();
    this.emitLobby();
    this.status('idle', 'READY');
  }

  isLive(): boolean {
    return this.role !== null && this.lobby !== null;
  }

  /* ---------------- internals ---------------- */

  private openPeer(id?: string): Promise<Peer> {
    return new Promise((resolve, reject) => {
      const peer = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        peer.destroy();
        reject(new Error('PARTY SERVICE TIMED OUT'));
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
        reject(new Error(error.message || 'PARTY SERVICE UNAVAILABLE'));
      });
    });
  }

  private accept(connection: DataConnection): void {
    connection.on('open', () => {
      this.connections.set(connection.peer, connection);
      this.sendLobby(connection);
      this.sendScoresTo(connection);
      for (const [code, entries] of this.clubCache) {
        connection.send({ type: 'club', code, entries } satisfies HostMessage);
      }
    });
    connection.on('data', (data) => this.receiveGuestMessage(connection, data));
    connection.on('close', () => {
      this.connections.delete(connection.peer);
      const player = this.playerByPeer.get(connection.peer);
      if (player && this.lobby) {
        this.playerByPeer.delete(connection.peer);
        this.lobby.players = this.lobby.players.filter((entry) => entry.id !== player.id);
        this.emitLobby();
        this.emitScores();
        this.broadcastScores();
      }
    });
  }

  private receiveGuestMessage(connection: DataConnection, data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const message = data as GuestMessage;

    if (message.type === 'join' && message.player?.id) {
      if (!this.lobby) return;
      const existing = this.lobby.players.find((player) => player.id === message.player.id);
      if (!existing) {
        const player: PartyPlayer = {
          id: message.player.id,
          name: (message.player.name || 'DIVER').slice(0, 14),
          depth: 0,
          hits: 0,
          done: false,
        };
        this.lobby.players.push(player);
        this.playerByPeer.set(connection.peer, player);
      }
      this.emitLobby();
      this.broadcastLobby();
      return;
    }

    const player = this.playerByPeer.get(connection.peer);
    if (!player || !this.lobby) return;

    if (message.type === 'score') {
      player.depth = Math.max(0, Math.round(message.depth) || 0);
      player.hits = Math.max(0, Math.round(message.hits) || 0);
      player.done = Boolean(message.done);
      this.emitScores();
      this.broadcastScores();
    } else if (message.type === 'club' && message.code) {
      const merged = trimClub(mergeLedgers(this.clubCache.get(message.code) ?? [], message.entries ?? []));
      this.clubCache.set(message.code, merged);
      this.onClub?.(message.code, merged);
      for (const other of this.connections.values()) {
        if (other.open) other.send({ type: 'club', code: message.code, entries: merged } satisfies HostMessage);
      }
    } else if (message.type === 'leave') {
      this.connections.delete(connection.peer);
      this.playerByPeer.delete(connection.peer);
      connection.close();
      this.lobby.players = this.lobby.players.filter((entry) => entry.id !== player.id);
      this.emitLobby();
      this.emitScores();
    }
  }

  private receiveHostMessage(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const message = data as HostMessage;
    if (message.type === 'lobby' && message.lobby) {
      this.lobby = message.lobby;
      this.emitLobby();
      this.status('live', 'IN THE PARTY');
    } else if (message.type === 'start' && message.round) {
      this.onStart?.(message.round);
    } else if (message.type === 'scores' && message.players) {
      this.onScores?.(message.players);
    } else if (message.type === 'club' && message.code) {
      this.onClub?.(message.code, message.entries ?? []);
    } else if (message.type === 'error') {
      this.status('error', message.message);
    }
  }

  private handlePeerError(error: { type?: string; message?: string }): void {
    if (error.type === 'peer-unavailable') {
      this.status('error', 'PARTY NOT FOUND — CHECK THE SIX DIGITS');
      this.dispose();
      return;
    }
    if (error.type === 'network' || error.type === 'server-error' || error.type === 'socket-error') {
      this.status('error', 'PARTY SERVICE UNREACHABLE — TRY AGAIN');
      this.dispose();
      return;
    }
    if (error.type === 'unavailable-id') {
      this.status('error', 'THAT CODE IS TAKEN — HOST AGAIN');
    }
  }

  private sendLobby(connection: DataConnection): void {
    if (!this.lobby || !connection.open) return;
    connection.send({ type: 'lobby', lobby: this.lobby } satisfies HostMessage);
  }

  private broadcastLobby(): void {
    for (const connection of this.connections.values()) this.sendLobby(connection);
    this.emitLobby();
  }

  private sendScoresTo(connection: DataConnection): void {
    if (!this.lobby || !connection.open) return;
    connection.send({ type: 'scores', players: this.lobby.players } satisfies HostMessage);
  }

  private broadcastScores(): void {
    for (const connection of this.connections.values()) this.sendScoresTo(connection);
  }

  private emitLobby(): void {
    this.onLobby?.(this.lobby);
  }

  private emitScores(): void {
    if (this.lobby) this.onScores?.([...this.lobby.players]);
  }

  private status(status: PartyStatus, message: string): void {
    this.onStatus?.(status, message);
  }

  private dispose(): void {
    this.disposed = true;
    for (const connection of this.connections.values()) connection.close();
    this.connections.clear();
    this.playerByPeer.clear();
    this.hostConnection?.close();
    this.hostConnection = null;
    this.peer?.destroy();
    this.peer = null;
  }
}

/** Union of two club ledgers, keyed by diver + moment + depth. */
export function mergeLedgers(base: ClubEntry[], incoming: ClubEntry[]): ClubEntry[] {
  const seen = new Set(base.map(entryKey));
  const merged = [...base];
  for (const entry of incoming) {
    if (!entry || !entry.id || !entry.name) continue;
    const key = entryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      id: String(entry.id).slice(0, 40),
      name: String(entry.name).slice(0, 14),
      depth: Math.max(0, Math.round(Number(entry.depth) || 0)),
      hits: Math.max(0, Math.round(Number(entry.hits) || 0)),
      mode: String(entry.mode || 'run').slice(0, 16),
      date: String(entry.date || '').slice(0, 24),
    });
  }
  merged.sort((a, b) => (a.date < b.date ? 1 : -1));
  return merged.slice(0, MAX_CLUB_ENTRIES);
}

function entryKey(entry: ClubEntry): string {
  return `${entry.id}|${entry.date}|${entry.depth}|${entry.mode}`;
}
