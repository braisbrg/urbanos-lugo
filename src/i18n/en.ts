import type { Dict } from './index';
/**
 * English.
 *
 * Written for someone who does not live here: the Camino de Santiago passes through
 * Lugo, so a good share of English readers are walking through for two days and have
 * never seen the network. That shapes the wording — "stop code on the pole" rather than
 * an insider's "QR", and "no live tracking" said plainly instead of assumed.
 *
 * Stop, line and zone names stay in Galician throughout. They are addresses: a visitor
 * has to match what this screen says against what is printed on the pole and spoken by
 * the driver, and a translated place name would break exactly that.
 */
export const en: Dict = {
  nav: {
    stops: 'Stops',
    lines: 'Lines',
    map: 'Map',
    plan: 'Route',
    main: 'Main navigation',
    appName: 'Urbanos de Lugo',
    skipToContent: 'Skip to content',
  },

  menu: {
    alerts: 'Service notices',
    fares: 'Fares and information',
    language: 'Language',
    theme: 'Appearance',
    themeAuto: 'Automatic',
    themeAutoShort: 'Auto',
    themeLight: 'Light',
    themeDark: 'Dark',
    close: 'Close menu',
    open: 'Menu',
    sourceTimetables: 'Official timetables from buslugo.com',
    sourceGeometry: 'Routes surveyed in OpenStreetMap',
    sourceNoGps: 'Times computed, not measured',
    sourceShort: "Official timetables from buslugo.com. This app's times are computed.",
    unofficial: 'Unofficial project: not made or endorsed by AULUSA / Monbus or Lugo city council.',
    privacy: 'Your location stays on this phone, unless you ask to see the walking path.',
    sourceCode: 'Code, licences and privacy',
  },

  search: {
    placeholder: 'Stop, line or street…',
    stops: 'Stops',
    lines: 'Lines',
    qr: 'Scan the QR code on the stop pole',
    clear: 'Clear',
    none: 'Nothing matches that search.',
  },

  stopHome: {
    savedLines: 'Your lines',
    savedLinesAt: (stop: string) => `next at ${stop}`,
    savedLinesNoStop: 'save a stop to see a time',
    saved: 'Saved stops',
    recent: 'Recently viewed',
    clearRecent: 'Clear',
    near: 'Near me',
    locate: 'Find stops near me',
    youAreHere: 'You are here',
    locating: 'Locating…',
    none: 'no departures in the next hour',
    emptyTitle: 'You have not saved any stops yet.',
    emptyBody:
      'Search for your stop above, scan the code on the pole, or tap it on the map. Then press the star and it will appear here.',
    orSearchAbove: 'or search above',
    scan: 'Scan the code on the pole',
    denied: 'Could not get your location. Check your browser permissions.',
    unavailable: 'Your browser does not support geolocation.',
    outOfArea: 'No stop within 2 km of where you are. This site only covers Lugo’s urban network.',
    walk: (minutes: number) => `${minutes} min walk`,
  },

  service: {
    weekday: 'Monday to Friday (weekdays)',
    weekend: 'Weekends and public holidays',
    everyday: 'Every day',
    checkTimetable: 'See timetable',
    every: (minutes: number) => `Every ${minutes} min`,
    everyRange: (from: number, to: number) => `Every ${from}–${to} min`,
    towards: (place: string) => `Towards ${place}`,
  },

  fares: {
    priceNotPublished: 'Price not published',
    alertsTitle: 'Official service notices for Lugo',
    alertsSubtitle:
      'Checked automatically every hour against the operator’s own portal, buslugo.com',
    faresTitle: 'Fares and the Tarxeta Cidadá',
    faresSubtitle: 'Official prices and travel passes in Lugo (Monbus)',
    notAffiliated: 'Unofficial site, not connected to Monbus or Lugo city council.',
    faqTitle: 'Frequently asked questions',
    contactTitle: 'Contact and passenger information',
    refreshBtn: 'Check for notices',
    refreshing: 'Syncing...',
    cooldownText: (seconds: number) => `Please wait (${seconds}s)`,
    unknownStatusTitle: 'Could not check for notices',
    staleStatusTitle: 'The last check is not recent',
    staleStatusDesc:
      'This is what the operator said on the date below, not what it says now. Something may have been announced since. Check buslugo.com if the trip matters.',
    unknownStatusDesc: 'We could not read the operator page. That does not mean everything is fine — it means we do not know. Check buslugo.com if this trip matters.',
    normalStatusTitle: 'The network is running normally',
    normalStatusDesc:
      'No incidents, roadworks or temporary diversions have been announced by AULUSA / Monbus or by the Concello de Lugo.',
    nightWindowTitle: 'Night hours (daytime service finished)',
    nightWindowBody:
      'Most Lugo city lines finish their last run between 22:00 and 22:30. The first morning departures start again from 07:00.',
    allLines: 'All lines',
    checkOnBuslugo: 'Check on buslugo.com',
    savedCopy: 'saved copy',
    structuralTitle: 'Standing notices and city roadworks',
    structuralSource: 'Written into this project from municipal sources, not checked automatically the way the alerts above are. They can go out of date.',
    newsTitle: 'Council news about the city',
    newsSubtitle:
      'Municipal press releases about roadworks and traffic. Not service notices: they may reach the buses, or they may not.',
    sourceOperator: 'Notice from the operator',
    sourceConcello: 'Press release from the council',
    readInFull: 'Read the whole thing',
    reviewedOn: (d: string) => `Reviewed on ${d}`,
    structuralStale: (months: number) =>
      `These notices have not been reviewed for ${months} months. Check the source before relying on them.`,
    phones: 'Information lines',
    portals: 'Reference websites',
    lastCheck: 'Last official check:',
    snapshotNotice: (at: string) =>
      `This was not just checked: it is the copy a scheduled job committed on ${at}. This build has no server to ask the operator with, so a notice may no longer be current. Check buslugo.com if it affects you.`,
    source: 'Official source:',
  },

  planner: {
    title: 'Route planner',
    subtitle: 'Work out a trip from any street, place or stop in Lugo',
    origin: 'From (street, place or stop)',
    destination: 'To (street, place or stop)',
    useMyLocation: 'Use my GPS location',
    locating: 'Getting your location…',
    calculate: 'Plan the trip',
    swap: 'Swap origin and destination',
    departureLabel: 'Depart',
    arrivalLabel: 'Arrive',
    board: 'Get on at',
    alight: 'Get off at',
    ride: (stops: number, minutes: number) =>
      `${stops} ${stops === 1 ? 'stop' : 'stops'} · ${minutes} min`,
    viaStops: 'Stops along the way',
    editTrip: 'Change origin or destination',
    quickDestinations: 'Common destinations:',
    noRouteFound: 'No good combination found. Try another street or a nearby stop.',
    transferFreeNotice:
      'Remember that changing bus within 75 minutes is free with the Tarxeta Cidadá or the TPG card.',
    placeholderOrig: 'Type a street, square or stop...',
    placeholderDest: 'Type your destination in Lugo...',
    lineWithStops: (line: string, stops: number) => `Line ${line} · ${stops} ${stops === 1 ? 'stop' : 'stops'}`,
    routeMap: 'Trip map',
    showMap: 'Show map',
    hideMap: 'Hide map',
    timeModes: { now: 'Now', depart: 'Leave at', arrive: 'Arrive by' },
    departAtLabel: 'Leave at',
    arriveByLabel: 'Be there before',
    noArriveOption: 'No departure gets you there in time. Try a later hour.',
    fareTitle: 'Cost of the trip',
    fareCard: 'With the Tarxeta Cidadá',
    fareSingle: 'Single ticket',
    fareTransferFree: 'Transfer included (within 75 min)',
    fareTransferPaid: 'The transfer is over 75 min apart: you pay two fares',
    optionsTitle: (shown: number, total: number) => `Trip options (${shown} of ${total})`,
    scheduledWait: 'Scheduled wait at the stop',
    walkOnly: 'Walk the whole way',
    walkMetres: (metres: number) => `Walk ~${metres} m`,
    walkConnection: 'Walking connection',
    measuredWalkTitle: 'On foot, measured',
    tripInfoTitle: 'Details',
    timeProvenanceMeasured:
      'The walking legs are measured by the OpenStreetMap pedestrian router, not estimated. Bus times still come from the official timetable; those marked ~ are worked out from the driving time measured along the road.',
    showWalkingPath: 'Show the walking route',
    hideWalkingPath: 'Hide the walking route',
    walkingPathHint:
      'Traces the walking legs along the real pavements. Needs a connection: it queries the OpenStreetMap pedestrian router.',
    noWaitNoFare: 'no waiting, no fare',
    waitShort: (minutes: number) => `${minutes} min wait`,
    serviceNoticeTitle: 'Service hours notice',
    includesWait: (minutes: number) =>
      `Includes ${minutes} min waiting at stops and transfers, from the published times.`,
    transfersShort: (count: number) => (count === 1 ? '1 change' : `${count} changes`),
    timeProvenanceTitle: 'Where these times come from',
    timeProvenance:
      'Departure times come from the official timetable; those marked ~ are the departure plus the driving time measured along the road. This app receives no vehicle positions, so get to the stop a few minutes early.',
  },

  faresContent: {
    faqs: [
      {
        q: 'How does the free transfer work?',
        a: 'If you pay with the Tarxeta Cidadá issued by Lugo city council, or with the Galician TPG card, you have 75 minutes from the first tap to change to any other line at no extra cost.',
      },
      {
        q: 'Can I pay by bank card or phone?',
        a: 'Yes. Every city bus takes contactless bank cards (Visa / Mastercard / Google Pay / Apple Pay) for a single ticket bought on board.',
      },
      {
        q: 'Where can I top up the Tarxeta Cidadá?',
        a: 'At participating ABANCA cash machines, at the city council offices, and in cash on board the bus.',
      },
    ],
    notices: [
      {
        title: 'Works at the new Lugo intermodal station (Montero Ríos)',
        description:
          'Because of the works on the future intermodal station at Montero Ríos and Conde de Fontao, follow the signed pedestrian route to the stops around the railway station.',
      },
      {
        title: 'Old town terminus (lines 7, 8, 9 and 12)',
        description:
          'All four lines end at Bolaño Ribadeneira, inside the walls. They come in through Porta do Bispo Odoario, beside Hospital Quirónsalud, and leave through Porta de San Fernando — always that way round, all four. Between 230 and 385 metres of each route run along streets OpenStreetMap marks pedestrian, without the bus exception they should carry. Seen on 2 September 2026: what is missing is the tag, not the passage.',
      },
      {
        title: '50% discount and the Xente Nova card (under 21)',
        description:
          'The 50% discount on the municipal Tarxeta Cidadá still applies, and travel is free (up to 60 trips a month) for under-21s holding the regional Xente Nova card.',
      },
    ],
  },

  map: {
    mapTitle: 'Network map',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    networkRegion: 'Network map. The routes and stops are also on the lines tab.',
    nearbyRegion: 'Map of the stops near you. The same stops are in the list below.',
    loadingMap: 'Loading the map…',
    subtitle: 'Routes, stops and where the buses should be',
    allLines: 'All',
    onlyLinesHere: 'Only the lines here',
    aroundStopActive: (stop: string, metres: number) =>
      `Only the lines that call at ${stop} and those passing within ${metres} m on foot.`,
    aroundStopClear: 'Show every line again',
    linesHere: 'Lines through here',
    drawRoute: 'Draw this route',
    openLineInfo: 'Open the full line details',
    liveBusesCount: 'buses running',
    centerLugo: 'Centre on Lugo',
    myLocation: 'My location',
    stop: 'Stop with a QR code',
    viewStopDepartures: 'See arrival times',
    nearbyTitle: (metres: number) => `Lines within ${metres} m`,
    nearbyFilter: 'Near me',
    filterHula: 'HULA',
    filterCampus: 'Campus',
    filterCeao: 'O Ceao',
    locating: 'Locating...',
    locationDenied: 'Could not get your location. Check your browser permissions.',
    occupancyLow: 'Low',
    occupancyMedium: 'Medium',
    occupancyHigh: 'High',
    occupancyLabel: 'Expected crowding',
    nextStop: 'Next stop',
    estimatedPosition: 'Position <b>estimated</b> from the timetable, not measured by GPS.',
    stopCode: 'Stop code',
    quickFilters: 'Quick filters',
    layerStops: 'Stops',
    layerBuses: 'Buses',
    layerRoutes: 'Routes',
    documentTitle: 'Urbanos de Lugo | Lines, timetables and stops',
    layers: 'Visible layers',
    linesList: 'Choose a line',
    controls: 'Filters and layers',
    closeControls: 'Close filters and layers',
    closeStop: 'Close this stop',
    expandLines: 'See every line at once',
    collapseLines: 'Show the lines in one row',
    geolocationUnavailable: 'Geolocation is not available.',
    yourPosition: 'Your current position',
    yourPositionAccurate: (metres: number) => `Your position, accurate to ±${metres} m`,
    stopFollowing: 'Stop following me',
    outOfArea: 'No stop near you. This site only covers Lugo’s urban network.',
    stopsCount: (total: number, withQr: number) =>
      `${total} stops, ${withQr} with a QR code`,
  },

  favourites: {
    close: 'Close favourites',
    title: 'Saved favourites',
    codeShort: 'Code',
    subtitle: 'One-tap access to stops and lines',
    tabStops: 'Stops',
    tabLines: 'Lines',
    noFavoriteStops: 'You have not added any stops to your favourites yet.',
    noFavoriteStopsHint: 'Press the star on a stop to save it here.',
    noFavoriteLines: 'You have not added any lines to your favourites yet.',
    noFavoriteLinesHint: 'Press the star at the top of a line to save it here.',
    remove: 'Remove from favourites',
  },

  rules: {
    title: 'On board',
    subtitle:
      "A summary of the operator's rules, in our words. The full text, and the one that counts, is on their page.",
    mustTitle: 'You must',
    must: [
      'Notes above €5 are not accepted.',
      'Pay from the age of 4.',
      'Keep your ticket or card until the end of the trip, in case of an inspection.',
      'Ring for your stop in good time.',
      'Give up your seat to anyone with reduced mobility.',
      'Get off through the centre or rear doors.',
    ],
    mustNotTitle: 'You must not',
    mustNot: [
      "Travel without a ticket, or on a pass that is not yours: a €60 fine.",
      'Smoke on board.',
      'Distract the driver while the bus is moving.',
      'Force the doors, or use the emergency mechanisms without cause.',
      'Dirty or damage the bus, or make unnecessary noise.',
      'Carry dangerous, explosive or foul-smelling substances.',
    ],
    sourceLink: "Read the operator's full rules on buslugo.com",
  },
  qr: {
    close: 'Close the code reader',
    title: 'Look up a stop code',
    subtitle: 'Scan the code in the shelter, or type the code printed on the pole',
    placeholder: 'For example: TPlG, 19, or the full URL...',
    searchBtn: 'Look up stop',
    scanBtn: 'Scan with the camera',
    stopScan: 'Stop the camera',
    scanning: 'Point at the QR code on the pole',
    noCamera: 'Your browser cannot scan. Type the code instead.',
    cameraDenied: 'Could not use the camera. Type the code instead.',
    popularDemos: 'Example stops:',
    howItWorks:
      'Every Urbanos de Lugo pole carries a unique QR code that opens the departure times for that stop. You can scan it here, or type the printed code.',
    notFound: 'No stop was found with that code.',
  },

  lines: {
    title: 'Bus lines',
    backToLines: 'Back to lines',
    subtitle: 'The full urban bus network of Lugo, operated by Monbus',
    categories: {
      all: 'All',
      hospital: 'HULA hospital',
      urbano: 'City',
      periferia: 'Outskirts',
      rural: 'Rural',
      especial: 'Night / Special',
    } as Record<string, string>,
    searchLines: 'Search a line by number or name...',
    enRoute: (count: number) => (count === 1 ? '1 running' : `${count} running`),
    enRouteHint:
      'Runs that should be on the road now according to the timetable. This app receives no vehicle positions.',
    lineLabel: (number: string) => `Line ${number}`,
    origin: 'Start',
    destination: 'End',
    noService: 'No service',
    passed: 'gone',
    nowAt: 'Now',
    codeShort: 'Code',
    saveLine: 'Save this line',
    unsaveLine: 'Remove from saved',
    viewRunAt: (time: string) => `Show the run that leaves at ${time}`,
    frequency: 'Frequency',
    serviceHours: 'Service hours',
    days: 'Days of service',
    stopsInDirection: 'Stops along the route',
    viewOnMap: 'Show the route on the map',
    routeLength: 'Length',
    routeStops: 'Stops',
    routeDuration: 'Trip time',
    routeDurationHint:
      'How long a whole trip in this direction takes according to the operator\u2019s timetable, first stop to last. It does not allow for delays.',
    routeDurationUnknown: 'No timetable',
    kilometres: (km: string) => `${km} km`,
    approximatePathTitle: 'Approximate path',
    approximatePath:
      'The path drawn for this direction has not been surveyed: it is built from the route a car would take between the stops, so it may detour where the bus does not. The stops and times are the official ones.',
    scheduleTable: 'Departures from the terminus',
    showingRun: 'Run shown',
    runOf: (index: number, total: number) => `${index} of ${total} today`,
    backToNow: 'now',
    noRunsToday: 'This line does not run today.',
    estimatedHint: 'Estimated from the departure at the terminus plus the measured driving time.',
    busScheduledHere: 'On the timetable, the bus would be reaching this stop now',
    viewStop: 'See stop',
  },

  arrivals: {
    operatorSaysTitle: 'What this stop’s QR shows',
    operatorSaysNote: (at: string) =>
      `This is what the code on this pole shows right now, read at ${at}. The operator’s figure, not this app’s.`,
    clockDrift: (hours: string, zone: string) =>
      `Your device is ${hours} Lugo time (it is set to ${zone}). The timetables on this page are Lugo's, so what you see here will not match your own clock.`,
    clockAhead: (h: string) => `${h} ahead of`,
    clockBehind: (h: string) => `${h} behind`,
    viewNext: 'Next',
    atTimeLabel: 'Show departures at',
    showingAt: (time: string) => `Departures due at ${time}, not right now.`,
    backToNow: 'Back to now',
    noneAtTime: (time: string) => `Nothing is due at ${time} at this stop.`,
    viewByLine: 'By line',
    viewNextHint: 'Every line, in order of arrival',
    viewByLineHint: 'Each line with its next departures',
    noArrivals: 'No departures are scheduled from this stop right now.',
    nextServiceAt: (line: string, time: string, to: string) =>
      `The next one is line ${line} at ${time}, towards ${to}.`,
    publishedHint: 'A time the operator publishes for this stop.',
    estimatedHint:
      'Worked out from the departure at the terminus plus the measured driving time. The bus reaches this stop a few minutes earlier.',
    positionChecked:
      'This stop sits where the operator publishes it on its own page, cross-checked against the independent survey in OpenStreetMap.',
    stopMapRegion:
      'Map of this stop and the ones near it. The nearby stops are in the lines list above.',
    stopMapTitle: 'Where this pole is',
    reportPosition: 'Is this stop in the wrong place?',
    reportCta: 'Open a report on the repository',
    reportNotCouncil:
      'The report reaches whoever maintains this app, which has no connection to the Concello de Lugo or to the operator. Anything official has to go to them.',
    precisionNote:
      'Times marked as estimated are worked out from the departure at the terminus. This app receives no vehicle positions, so get to the stop a few minutes early.',
    whyEstimatedTitle: 'Why are there no official times at this stop?',
    whyEstimated: (published: number, total: number) =>
      `The operator only publishes times at the termini and at a handful of major stops: ${published} of the ${total} in the network. Everywhere else, including here, the time is the published departure plus the driving time measured along the real route. No time in this app is a measured position of a bus.`,
    every: (minutes: number) => `about every ${minutes} min`,
    beyond: (count: number) =>
      `${count} more ${count === 1 ? 'departure' : 'departures'} after the next hour. You can see them under "By line".`,
    shelter: 'Shelter',
    fav: 'Save this stop',
    unfav: 'Remove from saved',
    map: 'Show on the map',
    share: 'Copy link',
    copyFailed: 'Could not copy. Here is the link:',
    copied: 'Copied',
    nearbyLinesTitle: 'Other lines nearby',
    nearbyLinesHint: 'They do not stop here, but they pass a short walk away.',
    seeLine: 'See the route of this line',
    dismiss: 'Close notice',
    back: 'Back to saved stops',
    watchCta: (minutes: number) => `Alert me ${minutes} min before`,
    watchOn: 'Alert on',
    watchTitle: 'Urbanos de Lugo',
    watchHint: (minutes: number) => `Alerts you when this bus is ${minutes} minutes away.`,
    watchFired: (line: string, eta: number, stop: string) =>
      `Line ${line} reaches "${stop}" in ${eta} min.`,
    watchForeground:
      'Alerts only sound while this screen is open: a web page cannot wake itself up in the background.',
    alarmCta: 'Alert me on arrival',
    alarmOn: 'Alert on',
    alarmHelp: 'Alerts you as you approach this stop so you do not miss it.',
    alarmWatching: (metres: number) => `We will alert you when you are within ${metres} m of this stop.`,
    alarmFired: (name: string) => `You are arriving at "${name}". Get ready to get off.`,
    alarmForeground: 'Keep this screen open: the browser cannot alert you in the background.',
    alarmDenied: 'Could not get your location. Check your browser permissions.',
    alarmUnavailable: 'Your browser does not support geolocation.',
  },

  nightBanner: {
    closed: (firstDeparture: string) =>
      `No service right now. The first departure is at ${firstDeparture}.`,
    festivals:
      'During the city festivals there are usually extra night buses. They are announced as notices and have no fixed timetable.',
    seeNotices: 'See notices',
    dismiss: 'Hide notice',
  },

  engine: {
    notRunningToday: (line: string, days: string) =>
      `Line ${line} does not run today (${days}).`,
    transferAt: (stop: string, line: string, at: string, wait: number) =>
      `Change at "${stop}". The next Line ${line} bus leaves at ${at}, about ${wait} min later. Changing within 75 minutes is free with the Tarxeta Cidadá.`,
    waitAt: (stop: string, until: string, wait: number, line: string, to: string) =>
      `Wait at "${stop}" until ${until}, about ${wait} min. Line ${line} towards ${to}.`,
    board: (line: string, direction: string, at: string, alightAt: string, stops: number, km: string, arriveAt: string) =>
      `Get on Line ${line} (${direction}) at ${at} and get off at "${alightAt}" after ${stops} stops (${km} km). Arriving at ${arriveAt}.`,
    walkWholeWay: (from: string, to: string, metres: number, minutes: number) =>
      `Walk from "${from}" to "${to}": ${metres} metres, about ${minutes} min. No waiting and no fare.`,
    walkToStop: (metres: number, minutes: number, from: string, stop: string, code: string) =>
      `Walk ${metres} metres (about ${minutes} min) from "${from}" to the stop "${stop}" (code ${code}).`,
    walkToDestination: (metres: number, minutes: number, to: string, arriveAt: string) =>
      `Walk ${metres} metres (about ${minutes} min) to "${to}". Arriving at ${arriveAt}.`,
  },

  error: {
    title: 'Something went wrong on this screen',
    body: 'We could not show this part of the app. The rest still works: try reloading, or switch to another section.',
    reload: 'Reload',
    official: 'Check buslugo.com',
  },

  common: {
    min: 'min',
    arrivingNow: 'Arriving',
    overdue: (minutes: number) => `${minutes} min ago`,
    overdueNote:
      'Its time has passed and this site does not know where the bus is. It stays on the board for five minutes because most delays are shorter than that.',
    lines: (count: number) => `${count} ${count === 1 ? 'line' : 'lines'}`,
    officialBadge: 'SCHEDULED',
    estimatedBadge: '~ ESTIMATED',
  },
};
