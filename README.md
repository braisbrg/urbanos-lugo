# Urbanos de Lugo — Liñas, paradas e tempos de paso

Aplicación web para consultar a rede de autobús urbano de Lugo (concesión de AULUSA /
Grupo Monbus): liñas, paradas, tempos de paso, planificador de traxectos e mapa da rede.

> **Proxecto non oficial.** Non está feito, revisado nin respaldado por AULUSA, Grupo
> Monbus nin o Concello de Lugo. Le os horarios que o operador publica en
> <https://buslugo.com> e amosa de onde vén cada hora. Para calquera cousa que dependa
> dun horario, a fonte oficial manda.

---

## Índice

1. [Que fai](#que-fai)
2. [De onde saen os datos](#de-onde-saen-os-datos)
3. [Cifras da rede](#cifras-da-rede)
4. [Arquitectura](#arquitectura)
5. [Estrutura do repositorio](#estrutura-do-repositorio)
6. [Nunca mentir coas horas](#nunca-mentir-coas-horas)
7. [Motor de horarios](#motor-de-horarios)
8. [Planificador](#planificador)
9. [Buscador](#buscador)
10. [API REST](#api-rest)
11. [Tecnoloxías](#tecnoloxías)
12. [Despregue](#despregue)
13. [Instalación](#instalación)
14. [Rexenerar os datos](#rexenerar-os-datos)
15. [Verificación](#verificación)
16. [Tres idiomas](#tres-idiomas)
17. [Móbil e escritorio](#móbil-e-escritorio)
18. [Limitacións coñecidas](#limitacións-coñecidas)
19. [Ideas para máis adiante](#ideas-para-máis-adiante)

---

## Que fai

### Taboleiro de chegadas
Próximos pasos en calquera parada, calculados a partir do **cadro horario publicado polo
operador**, non dunha simulación. Fóra do horario de servizo o taboleiro queda baleiro e
indícase a primeira saída da xornada seguinte, en lugar de inventar buses.

Cada hora leva a súa etiqueta: `HORARIO OFICIAL` cando o operador publica esa hora para
esa parada e `~ ESTIMADO` cando se deduce. Ver
[Nunca mentir coas horas](#nunca-mentir-coas-horas).

Dúas maneiras de ler o mesmo taboleiro: **Próximas**, todas as liñas en orde de chegada,
para cando colles o primeiro que veña; e **Por liña**, agrupado e ordenado polo número
que vai pintado no bus, coas seguintes saídas de cada unha e a súa cadencia, para cando
agardas por unha en concreto.

"Próximas" chega ata os 60 minutos; o que quede fóra anúnciase ("6 saídas máis despois
da próxima hora") en lugar de cortarse en silencio. "Por liña" non ten horizonte, porque
aí a pregunta xa é de planificación.

Nas paradas que non son punto horario publicado —392 das 417— todas as horas son
estimadas, e o taboleiro explica por que en lugar de deixalo a interpretación.

### Avisos de bus e de baixada
Dous avisos, os dous opcionais:

- **"Avisar 5 min antes"** en calquera liña do taboleiro, para non perder o bus por
  despiste.
- **"Avisarme ao chegar"**, que soa ao achegarte a menos de 300 m da parada elixida,
  para non pasarte de largo.

Ambos usan vibración, son e notificación do sistema se a concedes. Funcionan só coa
pantalla aberta: unha páxina web non pode espertarse en segundo plano, e a interface dío
en lugar de dar a entender o contrario.

### A portada son as túas paradas
O tab de paradas abre nas **gardadas**, xa coas súas próximas saídas: o caso habitual
custa cero toques e cero escritura. Debaixo, as **vistas hai pouco** —as últimas seis que
abriches, gardadas só como identificadores— porque buscar unha parada faino todo o mundo
e gardala case ninguén, e a segunda visita non debería custar escribir outra vez. E
debaixo, **preto de min**, que precisa permiso de localización e non inventa distancias
se llo negas.

### Mapa da rede
Leaflet sobre teselas de CartoDB. Os trazados **seguen a rede viaria real**: cada
itinerario está axustado ás rúas no momento de xerar os datos, non interpolado entre
paradas. Corenta e cinco dos corenta e oito sentidos son o itinerario levantado en
OpenStreetMap; **tres constrúense coa ruta que faría un coche** (a 3.2 nos dous sentidos
e a 5.2 cara a Avda. Américas), que se desvía por onde o bus non pasa. Eses tres dino na
ficha da liña, deixando claro que as paradas e as horas seguen a ser as oficiais: o que
é inferido é a forma entre elas.

Desde o globo dunha parada podes deixar no mapa **só as liñas que pasan por aí** — as
que paran nese poste e as que pasan a menos de 400 m a pé. A pregunta é da parada, así
que se fai desde a parada; como filtro solto nunha fila de zonas non se entendía e
respondía pola parada equivocada. Redúcelle a lista a algo máis pequeno nas 417
paradas: catro liñas das 24 en As Termas, unha en Nadela, dezaoito en Rda. Muralla 56,
que é o máis concorrido que hai en Lugo.

O filtro **"preto de min"** amosa todas as liñas a menos de 750 m, cun panel lateral que
lista cada unha coa distancia á súa parada máis próxima. Antes calculaba as oito liñas
próximas e logo quedaba só coa primeira, así que dende Avda. Américas 88 vías a 8 e
ningunha máis.

As paradas debúxanse en canvas (`preferCanvas`) e non todas á vez: afastado só se ven os
46 intercambiadores, e a partir do zoom 15 —ou ao seleccionar unha liña— aparecen as 417.
Amosalas todas sobre a vista de cidade tapaba as propias liñas e creaba 417 nodos DOM.

Os vehículos que se ven proveñen do cadro horario: unha expedición que xa saíu e aínda
non rematou sitúase sobre o trazado onde debería ir. O globo de cada un dío
explicitamente; non son posicións medidas.

### Planificador de traxectos
Compara a liña directa contra os transbordos posibles e devolve **o que chega antes**.
Considera varias paradas de saída e chegada próximas, porque camiñar dous minutos ata
unha parada mellor comunicada adoita compensar.

Tres modos: **agora**, **saír ás** e **chegar antes das**. O terceiro devolve a saída
máis tardía que aínda chega a tempo, que é a pregunta real antes dunha cita no HULA ou
dunha clase no Campus.

Non devolve unha soa resposta: amosa as **opcións distintas** de facer o traxecto,
agrupadas por combinación de liñas e ordenadas por tempo total. Ensínanse as catro
mellores.

**Ir andando é sempre unha das opcións.** Lugo crúzase a pé nunha hora, así que un
itinerario de 90 minutos con dous transbordos é peor que camiñar, e a aplicación dío en
vez de agochalo. Nunha mostra de 40 traxectos urbanos, en 18 a mellor resposta é ir a pé.

O radio de busca de parada é de **2 km**: medido sobre esa mesma mostra, a mediana deixa
de mellorar máis alá de 1,2 km e a media segue baixando ata os 2 km (40 → 37 min), onde
se aplana. Ningunha proposta pode ser absurda porque unha parada só se considera se
camiñar ata ela leva menos que camiñar todo o traxecto.

No mapa, os tramos a pé debúxanse en liña recta punteada. Con **"Ver camiño a pé"**
trázanse polas beirarrúas reais consultando o enrutador peonil de OpenStreetMap; é
opcional porque require conexión e o resto da aplicación non.

Amosa tamén **canto custa o traxecto** cos dous títulos, aplicando a regra dos 75 minutos:
un transbordo dentro da ventá vai incluído coa Tarxeta Cidadá.

### Liñas e horarios
Ficha de cada liña co seu percorrido en ambos sentidos, cadro horario por tipo de día
(laborables / sábados / domingos e festivos) e tempo de paso estimado en cada parada.

### Códigos QR das marquesiñas
Escaneo pola cámara usando `BarcodeDetector`, a API nativa do navegador (dispoñible en
Chromium; noutros navegadores queda a entrada manual do código). Acepta tanto o código
impreso no poste como a URL completa que codifica o QR.

Tamén se resolven parámetros na URL: `?parada=…`, `?stop=…`, `?ps=…`, `?qr=…`.

### Tarifas e avisos
Títulos de transporte tal e como os publica o operador, **cada un coa súa fonte
enlazada**: billete ordinario, bono ordinario e bono social da Tarxeta Cidadá, e a
**Tarxeta do transporte público de Galicia (TMG)**, válida na rede urbana de Lugo desde
que a cidade entrou na Área de Transporte Metropolitano en 2012.

Máis a sincronización dos avisos de servizo publicados en buslugo.com. A consulta faise **desde o servidor** (o navegador non pode por CORS). Se
non hai servidor —ou non responde— úsase a copia que deixou a tarefa programada e
amósase **cando se tomou**, en lugar de facela pasar por actual.

---

## De onde saen os datos

Non hai datos escritos a man. `stops.json` e `lines.json` xéranse a partir de:

1. **buslugo.com** — o portal da concesionaria. De cada páxina de liña extráense o
   itinerario ordenado de ambos sentidos, o identificador oficial de cada poste, as
   correspondencias con outras liñas e o cadro horario por tipo de día.

2. **Relacións de ruta de OpenStreetMap** — o itinerario que a comunidade levantou para
   cada liña, nos dous sentidos, etiquetado co operador. É a fonte do **trazado que se
   debuxa**: 45 dos 48 sentidos. Ver [O trazado que se debuxa](#o-trazado-que-se-debuxa).

3. **OSRM** (`router.project-osrm.org`) — conduce entre paradas consecutivas e devolve a
   **distancia e o tempo de condución de cada tramo**. Deses tempos saen os tramos que o
   cadro horario non fixa. Segue sendo o trazado de reserva onde OSM non chega.

4. **OpenStreetMap** — cartografía base do mapa e, vía Overpass, os equipamentos
   levantados en cada poste (marquesiña, banco). O operador non publica eses datos e o
   conxunto anterior inventábaos; agora 413 das 417 paradas están emparelladas cun nodo
   de OSM a menos de 45 m e o que ninguén levantou queda como `null`, non como "non".

O operador **non publica ningún trazado**, só listas de paradas e cadros horarios. Non
existe, polo tanto, unha fonte autorizada da liña que segue o bus: hai que reconstruíla.

### O trazado que se debuxa

Pintar a liña preguntándolle a OSRM como iría un coche entre paradas consecutivas
responde a outra pregunta, e falla de dous xeitos que se poden medir:

- **Rodeos que o bus non dá.** As liñas 7, 8, 9 e 12 rematan en Bolaño Rivadeneira, no
  casco histórico. Un coche non entra, así que OSRM daba a volta enteira á muralla: 2127
  metros para un salto de 372. A liña 8 de volta saía de 4,1 km fronte aos 2,3 reais.
- **Itinerarios listados fóra de orde.** A páxina do operador imprime dúas paradas da
  5.1 de volta (Fonte dos Ranchos e Doutor Gasalla) en terceiro e quinto lugar, cando a
  ruta pasa por elas case ao final. Lido ao pé da letra, ese itinerario cruza a cidade
  catro veces: **28 km** para un percorrido de 10.

Por iso o trazado sae das relacións de ruta de OSM cando as hai. Só se acepta unha se
describe ese sentido: número de liña correcto, remata onde remata o sentido, todas as
paradas preto da liña e en orde ao longo dela. Se a orde publicada non cadra pero a que
implica o trazado si — e acurta o itinerario drasticamente — repárase a orde e dise no
log. Hoxe: **45 sentidos co itinerario topografiado, 3 con OSRM**, e o 99% do que se
debuxa cae sobre o itinerario de OSM.

Efecto medido: os tramos cun desvío viario superior a 4x pasaron de 14 a **2 de 1137**.

**O que isto non resolve.** Unha relación de OSM di por onde vai o bus; as etiquetas de
acceso das rúas son outro levantamento distinto, e nese remate do casco histórico
discrepan. `pnpm data:osm` mide e lista os metros de cada ruta que caen sobre vías
pechadas a vehículos sen excepción para o bus:

| Liñas | Metros | Onde |
| :--- | ---: | :--- |
| 7, 8, 9, 12 (ambos sentidos) | 230–385 | Montevideo, San Fernando, Bolaño Rivadeneira |
| 11 (Calde → Ramón Ferreiro) | 317 | pista sen nome ao sur |

Todo o demais: cero. Son 0,93 km de 158. O operador publica paradas nesas rúas e OSM ten
alí unha parada de bus levantada sobre o terreo, así que algo pasa por elas; pero ningunha
vía leva `bus=yes` nin `psv=yes`. **Pode ser unha etiqueta que falta ou pode ser que o bus
quede na entrada: os datos abertos non o din, e non se afirma o que non se sabe.** O que
si é seguro é que a alternativa —dar 2,1 km de volta á muralla— non describe ningunha
realidade, así que se debuxa o itinerario levantado e queda anotado aquí.

A aplicación **non chama a ningunha destas fontes en execución**: os ficheiros xerados
van no repositorio. As fontes só se consultan ao rexenerar os datos.

### Por que non se usa GTFS

Comprobouse, e **non existe un GTFS público da rede urbana de Lugo**:

- O ficheiro do [Punto de Acceso Nacional](https://nap.transportes.gob.es/Files/Detail/1386)
  que se citaba antes neste README **non é o bus urbano**. É o feed *interurbano* da
  Xunta de Galicia: 127.784 viaxes, 6.594 rutas e 22.386 paradas repartidas por Lugo,
  A Coruña, Pontevedra, Ourense, Asturias, León e Zamora. O servizo urbano de Lugo é
  unha concesión do Concello (AULUSA), non da Xunta, e non está aí dentro.
- **Transitous** (agregador aberto, sen chave de API) ten ese mesmo feed da Xunta
  ingerido. Consultando o recadro da cidade de Lugo devolve 45 paradas, **todas** do
  feed interurbano. Non hai ningún feed municipal.
- buslugo.com non publica GTFS (`/gtfs.zip` devolve 404) e o portal de datos abertos do
  Concello non expón o dataset.

Polo tanto **buslugo.com é a fonte máis autorizada dispoñible**: é o propio operador
publicando os seus itinerarios e cadros horarios. Se algún día aparece un GTFS
municipal, substituír o scraper por un lector de GTFS afecta só a
`tools/importOfficialData.ts`; o resto do proxecto non cambia.

### Identificadores de parada

O operador numera cada parada **unha vez por liña e sentido**, polo que un mesmo poste
aparece con moitos identificadores distintos (a parada de Sindicatos ten 20). O
xerador agrúpaos por poste físico e conserva todos os identificadores en `officialIds`,
para que calquera enlace QR antigo siga resolvendo.

---

## Cifras da rede

| | |
| :--- | ---: |
| Liñas | 24 |
| Sentidos | 48 |
| Paradas (postes físicos) | 417 |
| Paradas cun código QR no poste | 271 |
| Sentidos co itinerario topografiado en OSM | 45 / 48 |
| Sentidos debuxados coa ruta dun coche | 3 / 48 |
| Liñas con horario oficial | 24 / 24 |
| Expedicións diarias (laborable) | 777 |
| Lonxitude da rede | 436 km |

As 24 liñas inclúen a **5DS** e os **catro ramais rurais da liña 11** (Pías, Bóveda,
Calde e Santa Comba), que se publican por separado porque son servizos distintos.

`pnpm audit` imprime estas cifras actualizadas xunto cos tramos sospeitosos.

---

## Arquitectura

```
[ SPA React 19 + TypeScript + Tailwind v4 ]
  ├── index.css           tokens de cor e escala tipográfica (claro/escuro)
  ├── components/         vistas e capas do mapa
  ├── utils/schedule      cadro horario -> hora de paso en cada parada
  ├── utils/transitEngine chegadas, vehículos, planificador, xeodesia
  ├── utils/searchUtils   normalización e relevancia
  └── data/               stops.json + lines.json (xerados)
           │
           ▼
[ Express ]
  ├── API REST
  ├── Sincronización de avisos oficiais
  └── Vite en desenvolvemento / estáticos en produción
```

---

## Estrutura do repositorio

```
├── src/
│   ├── components/
│   │   ├── Map/
│   │   │   ├── TransitMap.tsx      contedor do mapa e panel lateral
│   │   │   ├── RouteLayer.tsx      polilinas de percorrido
│   │   │   ├── RouteMap.tsx        mapa dun traxecto planificado
│   │   │   ├── StopLayer.tsx       marcadores de parada
│   │   │   └── VehicleLayer.tsx    marcadores de vehículo
│   │   ├── TopBar.tsx              buscador único + escáner QR
│   │   ├── BottomNav.tsx           navegación en móbil
│   │   ├── SideNav.tsx             rail de navegación en escritorio
│   │   ├── MenuDrawer.tsx          idioma, tema, avisos e tarifas (móbil)
│   │   ├── StopHome.tsx            gardadas, vistas hai pouco e preto de min
│   │   ├── StopArrivalsView.tsx    taboleiro de chegadas
│   │   ├── LinesView.tsx           liñas e horarios
│   │   ├── RoutePlannerView.tsx    planificador
│   │   ├── FaresAndAlertsView.tsx  tarifas e avisos
│   │   ├── FavoritesDrawer.tsx     favoritos
│   │   ├── QrScannerModal.tsx      escáner QR
│   │   ├── ErrorBoundary.tsx       illa un fallo nunha pestana sen tirar a app
│   │   └── navSections.ts          as seccións, nun sitio: rail, barra e menú
│   ├── data/
│   │   ├── stops.json              XERADO — o que le a app
│   │   ├── lines.json              XERADO — o que le a app
│   │   ├── route-geometry.json     XERADO — trazados, baixo demanda
│   │   ├── alerts.json             INSTANTÁNEA — avisos, refrescada por CI
│   │   ├── official-raw.json       INSTANTÁNEA — scraping de buslugo
│   │   ├── osm-routes.json         INSTANTÁNEA — relacións de OSM (Overpass)
│   │   ├── routes.json             INSTANTÁNEA — xeometría de OSRM
│   │   ├── stop-amenities.json     INSTANTÁNEA — equipamentos de OSM
│   │   ├── routeGeometry.ts        carga os trazados baixo demanda
│   │   └── transitData.ts          carga dos datos + tarifas
│   ├── services/
│   │   ├── alertSyncService.ts     avisos oficiais (só servidor)
│   │   ├── stopAlarm.ts            alarma de proximidade á parada
│   │   └── walkingPath.ts          tramos a pé polo enrutador de OSRM
│   ├── hooks/
│   │   ├── useTheme.ts             clara / escura / automática
│   │   ├── useRecentStops.ts       últimas paradas abertas (só ids)
│   │   └── useDialog.ts            Escape, foco atrapado e foco devolto
│   ├── utils/
│   │   ├── schedule.ts             calendario e cadro horario
│   │   ├── transitEngine.ts        chegadas, vehículos e rutas
│   │   ├── serviceLabels.ts        días e frecuencia no idioma da interface
│   │   └── searchUtils.ts          buscador
│   ├── types.ts
│   ├── App.tsx
│   └── main.tsx
├── tools/
│   ├── importOfficialData.ts       descarga e axuste viario (lento, cacheado)
│   ├── importStopAmenities.ts      equipamentos de parada desde OSM
│   ├── buildDataset.ts             xera stops.json e lines.json (rápido)
│   ├── importOsmRoutes.ts          relacións de ruta desde Overpass
│   ├── fetchAlerts.ts              refresca a instantánea de avisos (CI)
│   ├── calibrateWalking.ts         mide o factor de rodeo peonil
│   ├── validateRideTimes.ts        contrasta os tempos de percorrido
│   ├── reconcile.ts                coteja o dataset con buslugo, liña a liña
│   ├── reconcileSelfTest.ts        insire faltas para ver se reconcile as caza
│   ├── fullAudit.ts                informe de calidade de datos
│   └── test.ts                     comprobacións executables
├── design/                         artboards do redeseño (.dc.html) + canvas.json
├── server.ts
├── DATA.md                         procedencia e licenzas dos datos
└── vite.config.ts
```

`design/` garda o redeseño como artboards da canvas de Claude Design: cada pantalla
nun `.dc.html` e o `canvas.json` que os coloca. Son o rexistro de por que a interface
é como é —as alternativas que se descartaron seguen aí— e ábrense coa canvas, non
como páxinas soltas. O ficheiro sementado que a canvas publica é un artefacto de
compilación e non se commitea.

---

### Por que hai 1,4 MB de JSON que a app non le

`official-raw.json`, `osm-routes.json`, `routes.json` e `stop-amenities.json` non se
importan en ningures da aplicación: só os len as ferramentas. Non son restos.

Son **instantáneas do que dixeron fontes de terceiros**, e están commiteadas por tres
razóns. Regeneralas require que buslugo.com, Overpass e OSRM estean en pé e devolvan o
mesmo, así que sen elas o dataset non é reproducible. Volver pedilas cada vez sería
machacar servizos alleos e gratuítos. E `pnpm reconcile` compara o que a app amosa
co que dixo o operador, o que precisa gardar o que dixo.

Un `git diff` sobre elas amosa exactamente o que cambiou augas arriba, que é a razón
pola que un scrape se garda en lugar de repetirse.

## Nunca mentir coas horas

É a regra do proxecto. A rede non ten seguimento GPS, así que **nada se presenta como
medido se non o é**, e cada hora que aparece en pantalla di de onde sae:

| Etiqueta | Significado |
| :--- | :--- |
| `HORARIO OFICIAL` | O operador publica esa hora para esa parada. |
| `~ ESTIMADO` | Saída de cabeceira publicada + tempo de percorrido medido por estrada. |

Consecuencias en toda a aplicación:

- Os vehículos do mapa din no seu globo que a posición é **estimada do cadro horario**,
  non medida por GPS. A lenda chámalles «posición estimada», non «en movemento».
- Eliminouse todo campo que non se podía encher honestamente: velocidade do vehículo,
  hora da última posición, retraso en segundos e accesibilidade por vehículo. Estaban
  inventados e amosábanse como datos.
- A ocupación segue existindo porque a hora do día si informa, pero chámase
  **«ocupación prevista»**.
- Os equipamentos de parada (marquesiña, banco) veñen de levantamentos reais de OSM; o
  que ninguén levantou queda baleiro en vez de dicir «non».
- O pé de páxina xa non anuncia un SAE en tempo real que non existe.
- O listado de liñas amosaba `1 GPS` cun radar a pulsar ao lado. Non hai GPS ningún: ese
  número son as expedicións que segundo o cadro deberían estar circulando, e agora
  chámase **`1 en ruta`**, sen radar e cun texto que o explica ao pousar o rato.

A etiqueta decídese **por expedición e parada**, non por liña. Unha parada só leva
`HORARIO OFICIAL` se a hora que calculamos para ese bus concreto está literalmente
impresa no cadro. Dúas cousas facían que se sobre-anunciase:

- As expedicións que se xeran a partir da cadencia non están impresas en ningures. A
  liña 2 publica `07:15`, `21:15` e «cada 30 min.»: as `07:45` son unha inferencia
  sólida, pero non unha hora oficial.
- Cando un cadro imprime máis pasos nun punto horario ca noutro, o tempo de tramo é
  unha mediana que para algunhas expedicións cae uns minutos fóra do impreso.

Cobertura real hoxe (`pnpm validate:times`): **386 paradas** teñen a súa hora suxeita
por horas oficiais a ambos os lados, e **822** quedan máis alá do último punto horario e
dependen do modelo de estrada. Nesas, o erro fronte ao impreso ten mediana de 0,5 min e
chega a 8,5 min no peor tramo medible. Por iso o `~` non é decorativo.

`pnpm test` inclúe comprobacións que fallan se algunha hora volve presentarse sen dicir de
onde vén, e se algunha parada reclama unha hora oficial que o cadro non imprime.

Cando non hai saídas no horizonte —ás 03:00, ou un domingo cedo— o taboleiro xa non queda
só cun «non hai saídas programadas»: di cal é a seguinte, a que hora e con que destino,
aínda que sexa mañá pola mañá. Quen está na parada precisa saber se agardar ou marchar.

---

## Motor de horarios

`src/utils/schedule.ts` traduce o cadro horario publicado a unha hora de paso por parada.

O operador publica dous formatos e o importador entende os dous:

- **Reixa completa** — unha columna por expedición. Úsase nas liñas sen cadencia fixa.
- **Primeira e última saída** por tipo de día, coa cadencia na cabeceira
  (`L-V laborais (cada 30 min.)`, `S, D e festivos (cada 60 min.)`). As expedicións
  intermedias xéranse a esa cadencia.

Cada sentido áncorase a **todos** os puntos horarios que se poidan encadear con
seguridade, e as paradas intermedias interpólanse entre eles: os tempos de estrada
medidos estíranse para caer exactamente nas dúas horas oficiais que os rodean. Así o erro
queda acoutado polo tramo en vez de acumularse ao longo de todo o percorrido. Máis alá do
último punto horario xa non hai contra que interpolar, e manda o tempo de estrada.

Encadear dous puntos non é gratuíto: unha liña cíclica imprime cada punto unha soa vez
para toda a volta, e a mesma rúa adoita ter un poste por sentido, así que dúas filas
poden nomear paradas que ningunha expedición visita nesa orde. Emparellalas columna a
columna producía saídas ás 03:00, e por iso antes se usaba un só punto. Agora o par
compróbase: o oco impreso ten que ser positivo, plausible como un tramo, e da mesma orde
que o tempo medido por estrada. Un desaxuste de ida/volta falla iso por decenas de
minutos — a liña 5.1 imprime 40 min nun tramo que a estrada di que son 18 — e cae fóra.

Efecto medible: a 5.1 saíndo de Avda. Américas ás 17:00 chega a Ramón Ferreiro ás
**17:10**, como di o cadro. Antes calculábase 17:06, e con eses catro minutos de vantaxe
ficticia o planificador ofrecía un transbordo á 1.1 das 17:09 que na realidade xa marchara.

O importador tamén entende as liñas con **dous buses**, que imprimen unha columna por
vehículo baixo unha soa etiqueta (`Bus 1 7:15 | Bus 2 7:45`). Indexar por posición de
etiqueta emparellaba a primeira saída de laborable coa de fin de semana: a liña 2 saía
como 7:15, 7:45, 8:15 e remataba o día, cando en realidade circula cada 30 min ata as
21:45.

O calendario distingue laborables, sábados e domingos/festivos, e admite ventás de
servizo que cruzan a medianoite.

---

## Planificador

`planSmartTrip` en `src/utils/transitEngine.ts`:

1. **Resolución** — texto libre, código de parada, punto de interese ou coordenadas GPS.
2. **Candidatas de embarque** — ata 10 paradas servidas a menos de 2 km de cada extremo,
   e nunca unha que obrigue a camiñar máis para coller o bus que para chegar andando.
   **Escóllense pola cobertura de liñas, non pola distancia**: pasadas as catro máis
   próximas, unha parada só entra se serve unha liña que ningunha máis preto ofrece. Coas
   dez máis próximas a secas, desde Fonte dos Ranchos as dez estaban no mesmo corredor e
   sumaban oito liñas, mentres que a décimo segunda —Rda. Muralla (Obras Públicas), a
   535 m— serve nove máis. O plan dun só bus nin sequera existía.
3. **Opcións** — a liña directa, os transbordos por calquera parada alcanzable desde a
   orixe e desde a que se poida chegar ao destino (as 40 mellor conectadas), **os
   transbordos entre dous postes distintos a menos de 300 m** co paseo escrito no
   itinerario, e sempre a opción de ir andando todo o camiño.
4. **Selección** — gaña a que chega antes, priorizando as liñas realmente en servizo. En
   caso de empate gaña a que leva menos tramos de bus: un cambio que non precisas segue
   sendo un cambio que podes perder.
5. **Tempos** — cada tramo en bus lese da expedición que se colle, co que respecta todos
   os puntos horarios oficiais do percorrido; os tramos a pé aplican un factor de rodeo
   de 1,35 sobre a distancia en liña recta a 75 m/min, e substitúense polo camiño real
   en canto o enrutador peonil de OSM responde. **Mídense todas as opcións que se amosan**,
   non só a aberta, ou compararíaslas por estimacións e logo veríaas cambiar ao abrilas.

Regras que evitan suxestións absurdas ou perigosas:

- **Nunca a mesma liña dúas veces.** Baixar dun 5.1 para agardar por outro 5.1 non ten
  sentido: no mesmo sentido é literalmente o bus no que xa ías, e o traxecto directo
  existe sempre nese caso. Aparecía como `5.1 → 5.1` no listado de opcións.
- **Unha tarxeta por combinación visible.** Dúas opcións coas mesmas insignias son a
  mesma viaxe para quen a le, aínda que difiran en poste, sentido do bucle ou rama rural
  (as catro liñas numeradas `11`). Gárdase a máis rápida.
- **Marxe de transbordo segundo a procedencia da hora.** Dous minutos abondan cando a
  chegada é oficial, porque as dúas puntas veñen do mesmo cadro; catro cando é
  interpolada. Pasarse de largo só empurra a suxestión ao seguinte bus, quedarse curto
  deixa a alguén na beirarrúa.
- **Cando saír da casa.** Cada opción amosa `sae ás HH:MM`, que é a hora de saír da
  orixe: a espera antes do primeiro bus pásase na casa, non na parada. Contala como
  tempo de viaxe facía parecer peor unha ruta que só saía máis tarde.
- **Nunca unha soa parada en bus.** Medido sobre 2.254 tramos ao mediodía, un tramo
  dunha parada son 1,2 min de viaxe tras 5,3 de espera, fronte a un paseo de 5 min entre
  eses dous postes: custa o que custa andar. Os nove que si lle gañaban ao paseo aforraban
  entre 1 e 3 minutos, e en toda a rede ningún chegaba a catro. Un aforro así non
  sobrevive a un bus con retraso, e a diferenza do paseo non o controlas ti.
- **O paseo enteiro só lidera se gaña claro.** Ten que sacarlle cinco minutos ao mellor
  bus, e nunca encabeza por riba de 75 minutos: un paseo de tres horas non é unha
  suxestión, é unha broma. Por debaixo diso ofrécese igual, ordenado como calquera outra.

Se ningunha combinación funciona, dise. Antes inventábase unha "liña de enlace"
inexistente.

---

## Buscador

`src/utils/searchUtils.ts`, por puntuación de relevancia:

| Coincidencia | Puntos |
| :--- | ---: |
| Código ou identificador exacto | 1000 |
| Inicio do nome | 800 |
| Fronteira de palabra | 600 |
| Contido no nome | 400 |
| Contido no enderezo | 200 |
| Distancia de Levenshtein (erros de escritura) | 100 |

Normaliza tildes (NFD) e expande abreviaturas (`rda`→`ronda`, `avda`→`avenida`,
`sta`→`santa`, `pza`/`plz`→`praza`, …). A consulta escápase antes de construír a
expresión regular.

---

## API REST

| Método | Ruta | Descrición |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Estado do servizo |
| `GET` | `/api/lines` | Todas as liñas |
| `GET` | `/api/lines/:id` | Unha liña |
| `GET` | `/api/stops` | Paradas, con `?q=` opcional |
| `GET` | `/api/arrivals/:code` | Próximas chegadas nunha parada |
| `GET` | `/api/stop/:code/arrivals` | Idem (alias) |
| `GET` | `/api/realtime/:stopId` | Idem (alias) |
| `GET` | `/api/routes/:lineId` | Percorrido en GeoJSON |
| `GET` | `/api/buses/scheduled-positions` | Onde debería ir cada expedición segundo o horario. **Non son vehículos observados.** `/api/buses/live` mantense como alias antigo |
| `GET` | `/api/plan?from=&to=` | Cálculo de traxecto |
| `GET` | `/api/alerts` | Avisos oficiais (`?refresh=true` forza) |
| `POST` | `/api/alerts/sync` | Forza a sincronización |
| `GET` | `/api/fares` | Tarifas |

---

## Tecnoloxías

React 19 · TypeScript 5.8 · Vite 6 · Tailwind CSS 4 · Leaflet 1.9 (directo, sen
envoltorio) · Lucide React · Express 4 · vite-plugin-pwa · tsx · esbuild.

O escaneo de QR usa `BarcodeDetector`, nativo do navegador: sen dependencia externa.

### Funciona sen conexión

A aplicación é unha PWA instalable. Todo o que calcula —horarios, chegadas, rutas—
execútase en local sobre datos empaquetados, así que unha vez instalada segue a
funcionar sen cobertura, que é xusto o que pasa nunha marquesiña. As teselas do mapa
cachéanse segundo se van vendo e os avisos oficiais usan rede-primeiro con recurso á
última resposta gardada.

### Tamaño de descarga

A xeometría viaria (510 KB) e Leaflet cárganse só ao abrir un mapa:

| | Antes | Agora |
| :--- | ---: | ---: |
| Carga inicial (gzip) | 267 KB | **136 KB** |
| Xeometría viaria | no bundle | 85 KB, baixo demanda |
| Leaflet + capas | no bundle | 50 KB, baixo demanda |

### Rigor de tipos

`strict` está activado. Non o estaba: o proxecto herdara un `tsconfig.json` de andamio
e, sobre todo, **non tiña instalados `@types/react` nin `@types/react-dom`**, así que
todo JSX era `any` e as props de todos os compoñentes levaban sen comprobarse desde
sempre. Ao instalalos, os erros baixo `--strict` pasaron de 1581 a 19, e os que quedaban
eran reais: tres capas do mapa recibindo unha prop que ningunha lía, e `null` circulando
onde o código asumía un valor.

### Seguridade

`pnpm audit`: **0 vulnerabilidades** sobre 8 dependencias de produción e 10 de
desenvolvemento. Dependabot revisa semanalmente as dependencias e mais as actions.

**Content Security Policy.** `script-src 'self'`, sen `unsafe-inline` nin `unsafe-eval`:
o build non ten ningún script en liña, nin worker, nin wasm, e o escáner QR usa o
`BarcodeDetector` do navegador en vez dunha librería. As únicas orixes remotas
permitidas son as catro que a app usa de verdade — CARTO polas teselas, Google Fonts
polas dúas tipografías e o enrutador peonil de OSM. buslugo.com non está: só o servidor
o consulta, nunca o navegador.

A política escríbese unha vez en [`src/security/csp.ts`](src/security/csp.ts) e vai a
dous sitios, porque o despregue real é GitHub Pages e un aloxamento estático non envía
cabeceiras: **dentro da páxina**, inxectada ao construír, e **como cabeceira** para quen
o hospede el mesmo. Inxéctase ao construír e non no HTML fonte porque en `vite dev`
bloqueaba o websocket de recarga en quente, e ensanchar a política de produción para
admitir un socket de desenvolvemento sería facelo ao revés. `npm test` comproba que
`script-src` segue sendo só `'self'` e que ningunha orixe permitida sobra.

**Límite de peticións.** 120 peticións por minuto e enderezo, 30 se son de planificación,
que é a única chamada que custa decenas de milisegundos. Devolve `429` con `Retry-After`.
Está en memoria e por proceso a propósito: dúas instancias detrás dun repartidor de
carga permitirían o dobre, e [o comentario que o di](src/security/rateLimit.ts) é o
sitio onde buscalo se algún día se replica.

**Integración continua.** Permisos mínimos por traballo (o de construír só le a árbore;
só o de despregar escribe en Pages), `persist-credentials: false` no checkout para que o
token non quede en `.git/config` durante o resto do traballo, e unha lista branca en
`package.json` que só lle permite executar script de instalación a `esbuild`, que o
precisa para colocar o seu binario. Calquera dependencia nova que traia un `postinstall`
—que é onde correría primeiro se estivese comprometida— queda bloqueada ata que alguén
a engada aí a man.

O servidor normaliza todo o que chega pola query string (`?q[]=a` facía caer o endpoint
cun volcado de pila), devolve JSON en caso de erro en lugar da páxina de erro de Express,
limita o corpo das peticións a 32 KB e envía `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy` e `Permissions-Policy`. Os nomes que se interpolan en HTML nos globos
do mapa escápanse.

### Accesibilidade

`lang` do documento segue o idioma elixido, hai ligazón de salto ao contido, o taboleiro
de chegadas é unha rexión `aria-live` (actualízase cada 15 s) e as filas clicables son
alcanzables co teclado.

Esa última frase estivo aquí antes de ser certa. A sonda que daba por boa a aplicación
buscaba `button`, `a[href]`, `[role=button]` e `summary` sen nome accesible, e un `div`
cun manexador de clic non é ningún deles: **cada fila da lista de liñas era un `div`**,
así que coa pestana Liñas enteira non se podía abrir ningunha liña sen rato, e as dúas
listas de suxestións do planificador tiñan o mesmo problema. Tampouco vía o contedor de
Leaflet, que é un `div` ao que a librería lle pon `tabindex="0"`: os dous mapas eran unha
parada de tabulación sen nome e os seus controis dicían "Zoom in" en inglés baixo unha
interface en galego. Está todo arranxado, e a sonda marca agora `cursor: pointer` sobre
calquera cousa que non sexa interactiva.

**Contraste.** A insignia dunha liña é texto branco sobre a cor da liña a 10 px, e o número
que leva é o único que hai que ler dun golpe de vista. Cinco das vinte e catro non chegaban
ao mínimo de WCAG AA para texto pequeno —a liña 2 quedaba en 2,94:1 fronte ao 4,5 esixido—,
o que nunha marquesiña a pleno sol non se le. Escureceuse cada unha o mínimo que pasa a
proba, entre un 10% e un 22%, mantendo o ton. Medido no navegador, os fallos de contraste
pasaron de **84 de 400 elementos a 0**, e `pnpm test` xa non deixa entrar unha cor ilexible.

**Obxectivos táctiles e tipografía.** Despois do redeseño, os catro tabs, o detalle de
liña, o menú e a vista de avisos non teñen ningún elemento interactivo por debaixo de
44×44 px nin texto por debaixo de 12 px, medido no navegador en claro e escuro. As
excepcións que quedan son deliberadas: os pines do mapa (28–32 px, un pin de 44 taparía
a rúa), a atribución obrigatoria de Leaflet e as ligazóns dentro dunha frase, que a
WCAG 2.5.5 exime expresamente.

**Modo escuro e escala do sistema.** **O tema por defecto é o escuro**, e claro ou automático lémbranse só se se escollen:
isto lese de pé nun poste, moitas veces xa de noite, e un móbil en claro todo o día
non é unha opinión sobre como debe verse un cadro horario ás once. `public/theme-init.js`
resólveo antes do primeiro pintado —un ficheiro á parte, non un script en liña, porque
a política de seguridade é `script-src 'self'`— e `<html>` xa vén con `class="dark"`,
así que non hai destello branco nin sequera sen JavaScript. A escala tipográfica está en `rem` (12·15·19·23·29·46 px sobre unha
base de 16), así que o axuste de tamaño de letra do sistema operativo funciona en toda
a aplicación en lugar de quedar conxelado en píxeles. `prefers-reduced-motion` desactiva
transicións e animacións.

**Estado anunciado.** Os conmutadores levan `aria-pressed` (vistas do taboleiro, capas
do mapa, filtros de liña, modo de hora, opcións de traxecto, tema e idioma) e a
navegación usa `aria-current="page"`.

---

## Tres idiomas

Galego, castelán e inglés. O inglés non é decorativo: por Lugo pasa o Camiño de
Santiago e boa parte de quen le en inglés está de paso dous días e non viu nunca a
rede, así que a redacción asume iso — "o código do poste" antes que "o QR", e "sen
seguimento GPS" dito de fronte.

Os **nomes propios non se traducen**. "Rda. Muralla 56" é un enderezo de Lugo léase
no idioma que se lea, e quen vén de fóra ten que casar o que pon a pantalla co que pon
o poste e co que di o condutor.

### Como está feito

Un dicionario por idioma en `src/i18n/`, sen librería. O galego é a fonte e os outros
dous están tipados contra el (`type Dict = typeof gl`), así que **unha chave que falte
ou sobre é un erro de compilación**, non un burato na pantalla.

Isto substituíu doce bloques `{gl, es}` dentro dos compoñentes e **trinta e cinco
ternarios** `lang === 'gl' ? a : b`. Eses ternarios eran o motivo real de facelo: cun
terceiro idioma devolven castelán en silencio, sen erro e sen aviso.

O motor tamén escribe prosa ("sube á Liña 5.1 e baixa tras 25 paradas"), así que recibe
o idioma como parámetro en lugar de lelo dunha variable global. E as datas fórmanse con
`Intl` no idioma de quen le: os avisos gárdanse como instante ISO porque unha soa
descarga serve a todo o mundo.

`pnpm test` comproba que os tres dicionarios teñen exactamente a mesma forma, que ningún
valor está baleiro, e que planificar o mesmo traxecto en tres idiomas dá tres textos
distintos — se non, o motor está ignorando o idioma.

---

## Móbil e escritorio

Non é un deseño estirado: son dous caparazóns sobre o mesmo código.

**Móbil.** Buscador único arriba (paradas, liñas e rúas, co escáner QR ao lado, porque
estando no poste escanear a pegatina é o camiño máis curto que hai entre "estou aquí" e
"estes son os meus tempos"). Catro destinos abaixo, ao alcance do polgar, de 60 px de
alto. Lista ou detalle, nunca os dous apertados.

Non hai que rolar para facer o que se veu facer. O **mapa** vai primeiro e ocupa 62vh,
coa fila de filtros asomando por debaixo: antes a barra lateral apilábase enriba e a
pestana do mapa abría con 751 px de paneis e ningún mapa. Na **ruta**, o resumo —minutos,
saída, chegada— vai antes das alternativas e do mapa; ao responder, o formulario prégase
a unha liña co traxecto e os destinos rápidos retíranse, porque son para escoller, non
para ler unha resposta. A pantalla abre cun traxecto de exemplo xa calculado, que en
escritorio ensina o que fai a ferramenta e no móbil agarda a que preguntes.

Medido a 390 px: a resposta pasou do píxel 1.493 ao 103, e a pantalla de ruta de 4,61
a 3,18 pantallas de alto. O que queda é o itinerario paso a paso, que é unha lista.

**Escritorio (`lg` en diante).** Rail esquerdo fixo con os catro destinos etiquetados e,
ao pé, avisos, tarifas, tema e idioma. Paradas e Liñas son dous paneis con **scroll
independente**: escoller unha parada non che fai perder o sitio na lista. No planificador
o formulario queda fixo mentres o itinerario baixa ao lado. A barra inferior desaparece.

---

## Despregue

### Nun aloxamento estático (GitHub Pages)

**A aplicación non precisa servidor.** Horarios, chegadas, planificador, mapa e busca
calcúlanse no navegador a partir dos datos empaquetados, así que todo son ficheiros
estáticos. `.github/workflows/deploy-pages.yml` publica en Pages en cada `push` a `main`
e cada hora, refrescando antes a copia dos avisos oficiais.

Para activalo: **Settings → Pages → Source: GitHub Actions**. O workflow define
`BASE_PATH` co nome do repositorio para que as rutas apunten a
`https://<usuario>.github.io/<repo>/`. Con dominio propio ou nunha *user page*, pon
`BASE_PATH: /`.

O único que cambia sen servidor son os **avisos oficiais**: o navegador non pode ler
buslugo.com por CORS, así que se usa a copia horaria que deixa a tarefa programada e
amósase **cando se tomou**. Todo o demais é idéntico, incluído o funcionamento offline.

Se despregas o servidor Express (`pnpm start`), os avisos pásanse a consultar en vivo.

---

## Instalación

Precisa **Node 20 ou superior** e **pnpm**, que é o xestor que declara `package.json` e
o que usa a integración continua con `--frozen-lockfile`. `pnpm-lock.yaml` é o único
ficheiro de bloqueo do repositorio; instalar con outro xestor daría unha árbore distinta
da que se proba e se desprega.

```bash
corepack enable && corepack prepare --activate
```

```bash
pnpm install
```

```bash
pnpm dev
```

Dispoñible en `http://localhost:3001` (ou o primeiro porto libre).

```bash
pnpm build
```

```bash
pnpm start
```

Non fai falla ningunha chave nin conta: os datos van no repositorio e a app funciona sen
conexión. `.env.example` só ten o porto.

---

## Rexenerar os datos

Só é necesario cando o operador cambia a rede.

```bash
pnpm data:fetch
```

Descarga as páxinas de liña e as fichas de parada (cacheadas en `.cache/`) e axusta cada
itinerario á rede viaria. A primeira execución tarda uns 15 minutos; as seguintes
reutilizan a caché e a xeometría xa calculada.

```bash
pnpm data:alerts
```

Toma unha copia dos avisos oficiais para o aloxamento estático. Execútao a tarefa
programada; a man só fai falta para probar.

```bash
pnpm data:amenities
```

Trae de OpenStreetMap os equipamentos de cada parada. Opcional: se o ficheiro non existe,
`data:build` simplemente deixa eses campos a `null`.

```bash
pnpm data:build
```

Agrupa os postes duplicados, resolve os identificadores oficiais, asigna zonas e escribe
`stops.json` e `lines.json`. Execútase en segundos e sen rede.

---

## Verificación

```bash
pnpm test
```

71 comprobacións con asercións sobre o que xa estivo mal algunha vez: unicidade de
códigos, coherencia entre `stop.lines` e os itinerarios, xeometría que segue as rúas,
tramos non máis curtos ca a liña recta, ventás de servizo nocturnas, monotonía das horas
de paso, flota baleira fóra de servizo, puntos de interese preto da rede, traxectos
plausibles, que ningunha hora se amose sen dicir de onde vén, e que os filtros contra
posicións falsas rexeiten o que teñen que rexeitar.

Cada unha naceu dun fallo real, e o comentario de arriba di cal. Que dous postes non
compartan punto (nove liñas publicábanse como dezaoito paradas); que a conta de códigos
QR da cabeceira sexa a de postes que teñen un de verdade; que un nome que o operador
aínda imprime siga sendo buscable despois de fusionar; que un trazado feito coa ruta
dun coche o diga; e que ningún traxecto propoña coller o bus para unha soa parada.

Cinco delas percorren o planificador enteiro a catro horas distintas (punta da mañá,
tarde, despois do último bus e domingo) e esixen que ningún itinerario retroceda no
tempo, que ningún transbordo sexa imposible, que ningún repita liña e que as opcións
ofrecidas se distingan entre si. Outras dúas comproban que o cadro horario se reproduce
tal cal se publica.

```bash
pnpm reconcile            # contra as páxinas en disco
pnpm reconcile -- --fresh # volve baixar buslugo.com (~30 s)
```

Contrasta parada a parada o que publicamos contra **as mesmas páxinas que usa a xente**.
Non le `official-raw.json`: volve parsear o HTML do operador, porque comparar a saída dun
build contra a súa propia entrada intermedia sempre daría ben. Comproba a posición de cada
poste contra a súa propia páxina de parada (a do QR), a fusión de identificadores, o
itinerario de cada sentido, o nome, as liñas que anuncia cada parada e o cadro horario.
Con `--fresh-stops` volve ler tamén as 1186 páxinas de parada (~20 min).

Estado a 20/08/2026, contra buslugo.com no mesmo día:

| Comprobación | Resultado |
| :--- | :--- |
| Posición fronte á páxina de cada parada | 1186 ids, desvío p50 **0 m**, p99 4 m, peor 37 m |
| Postes que funden varios ids | 251, dispersión máxima **50 m** |
| Itinerarios (que paradas) | **0 diferenzas** |
| Itinerarios (en que orde) | **47/48** idénticos; 1 sentido con 3 paradas movidas |
| Cadros horarios | **24/24** coinciden |
| Liñas que anuncia cada parada | **417/417** |
| Nomes | **417/417** usan un nome que o operador imprime |
| Fronte ás paradas levantadas en OSM | 413/417 a menos de 120 m (mediana **7 m**) |

As 4 restantes son postes rurais que ninguén cartografou en OSM; a peor, `A Brea`, está a
**0 m** da coordenada que publica o propio operador. E hai 8 postes que o operador nomea
de dous xeitos entre os seus propios ids (`A Tolda (UNED)` / `(Gasolinera)`): amósase o
maioritario.

O único sentido que non se publica na orde impresa é a **5.1 de volta**, con tres paradas
movidas: `Fonte dos Ranchos 42-43`, `Rúa Doutor Gasalla 3` e `Ramón Ferreiro 26`, que a
páxina lista ao principio cando a ruta pasa por elas ao final. Lida ao pé da letra son 19,0
km fronte aos 8,2 reais, e ningún cadro horario que imprima 20 minutos para iso pode ser
certo.

**As cabeceiras non se tocan nunca.** Unha reordenación anterior movía a primeira parada da
volta de `HULA (Ent. Principal)` a `(Ent. Personal)` porque o trazado levantado pasa antes
por esta: a relación de OSM debuxa o bucle do hospital unha soa vez, á entrada, e o bus
volve pasar por Personal ao saír. Pero a ida remata en Principal, así que a volta empeza
alí — calquera outra cousa fai que o bus retroceda 651 m antes de arrancar. `pnpm test`
comproba agora que cada sentido remata onde empeza o outro, en toda a rede.

```bash
pnpm reconcile:selftest
```

Estraga os datos a mala fe —move unha parada 200 m, quita unha doutro itinerario, ponlle
unha liña que non pasa, cámbialle unha hora, renoméaa— e esixe que **a comprobación feita
para cada fallo sexa a que o detecte**. Se outra sección salta no seu lugar, é que as dúas
miden o mesmo. Restaura os ficheiros pase o que pase.

Existe porque o `reconcile` xa estivo mal tres veces: comparaba as catro ramas da liña 11
contra a mesma liña publicada (inventaba ~180 erros), comparaba os nomes por identificador
cando o operador imprime varios por poste (inventaba 8), e o propio auto-test usaba un
prefixo de sección ambiguo. **Un verificador que sempre di que todo está ben é
indistinguible dun que non comproba nada.**

```bash
pnpm data:osm
```

Volve pedir os itinerarios a OSM e, de paso, lista os metros de cada ruta que caen sobre
vías pechadas a vehículos. Se algún día unha edición de OSM manda unha liña por unha
senda peonil, aparece aquí en vez de acabar calada no mapa.

```bash
pnpm validate:times
```

Canto do que se amosa é hora do operador e canto modelo: paradas suxeitas por horas
oficiais a ambos os lados fronte ás que quedan fóra, e canto se desvía o tempo de estrada
dos tramos que si se poden contrastar. É a medida do risco que leva un `~`.

```bash
pnpm calibrate:walking
```

Mide 120 camiños peonís reais contra a liña recta para fixar o factor de rodeo. En Lugo
vai de 1,03 a 2,38 con mediana 1,26, e o router camiña a 75 m/min. A dispersión é o dato:
a muralla, o río e o ferrocarril impoñen rodeos que ningunha constante predí, así que o
peor caso queda a uns 14 min escóllase o número que se escolla. Por iso se usa 1,35, por
enriba da mediana, e por iso o camiño real hai que **pedilo**, non calculalo.

```bash
pnpm audit
```

Informe lexible: cobertura, ficha por liña, **tramos sospeitosos** (desvío viario fronte
á liña recta superior a 4x, que adoita sinalar dous postes opostos da mesma rúa no mesmo
sentido), estado en vivo e taboleiro nas paradas máis conectadas.

```bash
pnpm lint
```

---

## Limitacións coñecidas

- **Non hai posición GPS real da flota.** Non existe fonte pública. Os vehículos que
  amosa o mapa son as expedicións do cadro horario situadas sobre o trazado: onde
  *debería* estar o bus, non onde está. A aplicación nunca di "en tempo real".
- **Cada hora leva a súa procedencia.** `HORARIO OFICIAL` é a hora que publica o
  operador para esa parada; `ESTIMADO` (co prefixo `~`) calcúlase desde a saída de
  cabeceira máis o tempo de percorrido medido por estrada. Como o segundo pode desviarse
  uns minutos, convén chegar á parada antes da hora amosada.
- **2 tramos de 1135 (0,2%)** teñen un desvío viario superior a 4x fronte á liña recta,
  é dicir: o camiño por rúa entre dúas paradas consecutivas é máis de catro veces a
  distancia en liña recta. Adoita significar que o itinerario lista os dous postes
  opostos da mesma rúa dentro do mesmo sentido (o bus tería que dar a volta), ou que
  hai sentidos únicos no casco histórico. `pnpm audit` lístaos un a un.
- **12 paradas sen coordenadas** na fonte quedan fóra do conxunto de datos.
- **Festivos locais** non se distinguen dos domingos.
- **Tres sentidos debúxanse coa ruta dun coche**, non co itinerario levantado en OSM:
  a 3.2 nos dous sentidos e a 5.2 cara a Avda. Américas. A liña azul do mapa pode
  desviarse por onde o bus non pasa. As paradas e as horas seguen a ser as oficiais, e
  a ficha da liña dío cando é o caso.
- **Non hai liña nocturna fixa.** O operador non publica ningunha. Os reforzos de
  San Froilán, Noitevella e datas semellantes existen pero anúncianse como aviso puntual,
  sen cadro horario, así que a aplicación non inventa unha liña: cando non hai servizo,
  o aviso remite á sección de avisos, que é onde aparecerían.
- **Zonas de parada**: asígnanse por proximidade e suavízanse por veciñanza. Aínda así,
  arredor do 18% das paradas teñen algunha veciña a menos de 200 m nunha zona distinta,
  o normal nas fronteiras entre barrios.
- **Non hai historial de fiabilidade** ("este bus non pasou"). Necesita base de datos: en
  memoria perderíase en cada despregue, e rexistrar algo que se esvae sería outra forma
  de mentir.
- **Non hai posicións en tempo real de ningún tipo.** Ver [Ideas para máis adiante](#ideas-para-máis-adiante).
- O cadro horario dá as saídas de cabeceira; as horas nas paradas intermedias son
  estimacións a partir do tempo de condución medido, non horas publicadas.

---

## Licenza

O **código** vai baixo licenza MIT — ver [`LICENSE`](LICENSE).

Os **datos non**. Os horarios veñen de buslugo.com (AULUSA / Grupo Monbus) e a xeometría
dos percorridos deriva de OpenStreetMap, que é ODbL. Cada conxunto ten as súas condicións
e a súa procedencia detallada en [`DATA.md`](DATA.md).

Este proxecto **non é un servizo oficial** e non está avalado por AULUSA, Grupo Monbus
nin o Concello de Lugo. É un lector dun cadro horario público.

Cartografía © OpenStreetMap contributors © CARTO.

---

## Ideas para máis adiante

Cousas avaliadas e aparcadas a propósito, coa razón, para que quen as retome saiba de
onde parte.

### Tempo real colaborativo

Chegou a estar implementado e retirouse para manter o proxecto estático e sen servidor
que manter. A idea, tomada da app *Transit*: quen vai no bus comparte a súa posición e
serve a quen agarda máis adiante. É a única forma realista de ter tempo real nesta rede
mentres o operador non publique un feed.

O que se aprendeu montándoo, por se se retoma:

- **Nunca debe substituír o horario.** Amosábanse os dous, un ao lado do outro, co número
  de avisos que sosteñen a posición compartida. Así un dato falso confunde pero non tapa
  a información boa.
- **Filtros que si se poden facer**, porque temos xeometría viaria e horarios: rexeitar
  posicións a máis de 150 m da ruta real, e rexeitar calquera aviso dunha liña que a esa
  hora non ten ningunha expedición en curso. Máis límite por dispositivo e caducidade
  curta. Ningún demostra que quen envía vaia no bus — iso non se pode saber.
- **Privacidade**: sen conta nin identificador, só en memoria, caducidade de 2 minutos e
  coordenadas redondeadas.
- **Coste**: o patrón é escritura frecuente e lectura moi frecuente. A clave é **cachear
  o agregado** uns 15 s no CDN, co que só as escrituras chegan ao almacén e a cousa cabe
  nunha capa gratuíta.

Implicación: obriga a ter backend. Antes de retomalo, decidir se a función paga ese custo
operativo.

### Liñas interurbanas no taboleiro

Quen agarda en Sindicatos tamén pode coller un autocar da Xunta desde a mesma beirarrúa,
e hoxe iso obriga a abrir a web do operador. **É factible**: comprobado que 129 das 417
paradas urbanas teñen unha interurbana a menos de 150 m, con emparellamentos claros
(`Rda. Muralla 56 (Sindicatos)` ↔ `Ronda da Muralla 56 (sindicatos)`). Tamén aparecen
ALSA e Renfe, nas estacións.

O que custa, medido:

- A fonte é o GTFS da Xunta que agrega [Transitous](https://transitous.org). A súa API
  **non serve** para isto: esixe unha cabeceira `User-Agent` con nome e contacto, e un
  navegador non pode poñela. A propia política remite a descargar o conxunto de datos.
- Ese ficheiro son **61,5 MB comprimidos** (127.784 viaxes, 22.386 paradas). Habería que
  descargalo nunha tarefa programada, descomprimilo (nova dependencia de build),
  filtrar `stop_times` ás ~217 paradas de Lugo e respectar `calendar` e `calendar_dates`
  para os días de servizo. A saída final serían unhas poucas miles de filas.
- Encaixa co resto do proxecto: build-time, sen dependencia en execución, e a aplicación
  seguiría funcionando sen conexión.

Non está feito porque é un pipeline novo comparable ao do urbano, non un engadido
pequeno. A decisión previa é se paga a pena manter esa descarga.

### Que o móbil vibre coa aplicación pechada

Hoxe os avisos («avisar 5 min antes», «avisarme ao chegar») só soan con la pantalla
aberta, e a interface dío en ámbar en canto se activa un. Non é unha limitación nosa:
**unha páxina web non pode espertarse soa a unha hora concreta.**

O que existe e o que non:

- **Web Push** (Service Worker + Push API + VAPID) funciona en Chrome, Firefox e Edge, en
  escritorio e Android; en iPhone só desde Safari 16.4 e **só se a aplicación se engade á
  pantalla de inicio**. Pero é *iniciado polo servidor* por deseño: alguén ten que enviar
  a mensaxe ao endpoint de push. Un aloxamento estático como GitHub Pages non pode.
- **Programar unha notificación local** para dentro de vinte minutos non ten API na web.
  Notification Triggers quedou en proba de orixe en Chrome e nunca se publicou. O
  Periodic Background Sync é só de Chrome/Android, esixe a app instalada e está limitado
  a intervalos de horas: non serve para avisar cinco minutos antes dun bus.

Así que só hai dous camiños, e o intuitivo é o caro:

| | Que fai falta | Onde funciona |
| :--- | :--- | :--- |
| Seguir sendo web | Un servidor mínimo que garde a subscrición e dispare á hora — a Raspberry Pi de abaixo, ou un cron sen servidor | Android e iPhone coa app na pantalla de inicio |
| Envoltorio nativo (Capacitor) | Nada máis: Android e iOS programan alarmas locais sen rede | Android e iPhone, tamén sen conexión |

Como os nosos tempos veñen dun cadro horario e non dun GPS, **a hora do aviso sábese de
antemán**. Iso é exactamente o que unha alarma local resolve sen servidor ningún, e é o
único que a web non deixa facer. Se algún día se fai, a mensaxe ten que levar a mesma
etiqueta de procedencia que a pantalla: un aviso que vibra é unha promesa máis forte ca
un número que alguén decidiu mirar.

### Un panel físico nunha Raspberry Pi

Unha pantalla no recibidor que diga «sae en 6 min, colle o abrigo». **É factible con moi
pouco**, porque a arquitectura xa o permite sen querelo: os datos son ficheiros JSON
estáticos e o motor (`schedule.ts`, `transitEngine.ts`) é TypeScript sen DOM nin
dependencias de navegador. Unha Pi con Node importa exactamente o mesmo código e calcula
en local; `estimateWalk` máis `getArrivalsForStop` dan «cando saír da casa» nunhas trinta
liñas. Sen API, sen servidor propio, e segue funcionando se cae a rede.

O que falta non é código, é compromiso: publicar as URLs dos datos como **interface
estable** e documentala, para que un aparello aí fóra non rompa cada vez que se cambia a
forma dun JSON. Iso e un exemplo mínimo que sirva de referencia.

Cae despois das interurbanas na orde de prioridade: aproveita todo o traballo feito, pero
non lle serve a ninguén que non teña unha Pi.

### Historial de fiabilidade

"Este bus non pasou", con estatísticas por liña. Necesita base de datos de verdade
(persistencia, consultas, agregados). Non ten sentido en memoria: perderíase en cada
despregue, e rexistrar algo que se esvae sería outra forma de mentir. Se algún día se
monta backend, faise á vez que o anterior.

### Modo escuro e obxectivos táctiles

Reservados para o redeseño pendente, porque tocan o sistema visual enteiro.

### Un GTFS municipal

O de máis impacto e o menos técnico: o Concello concede o servizo e pode esixir que se
publique GTFS e GTFS-Realtime. Iso resolvería de golpe os datos e o tempo real, e
substituír o scraper por un lector de GTFS afectaría só a `tools/importOfficialData.ts`.
