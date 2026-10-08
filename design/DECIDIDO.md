# O que se decidiu, e por que

Tres plans de deseño escribíronse antes de tocar código, executáronse, e quedaron no
repositorio como plans dunha cousa xa feita. Este ficheiro garda o que deles importa
—as decisións, coa súa data, a súa razón e a súa medida— e os plans sacáronse do árbore
o 15 de setembro de 2026. Os textos completos, coas maquetas e as voltas, están no
historial de git ata ese día (`design/PLAN-acento-vermello.md`, `design/PLAN-mapa-propio.md`,
`design/PLAN-vou-no-bus.md`). As medidas e os fallos de cada rolda seguen en
[`REXISTRO-probas.md`](REXISTRO-probas.md); o que nunca se fará, e por que, no README en
«Ideas para máis adiante».

A regra que atravesa os tres: **non presentar como medido o que non o é**, e medir antes
de afirmar. Cada decisión de abaixo se tomou contra unha cifra, non contra un gusto.

---

## A marca e a paleta — 27 de agosto de 2026

- **O acento é o vermello de flota, `#d81f26`.** Os autobuses de Urbanos de Lugo son
  vermellos e levan a muralla no lateral. O azul anterior (`#1e3a8a`) nunca se escollera:
  era o `blue-900` de Tailwind. Recomendouse verde nun momento, co argumento de que o
  vermello significa erro; caeu cando se decidiu que o distintivo de horario oficial podía
  cambiar de cor. *Non revisitar sen ese contexto.*
- **A icona é A Mosqueira, forma F3**: a torre co remate de dous arcos tanxentes, o adarve
  atravesando a placa, e a parada como un anel sobre esa liña. Vista a 16, 20, 32, 64 e
  160 px contra outras dúas variantes e mantida; que a 16 px se lea coma un «m» está dito e
  aceptado. Un só ficheiro, `public/favicon.svg`; había dous debuxos e dous debuxos
  diverxen.
- **Tres tons levan significado e ningún outro o leva**: vermello a app, azul unha hora
  publicada polo operador, ámbar unha hora calculada por esta app. Sepáranos 50 graos ou
  máis en oklch, e un check átao. O oficial **non foi a verde**, aínda que o plan o dicía:
  verde e vermello son o único par que un lector con daltonismo non separa, e o azul,
  agora o único azul do sistema, é máis claro, non menos.
- **Os neutros deixaron de estar tinguidos de azul** (ton 255, herdado do acento vello):
  pasaron ao ton 40 no tema claro e 34 no escuro, mesma luminosidade. É a diferenza entre
  unha paleta escollida e unha herdada.
- **Todo par que a interface pon en pantalla pasa de 4,5:1**, o peor sendo texto de
  acento sobre superficie a 5,13:1. Medido co alfa fundido sobre o fondo real e as
  transicións conxeladas: sen iso saen falsos negativos de 1,4:1.
- **O acento non aparece no mapa.** Varias liñas son vermellas; un marcador vermello
  desaparecería xusto na ruta que marca. `stopSelected` e o punto de posición quedan
  azuis por iso.
- **O filete dos bordos queda en 1,37:1**, por baixo do que pediría a norma para o
  contorno dun control. Subilo cambia o peso visual de toda a app e non se pediu. Segue
  aberto, a propósito.
- De paso: `background_color` do manifest a escuro (a app instalada abría cun fogonazo
  branco), a lenda do mapa pasa a usar a cor da liña activa (usaba o acento e acertaba por
  casualidade), e a cor de selección de texto pasa por un token.

## O mapa de debaixo — 8 e 9 de setembro de 2026

- **O estilo do basemap é do repositorio**, derivado do de OpenFreeMap e xerado por
  `tools/buildMapStyle.ts` desde unha táboa de transformacións (`pnpm run map:style`).
  Antes eran parches de cor aplicados en execución, cun `try`/`catch` que perdoaba
  calquera cambio de nome augas arriba: o axuste que apaga os nomes de rúa a partir do
  zoom 16 **nunca se aplicara no tema claro** e ninguén o soubo. Un ficheiro que se
  comproba na build, en vez dun parche que se perdoa.
- **Fóra o amplificador.** `.dark .leaflet-tile-pane { filter: brightness(2.8) }` era de
  cando o basemap era ráster de CARTO; coas teselas vectoriais multiplicou meses cada cor
  do estilo por 2,8, e só o basemap: as rutas ían no outro *pane*, sen multiplicar. Esa
  era a razón enteira de que unha liña desaparecese na rúa de debaixo. Un check impide
  que o `tile-pane` volva levar filtro.
- **Este mapa non é un mapa de Lugo**: é o fondo de 24 cores de liña e 417 paradas, e
  todo o que hai nel recúa. No escuro, as rúas son canles escuras con bordo claro, non
  cintas claras; os edificios a 1,18 sobre o chan, o parque a 1,16, a rúa menor a 1,31 e o
  bordo da maior a 1,67. **As 24 liñas quedan a 1,45 ou máis** sobre as tres capas de rúa
  que cruzan, e a 1,63 sobre os edificios. O teito ponno a liña 11: o seu marrón é escuro
  porque o número en branco do badge ten que pasar 4,5:1, e o que fai lexible o badge é o
  que fai que a liña desapareza nun mapa escuro. Se algún día o basemap ten que ser máis
  claro, o resorte é un fío escuro debaixo da ruta, non outro paso no chan.
- **O claro tamén estaba mal e o plan dicía que non.** Enviouse un commit afirmando que
  «Positron xa mide ben» cando só se medira a tinta sobre as rúas. O contorno dos edificios
  separaba case o dobre có recheo (unha mazá como un alambre) e o recheo, a 1,08, non
  separaba a cidade dos campos. Agora edificio a 1,23, rúa menor a 1,05 clara, maior a
  1,11. Probouse subir os edificios a 1,30 e non moveu nada visible; probouse dar ao
  bosque o verde do escuro e pintou o 57 % da pantalla.
- **Ningún rótulo do basemap baixa de 4,5**: os nomes de rúa (2,3) e de lugar (3,0) do
  estilo publicado corríxense; o nome da auga viña en negro ao 70 % sobre un mapa case
  negro.
- **Fóra as frechas de sentido único**, nos dous temas: ninguén que lea isto vai
  conducindo, saían xusto onde os rótulos das paradas precisan o sitio, e ademais o
  sprite debúxaas atravesadas na calzada.
- **Fóra o tinte de `landuse_residential`**: disimulaba que A Piringalla ten 57 edificios
  cartografados por quilómetro cadrado contra 4.588 no centro. Un barrio baleiro no dato
  ten que parecer baleiro.
- **A tipografía do basemap queda a de OpenFreeMap** (Noto Sans, glifos SDF): servir a
  nosa serían un ou dous megabytes para un texto que desaparece por riba do zoom 16,5,
  onde os nosos rótulos toman o relevo. O número dentro do pin de parada, que ía en
  `sans-serif` do sistema, pasa á cara da app.
- **Non se tocan**: a atribución (agora tamén dentro do ficheiro), as orixes de teselas,
  sprites e glifos, as cores de liña, e as nove capas que nunca debuxan en Lugo (quitalas
  aforra tres kilobytes e estropea o mapa a quen se afaste).
- **O basemap non é CARTO desde agosto de 2026**: comezou a estampar «API KEY REQUIRED»
  nas teselas sen chave. OpenFreeMap, sen chave e sen conta; a decisión vive en
  `src/components/Map/basemap.ts`.

## A pantalla Ruta e o modo «vou no bus» — 7 a 13 de setembro de 2026

### A raia

- **Non se debuxa o bus.** Ninguén publica a posición dos vehículos desta rede; os buses
  do mapa grande saen do cadro horario e dino. O que se debuxa é a túa viaxe e onde estás
  ti nela, que si é unha medición (o GPS). Se algún día o operador publica posicións, o
  modo está preparado para amosalas, pero non depende diso para valer.
- **Unha páxina web non pode espertarse soa.** O aviso de baixada só soa coa páxina
  aberta; a resposta é un interruptor visible e apagado por defecto, «manter a pantalla
  acesa durante a viaxe», que non se amosa onde a API non existe e que nunca di «wake
  lock». Está feito, e o navegador sóltao só ao agochar a lapela.

### O formulario (estado A)

- **A resposta manda.** O formulario prégase a unha barra que di o traxecto e abre e
  pecha os campos; en móbil, campos e resposta quéndanse. As catro alternativas vense
  enteiras —non se pode escoller entre catro cousas que non se ven— como filas densas de
  44 px, dúas á vista e «N máis», non como tarxetas; os atallos si van nun carril, porque
  ou ves o que querías ou escribes. Nada corta o nome dunha parada.
- **Últimas rutas**, as catro últimas consultas con resposta, en `localStorage` coa súa
  fila en PRIVACY.md; un check esixe que toda clave que a app escriba estea nese documento.
- **O prezo que se amosa é o que paga calquera** (0,64 €), coa tarxeta como mellor
  opción etiquetada, ningunha riscada. Non se garda un prezo favorito: pode quedar rancio
  e sería a sétima clave. A tarxeta chámase TMG en todas partes; tiña dous nomes.
- **A saída deixou de estar clavada na hora da pregunta**: preguntar ás 09:00 daba
  «50 min, sae ás 09:00» con 21 minutos de pé no poste. A saída deslízase ata deixar só a
  marxe de seguridade, e a orde pasa a `slackMinutes + durationMinutes` (ordenar por
  duración perdía de media 66 minutos de chegada para aforrar 5 de viaxe).
- **O bus que xa non se colle dise.** Cando o paseo medido á primeira parada é máis longo
  que a almofada, ese bus foise: 180 de 1.017 opcións (18 %). O planificador acepta o
  paseo medido antes de escoller a parada de embarque —mover o reloxo case non movía a
  agulla— e quedan 82 (8 %), que o din: «Co paseo medido xa non chegas a este bus».
- `zoomSnap = 0` e o encaixe da ruta en `basemap.ts`, o único sitio polo que pasan os
  tres mapas: o traxecto debuxábase ao 46 % dun mapa nacido en `display:none`.

### O modo (estado B)

- **Éntrase por un botón explícito, «Vou nesta».** Detectar por GPS que vas montado
  sería presentar unha inferencia como un feito, e a inferencia é mala (16 km/h de media,
  0 nun semáforo, 5 a pé). O botón sabe cando importa: nos dez minutos antes do bus sobe
  ao principio da resposta; pasada a hora impresa volve abaixo. A posición do lector só
  pode mantelo abaixo, nunca subilo.
- **Se non colles ese bus, pregúntase; non se adiviña.** Aos tres minutos da hora impresa
  sen ver pasar nada, «collíchelo?»; «non» le do cadro a seguinte saída desa liña nese
  poste, e cando non queda ningunha di que era a última. Medido sobre 233 plans: o oco ata
  o seguinte bus ten mediana de 30 min e p90 de 90; recalcular desde unha posición en
  movemento sería caro e impreciso.
- **Lévate ata a porta**: coa espera, o segundo bus e o paseo final. 43 de 233 plans
  (18 %) teñen transbordo, con espera mediana de 5 minutos: parar antes sería soltar ao
  lector exactamente aí, e é máis código, non menos.
- **Unha soa alarma.** `stopAlarm.ts` ten unha soa vixilancia de posición para toda a app,
  con subscritores; o taboleiro e a viaxe son dous deles. Un check impide un segundo
  radio ou un `watchPosition` propio.
- **A viaxe sobrevive en `sessionStorage`**, non en `localStorage`: sobrevive a unha
  recarga e morre coa lapela, que é a vida dunha viaxe, e non queda no aparello un
  rexistro de que alguén foi de X a Y. Gárdase o plan escollido, non o seu índice.
  Declarado en PRIVACY.md igual.
- **Só se afirma o que se contou.** Vaise no bus cando se dixo ou cando o GPS viu pasar a
  segunda parada do tramo; o aviso soa unha vez por tramo, a 300 m ou no propio poste. O
  cursor sobre as paradas vai **en orde** desde a última alcanzada e colle a primeira a
  tiro: seis dos 48 sentidos van e volven pola súa propia avenida, e a versión que tachaba
  «a máis afastada a tiro» saltaba nove paradas dunha vez.
- **Os estados son catro**, non cinco: agardando, viaxando, baixando, camiñando. Non hai
  «feito»: feito é que a viaxe desapareza ao premer «Saír da viaxe», nunha barra fixa ao
  pé, non ao fondo dunha lista de 1.348 px.

## O movemento — 20 de setembro de 2026

Decidido sobre un catálogo con demo de cada peza e as súas versións, non sobre a
descrición. Catro regras, e o que quedou fóra:

- **Móvese a interface, nunca un número.** Un contador que roda, un pin que late ou unha
  ruta con formigas din «en vivo», e esta app non sabe onde está o bus. A excepción é
  a pantalla «Vou nesta», e só porque alí a posición vén do GPS: a conta ata *un* bus
  roda ao cambiar e a marca da seguinte parada late. No taboleiro, con quince números
  cambiando á vez, o mesmo lería como seguimento; un check impide que o roll chegue alí.
- **Só `opacity` e `transform`, 120–240 ms, e só de entrada.** Os cajóns, a ficha do
  mapa e o lector QR desmóntanse ao pechar; animar a saída obrigaría a mantelos montados,
  e un peche instantáneo é un peche que non estorba. Pregar bloques (formulario da ruta,
  «N opcións máis», o mapa do traxecto, o aviso nocturno) vai polo truco de
  `grid-template-rows: 0fr → 1fr`, sen medir alturas; o elemento pregado ten que ser un
  envoltorio sen recheo, ou queda un tallo dos seus 30 px de padding e bordo.
- **Un control segmentado compartido** (`ui/Segmented.tsx`): o taboleiro e o modo de hora
  do planificador debuxaban cada un o seu, con dous recheos distintos. O pulgar esvara;
  o botón premido leva o seu propio recheo en repouso, porque a auditoría de contraste
  le o fondo do botón e non o do irmán que ten debaixo, e con recheo transparente
  devolvía 1,00:1.
- **Todo apágase con `prefers-reduced-motion`**, coa regra global que xa existía;
  `audit:browser` sostén que nada segue animándose.
- **Fóra**: fundido global ao cambiar de tema, filas do taboleiro escalonadas (cada
  escalón atrasa o número que se vén ler), pines que crecen (son canvas), View
  Transitions entre pestanas (o indicador que esvara di o mesmo por nada), e calquera
  cousa no mapa, que segue na lista de abaixo.

## Os buses do mapa — 30 de setembro de 2026

- **Empezan apagados.** Ninguén publica onde van os buses desta rede; os do mapa saen do
  cadro horario, e un marcador que avanza sobre un mapa lese como un bus seguido por moito
  que o diga un globo que só se abre ao tocalo. Quen os queira acéndeos en «Capas visibles».
- **Mentres se ven, o mapa dío enriba**, co trazo discontinuo de `~ ESTIMADO`: «Posición dos
  buses estimada polo horario, non en directo», e un botón de 44 px para apagalos. Non se
  pecha o aviso deixando os buses: quitar o aviso é quitar os buses.
- **A conta di de onde sae**: «buses en ruta segundo o horario», non «en servizo».
- Non se garda a elección entre visitas: cada vez que se abre a app empezan apagados.

## A lista de liñas — 1 de outubro de 2026

- **O tinte forte queda** (o 40 % e o bordo á cor da liña de `.tint-strong`). Quen xa sabe
  a cor da súa liña vai directo a ela coa vista, e iso faino a fila enteira, non un cadrado.
- Probáronse, renderizadas na app en claro e escuro, dúas listas máis calmas: un índice con
  filetes e a cor só no cadrado do número, co destino, «desde» e a orixe; e o mesmo co
  trazo orixe–destino da ficha da liña. Gañan en calma e perden esa busca pola cor, e o
  trazo non engadía abondo ao índice.
- Antes descartárase un tinte pálido cunha franxa de cor de 4 px á esquerda: é o patrón de
  tarxeta que delata unha interface xerada.

## A precaché e Dependabot — 2 de outubro de 2026

- **A rede peonil segue na precaché.** Son 396 KB en brotli dos 1,05 MB que baixan en
  segundo plano na primeira visita, e a cambio o primeiro camiño a pé non agarda pola rede
  nin falla sen cobertura. Gardala só ao trazar o primeiro camiño aforraba esa descarga a
  quen nunca traza un, e quedou fóra.
- **Dependabot sen `cooldown`.** Que abra as súas propostas no momento: van contra
  `develop`, pasan os catro gates no CI e nada entra sen fundilo a man. semgrep suxería
  agardar uns días para non adoptar versións do mesmo día.

## O planificador e a regra do movemento — 3 de outubro de 2026

- **«Calculando», con tres puntos que botan.** O plan corre no fío principal e «chegar
  antes» ocúpao segundos nun teléfono lento, sen nada na pantalla que o dixese. Agora o
  botón pinta «Calculando» nun cadro seu e o plan empeza despois: o toque responde en
  56–72 ms a 6× de CPU. Os puntos móveos o compositor, así que seguen botando co fío
  ocupado (116 cadros distintos en 5 s dun plan). Custan: a 6×, «chegar antes» pasou de
  9,2–10,0 s cos puntos quietos a 10,3–12,2 s; nun teléfono o compositor vai noutro núcleo,
  pero iso non se mediu. O *worker* que deixaría a páxina usable mentres calcula quedou fóra.
- **A regra de `opacity` e `transform` xa non ten excepcións.** `attention`, o anel arredor
  de «Vou nesta», é un disco detrás do botón que medra e se esvae na mesma curva, co mesmo
  alfa en cada cadro que a sombra que era; `seg-reveal` deixou de ser unha animación e o
  recheo do botón premido chega aos 200 ms dunha vez. Os puntos de «Calculando» son o
  segundo bucle da app, despois do latexo de «Vou nesta», e duran o que dura o cálculo.
  `pnpm test` le cada `@keyframes` e falla se algún anima outra cousa.

## Deno e as pestanas — 3 de outubro de 2026

- **A organización de Deno Deploy queda sen verificar**, polo de agora. Sen medio de pago
  non hai nada que cobrar, e o teito é o 1 % do plan gratuíto: 10.000 peticións ao mes.
  Cada visita pide os avisos unha vez, e un taboleiro aberto desde o QR pide os minutos
  cada 30 s. Se se esgota, a app segue: os avisos saen da copia de cada hora, marcada como
  copia, e os minutos do operador non se amosan ata o mes seguinte.
- **Ruta e Liñas seguen no anaco de entrada: descartado o 6 de outubro, medido.** Decidírase
  cargalas á demanda e en repouso despois do primeiro pintado, e probouse nunha rama antes
  de facelo. A primeira carga baixaba de 148 a 138 KB en brotli, 54 KB menos de código, pero
  a 6× de CPU e 4G lento, mediana de tres medidas alternas, nada o notou: o primeiro pintado
  3,38 s fronte a 3,48, a primeira saída do QR 3,35 fronte a 3,53, a segunda visita 1,23
  fronte a 1,30. E abrir Ruta nada máis cargar pasaba de 0,93 a 2,05 s, e Liñas de 0,52 a
  1,18, agardando pola rede. O navegador apenas traballa co código que non executa, e a
  precarga competía co taboleiro. Os 150 ms do 1 de outubro saían dun perfil, non dunha
  medida de antes e despois.

## As confirmacións, tamén en 240 ms — 6 de outubro de 2026

- **Os 120–240 ms quedan sen excepcións.** Catro confirmacións duraban máis desde as
  demos de setembro: a insignia de avisos 260 ms, a estrela 320, a campá 520 e o anel
  arredor de «Vou nesta» 700. Vistas lado a lado, coas mesmas curvas a 240 ms, baixan as
  catro; o anel segue agardando 300 ms antes de saír. A frecha que intercambia orixe e
  destino xiraba en 260 ms, nunha clase do compoñente que o check non lía; baixa tamén.
- **Os indicadores de espera quedan.** Ademais dos dous bucles, cinco sitios repítense
  mentres agardan, coas clases de Tailwind: o oco do mapa e os dous do mapa do traxecto
  (Ruta e «Vou nesta») latexan mentres carga o seu código, a icona da localización
  mentres busca, e a de actualizar xira en Avisos mentres sincroniza. Rematan coa espera,
  como «Calculando»; quitalos deixaría o oco e a icona sen nada que diga que traballan.

## Overpass e o feed do Concello — 6 de outubro de 2026

- **Overpass ten unha segunda instancia, sen agardar a un terceiro luns.** A de FOSSGIS
  fallou dous luns seguidos, e o trazado leva dúas semanas sen comprobar. A segunda é
  `overpass.private.coffee`, escollida entre as públicas sen chave da wiki de OSM: global,
  sen límite de peticións, e os seus operadores só piden que lles avisen dun uso a grande
  escala. A outra sen chave é a de VK Maps. Só se lle pregunta cando a primeira non
  responde despois de tres intentos.
- **O feed do Concello ten 4 s, e cada lectura déixao escrito.** Lido despois da páxina do
  operador, os seus 15 s de prazo facían agardar os avisos do operador cando non
  conectaba. Desde unha conexión doméstica responde en menos dun segundo. Se o rexistro
  amosa que desde os servidores non conecta nunca, o seguinte paso é quitalo de aí.

## O que sae dos pendentes — 6 de outubro de 2026

- **As interurbanas no taboleiro, e con elas os postes na beirarrúa, non se fan.** Era un
  proxecto de datos enteiro: as liñas da Xunta en GTFS, as coordenadas das paradas tomadas
  de OpenStreetMap (ODbL), 142 paradas sen poste en OSM e as paradas dobres partidas en
  dúas, co que cambian os recontos, os QR compartidos, os favoritos e as ligazóns
  `?parada=`. Ninguén o pediu. Os postes vistos onde os pon OSM vanse movendo un a un
  (`POLE_SEEN_AT_OSM`, en `tools/lib.ts`), cada un comprobado.

## Os avisos do operador, usados — 8 de outubro de 2026

- **O que un aviso cambia úsase, non só se amosa.** O do San Froilán de 2026 era prosa: cinco
  liñas ata as 03:00 e máis, unha parada deixada por dúas liñas e outra trasladada, en sete
  días. A app amosábao e nada máis. O taboleiro dicía «sen servizo» á unha da mañá, e Ruta
  mandaba subir á 1.4 nunha parada onde non paraba. Agora a app le do aviso os días, as horas
  de fin e as paradas:
  - o taboleiro di o que cambia e marca as saídas que non paran;
  - Ruta non propón esa parada a esas liñas;
  - a ficha resume os cambios da liña;
  - o aviso de madrugada di que liñas seguen.
- **Non se inventan saídas.** O aviso di ata cando, non cando pasa. As súas horas amósanse
  como do aviso, nunca como saída nin como estimación, e o horario oficial non se toca.
- **Na dúbida, nada.** Un nome que non casa claramente cunha parada da liña non cambia nada,
  e o texto do aviso segue aí. O percorrido desviado («suprimindo o seu percorrido polo
  HULA») queda en palabras.
- **Pregado, e despregado cando é a única resposta.** A franxa do taboleiro e a de Ruta van
  pregadas ao titular e ao que cambia nesa parada. Abertas ocupaban 166 px e 185 px de día
  nun teléfono, enriba da primeira saída e da resposta. Desde a última saída impresa dunha
  liña na parada, a hora final e de quen é a palabra saen soas. Na ficha, o texto do
  operador vai pregado baixo o resumo do día, que xa di o mesmo.
- **A palabra é de buslugo.com, e o horario, «que saibamos».** O 8 de outubro a súa páxina
  da 1.2 remataba ás 22:17 e a portada só tiña o aviso. Non se afirma que non exista
  horario: dise que non o coñecemos.
- **A noite de festa vai do mediodía ao fin.** Ás 05:30, antes do primeiro bus, o aviso de
  «sen servizo» dicía que cinco liñas seguían: a noite anterior xa acabara. Tampouco se di
  unha hora final xa pasada, nin se lle pon a unha hora o lugar escrito con outra.
- **Un aviso remata cos seus días**, siga ou non na páxina do operador. Pasado o último, ás
  05:00 do día seguinte, sae de todo: franxas, ficha, Ruta, o «1» do menú e Avisos. Un
  aviso sen días non remata por isto. Un «1 de xaneiro» lido en decembro é do ano que vén.
- **Ruta pregunta ao aviso pola noite da viaxe.** As paradas pechadas e os cortes son os
  do día no que sae a viaxe; as horas finais, as que corren agora.

## Ruta: a orde que se le, e o bus de mañá — 8 de outubro de 2026

- **As opcións van na orde do que di cada fila.** A regra do planificador aplícase outra
  vez sobre os paseos medidos, e mentres non hai medida nada se move. Un bus que o paseo
  medido xa non colle vai ao final. Cada fila ten por clave a súa viaxe, non o seu número.
- **«En servizo» cóntase desde a pregunta.** Un paseo que remata pasada a medianoite non
  fai do primeiro bus de mañá un bus en servizo: ás 23:50 vai diante ir andando esa noite,
  como na 1.1.0.

## O latexo de «Vou nesta», dúas veces — 8 de outubro de 2026

- **A marca da seguinte parada late dúas veces cada vez que cambia, uns catro segundos, e
  queda quieta.** Repetíase mentres duraba a viaxe, e WCAG 2.2.2 pide un xeito de parar na
  propia páxina todo o que se move máis de cinco segundos á beira doutro contido;
  `prefers-reduced-motion` non conta como tal. Segue dicindo «aquí» cando importa, ao
  cambiar a seguinte parada, e con iso a app cumpre os 55 criterios A e AA (rolda 31 do
  rexistro). O único bucle que queda é «Calculando», que dura o que dura o cálculo.

## Quedou aberto

- O filete dos bordos a 1,37:1 (arriba).
- Animacións ou efectos no mapa: non é prioridade e non se fai sen unha razón.
- A «duración sen tráfico» da ficha de liña, que o plan da paleta deixou como dúbida —25
  minutos calculados fronte a 38 do cadro—, resolveuse quitando a tarxeta: a ficha da
  liña non amosa hoxe ningunha duración calculada.
