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

## Quedou aberto

- O filete dos bordos a 1,37:1 (arriba).
- Animacións ou efectos no mapa: non é prioridade e non se fai sen unha razón.
- A «duración sen tráfico» da ficha de liña, que o plan da paleta deixou como dúbida —25
  minutos calculados fronte a 38 do cadro—, resolveuse quitando a tarxeta: a ficha da
  liña non amosa hoxe ningunha duración calculada.
