import type { Vector3 } from 'three';

export type LonLat = [number, number];

/** A circuit exactly as it arrives from circuits.geojson. */
export interface TrackFeature {
  id: string;
  name: string;
  location: string;
  opened: number;
  /** Real-world circuit length in metres. */
  length: number;
  coordinates: LonLat[];
}

export interface TrackCatalog {
  features: TrackFeature[];
  source: string;
  /** True when the GeoJSON could not be fetched and the embedded set is used. */
  fallback: boolean;
}

export interface BankingProfile {
  /** Lap fraction where the banking peaks. */
  at: number;
  /** Peak banking in degrees. */
  deg: number;
  /** Gaussian half-width in lap fraction. */
  spread: number;
  /** Snap the peak onto the nearest detected corner inside this u-window. */
  snapWindow?: number;
}

export interface ElevationPoint {
  at: number;
  height: number;
}

export interface TrackMeta {
  width?: number;
  night?: boolean;
  overpass?: boolean;
  elevation?: ElevationPoint[];
  banking?: BankingProfile[];
  /** DRS zones as lap fractions; omit for automatic straight detection. */
  drs?: [number, number][];
  pitEntry?: number;
  pitExit?: number;
  pitBox?: number;
}

export interface TrackSample {
  index: number;
  /** Centerline point on the racing surface. */
  pos: Vector3;
  /** Unit tangent, including elevation pitch. */
  tangent: Vector3;
  /** Banked lateral axis pointing to the car's right. */
  right: Vector3;
  /** Surface normal after banking. */
  up: Vector3;
  /** Lap fraction 0..1. */
  u: number;
  /** Asphalt width in metres. */
  width: number;
  /** Absolute banking, degrees. */
  bankDeg: number;
  /** +1 = left-hand corner, -1 = right-hand, 0 = straight. */
  turnSign: number;
  curvature: number;
  radius: number;
  sector: 1 | 2 | 3;
  drs: boolean;
  kerb: boolean;
}

export interface Corner {
  index: number;
  u: number;
  radius: number;
  direction: 1 | -1;
}

export interface DRSZone {
  start: number;
  end: number;
  /** Detection point, slightly before the zone. */
  detection: number;
}

export interface Overpass {
  u: number;
  index: number;
  height: number;
  point: Vector3;
}

export interface RacingLine {
  /** Lateral offset from centerline, metres (positive = right). */
  offsets: Float32Array;
  /** Target speed through each sample, m/s. */
  targetSpeed: Float32Array;
  /** 0..1 braking demand for line colouring. */
  braking: Float32Array;
}

export interface TrackData {
  id: string;
  name: string;
  location: string;
  opened: number;
  /** Official length, metres. */
  length: number;
  width: number;
  night: boolean;
  samples: TrackSample[];
  corners: Corner[];
  drsZones: DRSZone[];
  pitLane: Vector3[];
  pitEntryU: number;
  pitExitU: number;
  pitBoxU: number;
  overpass: Overpass | null;
  center: Vector3;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  sectorMarks: [number, number];
  racingLine: RacingLine;
}
