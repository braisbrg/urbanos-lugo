/**
 * Galician — the source dictionary.
 *
 * This one is written first and the other languages are typed against it, so a missing
 * key is a compile error rather than a blank on screen. It replaced twelve inline
 * `{gl, es}` blocks and thirty-five `lang === 'gl' ? a : b` ternaries; those ternaries
 * were the reason to do this at all, because a third language makes every one of them
 * silently return Spanish.
 *
 * Values that need a number or a name are functions, not templates with placeholders:
 * the compiler then checks the call sites too, and plural rules stay in the language
 * that has them rather than in a rules engine.
 *
 * Place names — stops, lines, zones — are never translated. "Rda. Muralla 56" is an
 * address in Lugo whatever language you are reading in.
 */
export const gl = {
  nav: {
    stops: 'Paradas',
    lines: 'Liñas',
    map: 'Mapa',
    plan: 'Ruta',
    main: 'Navegación principal',
    appName: 'Urbanos de Lugo',
    skipToContent: 'Ir ao contido',
  },

  menu: {
    alerts: 'Avisos do servizo',
    alertsAndFares: 'Avisos e tarifas',
    fares: 'Tarifas e billetes',
    language: 'Idioma',
    theme: 'Aparencia',
    themeAuto: 'Automática',
    themeAutoShort: 'Auto',
    themeLight: 'Clara',
    themeDark: 'Escura',
    close: 'Pechar menú',
    open: 'Menú',
    sourceTimetables: 'Horarios oficiais de buslugo.com',
    sourceGeometry: 'Trazado levantado en OpenStreetMap',
    sourceNoGps: 'Sen GPS de flota',
    sourceShort: 'Horarios oficiais de buslugo.com. Sen GPS de flota.',
  },

  search: {
    placeholder: 'Parada, liña ou rúa…',
    stops: 'Paradas',
    lines: 'Liñas',
    qr: 'Escanear código QR do poste',
    clear: 'Limpar',
    none: 'Nada coincide con esa busca.',
  },

  stopHome: {
    savedLines: 'As túas liñas',
    savedLinesAt: (stop: string) => `próxima en ${stop}`,
    savedLinesNoStop: 'garda unha parada para ver a hora',
    saved: 'Paradas gardadas',
    recent: 'Vistas hai pouco',
    clearRecent: 'Borrar',
    near: 'Preto de min',
    locate: 'Buscar preto de min',
    youAreHere: 'Estás aquí',
    locating: 'Localizando…',
    none: 'sen saídas na próxima hora',
    emptyTitle: 'Aínda non gardaches ningunha parada.',
    emptyBody:
      'Busca a túa parada arriba, escanea o código do poste ou tócaa no mapa. Despois preme a estrela e aparecerá aquí.',
    orSearchAbove: 'ou busca arriba',
    scan: 'Escanear código do poste',
    denied: 'Non se puido acceder á localización. Revisa os permisos do navegador.',
    unavailable: 'O teu navegador non permite a xeolocalización.',
    walk: (minutes: number) => `${minutes} min a pé`,
  },

  service: {
    weekday: 'De luns a venres (laborables)',
    weekend: 'Fins de semana e festivos',
    everyday: 'Todos os días',
    checkTimetable: 'Consultar horario',
    every: (minutes: number) => `Cada ${minutes} min`,
    everyRange: (from: number, to: number) => `Cada ${from}–${to} min`,
  },

  fares: {
    priceNotPublished: 'Prezo non publicado',
    alertsTitle: 'Avisos oficiais e incidencias en Lugo',
    alertsSubtitle:
      'Comprobación automatizada e diaria dende o portal oficial buslugo.com e Concello de Lugo',
    faresTitle: 'Tarifas e Tarxeta Cidadá',
    faresSubtitle: 'Prezos oficiais e títulos de transporte en Lugo (Monbus)',
    faqTitle: 'Preguntas frecuentes',
    contactTitle: 'Atención á cidadanía e contacto',
    refreshBtn: 'Comprobar avisos',
    refreshing: 'Sincronizando...',
    cooldownText: (seconds: number) => `Agarde (${seconds}s)`,
    unknownStatusTitle: 'Non se puido comprobar se hai avisos',
    staleStatusTitle: 'A última comprobación xa ten tempo',
    staleStatusDesc:
      'Isto é o que dicía o operador na data de abaixo, non o que di agora. Puido anunciarse algo despois. Consulta buslugo.com se vas facer un traxecto importante.',
    unknownStatusDesc: 'Non conseguimos ler a páxina do operador. Iso non quere dicir que todo estea ben: quere dicir que non o sabemos. Consulta buslugo.com se vas facer un traxecto importante.',
    normalStatusTitle: 'Rede de transporte operando con total normalidade',
    normalStatusDesc:
      'Non hai incidencias, obras nin desvíos temporais activos comunicados oficialmente por AULUSA / Monbus nin polo Concello de Lugo.',
    nightWindowTitle: 'Franxa horaria nocturna (servizo diurno finalizado)',
    nightWindowBody:
      'A maioría das liñas do servizo urbano de Lugo rematan os seus percorridos entre as 22:00 e as 22:30. As primeiras saídas da mañá reactívanse a partir das 07:00.',
    allLines: 'Todas as liñas',
    alertsUnavailable: 'Avisos non dispoñibles',
    checkOnBuslugo: 'Consultar en buslugo.com',
    savedCopy: 'copia gardada',
    structuralTitle: 'Avisos estruturais e obras municipais vixentes',
    structuralSource: 'Escritos neste proxecto a partir de fontes municipais, non comprobados automaticamente coma os avisos de arriba. Poden quedar desactualizados.',
    phones: 'Teléfonos de atención',
    portals: 'Portais de referencia',
    lastCheck: 'Última verificación oficial:',
    source: 'Fonte oficial:',
  },

  planner: {
    title: 'Planificador de ruta',
    subtitle: 'Calcula o traxecto desde calquera rúa, lugar ou parada de Lugo',
    origin: 'Orixe (rúa, lugar ou parada)',
    destination: 'Destino (rúa, lugar ou parada)',
    useMyLocation: 'Usar a miña localización GPS',
    locating: 'Obtendo a localización…',
    calculate: 'Calcular ruta',
    swap: 'Inverter orixe e destino',
    departureLabel: 'Saída',
    arrivalLabel: 'Chegada',
    board: 'Sube en',
    alight: 'Baixa en',
    ride: (stops: number, minutes: number) =>
      `${stops} ${stops === 1 ? 'parada' : 'paradas'} · ${minutes} min`,
    viaStops: 'Paradas polas que pasa',
    editTrip: 'Cambiar orixe ou destino',
    quickDestinations: 'Destinos rápidos habituais:',
    noRouteFound: 'Non se atopou unha combinación óptima. Proba con outra rúa ou parada próxima.',
    transferFreeNotice:
      'Lembra que o transbordo dentro dos 75 minutos é gratuíto coa Tarxeta Cidadá ou TPG.',
    placeholderOrig: 'Escribe unha rúa, praza ou parada...',
    placeholderDest: 'Escribe o teu destino en Lugo...',
    lineWithStops: (line: string, stops: number) => `Liña ${line} · ${stops} ${stops === 1 ? 'parada' : 'paradas'}`,
    routeMap: 'Mapa do traxecto',
    showMap: 'Amosar mapa',
    hideMap: 'Ocultar mapa',
    timeModes: { now: 'Agora', depart: 'Saír ás', arrive: 'Chegar antes' },
    departAtLabel: 'Saír ás',
    arriveByLabel: 'Estar alí antes das',
    noArriveOption: 'Non hai ningunha saída que chegue a tempo. Proba unha hora máis tarde.',
    fareTitle: 'Custo do traxecto',
    fareCard: 'Con Tarxeta Cidadá',
    fareSingle: 'Billete ordinario',
    fareTransferFree: 'Transbordo incluído (dentro dos 75 min)',
    fareTransferPaid: 'O transbordo supera os 75 min: paga dous billetes',
    optionsTitle: (shown: number, total: number) => `Opcións de traxecto (${shown} de ${total})`,
    scheduledWait: 'Espera programada na parada',
    walkOnly: 'Todo a pé',
    walkMetres: (metres: number) => `Camiñar ~${metres} m`,
    walkConnection: 'Conexión a pé',
    measuredWalkTitle: 'A pé, medido',
    tripInfoTitle: 'Información',
    timeProvenanceMeasured:
      'Os tramos a pé están medidos polo enrutador peonil de OpenStreetMap, non estimados. As horas de bus seguen a vir do cadro horario oficial; as marcadas con ~ dedúcense do tempo de percorrido medido por estrada.',
    showWalkingPath: 'Ver camiño a pé',
    hideWalkingPath: 'Ocultar camiño a pé',
    walkingPathHint:
      'Traza os tramos a pé polas beirarrúas reais. Precisa conexión: consúltase o enrutador peonil de OpenStreetMap.',
    noWaitNoFare: 'sen esperas nin billete',
    leaveAtShort: (hhmm: string) => `sae ás ${hhmm}`,
    waitShort: (minutes: number) => `${minutes} min de espera`,
    serviceNoticeTitle: 'Aviso de horario de servizo',
    includesWait: (minutes: number) =>
      `Inclúe ${minutes} min de espera en paradas e transbordos, segundo os horarios de paso.`,
    transfersShort: (count: number) => (count === 1 ? '1 transbordo' : `${count} transbordos`),
    timeProvenanceTitle: 'De onde saen estas horas',
    timeProvenance:
      'As horas de saída veñen do cadro horario oficial; as marcadas con ~ calcúlanse sumando o tempo de percorrido medido por estrada. Non hai seguimento GPS da flota, así que convén chegar á parada uns minutos antes.',
  },

  faresContent: {
    faqs: [
      {
        q: 'Como funciona o transbordo gratuíto?',
        a: 'Ao pagar coa Tarxeta Cidadá do Concello de Lugo ou coa Tarxeta TPG de Galicia, dispoñerás de 75 minutos desde a primeira validación para cambiar a calquera outra liña sen custe adicional.',
      },
      {
        q: 'Pódese pagar con tarxeta bancaria ou móbil?',
        a: 'Si, todos os autobuses urbanos contan con lector bancario contactless (Visa / Mastercard / Google Pay / Apple Pay) para a compra do billete ordinario a bordo.',
      },
      {
        q: 'Onde se recarga a Tarxeta Cidadá?',
        a: 'Podes recargar a túa tarxeta nos caixeiros automáticos de ABANCA habilitados, nas oficinas municipais do Concello de Lugo e a bordo dos autobuses en efectivo.',
      },
    ],
    notices: [
      {
        title: 'Obras da Nova Estación Intermodal de Lugo (Montero Ríos)',
        date: 'Obras actuais',
        description:
          'Por mor das obras da futura Estación Intermodal en Montero Ríos e Conde de Fontao, séguese a sinalización peonil habilitada cara ás paradas da contorna ferroviaria.',
      },
      {
        title: 'Reordenación do Casco Histórico (Cabeceira de Bolaño Ribadeneira)',
        date: 'Vixente',
        description:
          'Tras a peonalización da Praza de Ferrol e Santo Domingo, as liñas 7, 8, 9 e 12 manteñen a súa cabeceira central en Bolaño Ribadeneira con circulación exclusiva para bus urbano.',
      },
      {
        title: 'Bonificación do 50% e Tarxeta Xente Nova (<21 anos)',
        date: 'Activo',
        description:
          'Manteñense aplicadas as bonificacións do 50% na Tarxeta Cidadá municipal e a gratuidade (ata 60 viaxes/mes) para menores de 21 anos coa Tarxeta Xente Nova da Xunta.',
      },
    ],
  },

  map: {
    mapTitle: 'Mapa da rede',
    zoomIn: 'Achegar o mapa',
    zoomOut: 'Afastar o mapa',
    networkRegion: 'Mapa da rede. Os percorridos e as paradas tamén están na pestana de liñas.',
    nearbyRegion: 'Mapa das paradas preto de ti. As mesmas paradas están na lista de embaixo.',
    loadingMap: 'Cargando o mapa…',
    subtitle: 'Percorridos, paradas e posición dos autobuses',
    allLines: 'Todas',
    onlyLinesHere: 'Só as liñas de aquí',
    aroundStopActive: (stop: string, metres: number) =>
      `Só as liñas que paran en ${stop} e as que pasan a menos de ${metres} m a pé.`,
    aroundStopClear: 'Amosar todas as liñas outra vez',
    linesHere: 'Liñas por aquí',
    drawRoute: 'Debuxar o percorrido',
    openLineInfo: 'Ver a ficha completa da liña',
    liveBusesCount: 'buses en servizo',
    centerLugo: 'Centrar Lugo',
    myLocation: 'A miña localización',
    legend: 'Lenda',
    stop: 'Parada con código QR',
    busLive: 'Bus (posición estimada do horario)',
    route: 'Trazado da liña',
    viewStopDepartures: 'Ver tempos de chegada',
    nearbyTitle: (metres: number) => `Liñas a menos de ${metres} m`,
    nearbyFilter: 'Preto de min',
    filterHula: 'HULA',
    filterCampus: 'Campus',
    filterCeao: 'O Ceao',
    locating: 'Localizando...',
    locationDenied: 'Non se puido acceder á túa localización. Revisa os permisos do navegador.',
    occupancyLow: 'Baixa',
    occupancyMedium: 'Media',
    occupancyHigh: 'Alta',
    occupancyLabel: 'Ocupación prevista',
    nextStop: 'Seguinte parada',
    estimatedPosition: 'Posición <b>estimada</b> a partir do cadro horario, non medida por GPS.',
    stopCode: 'Cód. QR',
    quickFilters: 'Filtros rápidos',
    layerStops: 'Paradas',
    layerBuses: 'Buses',
    layerRoutes: 'Trazados',
    documentTitle: 'Urbanos de Lugo | Liñas, horarios e paradas',
    layers: 'Capas visibles',
    linesList: 'Seleccionar liña',
    geolocationUnavailable: 'A xeolocalización non está dispoñible.',
    yourPosition: 'A túa posición actual',
    stopsCount: (total: number, withQr: number) =>
      `${total} paradas, ${withQr} con código QR`,
  },

  favourites: {
    close: 'Pechar favoritos',
    title: 'Favoritos gardados',
    codeShort: 'Cód.',
    subtitle: 'Acceso directo de 1 toque a paradas e liñas',
    tabStops: 'Paradas',
    tabLines: 'Liñas',
    noFavoriteStops: 'Aínda non engadiches paradas aos teus favoritos.',
    noFavoriteStopsHint: 'Preme na estrela dunha parada para gardala aquí.',
    noFavoriteLines: 'Aínda non engadiches liñas ás túas favoritas.',
    noFavoriteLinesHint: 'Preme na estrela da cabeceira dunha liña para gardala aquí.',
    remove: 'Eliminar de favoritos',
  },

  qr: {
    title: 'Consultar código QR / parada',
    subtitle: 'Escanea o código da marquesiña ou introduce o código do poste',
    placeholder: 'Exemplo: TPlG, 19 ou a URL completa...',
    searchBtn: 'Consultar parada',
    scanBtn: 'Escanear coa cámara',
    stopScan: 'Deter cámara',
    scanning: 'Apunta ao código QR do poste',
    noCamera: 'O teu navegador non permite escanear. Introduce o código a man.',
    cameraDenied: 'Non se puido acceder á cámara. Introduce o código a man.',
    popularDemos: 'Paradas de exemplo:',
    howItWorks:
      'Cada poste de Urbanos de Lugo ten un código QR único que abre os tempos de paso desa parada. Podes escanealo aquí ou escribir o código impreso.',
    notFound: 'Non se atopou ningunha parada co código introducido.',
  },

  lines: {
    title: 'Liñas de autobús',
    backToLines: 'Volver ás liñas',
    subtitle: 'Rede completa de autobuses urbanos de Lugo operada por Monbus',
    categories: {
      all: 'Todas',
      hospital: 'Hospital HULA',
      urbano: 'Urbanas',
      periferia: 'Periferia',
      rural: 'Rurais',
      especial: 'Nocturna / Especial',
    } as Record<string, string>,
    searchLines: 'Buscar liña por número ou nome...',
    enRoute: (count: number) => (count === 1 ? '1 en ruta' : `${count} en ruta`),
    enRouteHint:
      'Expedicións que segundo o cadro horario deberían estar circulando agora. Non hai seguimento GPS da flota.',
    lineLabel: (number: string) => `Liña ${number}`,
    origin: 'Orixe',
    destination: 'Destino',
    noService: 'Sen servizo',
    passed: 'pasou',
    nowAt: 'Agora',
    codeShort: 'Cód.',
    saveLine: 'Gardar liña en favoritos',
    unsaveLine: 'Quitar dos favoritos',
    viewRunAt: (time: string) => `Ver o percorrido da saída das ${time}`,
    frequency: 'Frecuencia',
    serviceHours: 'Horario de servizo',
    days: 'Días de servizo',
    stopsInDirection: 'Paradas do percorrido',
    viewOnMap: 'Ver percorrido no Mapa',
    routeLength: 'Lonxitude',
    routeStops: 'Paradas',
    routeFreeFlow: 'Sen tráfico',
    routeFreeFlowHint:
      'Tempo de circulación libre entre as paradas deste sentido, sen paradas nin tráfico. Non é a duración real da viaxe.',
    kilometres: (km: string) => `${km} km`,
    approximatePathTitle: 'Trazado aproximado',
    approximatePath:
      'O trazado deste sentido no mapa non está topografiado: constrúese coa ruta que faría un coche entre as paradas, así que pode desviarse por onde o bus non pasa. As paradas e as horas son as oficiais.',
    scheduleTable: 'Saídas desde cabeceira',
    showingRun: 'Expedición amosada',
    runOf: (index: number, total: number) => `${index} de ${total} do día`,
    backToNow: 'agora',
    noRunsToday: 'Esta liña non presta servizo hoxe.',
    estimatedHint: 'Hora estimada desde a saída de cabeceira e o tempo de percorrido medido.',
    busScheduledHere: 'Segundo o horario, o bus estaría chegando aquí',
    viewStop: 'Ver parada',
  },

  arrivals: {
    clockDrift: (hours: string, zone: string) =>
      `O teu dispositivo vai ${hours} respecto da hora de Lugo (está en ${zone}). Os horarios desta páxina son os de Lugo, así que o que ves aquí non coincide co reloxo do teu aparello.`,
    clockAhead: (h: string) => `${h} por diante`,
    clockBehind: (h: string) => `${h} por detrás`,
    viewNext: 'Próximas',
    atTimeLabel: 'Ver o paso ás',
    showingAt: (time: string) => `Paso previsto ás ${time}, non agora mesmo.`,
    backToNow: 'Volver a agora',
    noneAtTime: (time: string) => `Non hai ningún paso previsto ás ${time} nesta parada.`,
    viewByLine: 'Por liña',
    viewNextHint: 'Todas as liñas, en orde de chegada',
    viewByLineHint: 'Cada liña coas súas próximas saídas',
    noArrivals: 'Non hai saídas programadas neste intre para esta parada.',
    nextServiceAt: (line: string, time: string, to: string) =>
      `A seguinte é a liña ${line} ás ${time}, con destino ${to}.`,
    publishedHint: 'Hora publicada polo operador para esta parada.',
    estimatedHint:
      'Estimación a partir da saída de cabeceira e do tempo de percorrido medido. Chega uns minutos antes.',
    positionChecked:
      'A posición desta parada é a que o operador publica na súa propia páxina, contrastada co levantamento independente de OpenStreetMap.',
    stopMapRegion:
      'Mapa desta parada e das que ten preto. As paradas próximas están na lista de liñas de arriba.',
    stopMapTitle: 'Onde está este poste',
    reportPosition: 'Esta parada non está onde debería?',
    reportCta: 'Abrir un aviso no repositorio',
    reportNotCouncil:
      'O aviso chega a quen mantén esta aplicación, que non ten relación co Concello de Lugo nin co operador. Calquera trámite oficial hai que facelo con eles.',
    precisionNote:
      'As horas marcadas como estimadas calcúlanse desde a saída de cabeceira. Non hai GPS público da flota: para non perder o bus, chega á parada uns minutos antes.',
    whyEstimatedTitle: 'Por que non hai horas oficiais nesta parada?',
    whyEstimated: (published: number, total: number) =>
      `O operador publica horas só nas cabeceiras e nunhas poucas paradas principais: ${published} das ${total} da rede. Nas demais, coma esta, calculamos a hora sumando á saída de cabeceira o tempo de percorrido medido sobre o trazado real. Non hai GPS da flota, así que ningunha hora desta app é unha posición medida do bus.`,
    every: (minutes: number) => `cada ${minutes} min aprox.`,
    beyond: (count: number) =>
      `${count} ${count === 1 ? 'saída máis' : 'saídas máis'} despois da próxima hora. Vainas ver en «Por liña».`,
    shelter: 'Marquesiña',
    fav: 'Engadir a gardadas',
    unfav: 'Quitar de gardadas',
    map: 'Ver no mapa',
    share: 'Copiar ligazón',
    copyFailed: 'Non se puido copiar. Esta é a ligazón:',
    copied: 'Copiada',
    nearbyLinesTitle: 'Outras liñas preto',
    nearbyLinesHint: 'Non paran aquí, pero pasan a poucos minutos a pé.',
    seeLine: 'Ver percorrido da liña',
    dismiss: 'Pechar aviso',
    back: 'Volver ás paradas gardadas',
    watchCta: (minutes: number) => `Avisar ${minutes} min antes`,
    watchOn: 'Aviso activo',
    watchTitle: 'Urbanos de Lugo',
    watchHint: (minutes: number) => `Avísate cando falten ${minutes} minutos para que chegue este bus.`,
    watchFired: (line: string, eta: number, stop: string) =>
      `A liña ${line} chega en ${eta} min a "${stop}".`,
    watchForeground:
      'Os avisos só soan con esta pantalla aberta: unha páxina web non pode espertarse en segundo plano.',
    alarmCta: 'Avisarme ao chegar',
    alarmOn: 'Aviso activo',
    alarmHelp: 'Avísate cando esteas preto desta parada para que non a pases.',
    alarmWatching: (metres: number) => `Avisarémoste cando esteas a menos de ${metres} m desta parada.`,
    alarmFired: (name: string) => `Estás a chegar a "${name}". Prepárate para baixar.`,
    alarmForeground: 'Ten esta pantalla aberta: o navegador non pode avisarte en segundo plano.',
    alarmDenied: 'Non se puido acceder á localización. Revisa os permisos do navegador.',
    alarmUnavailable: 'O teu navegador non permite a xeolocalización.',
  },

  nightBanner: {
    closed: (firstDeparture: string) =>
      `Sen servizo agora. A primeira saída é ás ${firstDeparture}.`,
    festivals:
      'En festas adoita haber reforzos nocturnos. Publícanse como aviso, sen horario fixo.',
    seeNotices: 'Ver avisos',
    dismiss: 'Ocultar aviso',
  },

  engine: {
    notRunningToday: (line: string, days: string) =>
      `A liña ${line} non presta servizo hoxe (${days}).`,
    transferAt: (stop: string, line: string, at: string, wait: number) =>
      `Transbordo en "${stop}". O seguinte bus da Liña ${line} sae ás ${at} (~${wait} min de espera). Transbordo gratuíto dentro dos 75 min coa Tarxeta Cidadá.`,
    waitAt: (stop: string, until: string, wait: number, line: string, to: string) =>
      `Espera na parada "${stop}" ata as ${until}, uns ${wait} min. Liña ${line} con destino ${to}.`,
    board: (line: string, direction: string, at: string, alightAt: string, stops: number, km: string, arriveAt: string) =>
      `Sube á Liña ${line} (${direction}) ás ${at} e baixa en "${alightAt}" tras ${stops} paradas (${km} km). Chegada ás ${arriveAt}.`,
    walkWholeWay: (from: string, to: string, metres: number, minutes: number) =>
      `Vai andando desde "${from}" ata "${to}": ${metres} metros, uns ${minutes} min. Sen agardar nin pagar.`,
    walkToStop: (metres: number, minutes: number, from: string, stop: string, code: string) =>
      `Camiña ${metres} metros (~${minutes} min) desde "${from}" ata a parada "${stop}" (Cód. ${code}).`,
    walkToDestination: (metres: number, minutes: number, to: string, arriveAt: string) =>
      `Camiña ${metres} metros (~${minutes} min) ata "${to}". Chegada final ás ${arriveAt}.`,
  },

  error: {
    title: 'Algo foi mal nesta pantalla',
    body: 'Non puidemos amosar esta parte da aplicación. O resto segue funcionando: proba a recargar ou a cambiar de sección.',
    reload: 'Recargar',
    official: 'Consultar en buslugo.com',
  },

  common: {
    min: 'min',
    arrivingNow: 'Chegando',
    lines: (count: number) => `${count} ${count === 1 ? 'liña' : 'liñas'}`,
    officialBadge: 'HORARIO OFICIAL',
    estimatedBadge: '~ ESTIMADO',
  },
};
// Deliberately not `as const`: the other languages are typed against this, and literal
// types would demand they repeat the Galician strings verbatim rather than match its
// shape.
