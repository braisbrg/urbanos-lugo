# Plan: a pantalla Ruta en dous estados, e o modo «vou no bus»

Proposta de deseño, 7 de setembro de 2026. **Nada disto está implementado**: é o paso
previo, para decidir antes de escribir código. `RoutePlannerView.tsx` son 1.108 liñas e é
o ficheiro máis grande do proxecto, así que convén saber a onde vai antes de abrilo.

O encargo, tal e como quedou acordado: unha vez escollido un plan e subido ao bus, a
pantalla deixa de ser un formulario e pasa a acompañar a viaxe — mapa dunha soa liña,
en vivo onde vai o bus e onde vas ti, e aviso ao achegarse á parada de baixada.

Artifact coa auditoría visual e as maquetas dos dous estados:
<https://claude.ai/code/artifact/a24e4ed5-5fbe-4c33-a21b-48e44a38f018>

---

## A raia: unha das tres cousas non se pode facer

Antes de deseñar nada. O encargo pide **«en vivo: onde vai o bus e onde vas ti»**, e esas
dúas metades non son a mesma cousa:

| | Que é de verdade |
| :--- | :--- |
| **Onde vas ti** | Unha medición. O GPS do móbil, xa usado pola alarma. |
| **Onde vai o bus** | **Non existe.** Ninguén publica a posición dos vehículos desta rede. |

Os autobuses que hoxe se debuxan no mapa grande non son unha medición: saen do cadro
horario. Dío o propio código en `VehicleLayer.tsx` —«Every position here is computed from
the timetable»— e dío o README na sección «O que esta app NON pode facer». O `occupancy`
que amosa o globo é a hora do día, non xente contada.

Así que hai que escoller, e a regra do proxecto xa a ten escollida: **non presentar unha
posición como medida se non o é**. **Decidido con Brais o 7 de setembro de 2026:**

> **Non se debuxa o bus.** O que se debuxa é **a túa viaxe** e **onde estás ti nela**. O
> horario segue mandando nas horas, coas súas etiquetas de sempre.

Non é un recorte: é o que fai o modo útil. Ninguén precisa ver un icono de bus na
pantalla mentres vai sentado dentro dese bus. O que precisa é **cantas paradas faltan** e
**que non se lle pase a súa**. Iso si se pode responder, e con datos reais: a túa posición
contra a lista de paradas do traxecto que estás a facer.

Se algún día o operador publica posicións, o modo xa está preparado para amosalas — pero
o modo non depende diso para valer.

### E a segunda raia: o móbil no peto

`stopAlarm.ts` xa o leva escrito: *«It runs only while the page is open — a web page
cannot wake itself in the background»*. Coa pantalla apagada e o navegador en segundo
plano, `watchPosition` recibe menos posicións ou ningunha. Un aviso de baixada que promete
máis do que pode cumprir é peor que non ter aviso.

**Wake Lock, e que ve o usuario: nada.** `navigator.wakeLock.request('screen')` pide que a
pantalla non se apague mentres a páxina estea visible. Non hai diálogo, non hai permiso que
conceder — a pantalla simplemente deixa de apagarse. Non pode quedar acesa ás agachadas: o
navegador sóltao el só en canto a lapela deixa de verse. O que custa é batería, que é o que
máis gasta unha pantalla acesa. E **no chan que sostemos non existe**: Safari incorporouno
na 16.4 e nós aguantamos a 15.4.

Precisamente porque non se ve, a proposta é que sexa un **interruptor visible e apagado por
defecto**, redactado desde quen o le —«Manter a pantalla acesa durante a viaxe», e debaixo
«gasta máis batería»—, e que non se amose sequera onde a API non existe. Un control que non
fai nada é peor que non telo. A palabra «wake lock» non aparece na interface.

---

## Auditoría visual, medida nun 375×812

Non a ollo: medido no navegador contra a build actual.

| Medida | Que significa |
| :--- | :--- |
| **582 px** ocultos | A tira de alternativas ten 305 px visibles e 887 de contido. Nun teléfono ves unha tarxeta e o bordo da segunda. |
| **103 de 355 px** | «Rda. Muralla 56 (Sindicatos) - HULA (Ent. Principal)» vese ao 29 %. Catro textos recortados, tres deles nomes de parada. |
| **194 px de 762** | Os seis destinos rápidos son o 25 % da pantalla de busca, e o formulario aínda así non cabe enteiro. |
| **1.490 px** de alto | O itinerario dun traxecto de 32 minutos, con cada paso repetindo tres veces os mesmos dous números. |
| **162 px** de aviso | O banner das 07:00 é o 20 % da pantalla, en todas as lapelas, e deixa o contido en 513 px. |
| **2 veces** a mesma frase | «Sen servizo agora. A primeira saída é ás 07:00» sae no banner global *e* dentro do resultado do planificador. |

### O aviso das 07:00 — **FEITO** o 8 de setembro de 2026

| | Antes | Despois |
| :--- | ---: | ---: |
| Alto da barra | 162 px | **55 px** |
| Alto útil da pantalla | 513 px | **619 px** |
| Área tocable para ir a Avisos | 44 px (unha fila propia) | **54 px** (a fila enteira) |

Feito só o banner de `App.tsx` e as tres traducións. **Sen tocar `RoutePlannerView.tsx`**:
esa sesión paralela está a substituír o enrutador peonil de terceiros por un local, e ese
ficheiro é seu mentres dure. Quedan pendentes de alí a frase duplicada e a caixa
«Información» baleira.

Check: `ok('the out-of-service banner still fits on two lines')`. As dúas liñas usan
`truncate`, así que unha tradución longa non fai a barra máis alta — córtaa en silencio,
que é peor. Por iso o orzamento é en caracteres, medido no navegador: a columna de texto
son 279 px a 375 de ancho e a liña pequena vai a uns 5,16 px por carácter, logo 54 é o
bordo e o chevron come dous. Restaurar o texto inglés antigo falla con «is 121 characters
and the second line fits 52».

Medido despois nas tres linguas a 375 px: galego 253 px, castelán e inglés 263, sobre 279
dispoñibles. O inglés non collía na primeira escrita —cortábase por 10 px— e acurtouse.

---

### O que se mediu

Medido ás 23:48 dun luns, que é cando aparece. Tres bloques: a frase en negra, o parágrafo
dos reforzos de festas, e «Ver avisos» como botón de 44 px na súa propia liña. Súmalle a
barra de busca e a nav inferior e o mobiliario come 299 dos 812 px — e o formulario de Ruta
precisa 762, así que pasa de «case cabe» a necesitar unha pantalla e media.

| Cambio | Por que |
| :--- | :--- |
| De 162 px a ~64 | A frase que importa ás 03:00 é «primeiro bus ás 07:00». O resto baixa a unha liña pequena. |
| A barra enteira é tocable, e vai a Avisos | «Ver avisos» deixa de ser unha fila de 44 px propia. |
| Os reforzos de festas **quedan** | Non se pode quitar: é o que impide que «non hai servizo» sexa mentira a noite de San Froilán. Pero como clause dunha liña, non como parágrafo en todas as pantallas. |
| O planificador cala cando a barra xa o dixo | O seu aviso só aparece se fala doutra hora — planificar para as 08:00 de mañá si é información nova. |
| A caixa «Información» só se leva algo dentro | De noite, coa opción «todo a pé», non hai tarifa e queda un recadro cun rótulo e nada. |

E a comparación que pediu Brais: **Mapa xa levou este tratamento e Ruta non.** Mapa é mapa
a sangre, controis flotando por riba, accións no terzo do polgar. Ruta é unha tarxeta con
marxes, todo apilado, o mapa reducido a 200 px no medio dun scroll, e as accións como dúas
ligazóns de texto pequenas por riba del. A proposta é aplicarlle o que xa funcionou no
Mapa, non inventar un patrón terceiro.

---

## Estado A.1 — Buscar, antes de calcular — **FEITO** o 8 de setembro de 2026

| | Antes | Despois |
| :--- | ---: | ---: |
| Alto do formulario | 762 px (non collía en 619) | **619 px, colle enteiro** |
| Atallos | 194 px | **36 px** |
| Ancho de texto nos campos | 241 px | **223 px** |

O ancho estivo a piques de ser unha regresión miña. A primeira versión metía o intercambio
no bordo dereito e deixaba os campos en **163 px** — e «Hospital Lucus Augusti (HULA)»
mide 212, «Rda. Muralla 56 (Sindicatos)» 195. Cortaba os dous nomes máis comúns da rede,
que é exactamente o que llo reprochei á pantalla no informe. O intercambio está agora na
columna dos puntos, sobre a liña divisoria, que é espazo que nunca leva texto.

Fóra tamén a estreliña do botón: nada disto é maxia, é un cadro horario impreso e
aritmética, e unha variña promete outra clase de resposta.

### O minimapa, que ía por libre

`TransitMap` quitaba o prefixo «Leaflet |» da atribución e as outras dúas mapas non, así
que a ruta e o minimapa da parada imprimían unha liña que o mapa grande xa decidira que
non collía nunha pantalla de 375 px. E `RouteMap` facía zoom coa roda dentro dun
itinerario que se despraza. Arranxado onde non pode volver separarse: o prefixo cae en
`createBasemap`, polo que pasan os tres. Check: `ok('every map gets its chrome from the
one place that has it')`.

### O prezo que non paga todo o mundo

O resumo do traxecto daba **0,45 €**, que é o prezo coa Tarxeta Cidadá: dá por feito que
quen le ten unha tarxeta que emite o Concello de Lugo. Quen vén de fóra paga 0,64 € e o
único número da liña dicíalle outra cousa. E no detalle, o billete ordinario aparecía **co
texto riscado** ao lado do de tarxeta — o idioma dunha rebaixa, «este prezo xa non vale»,
cando vale para todo o que non teña a tarxeta.

É a mesma regra das horas: o valor por defecto é o que é certo para quen está a ler, e o
mellor ofrécese en vez de supoñerse. Agora o resumo dá 0,64 € e o detalle leva as dúas
filas etiquetadas, ningunha riscada. Check: `ok('the price a trip shows is the one anybody
pays')`.

**Sobre gardar un prezo favorito** (idea de Brais): non o vexo necesario, e recomendo non
facelo. As dúas tarifas caben xa en dúas liñas, así que non hai nada que escoller; unha
preferencia gardada engade a sétima clave en `localStorage` —cunha fila en PRIVACY.md e o
seu test— e pode quedar rancia: a quen lle caduque a tarxeta veríalle un prezo que xa non
paga, sen que nada llo diga. Se aínda así o queres, a versión barata é un interruptor que
só cambia cal das dúas vai en negra, nunca cal existe.

### A tarxeta que tiña dous nomes

A app chamáballe TMG nas tarifas, en `transitData.ts`, no README e na URL da fonte, e
**TPG** no recordatorio de transbordo e na FAQ — seis cadenas, nos tres idiomas. E a
expansión contradicía o acrónimo: «transporte público de Galicia (TMG)». Lido en
tmg.xunta.gal, o emisor escribe «Tarxeta TMG» e «tarxeta do Transporte **Metropolitano**
de Galicia». Corrixido, cun check que non deixa volver a ter dous nomes.

---

## Estado A.1 — o que se mediu

É a primeira pantalla que ve quen toca «Ruta», e é a que menos coidado leva.

| Cambio | Que gaña |
| :--- | :--- |
| Fóra a cabeceira «Planificador de ruta» e o subtítulo | Chegaches premendo unha lapela chamada «Ruta». |
| Orixe e destino nun só bloque, cos dous puntos unidos | Hoxe son dous formularios cun botón no medio. |
| As etiquetas van ao *placeholder* | «(rúa, lugar ou parada)» aparece dúas veces en maiúsculas. |
| O GPS pasa a icona dentro do campo | É unha forma de encher a orixe, non un igual de «calcular». |
| Atallos nun carril de 32 px | De 194 px a ~50, co patrón do carril de liñas do Mapa. |
| «Calcular» fixo abaixo | Terzo do polgar, visible mentres escribes. |
| No oco liberado, **«últimas rutas»** | Proposta, non decidido: o repetido nun bus é a volta. |

Un carril horizontal para os atallos despois de queixarme do carrusel das alternativas non
é incoherente: **as alternativas son a resposta** —hai que ver as catro para escoller— e
**os atallos son un atallo**: ou ves o que querías, ou escribes.

---

## Estado A.2 — O resultado — **FEITO** o 9 de setembro de 2026

| | Antes | Despois |
| :--- | ---: | ---: |
| Alternativas fóra da pantalla | 582 px de 887 | **0** |
| Nome da liña visible | 103 px de 355 (29 %) | **enteiro** |
| Nomes de parada cortados | 3 | **0** |
| Alto do itinerario | 1.473 px | 1.706 px |

O itinerario medra 233 px, e é a troca que escollín: as catro alternativas vense agora
todas en vez de dúas e o bordo dunha terceira. Non se pode escoller entre catro cousas que
non se ven; os atallos do formulario si poden ir nun carril, porque ou ves o que querías ou
escribes, pero **as alternativas son a resposta**.

O nome da liña era o dato equivocado, ademais de cortado: «Rda. Muralla 56 (Sindicatos) -
HULA (Ent. Principal)» nun oco de 103 px. A fila de abaixo xa di onde subes; o que faltaba
era cara a onde vai, así que agora pon o destino do sentido. E en «Sube en» / «Baixa en», a
etiqueta e a hora baixáronse da liña do nome: deixaban 132 px para «Rda. Muralla (Obras
Públicas)», que precisa 204. Nada merece cortar o nome dunha parada.

O reconto «(4 de 55)» fóra, decidido con Brais: soaba a que gardabamos corenta e nove
respostas nun caixón, cando o que queda son as mesmas liñas saíndo máis tarde. Como
`planTrips` ordena por `isBetterPlan`, as catro primeiras son de verdade as mellores, e iso
é o que di a etiqueta agora.

O punto que quedaba do informe —cada paso repetindo tres veces os mesmos dous números—
**está feito** o 9 de setembro. Cada fila leva xa a súa cabeceira co reloxo e a duración,
así que as cinco frases do motor (`waitAt`, `transferAt`, `walkToStop`, `walkToDestination`,
`walkWholeWay`) soltaron o que a cabeceira xa di, nos tres idiomas. A fila de espera baixou
de 173 a 157 px. Hai check: ningunha instrución pode conter un `HH:MM` nin os seus propios
metros.

Segue cortado un só texto: o resumo pregado da consulta (146 px de 292). É un recap cun
`title`, non un dato, e gastar alto en desdobralo non paga a pena.

---

## Estado A.2 — o que se mediu

Cambia pouco, e a propósito. O formulario funciona; o problema é que ocupa a pantalla
enteira despois de que xa respondeu.

O que hai hoxe e queda igual: os dous campos con autocompletado, o botón de GPS, o
intercambio, «agora / saír ás / chegar ás», os destinos rápidos, as ata catro
alternativas (`MAX_OPTIONS`), os tres números de cabeceira, a letra pequena coa
procedencia das horas, e a liña de tempo paso a paso coas paradas intermedias pregadas.

Tres cambios:

1. ~~**O formulario prégase só e queda como unha liña.**~~ **Feito.** A barra di o
   traxecto e abre os campos — e péchaos, que non estaba previsto e facía falta: sen iso,
   quen abría os campos para mirar só saía buscando outra vez. Os campos e a resposta
   quéndanse en móbil.
2. ~~**A alternativa escollida gaña peso.**~~ **Substituído**, e a proba está na segunda
   volta de arriba: non facía falta que a escollida medrase, facía falta que as catro
   deixasen de ser tarxetas. Táboa densa de filas de 44 px, dúas á vista e «2 opcións
   máis». 274 px → 152.
3. **Un botón novo ao pé do plan: «Vou nesta»**. É a única porta ao estado B, e é
   explícita: ninguén adiviña por GPS que subiches (pregunta 2). **Sen facer**, coma todo
   o estado B.

---

---

## A segunda volta — 8 e 9 de setembro de 2026

Todo o de abaixo saíu de mirar a pantalla con Brais depois de dar A.1 e A.2 por bos. Non
estaba no plan; está aquí porque son as medidas, e porque o estado B parte de aquí.

### O bloque de opcións: tres maquetas e o que quedou

As alternativas eran catro tarxetas de 64 px —274 px, o 39 % da columna que scrollea— para
levar tres cifras cada unha. Fixéronse tres maquetas e escolleuse por eixes, que resultaron
ser dous e non tres: **como se le unha fila** e **cantas filas hai**.

| | Antes | Agora |
| :--- | ---: | ---: |
| Alto do bloque | 274 px (39 %) | **152 px** (2 filas + «2 opcións máis») |
| Alto dunha fila | 64 px | 44–45 px |
| Cabeceira (min · saída · chegada) | 82 px | **44 px**, nunha liña |
| Páxina enteira | 1.690 px | **~1.500 px** |

A fila perdeu a moldura de tarxeta —bordo, recheo e radio en cada unha din «catro obxectos
separados» cando o que se le é unha columna de catro liñas comparables— e perdeu tamén o
«1 transbordo», que a propia fila xa debuxa con `6 → 4.2`. Iso último valía 18 px en dúas
das catro filas, porque partía a liña en dúas. As palabras quedan para o lector de pantalla.

O reloxo manda na fila e a duración é a consecuencia, que é a orde correcta desde que a
saída deixou de ser sempre «agora». Vai en `text-label` con tinta plena: destacado sen
medir o mesmo que os minutos.

### A saída deixou de estar clavada nas 9

O achado máis gordo da volta, e non era de UI. Preguntando ás 09:00 por HULA a resposta era
«50 min, sae ás 09:00», e 21 deses minutos eran de pé no poste. Peor: as cinco primeiras
opcións duraban 50 min e chegaban todas ás 09:50 — cinco maneiras de coller o mesmo 4.2.

`buildResult` desliza agora a saída ata que só queda a marxe de seguridade, a mesma que xa
se lle daba a un transbordo e pola mesma razón (aquí non hai GPS e hai buses adiantados).
A resposta pasa a ser «33 min, sae ás 09:17», mesma chegada.

E iso rompeu a ordenación, que é o que ninguén vería sen medilo: coa saída libre, «máis
curto» deixa de significar «chegas antes». Ás 09:00 encabezaba a lista un 5ES de 22 minutos
**que sae ás 14:08**. Sobre 36 consultas, ordenar por duración perdía de media 66 minutos de
chegada para aforrar 5 de viaxe, con casos de 355. Compárase agora `slackMinutes +
durationMinutes`, e o empate rómpeo a duración.

### O autobús que xa non se colle

O plan constrúese coa estimación do paseo e o router mide o real despois. Cando o paseo á
primeira parada pasa da almofada, saír a tempo significaría saír antes de agora: **ese bus
foise**, e a hora en pantalla non a alcanza ninguén. Medido: **180 de 1.017 opcións con bus
(18 %)**.

Probouse primeiro mover o reloxo e case non moveu a agulla (47 respostas malas → 39): pedir
a outra hora non cambia que o planificador ordena as paradas de embarque pola estimación en
liña recta, así que escolle outra parada igual de mal medida. O que funciona é dicirllo.
`planTrips` acepta `measuredWalkToStop` e `boardingCandidates` substitúe a estimación
**antes** de filtrar e ordenar.

| | Antes | Agora |
| :--- | ---: | ---: |
| Resposta en pantalla inalcanzable | 47 de 312 preguntas | **5** |
| Opcións inalcanzables | 180 (18 %) | **82 (8 %)**, e dinno |

O que sobrevive non se maquilla: `withMeasuredWalk` devolve `reachable`, a chegada só se
move polo paseo posterior ao bus, e a fila e a cabeceira din «Co paseo medido xa non chegas
a este bus». Unha soa repetición, con tope duro.

### O mapa non estaba amosando a ruta

Dous fallos distintos, atopados buscando un.

O primeiro: `fitBounds` encaixa o contedor tal como está nese intre, e este mapa nace nunha
columna que en móbil está en `display:none` ata que se pide un plan. `invalidateSize`
devolve o tamaño e deixa a vista onde estaba, así que o mapa garda un zoom feito para unha
caixa que xa non existe. Collido nun 375×812: **a ruta debuxada 118×288 dentro dun mapa de
297×240, con 3 dos seus 29 anacos en pantalla**. Agora o mapa lembra o traxecto e volve
encaixar só se se saíu da caixa; quen fixo zoom pola súa conta consérvao.

O segundo: `fitBounds` redondea ao nivel de zoom enteiro, e nun mapa pequeno iso é ata a
metade da caixa. O traxecto por defecto debuxábase ao **46 %** e saltaba ao 67 % ao tocar
unha opción calquera, sen motivo visible desde fóra. O basemap é vectorial e debuxa a
calquera zoom, así que `map.options.zoomSnap = 0` vai en `basemap.ts` —o único sitio polo
que pasan os tres mapas, igual que o prefixo da atribución—. **76 %**, e estable.

### O resto da volta

- **Ritmo da columna.** Os ocos entre bloques ían 20, 0, 20, 20, 24 px porque cada bloque
  traía a súa marxe. Agora a columna manda: 16 entre bloques, 8 de cabeceira a contido, e o
  mesmo en `LinesView`, que tiña cinco valores distintos.
- **Unha pastilla no mapa** —«Paso a paso ⌄»— porque o mapa remata a poucos píxeles do
  pregue e nada dicía que a viaxe seguía escrita debaixo. Vai enriba e o encaixe resérvalle
  56 px, así que a ruta xa non lle pasa por baixo.
- **Obxectivos táctiles.** Nove elementos por debaixo de 44 px no planificador, que nunca se
  auditara: o botón de inverter e os oito atallos. Cero agora, e o README xa o reclama.
- **Últimas rutas** (pregunta 1 do plan, resolta facéndoa): as catro últimas consultas con
  resposta, sétima clave en `localStorage`, fila en PRIVACY.md e check que esixe que toda
  clave que a app escriba estea nese documento.
- **Os campos e a resposta quéndanse** en móbil. Reabrir o formulario deixaba a resposta
  anterior 410 px máis abaixo, e non había forma de pechalo sen buscar outra vez.
- **Líneas.** A lista: filas de 82–109 px desiguais a 59–61, de 4 visibles a 7. O nome
  amosa a metade que varía —as primeiras metades só teñen 9 valores distintos entre 24
  liñas, as segundas 17—. O detalle: 5.727 → 4.435 px, seis caixas de datos nun bloque
  (281 → 164 px), e as paradas cos nomes enteiros, que custa alto e paga a pena.

`pnpm test` pasou de 119 a **125** comprobacións nesta volta.

---

## Estado B — «Vou no bus»

Pantalla completa, sen formulario. Pensada para mirarse de esguello, cunha man, de pé,
co bus en movemento. Tres bloques, de arriba abaixo:

### 1. A cabeceira: canto falta

O único que importa. Grande, e nesta orde:

```
   Baixas en

   Rda. Muralla 56 (Sindicatos)
   ────────────────────────────
   4 paradas         ~ 11 min
                     ~ ESTIMADO
```

O número de paradas é **contado**, non estimado: sae da lista de paradas do sentido que
vas montando. Os minutos son do horario e levan a etiqueta de sempre. Se a parada de
baixada é un punto horario publicado, pon `HORARIO OFICIAL`; se non, `~ ESTIMADO`. Esa
distinción non se suaviza porque a pantalla sexa máis bonita.

### 2. O mapa dunha soa liña

**Isto xa existe e non hai que construílo.** `RouteMap.tsx` debuxa só o plan, non a rede:
recibe `plan` e debuxa os seus segmentos. O mapa grande con todas as liñas é `TransitMap`
e non pinta nada aquí.

O que fai falta é enfocalo: que no estado B debuxe **só o segmento de bus que estás a
facer**, non todo o plan, e que centre en ti. Dous engadidos á súa interface, non un mapa
novo.

Enriba: a túa posición, real. O bus non se debuxa (ver «A raia»).

### 3. A lista de paradas que faltan

A parte que substitúe a mirar pola ventá:

```
   ✓  Praza de Ferrol            pasada
   ✓  Rda. Muralla 118           pasada
   →  Rda. Muralla 95            agora
      Rda. Muralla 56            baixas aquí
```

As pasadas márcanse contra o teu GPS, non contra o reloxo. É a diferenza entre «o horario
di que xa deberías ir por aquí» e «pasaches por aquí», e é a única cousa deste modo que se
pode afirmar con certeza.

### O aviso de baixada

`watchForStop` xa fai exactamente isto, con `ALARM_RADIUS_M = 300` m, e xa ten
`ringAlarm()` (vibración + son), `notify()` e o permiso de notificacións. Hoxe está atado
ao taboleiro dunha parada que abriches; aquí ataríase á parada de baixada do plan.

**Non hai que escribir a alarma. Hai que movela de sitio.**

### Saír do modo

Un botón «Rematei» sempre visible, e o modo remata só cando soa o aviso e confirmas.
Nunca se queda acesa unha alarma que ninguén pediu.

---

## Que se reutiliza e que é novo

| Peza | Estado |
| :--- | :--- |
| `services/stopAlarm.ts` completo | **Reutilízase tal cal.** Só cambia quen o chama. |
| `RouteMap.tsx` | **Reutilízase**, con dous props novos: segmento activo e seguimento. |
| `RoutePlanResult.segments` | **Xa abonda.** Trae `line`, `directionId`, `fromStop`, `toStop`, `stopsCount`, `precision` e as horas. Non fai falta tipo novo. |
| Etiquetas `published` / `estimated` | **Reutilízanse**, sen excepción. |
| `utils/geo.ts` | **Reutilízase** para «que parada pasei». |
| `useOperatorTimes` | **Reutilizable** na parada de baixada, se ten código de poste. Opcional. |
| A máquina de estados da viaxe | **Novo.** `planificando → agardando → viaxando → baixando → feito`. |
| «Que paradas pasei», por GPS | **Novo.** É o corazón do modo e non existe nada parecido. |
| Enfoque nun só segmento no mapa | **Novo**, pero pequeno: dous props. |
| Persistencia da viaxe en curso | **Novo, e é unha decisión** (pregunta 4). |

Sobre o tamaño do ficheiro: `RoutePlannerView.tsx` non debería medrar. O estado B é un
compoñente irmán —`TripCompanionView.tsx`— e o planificador só decide cando amosalo. Se o
estado B entra dentro das 1.108 liñas actuais, o ficheiro pasa das 1.600 e ninguén o vai
tocar despois.

---

## Privacidade: que cambia

Bo punto de partida: **nada novo sae do móbil**. Todo o modo é GPS lido no aparello e
aritmética en `geo.ts`, igual que a alarma de hoxe. As paradas e o horario van dentro do
bundle. Non hai petición nova a ninguén.

PRIVACY.md xa contempla a alarma —«the **arrival alarm**, which watches your position
while it is running so it can tell you when to get off»—. Aínda así, dúas cousas merecen
escribirse antes de facelas, non despois:

1. **A duración.** Hoxe a alarma acéndese para unha parada concreta e apágase soa. No modo
   novo o seguimento dura toda a viaxe. É o mesmo mecanismo e o mesmo destino —ningún—,
   pero é un feito distinto e o ficheiro debe dicilo.
2. **Se se garda a viaxe en curso** (pregunta 4), aparece unha **sétima clave** no
   aparello —quedou en `sessionStorage`, ver «Decidido»— e PRIVACY.md ten unha fila máis.

En ambos casos, un check en `tools/test.ts` no estilo dos que xa hai: que o modo non
introduza ningunha orixe de rede que non estea xa na táboa do ficheiro. Hoxe son 111
checks e teñen que seguir pasando; se se toca a promesa, o test é parte do cambio, non un
seguimento.

---

## Decidido — 9 de setembro de 2026

Eran de produto, non de código, e xa están respondidas. As cifras son as que se mediron
para decidilas, sobre 233 plans líderes (5 orixes × 8 destinos × 8 horas do día).

1. ~~**Últimas rutas** no oco que deixan os atallos.~~ **Resolta facéndoa.** As catro
   últimas consultas que deron resposta, coa súa clave en `localStorage` e a súa fila en
   PRIVACY.md — que di ademais o que a táboa non dicía: esta clave garda texto que alguén
   escribiu, e pode ser a súa rúa. Hai check que esixe que toda clave que a app escriba
   apareza nese documento.

2. **Éntrase por un botón explícito.** Detectar por GPS que xa vas montado sería
   presentar unha inferencia como un feito, que é o que este proxecto non fai — e a
   inferencia é mala: a liña 1.1 fai 10,5 km en 38 min, uns 16 km/h de media, pero un bus
   parado nun semáforo vai a 0 e un paseo vivo vai a 5. O que si fará o botón é saber
   cando importa: se o GPS di que estás no poste de subida á hora de subida, é o único que
   ten que haber na pantalla.

3. **Se non colles ese bus, pregúntase; non se adiviña.** O modo arranca desde unha
   expedición concreta e todo o que amosa despois sae desa fila do cadro. Non subir
   significa que as paradas seguen ben e **todas as horas están mal por unha frecuencia
   enteira**:

   | | |
   | :--- | ---: |
   | Oco ata o seguinte bus da mesma liña, no mesmo poste (mediana) | 30 min |
   | p90 | 90 min |
   | Máximo | 420 min |
   | Máis de 30 min fóra | 77 de 220 |
   | Sen outra expedición ese día | 13 de 233 |

   Pasada a hora de subida máis a marxe, sen que o GPS se moveu, a folla pregunta
   «collíchelo?» con dous botóns. A recuperación non é «recalcular desde onde estou»
   —caro e impreciso sobre unha posición en movemento— senón **o seguinte paso desa liña
   nese poste**, que é `getNextLineDeparture` e xa existe. E cando non hai outro, o que se
   di é que ese era o último, non unha hora nova.

4. **A viaxe sobrevive a que se descarte a pestana, en `sessionStorage`.** Bloquear o
   móbil e gardalo é o normal nun bus, e en Safari unha pestana en segundo plano
   descártase con alegría; se iso perde o modo, o modo non serve. Pero `localStorage` sería
   un rexistro que queda no aparello dicindo que esta persoa ía de X a Y e cando.
   `sessionStorage` sobrevive a unha recarga e morre coa pestana, que é xusto a vida dunha
   viaxe. Gárdase o plan escollido —coas liñas reducidas ao seu id, que o resto vai no
   paquete— e as paradas xa pasadas; bórrase ao rematar, e declárase en PRIVACY.md igual,
   aínda que non sexa `localStorage`. (Dicía «o índice do plan»: volver calculalo ao
   restaurar daría outro plan se o reloxo avanzou, e o lector escolleu ese.)

5. **Lévate ata a porta, coa espera e o tramo a pé finais.** 43 dos 233 plans líderes
   (18 %) poñen un segundo bus, e a espera do medio ten mediana de 5 minutos e p90 de 13:
   cinco minutos nun intercambio que igual non coñeces é onde máis falta fai que algo diga
   que poste e que liña. Rematar no primeiro bus sería soltar ao lector exactamente aí. E
   é máis código, non menos: o modo é un cursor sobre `plan.segments`, e os segmentos xa
   describen a espera, o segundo bus e o paseo final. Parar antes é escribir un caso
   especial.

6. **Unha soa alarma, e unifícase primeiro.** `stopAlarm.ts` xa ten radio, vibración, son,
   notificación e permiso; o modo chámao, non o reimplementa. Se non se unifica antes, o
   resultado é dous sitios pedindo permiso de notificacións, dous radios que se separan co
   tempo, e quen puxese alarma no taboleiro dunha parada e ademais arrancase a viaxe
   recibindo dous avisos para a mesma parada.

---

## Se isto se aproba, a orde de traballo

1. Sacar o estado B a `TripCompanionView.tsx`, baleiro, coa cabeceira e o botón de saír. — **FEITO** o 13 de setembro
2. «Que parada pasei» contra o GPS, con test —é a peza nova e a que pode estar mal. — **FEITO** o 9 de setembro
3. Mover a alarma do taboleiro ao plan. — **FEITO** o 13 de setembro
4. Enfoque de segmento en `RouteMap`. — **FEITO** o 13 de setembro
5. Adelgazar o estado A: barra pregada e alternativa destacada. — feito na segunda volta (a barra prégase; dúas opcións e «+N máis»)
6. PRIVACY.md e o check, no mesmo commit que o que os fai certos. — **FEITO** o 13 de setembro

---

## Estado B, primeira entrega — 13 de setembro de 2026

O que hai, e o que se comprobou nun 375×812 con posicións inxectadas no `watchPosition`
do navegador (o panel non ten GPS):

**Tres ficheiros novos e ningún grande.** `utils/tripProgress.ts` leva toda a lóxica,
pura: fases, «collíchelo?», a substitución dun bus perdido e a copia para
`sessionStorage`. `hooks/useTripCompanion.ts` sostena por riba das pestanas —a vixilancia
de posición, o aviso e a copia viven en `App`, non na pantalla— porque o planificador
desmóntase ao tocar Mapa ou Liñas, e unha viaxe que morre aí non é unha viaxe.
`components/TripCompanionView.tsx` é a pantalla. `RoutePlannerView` medra 20 liñas: o
botón e a prop.

**Os estados quedaron en catro, non cinco.** `planificando` é o estado A; o modo empeza
en `agardando` e pasa por `viaxando`, `baixando` e `camiñando` (o tramo a pé final, coa
espera e o segundo bus polo medio se os hai). Non hai `feito`: feito é que a viaxe
desapareza ao premer «Saír da viaxe».

**Só se afirma o que se contou.** Vaise no bus cando se dixo («Si, vou nel») ou cando o
GPS viu pasar a segunda parada do tramo; a primeira é o poste onde se estaba. O aviso soa
unha vez por tramo, a 300 m ou no propio poste se non houbo posición polo camiño. A
pregunta «Colliches o X das HH:MM?» sae aos tres minutos da hora impresa se non se viu
pasar nada; «Non» le do cadro a seguinte saída desa liña nese poste —14:02 cando se
preguntou ás 13:52 por un 4.1 das 13:12— e cando non queda ningunha di que era a última.

**Un fallo atopado antes de que existise a pantalla.** O cursor sobre os tramos xulgaba
«tramo rematado» pola distancia á parada de baixada no propio fix: de pé no poste onde
baixas, saltaba ao seguinte bus no mesmo instante, así que o primeiro tramo nunca chegaba
e a súa alarma nunca soaba; e ao afastarse 70 m cara ao poste do transbordo, volvía. Agora
rematado é que `seen` teña esa parada —lembrado do fix anterior—, e o check de transbordo
en `tools/test.ts` fixa as dúas cousas.

**A alarma é unha.** `stopAlarm.ts` ten agora unha soa vixilancia de posición para toda
a app, con subscritores; o taboleiro e a viaxe son dous subscritores do mesmo `watch`, co
mesmo radio, o mesmo son e o mesmo permiso. Un check impide que apareza un segundo
`RADIUS_M` ou un `watchPosition` propio.

**A copia pesa 3.666 bytes** para un plan de dous buses, coas liñas reducidas ao seu id;
sobrevive a unha recarga e a cambiar de pestana, e «Saír da viaxe» bórraa. PRIVACY.md ten a
fila e o parágrafo, e o check de claves le agora tamén `sessionStorage`.

**A segunda ollada, o mesmo día.** Brais pediu ver a viaxe enteira e sinalou tres cousas:
o mapa quedaba pequeno ao lado do resto, «Rematei» non era a palabra, e o botón de saír
tiña que estar á man e non ao fondo. Medido nun 375×812 antes de tocar nada: mapa 200 px
fronte a unha cabeceira de 260 e unha lista de 774; o botón a **1.348 px** do alto, dúas
pantallas por baixo do pregue. Despois: mapa a 37 vh (300 px aquí, entre 280 e 420), a
saída nunha barra fixa ao pé de 73 px por riba da navegación, e a palabra é «Saír da
viaxe» —es «Salir del viaje», en «Leave trip»—, que di o que fai un control que está
sempre. E un punto na pestana Ruta, no móbil e no rail, mentres hai viaxe: era o único
sitio onde «enriba das pestanas» non se vía. A viaxe enteira, en pantallas, con GPS
inxectado por CDP (`tools/_companion.ts`, ignorado por git):
<https://claude.ai/code/artifact/2ad3bda6-e1e9-46be-91d2-1e699884f783>

**O paso 4, o mesmo día.** `RouteMap` recibe dous props: `focusSegment`, o tramo que se
está a facer, que se debuxa como sempre e é o que se encadra mentres o resto do plan baixa
a un cuarto de opacidade; e `position`, a posición do lector, unha capa propia que se
move con cada fix en vez de redebuxar a viaxe, e que se mantén á vista co `panInside`
mínimo —non un recentrado a cada fix, que pelexaría con quen acaba de facer zoom, nin un
reencadre ruta-máis-lector, que un salto do GPS convertería nun mapa de todo Lugo. Ao
baixar do último bus o foco pasa ao paseo final, que a pantalla traza polas rúas co
mesmo enrutador do planificador (uns 6 ms por tramo) sen gardalo na copia da viaxe.
Comprobado nun transbordo 5.2 → 3.2: o encadre salta ao 3.2 ao chegar a Rda. Mercedes 11
e ao paseo de 371 m ao chegar á última parada.

**E o último, aprobado e feito o mesmo día:** o botón «Vou nesta» sabe cando importa.
Está sempre —non se agocha nada— e o que cambia é onde: nos dez minutos antes do primeiro
bus vai ao principio da resposta, de 48 a 56 px e a tamaño de titular; pasada a hora
impresa volve abaixo, porque o plan xa é vello e quen fala é o replan. A posición do
planificador, cando o lector a deu, só pode mantelo abaixo («a un quilómetro do poste»),
nunca subilo: é unha lectura única e pode ser da casa; sen posición decide o reloxo só.
`boardingIsNow` en `tripProgress.ts`, con check. Comprobado ás 18:59 cun 6 das 19:05
desde Intercentros: o botón é o primeiro fillo da tarxeta, a 56 px. 140 checks.

O plan de Estado B queda pechado. O que non está feito é o que se decidiu non facer:
debuxar o bus, e o modo en segundo plano, que unha páxina web non pode.

---

## Revisión — 13 de setembro de 2026

Brais pediu revisar a entrega. Tres cousas, dúas delas nos ficheiros que o propio plan
sinalaba como os que podían estar mal.

**O contador saltaba cara adiante e non volvía.** `tripProgress` daba por pasada a
parada **máis afastada** que tivese a menos de 60 m e tachaba todo o anterior. A nota do
radio medira os pares consecutivos a menos de 60 m (dez) e xulgounos asumibles; o que
nunca contou foron os **non consecutivos**:

| | | | |
| :--- | :--- | ---: | :--- |
| 4.1 ida | parada 20 → 29 | 38 m | N-640 (Taller López y Vázquez) / Rotonda Rda. Norte |
| 4.1 volta | parada 7 → 11 | 15 m | Pista Muxa, un poste en cada sentido |
| 5DS volta | parada 19 → 23 | 26 m | Ramón Ferreiro 31 / 26 |
| 5.2 volta | parada 20 → 22 | 54 m | Ramón Ferreiro 19 / Anexa |
| 6 ida | parada 20 → 24 | 59 m | Avda. Magoi 92 / Rúa do Valiño |
| 3.2 volta | parada 0 → 2 | 37 m | N-VI, Torre de Núñez / Ent. Fortaleza |

Seis dos 48 sentidos van e volven pola súa propia avenida. De pé na 20 da 4.1, o fix
está tamén a tiro da 29, así que se tachaban da 21 á 29 dunha vez — e como unha parada
pasada non volve, quedaba así: nove paradas menos na conta e o aviso nove paradas antes.
Agora o percorrido vai **en orde** desde a última alcanzada e colle a primeira a tiro:
pode saltar postes sen fix, non pode pasar por riba dun poste que ten a tiro. O que lle
queda de erro é o inofensivo: un fix que chega de verdade á 29 tras un silencio longo lese
como a 20, e corríxese na 30. O check proba os seis pares; sen o arranxo cae no primeiro.

**O interruptor da pantalla non existía.** O plan decidiuno o 7 de setembro como a
resposta ao móbil no peto, e a entrega non o listaba entre o descartado. Vive no hook,
que dura toda a viaxe: apagado por defecto e sen gardar, `wakeLock.request('screen')`
mentres está acendido e hai viaxe, soltado polo navegador ao agochar a pestana e pedido
de novo en `visibilitychange`. Onde a API non existe, o control non se amosa. Texto nos
tres idiomas, sen a palabra «wake lock». Comprobado nun Chromium de nivel superior contra
a app: adquirido e liberado; no panel embebido do editor dá `NotAllowedError`, que é o
panel e non a app. `server.ts` nomea agora `screen-wake-lock=(self)` na
`Permissions-Policy`, á beira de `geolocation`: era xa o valor por defecto, pero a
cabeceira di o que a app fai.

**Os círculos das paradas baixo as liñas** non era deste modo pero saíu na mesma revisión:
o mapa da rede debuxa nun só lienzo e as rutas redebúxanse despois das paradas en cada
selección. `RouteLayer` mándaas ao fondo en cada redebuxo.
