/**
 * Where a time came from. Nothing in this app is a measurement: 'published' is printed by
 * the operator for that stop, 'estimated' is derived from a departure plus measured road
 * time. Every surface says which — an unlabelled time is a bug.
 */
export type Precision = 'published' | 'estimated';

export type DayKind = 'laborable' | 'sabado' | 'domingo';
export type DirectionId = 'ida' | 'volta' | 'circular';

export interface BusStop {
  id: string; // e.g. "s19"
  code: string; // the code on the pole; the operator's QR token when it has one
  /** The operator numbers a pole once per line and direction; all of them, so any QR link resolves. */
  officialIds?: number[];
  officialToken?: string | null;
  name: string; // e.g. "Rda. Muralla 56 (Sindicatos)"
  /** Other labels the operator prints for this pole, so a merged listing stays findable. */
  aliases?: string[];
  lat: number;
  lng: number;
  /** Set only when the coordinates are OpenStreetMap's, not the operator's (see tools/buildDataset.ts). */
  positionSource?: 'osm';
  lines: string[]; // line ids passing by, e.g. ["1.1", "1.2", "3.1"]
  zone?: string;
  /** Surveyed in OpenStreetMap. `null` means nobody recorded it, shown as nothing rather than "no". */
  shelter: boolean | null;
  bench: boolean | null;
}

export interface BusDirection {
  id: DirectionId;
  /** `Sentido ${destination}`, in one language — do NOT render; use `directionLabel()`. */
  name: string;
  origin: string;
  destination: string;
  stops: string[]; // stop ids in sequence
  pathCoordinates: [number, number][]; // [lat, lng] polyline along the real streets
  /** Index into pathCoordinates for each stop, so the path can be sliced per leg. */
  stopPathIndex: number[];
  /** 'osm' is the surveyed itinerary; 'osrm' a car's route between stops, which detours where a bus does not. */
  geometrySource?: 'osm' | 'osrm' | 'straight';
  /** Real road metres and free-flow seconds between consecutive stops. */
  legMeters: number[];
  legSeconds: number[];
  totalMeters: number;
}

export interface BusService {
  days: DayKind[];
  /** Set when the operator gives a cadence and prints only the first and last departure. */
  headwayMinutes: number | null;
  rows: { timingPoint: string; times: string[] }[];
}

export interface BusLine {
  id: string; // "1.1", "2", "5ES"…
  number: string;
  name: string; // e.g. "Campus USC - Fingoi - O Ceao"
  color: string;
  textColor: string;
  category: 'urbano' | 'hospital' | 'periferia' | 'rural' | 'especial';
  /**
   * Prose in the operator's Spanish, written once by the generator — do NOT render.
   * `daysLabel()` / `frequencyLabel()` say the same facts in the reader's language;
   * `description` exists only so the search matches a line by what it says.
   */
  days: string;
  frequency: string;
  description: string;
  firstDeparture: string; // "07:00"
  lastDeparture: string; // "22:30"
  services: BusService[];
  directions: BusDirection[];
}

/** One scheduled passing at one stop. No vehicleId, delay or occupancy: this network publishes none. */
export interface StopArrival {
  lineId: string;
  lineNumber: string;
  lineName: string;
  lineColor: string;
  destination: string;
  etaMinutes: number; // 0 = arriving now
  etaTime: string; // "14:22"
  precision: Precision;
  /**
   * Minutes since the printed time went by, while the row is kept. Not a delay — the
   * timetable cannot tell a late bus from one already gone — just the fact that it passed.
   */
  overdueMinutes?: number;
}

/**
 * Where a run should be right now if it is keeping to its timetable: interpolated along
 * the surveyed route from a published departure. Nothing about it is live.
 */
export interface ScheduledBus {
  id: string;
  lineId: string;
  lineNumber: string;
  lineColor: string;
  direction: DirectionId;
  destination: string;
  currentLat: number;
  currentLng: number;
  bearing: number; // degrees 0-360
  nextStopId: string;
  nextStopName: string;
  /** Expected crowding from the time of day; there is no occupancy feed. */
  occupancy: 'low' | 'medium' | 'high';
}

export interface ServiceAlert {
  id: string;
  title: string;
  severity: 'info' | 'warning' | 'urgent';
  linesAffected: string[];
  date: string;
  description: string;
  active: boolean;
  /** The operator speaks about its own service; the Concello's press feed is a different kind of claim. */
  source?: 'operator' | 'concello';
  link?: string;
}

export interface TripFare {
  busLegs: number;
  /** Whether every transfer falls inside the free-transfer window. */
  transfersFree: boolean;
  transferSpanMinutes: number;
  singleTicketEuros: number;
  citizenCardEuros: number;
}

export interface TripSegment {
  type: 'walk' | 'wait' | 'bus';
  line?: BusLine;
  /** Which direction of `line` this leg rides, so the map can slice its geometry. */
  directionId?: string;
  precision?: Precision;
  arrivalPrecision?: Precision;
  fromStop?: BusStop;
  toStop?: BusStop;
  walkMeters?: number;
  durationMinutes: number;
  instruction: string;
  stopsCount?: number;
  departureTime?: string;
  arrivalTime?: string;
}

export interface RoutePlanResult {
  durationMinutes: number;
  fare?: TripFare;
  departureTime: string;
  arrivalTime: string;
  walkToStartMeters: number;
  walkFromEndMeters: number;
  totalWaitMinutes: number;
  /**
   * How much later than asked this plan sets off because the bus was not there yet. It is
   * the only cushion available when the walk turns out longer than estimated.
   */
  slackMinutes: number;
  isServiceActive: boolean;
  serviceNotice?: string;
  segments: TripSegment[];
}
