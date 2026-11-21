import type Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import type { ChampionshipId } from './data';
import type { DifficultyId } from './engine';

export interface PartyPlayer {
  id: string;
  name: string;
  score: number;
  solved: number;
  done: boolean;
}

export interface PartyLobby {
  code: string;
  hostId: string;
  players: PartyPlayer[];
}

/** The host's exact eight circuits, so every browser starts the same run. */
export interface PartyGame {
  championship: ChampionshipId;
  difficulty: DifficultyId;
  rounds: string[];
}

export type PartyStatus = 'idle' | 'connecting' | 'live' | 'error' | 'closed';

type GuestMessage =
  | { type: 'join'; player: { id: string; name: string } }
  | { type: 'score'; score: number; solved: number; done: boolean }
  | { type: 'leave' };

type HostMessage =
  | { type: 'lobby'; lobby: PartyLobby }
  | { type: 'game'; game: PartyGame }
  | { type: 'scores'; players: PartyPlayer[] }
  | { type: 'error'; message: string };

type PeerConstructor = typeof import('peerjs').default;

let peerConstructor: Promise<PeerConstructor> | null = null;

/** PeerJS is only needed for parties, so it stays out of the first load. */
function loadPeer(): Promise<PeerConstructor> {
  if (!peerConstructor) peerConstructor = import('peerjs').then((module) => module.default);
  return peerConstructor;
}

function randomCode(): string {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(100000 + (values[0] % 900000));
}

/**
 * A tiny peer-to-peer party: the host owns the lobby and the circuit list,
 * every browser plays its own run, and only scores cross the wire.
 */
export class PartyClient {
  onLobby: ((lobby: PartyLobby | null) => void) | null = null;
  onStatus: ((status: PartyStatus, message: string) => void) | null = null;
  onGame: ((game: PartyGame) => void) | null = null;
  onScores: ((players: PartyPlayer[]) => void) | null = null;

  role: 'host' | 'guest' | null = null;
  selfId = '';
  lobby: PartyLobby | null = null;

  private peer: Peer | null = null;
  private connections = new Map<string, DataConnection>();
  private playerByPeer = new Map<string, PartyPlayer>();
  private hostConnection: DataConnection | null = null;
  private disposed = false;

  async host(self: { id: string; name: string }): Promise<void> {
    this.dispose();
    this.disposed = false;
    this.role = 'host';
    this.selfId = self.id;
    this.status('connecting', 'OPENING PARTY…');

    let lastError = 'Could not reserve a party code.';
    for (let attempt = 0; attempt < 7; attempt++) {
      const code = randomCode();
      try {
        const peer = await this.openPeer(`trace-${code}`);
        if (this.disposed) {
          peer.destroy();
          return;
        }
        this.peer = peer;
        this.lobby = {
          code,
          hostId: self.id,
          players: [{ id: self.id, name: self.name, score: 0, solved: 0, done: false }],
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
    this.status('error', lastError.toUpperCase());
  }

  async join(code: string, self: { id: string; name: string }): Promise<void> {
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
      peer.on('error', (error) => this.handlePeerError(error));

      const connection = peer.connect(`trace-${code}`, { reliable: true });
      this.hostConnection = connection;
      const timeout = window.setTimeout(() => {
        if (connection.open) return;
        this.status('error', 'PARTY NOT FOUND — CHECK THE SIX DIGITS');
        this.dispose();
      }, 12000);

      connection.on('open', () => {
        window.clearTimeout(timeout);
        connection.send({ type: 'join', player: { id: self.id, name: self.name } } satisfies GuestMessage);
        this.status('live', 'IN THE PARTY · WAITING FOR THE HOST');
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
      this.status('error', error instanceof Error ? error.message.toUpperCase() : 'COULD NOT REACH THE PARTY SERVICE');
      this.dispose();
    }
  }

  /** Host only: send the exact circuit list every guest must play. */
  launch(game: PartyGame): void {
    if (this.role !== 'host' || !this.lobby) return;
    for (const player of this.lobby.players) {
      player.score = 0;
      player.solved = 0;
      player.done = false;
    }
    for (const connection of this.connections.values()) {
      if (connection.open) connection.send({ type: 'game', game } satisfies HostMessage);
    }
    this.emitLobby();
    this.emitScores();
  }

  pushScore(score: number, solved: number, done: boolean): void {
    if (!this.lobby) return;
    if (this.role === 'guest') {
      if (this.hostConnection?.open) {
        this.hostConnection.send({ type: 'score', score, solved, done } satisfies GuestMessage);
      }
      return;
    }
    const self = this.lobby.players.find((player) => player.id === this.selfId);
    if (self) {
      self.score = Math.max(0, Math.round(score) || 0);
      self.solved = Math.max(0, Math.round(solved) || 0);
      self.done = Boolean(done);
    }
    this.emitScores();
    this.broadcastScores();
  }

  leave(): void {
    if (this.role === 'guest' && this.hostConnection?.open) {
      this.hostConnection.send({ type: 'leave' } satisfies GuestMessage);
    }
    this.dispose();
    this.role = null;
    this.lobby = null;
    this.emitLobby();
    this.status('idle', 'NOT CONNECTED');
  }

  isLive(): boolean {
    return this.role !== null && this.lobby !== null;
  }

  /* ---------------- internals ---------------- */

  private async openPeer(id?: string): Promise<Peer> {
    const PeerCtor = await loadPeer();
    return new Promise((resolve, reject) => {
      // Public STUN only: enough for most home and mobile NATs. No TURN relay.
      const options = {
        debug: 0 as const,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun.cloudflare.com:3478' },
          ],
        },
      };
      const peer = id ? new PeerCtor(id, options) : new PeerCtor(options);
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        peer.destroy();
        reject(new Error('party service timed out'));
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
        reject(new Error(error.message || 'party service unavailable'));
      });
    });
  }

  private accept(connection: DataConnection): void {
    connection.on('open', () => {
      this.connections.set(connection.peer, connection);
      this.sendLobby(connection);
      this.sendScoresTo(connection);
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
          name: (message.player.name || 'DRIVER').slice(0, 14),
          score: 0,
          solved: 0,
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
      player.score = Math.max(0, Math.round(message.score) || 0);
      player.solved = Math.max(0, Math.round(message.solved) || 0);
      player.done = Boolean(message.done);
      this.emitScores();
      this.broadcastScores();
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
    } else if (message.type === 'game' && message.game) {
      this.onGame?.(message.game);
    } else if (message.type === 'scores' && message.players) {
      if (this.lobby) this.lobby.players = message.players;
      this.onScores?.(message.players);
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
