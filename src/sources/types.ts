export type SourceId = 'hdb' | 'lta';

export interface Carpark {
  /** Globally unique: `${sourceId}:${code}` */
  id: string;
  sourceId: SourceId;
  code: string;
  name: string;
  address: string;
  agency: string;
  lat: number;
  lng: number;
  type?: string;
  parkingSystem?: string;
  shortTermParking?: string;
  freeParking?: string;
  nightParking?: boolean;
  decks?: number;
  gantryHeight?: number;
  basement?: boolean;
  /** Published rate text, for sources without structured rate rules. */
  rateText?: string[];
}

/** C = cars, Y = motorcycles, H = heavy vehicles. */
export interface LotCount {
  lotType: string;
  available: number;
  total: number | null;
}

/** Only filled when a source really publishes per-level counts. */
export interface LevelCount {
  level: string;
  available: number;
  total: number | null;
}

export interface CarparkReading {
  /** Epoch ms of the car park's own last update. */
  updated: number;
  lots: LotCount[];
  levels?: LevelCount[];
}

export interface Snapshot {
  /** Epoch ms the snapshot describes. */
  timestamp: number;
  byCode: Map<string, CarparkReading>;
}

export type AvailabilityStatus = 'live' | 'predicted' | 'none';

export interface Availability {
  status: AvailabilityStatus;
  /** Car lots available (live) or expected (predicted). */
  available: number | null;
  total: number | null;
  lots: LotCount[];
  levels?: LevelCount[];
  /** Predicted only: lowest and highest value seen in the samples. */
  range?: [number, number];
  samples?: number;
  updated?: number;
}

export interface QuoteLine {
  label: string;
  minutes: number;
  amount: number;
}

export interface Quote {
  /** null when a total cannot be worked out. */
  total: number | null;
  rateLabel: string;
  lines: QuoteLine[];
  notes: string[];
}

export interface CarparkSource {
  id: SourceId;
  label: string;
  loadCarparks(): Promise<Carpark[]>;
  getLive(): Promise<Snapshot>;
  /** Past snapshots comparable to `at` (same weekday and time of day). */
  getHistory(at: Date, now: Date): Promise<Snapshot[]>;
  quote(carpark: Carpark, arrive: Date, depart: Date): Quote;
}
