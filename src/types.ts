export interface BusStop {
  id: string; // e.g. "s19"
  code: string; // Code shown on the pole; the operator's QR token when it has one
  /**
   * The operator numbers each stop once per line and direction, so one physical pole
   * carries several of its ids. All of them are kept here so any QR link resolves.
   */
  officialIds?: number[];
  officialToken?: string | null;
  name: string; // e.g. "Rda. Muralla 56 (Sindicatos)"
  /**
   * Other labels the operator prints for this same pole — a Galician and a Spanish
   * spelling, or a description from the opposite side of the road. Kept so that
   * merging two listings into one pole does not make a published name unfindable.
   */
  aliases?: string[];
  address?: string;
  lat: number;
  lng: number;
  lines: string[]; // List of line IDs passing by, e.g. ["1.1", "1.2", "3.1", "4.1"]
  zone?: string;
  /**
   * Surveyed amenities from OpenStreetMap. `null` means nobody has recorded it, which
   * the UI shows as nothing rather than as a "no".
   */
  shelter: boolean | null; // Marquesina
  bench: boolean | null;
  hasScreen: boolean; // Panel electrónico do operador
}

export interface BusLine {
  id: string; // "1.1", "1.2", "2", "3.1", "4.1", "5.1", etc.
  number: string; // Display number
  name: string; // e.g. "Campus USC - Fingoi - O Ceao"
  color: string; // Hex color for line badge & map route
  textColor: string;
  category: 'urbano' | 'hospital' | 'periferia' | 'rural' | 'especial';
  days: string; // e.g. "Luns a Venres" | "Todos os días" | "Laborables e Sábados"
  frequency: string; // e.g. "Cada 30 min" | "Cada 60 min"
  firstDeparture: string; // "07:00"
  lastDeparture: string; // "22:30"
  description: string;
  /**
   * Published timetable, one pattern per kind of day the operator distinguishes.
   * `headwayMinutes` is set when the operator gives a cadence and prints only the
   * first and last departure instead of every one.
   */
  services: {
    days: ('laborable' | 'sabado' | 'domingo')[];
    headwayMinutes: number | null;
    rows: { timingPoint: string; times: string[] }[];
  }[];
  directions: {
    id: 'ida' | 'volta' | 'circular';
    name: string; // e.g. "Sentido O Ceao"
    origin: string;
    destination: string;
    stops: string[]; // Stop IDs in sequence
    pathCoordinates: [number, number][]; // Lat, Lng polyline following the real streets
    /** Index into pathCoordinates for each stop, so the path can be sliced per leg. */
    stopPathIndex: number[];
    /**
     * Where the drawn line comes from. 'osm' is the itinerary surveyed in OpenStreetMap;
     * 'osrm' is a car's route between stops, which detours where a bus does not.
     */
    geometrySource?: 'osm' | 'osrm' | 'straight';
    /** Real road distance in metres between consecutive stops. */
    legMeters: number[];
    /** Free-flow driving seconds between consecutive stops. */
    legSeconds: number[];
    totalMeters: number;
  }[];
}

/** One scheduled passing at one stop, with where its time came from. */
export interface StopArrival {
  lineId: string;
  lineNumber: string;
  lineName: string;
  lineColor: string;
  destination: string;
  etaMinutes: number; // minutes until arrival (0 = Llegando / Chegando)
  etaTime: string; // "14:22"
  /**
   * 'published' = the operator prints this time for this stop.
   * 'estimated'  = derived from the departure plus measured road time.
   * Nothing here is ever a live position: this app receives none. The operator does
   * publish its own minutes per stop, which the stop board shows separately and
   * attributes to them rather than folding into these.
   */
  precision: 'published' | 'estimated';
  /**
   * Minutes since this departure was due, when it is past due and has not been dropped.
   *
   * Not a delay: this app has no idea where the bus is, and the timetable cannot tell a
   * late bus from one that has already gone. It is the plain fact that the printed time
   * has passed. The board says so and leaves the reader to look up the street, which is
   * more use than removing the row and quoting the next service an hour later.
   */
  overdueMinutes?: number;
}

// Deliberately absent from an arrival: vehicleId, delayMinutes, occupancy and
// distanceMeters. This network publishes no vehicle feed, so every one of those would
// have to be invented, and an invented fleet number or delay is exactly the kind of
// detail a rider has no way to check.


/**
 * Where a run should be right now if it is keeping to its timetable.
 *
 * Called `LiveBus` until it was renamed: nothing about it is live. The position is
 * interpolated along the surveyed route from a published departure, so a bus stuck in
 * traffic is still drawn on schedule. The old name was the last place in the codebase
 * still claiming a vehicle feed that does not exist.
 */
export interface ScheduledBus {
  id: string;
  lineId: string;
  lineNumber: string;
  lineColor: string;
  direction: 'ida' | 'volta' | 'circular';
  destination: string;
  currentLat: number;
  currentLng: number;
  bearing: number; // Degrees 0-360
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
  /**
   * Who said it. The operator speaks about its own service; the Concello's press feed
   * occasionally mentions the buses and is a different kind of claim, so a reader gets
   * to know which they are looking at. Absent on the notices written into this app,
   * which carry their own provenance line.
   */
  source?: 'operator' | 'concello';
  /** Where to read the whole thing, when the source publishes one. */
  link?: string;
}

export interface TripFare {
  busLegs: number;
  /** Whether every transfer falls inside the free-transfer window. */
  transfersFree: boolean;
  /** Minutes between boarding the first bus and the last one. */
  transferSpanMinutes: number;
  singleTicketEuros: number;
  citizenCardEuros: number;
}

export interface RoutePlanResult {
  durationMinutes: number;
  fare?: TripFare;
  departureTime: string;
  /**
   * The latest you can leave the origin and still catch it. Differs from
   * `departureTime` when the first bus is a while away: that wait is spent at home.
   */
  leaveAt: string;
  arrivalTime: string;
  walkToStartMeters: number;
  walkFromEndMeters: number;
  totalWaitMinutes: number;
  isServiceActive: boolean;
  serviceNotice?: string;
  segments: {
    type: 'walk' | 'wait' | 'bus';
    line?: BusLine;
    /** Which direction of `line` this leg rides, so the map can slice its geometry. */
    directionId?: string;
    /**
     * Where the boarding time came from. 'published' is printed by the operator for
     * that stop; 'estimated' is derived from the departure plus measured road time.
     */
    precision?: 'published' | 'estimated';
    fromStop?: BusStop;
    toStop?: BusStop;
    walkMeters?: number;
    durationMinutes: number;
    instruction: string;
    stopsCount?: number;
    departureTime?: string;
    arrivalTime?: string;
    delayMinutes?: number;
  }[];
}
