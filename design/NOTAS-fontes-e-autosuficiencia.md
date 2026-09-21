# Fontes, e que a web se manteña soa

O obxectivo fixado o 28 de agosto de 2026: cando estea acabada, a menos que cambie unha
ruta ou un bus, a web ten que manterse soa. Isto é o inventario do que hai, do que
falta, e —o máis importante— **onde está a raia** entre o que se pode deixar só e o que
non.

---

## A raia: que pode ir só e que non

### Pode ir só, e xa vai

| | Cada canto | Como |
|---|---|---|
| **Avisos do operador** | cada hora | `deploy-pages.yml` corre `tools/fetchAlerts.ts` e volve despregar |
| **Itinerarios e horarios** | cada semana | `check-source.yml` corre `reconcile --fresh` e **falla** se a páxina do operador xa non di o que publicamos |

Iso cobre o obxectivo: mentres non cambie unha ruta nin un bus, ninguén ten que
tocar nada; e o día que cambien, salta.

### Pode ir só, e aínda non vai

- **As tarifas.** `buslugo.com/tarifas/` é unha táboa HTML estable e é a fonte que manda.
  Hoxe os prezos están escritos en `transitData.ts`. Deberían comprobarse no mesmo traballo
  semanal: non para cambialos sós —un prezo que muda só é un prezo no que non se pode
  confiar— senón para **fallar** cando deixen de coincidir.
- **Os avisos do operador nunha segunda fonte.** O RSS de `urbanoslugo.com/es/rss.xml` está
  abandonado hoxe, pero é XML e custa nada consultalo. O día que o usen, chega de balde.

### **Non pode ir só**

- **As obras e avisos municipais.** Non hai fonte lexible por máquina. `datosabertos.lugo.gal`
  devolve 503 nos endpoints CKAN e 404 nos catálogos; a web do Concello é HTML pensado para
  ler, e raspala é un proxecto propio que ademais obriga a ler os seus termos. Quedan
  escritos a man, **con data de revisión e cun aviso que salta aos seis meses**. Iso é o
  máximo que se pode automatizar: que a app admita soa que ninguén mirou.
- **Os nomes das paradas e das liñas.** Veñen do scrape. Cambialos é unha decisión, non un
  refresco.
- **Calquera cousa que a app afirme sobre cartos.** Detéctase soa que cambiou; cámbiase a
  man.

---

## As fontes, unha por unha

| Fonte | Que serve | Automatizable? |
|---|---|---|
| **buslugo.com** | avisos (na barra de navegación) e as páxinas de liña | **Si**, e xa se usa |
| **buslugo.com/tarifas/** | a táboa de prezos vixente | **Si.** Semanal, `checkFares.ts` |
| **buslugo.com/normativa/** | dereitos e obrigas das persoas usuarias | Si, pero non fai falta: cambia moi de raro |
| **info.urbanoslugo.com/qr-demo-paradas/<código>** | **tempos de paso por parada** | **Si**, e é o achado gordo. Ver abaixo |
| **urbanoslugo.com** | a web da propia operadora, Monbus Urbanos S.A. | RSS abandonado; sen HTTPS |
| **datosabertos.lugo.gal** | portal de datos abertos | **Non.** 503 e 404 |
| **Folleto impreso do Concello** | tarifas, nomes de liña, planos | **Non**, é papel; vale para contrastar |

### O achado: o operador si publica tempos por parada, e **non son do horario**

`https://info.urbanoslugo.com/qr-demo-paradas/<codigo>` devolve, por parada, as vindeiras
saídas con **liña, corredor e minutos**, e refréscase soa cada 30 segundos. **Usa os mesmos
códigos de parada ca esta app**: comprobado con `uilP`, `qFuw`, `RnND`, `XpKC` e `gJRz`,
todos 200 e con datos coherentes entre paradas seguidas — a L4.2 sae a 0 min en `qFuw`,
1 min en `RnND` e 1 min en `XpKC`, que están unha detrás doutra na Ronda da Muralla.

**Son medidos, non calculados dun horario.** Seis mostras, unha por minuto, na parada
`uilP` o 28 de agosto:

```
12:46:59   L6  7 min      outra saída 14 min
12:48:25   L6  5 min      13 min
12:49:25   L6  5 min      13 min      <- párase
12:50:26   L6  4 min      11 min      <- baixa 2 min en 61 s
12:51:26   L6  4 min      10 min      <- párase
12:52:27   L6  3 min       9 min
```

Unha conta atrás feita sobre unha hora fixa baixa exactamente un minuto por minuto e non
fai outra cousa. Esta **párase e dá saltos**, o que só pode significar que o número se
recalcula contra algo que se move. Iso pese a que o propio RSS do operador aínda diga
«muy pronto info en tiempo real».

Que abre isto, por orde de importancia:

1. **Unha vara de medir.** Este proxecto enteiro distingue o publicado do calculado, e ata
   agora non había contra que comparar o erro real das nosas estimacións. Agora si.
2. Poderíanse amosar eses minutos, mais **só despois** de saber que son exactamente, que
   significa o `qr-demo-` da ruta, e se os seus termos o permiten. **Non presentalos como
   medidos ata telo por escrito**, que é a regra desta casa.

---

## O contraste co folleto do Concello

### Resolto: o transbordo

O folleto imprimía **transbordo ordinario 0,19 €** e **social 0,10 €**; a app di que son de
balde. Gaña a app: `buslugo.com/tarifas/`, consultada o 28 de agosto, di **0,00 €** nos
dous. O folleto está desactualizado nesa liña e certo nas outras tres (0,64 / 0,45 / 0,31).

### Sen resolver: os nomes de liña

O Concello nomea as liñas polo corredor, buslugo polas cabeceiras:

| | Concello | O que amosa a app |
|---|---|---|
| 1.1 | Campus Universitario – Fingoi – O Ceao | Opuesto Piscina Pedreiras – Rúa Mercadorías (Terminal) |
| 7 | Casco Histórico (Bolaño) – Barrio da Ponte | Bolaño Ribadeneira 1 – A Ponte (cruce Fl…) |

O do Concello dille a alguén por onde vai; o do operador, onde remata. Paga a pena, pero é
un cambio de datos e habería que decidir cal manda.

---


## Redes sociais e outras webs (comprobado o 28 de agosto)

Preguntouse por elas. A resposta curta é **non hai por onde**, e convén que quede
escrito para non volver mirar:

- **`@010lugo` en X** — é a conta de información do Concello e é a que interesa; enlázaa a
  propia web da operadora. Pero X pide API de pago, e Nitter morreu (410). Non é lexible.
- **`concellodelugo.gal/es/actualidad`** — 200, pero a lista de novas píntaa JavaScript: o
  HTML estático só trae o formulario de busca. Raspalo obrigaría a meter un navegador
  completo nun traballo programado.
- **`concellodelugo.gal/rss.xml`** — **si funciona**: RSS válido, 55 KB. Pero son notas de
  prensa, dez entradas entre marzo de 2025 e xuño de 2026, unha cada dous meses. Non dará
  obras. Si trouxo unha cousa directamente útil: «AUTOBUSES GRATUÍTOS PARA O ACTO DE INICIO
  DO ARDE LUCUS».

Conclusión: **paga a pena consultar o RSS do Concello** e amosar só o que fale de
transporte, etiquetado como nota de prensa do Concello e coa súa data — nunca como «obras
comprobadas automaticamente», que é o que non é. As obras seguen sen fonte automática.


## Canto nos equivocamos: a primeira medida

`tools/compareOperatorTimes.ts` pon os nosos minutos ao lado dos do operador para a mesma
parada e o mesmo instante. Oito pasadas por cinco paradas o 28 de agosto, arredor das
13:10, **82 comparacións**:

- **mediana +1 min** (positivo = esta app di máis tarde ca eles)
- **38 de 82 dentro de 2 minutos** — menos da metade
- rango de −24 a +107 min

As colas non son erro noso: o emparellamento é inxenuo, colle a primeira saída dunha liña
en cada lado e as dúas poden ser sentidos distintos. **O seguinte paso é emparellar por
sentido**, e ata facelo os extremos non se poden ler como erro de estimación.

O que si se pode ler: **a mediana é practicamente cero**, así que non hai nesgo — non
chegamos nin tarde nin cedo de forma sistemática. O que hai é ruído, e agora sábese canto.

Un exemplo que amosa por que os seus números son medidos: a liña 2 en `uilP`, ás 13:05,
eles 8 min e nós 1; ás 13:07, eles 7 e nós 0. **A diferenza mantívose en −7 exactos**
mentres os dous baixaban: un bus con sete minutos de retraso, que eles saben e nós non.

Outra confirmación, independente: as clases do seu HTML chámanse `sae-content-info-line`,
`-itinerary`, `-time`. **SAE** é, neste sector, *sistema de axuda á explotación* — o nome
que se lle dá ao sistema que sabe onde están os autobuses, non ao que imprime horarios.
E o seu `robots.txt` é `Disallow:` baleiro: permiso explícito para ler.

## A DGT: comprobada, e non serve

Miroulle a proposta. O feed DATEX II aberto de `infocar.dgt.es` **é de Cataluña, non de
España**: 280 coordenadas, todas entre as lonxitudes +0,49 e +3,21 —ao leste de Greenwich—
e o propio XML identifícase como `sct`, o Servei Català de Trànsit. **Cero incidencias en
Galicia.** O punto de acceso nacional (`nap.dgt.es`) responde, pero é un portal de rexistro,
non un endpoint.

E aínda tendo acceso: a DGT leva **estradas**. Un bus urbano párao o casco vello, a Ronda
da Muralla, unha avaría de auga ou unha procesión. Das nosas 20 liñas só un par tocan
estrada da DGT (a N-VI nas liñas 2 e 3.2).

O que de verdade importa xa chega: «Retenciones en zona Estación Tren» entrou pola campá do
operador. **É un aviso de tráfico, publicado por quen sabe a que liñas afecta.** Esa é a
canle correcta para unha app de bus, e xa se le cada hora.


## Se cambia o mapa: que se detecta e que non

Pregunta aberta: se aparece unha rotonda nova e a ruta cambia, actualízase soa?
**En parte, e convén saber en cal.**

Detéctase só, cada semana, en `reconcile --fresh`:

- a posición de cada poste contra a súa páxina de buslugo **e contra o levantamento de
  OpenStreetMap**;
- a secuencia de paradas de cada itinerario contra as páxinas do operador;
- os nomes, a orde, as liñas que serven cada parada e **os cadros horarios**.

Se a rotonda fai que a liña deixe de pasar por unha parada ou que cambien as horas, salta.

**Detéctase dende agora**: o **trazado debuxado no mapa**. Era o único que podía
envellecer en silencio — vén das relacións de ruta de OpenStreetMap, importábase a man con
`pnpm data:osm`, e se a rúa cambiaba a liña do mapa seguía co percorrido vello ata que
alguén volvese importar. Ninguén se enteraría.

`tools/checkOsmGeometry.ts` corre no mesmo traballo semanal: pregunta a Overpass o mesmo
que `data:osm`, cose as relacións coa mesma función —non unha copia— e compara a lonxitude
de cada sentido coa do trazado publicado. Tamén compara `restrictedMeters`, que é a proba
na que se apoia o aviso da cabeceira do casco histórico: se alguén etiqueta o `bus=yes` que
falta, o número cae e hai que reescribir o aviso.

**O limiar é do 0,5 %**, e non é unha suposición sobre ruído: a mesma relación sen editar
cose exactamente á mesma polilínea, así que o chan é cero e calquera cousa é unha edición
real. A marxe existe para que un mapeador movendo un bordo tres metros non faga saltar a
alarma cada luns — porque unha alarma que salta cada luns acaba ignorada o luns que
importa. Comprobado: 48 rutas de 48, deriva cero; e cunha rotonda de 300 m simulada nunha
liña, falla e sae con 1.

Se Overpass non responde non falla: que un servizo compartido estea caído non é que os
datos estean mal, e facer fallar a semana por iso ensina a todo o mundo a ignorar a semana.

## Pendente

1. **Outra rolda de auditoría e de comprobacións**, coa mesma disciplina: medir antes de
   afirmar, e correr cada aviso ata a súa causa antes de descartalo.
   *Feita: as roldas 13 a 16 de `REXISTRO-probas.md` (14 e 15 de setembro de 2026).*
2. **Comprobar navegadores e sistemas.** Non se probou máis que nun Chromium. Importa
   especialmente: **Safari en iOS**, que é o outro medio Lugo, e onde `100dvh`, os
   `<details>`, `oklch()` e o `ResizeObserver` do mapa son os candidatos a romper. Tamén
   Firefox e Chrome en Android. Hai que decidir cal é o chan que se soporta e escribilo.
   *O chan está escrito (15 de setembro de 2026, README, «Navegadores»): o de Vite 8,
   Chrome/Edge 111, Firefox 114, Safari e iOS 16.4. Do que está por riba do chan xa se
   protexe o código: `AbortSignal.timeout?.`, `wakeLock` só se existe, `vibrate?.`, mapa
   ráster sen WebGL2. O que queda é a proba nun iPhone real, coa lista de abaixo.*
3. **Probas de esforzo en todo o proxecto**, despois do paso de navegadores. Non se
   probou nunca nada fóra do camiño feliz: unha sesión longa co taboleiro recalculando cada
   15 s, o planificador contra pares de paradas afastadas, o mapa con todas as capas, a
   sincronización de avisos contra un servidor lento ou caído, o endpoint do QR chamado
   unha e outra vez, consultas enormes na busca, e o comportamento con rede mala. Hai que
   decidir que se rompe aceptablemente e que non debe romper nunca.
   *Feitas, e con ferramenta cada unha: a sesión longa e o mapa con todo (`measure:browser`),
   o planificador contra pares afastados (`stressPlanner`), o QR unha e outra vez e as
   consultas enormes (`stressHttp`: 50 á vez sobre un poste, 40 plans nunha ventá, o
   limitador a 120/min), e o 15 de setembro de 2026 os avisos contra un servidor colgado,
   con erro ou lento e a app sen rede (`stress:network`). O que se decidiu: o taboleiro
   nunca espera pola rede; a pantalla de avisos nunca queda baleira máis de dous segundos;
   unha lectura fallida do operador dura un minuto, non media hora; sen rede, o *service
   worker* dá a última resposta que viu. Rolda 16 do rexistro.*
4. **Interurbanas no taboleiro, e con elas os postes na beirarrúa.** Un só proxecto de
   datos, decidido o 15 de setembro de 2026 e sen data. As liñas da Xunta chegan en GTFS
   (datos abertos; ler a licenza antes, regra de `DATA.md`) con un poste por sentido, na
   beirarrúa. É o mesmo formato que faría falta para arranxar o que hoxe o mapa non di: o
   lado da rúa. Medido: de 1.088 pares parada-sentido, 652 pins do operador están a menos
   de 4 m do eixe da rúa —marcan a calzada, non a beirarrúa— e 143 paradas son un só
   punto para os dous sentidos. Non se arranxa desprazando os pins «á dereita do sentido»
   (sería inventar unha posición, e falla en rotondas, dobres calzadas e bucles: os 22
   casos que saen «á esquerda» son iso), senón tomando o poste real: OpenStreetMap ten 275
   das 417 co mesmo nome. O prezo: as coordenadas deixan de ser do operador, `stops.json`
   pasa a ser dato OSM (ODbL), 142 paradas quedan sen fonte, e hai que partir as dobres —
   co que cambian o reconto, os códigos QR compartidos, os favoritos e `?parada=`. Non se
   fai por partes.
5. **Tres paradas que discrepan de OSM no lado da rúa**, para mirar a pé ou en Street View
   antes de tocar nada: `s589` Czda. Gándaras (enfte. Residencia) —o poste de OSM está 31 m
   máis alá, na outra beirarrúa da 4.2 cara a Gándaras—, `s133` Rúa Industria (Aula 9)
   —43 m, outra beirarrúa da 1.2/1.4 de volta— e `s1043` Barbaín (dir. centro) —15 m, outra
   beirarrúa da 11 a Bóveda de volta—. OSM tamén se equivoca; sen velas, non se move
   ningunha.
   *Vistas o 21 de setembro de 2026, en Street View (imaxes de 2025), coas tres respostas
   distintas que cabían:*
   - *`s133` Rúa Industria (Aula 9): **ten razón OSM.** O poste —o tótem gris do
     operador— está na beirarrúa norte, diante da cafetería Zertín (escola de cociña),
     en 43,04574 −7,56535, xusto onde OSM o pon e 43 m ao leste do pin do operador,
     onde non hai nada. Norte é a dereita da 1.2/1.4 de volta, que baixa cara ao oeste.
     Movelo é un cambio de xeometría no xerador; o único precedente (Monte Segade) ten
     unha regra propia e un check que garda que sexa un só. Vai co proxecto 4 ou como
     segunda excepción: decisión do dono.*
   - *`s1043` Barbaín (dir. centro): **ten razón o operador.** A marquesiña verde do
     Concello («Zona Rural») está no lado leste do tronco sur do cruce, ao pé do sinal
     «Bóveda», en 43,00732 −7,51735: o pin do operador. O poste de OSM, 15 m ao NNO na
     bifurcación, non ten nada. Leste é a dereita da 11 de volta, que sobe cara ao norte.*
   - *`s589` Czda. Gándaras (enfte. Residencia): **non se ve poste en ningún dos dous
     sitios.** Onde OSM (43,03106 −7,54952, lado leste): sebe, muro de pedra, un poste
     eléctrico sen placa e o sinal da Protectora de Animais; onde o operador (o cruce,
     lado leste): o espello, dous sinais e a terraza da cafetería. A única
     infraestrutura é a marquesiña do lado oeste, diante da Residencia, que é a outra
     parada (`s595`, 4.2 de volta e 13). A do sentido Gándaras non ten sinal visible en
     2025; queda onde está.*
6. **A folla de controis do mapa**, a outra metade da débeda 7 (rolda 15 do rexistro). Non
   se fai en frío: sería un compoñente de vinte props coa mesma complexidade. Cando se abra
   `TransitMap` por outro motivo, o que paga é sacar só a lista de liñas (`pickedLineIds`,
   `linesExpanded`), que si é unha peza soa.
   *Feita a metade que pagaba, o 21 de setembro de 2026: a tira de fichas de liña do
   móbil é `Map/LineChips.tsx`, con seis props (idioma, as liñas, as listadas, as
   escollidas, alternar, todas) e o seu propio estado de despregada, que se pecha só cando
   cambian as liñas escollidas —tamén ao escoller desde a folla, como antes—. Con ela
   fóronse `sharedNumbers` e `destinationOf`, que só ela usaba: 118 liñas menos en
   `TransitMap` (1.063). O resto da folla queda onde está, polo motivo de arriba.
   Comprobado no navegador a 375 px: despregar, escoller a 1.2, a tira prégase e a liña
   queda marcada; `audit:browser` sen achados no estado `mapa`.*
7. **«WebGL context lost»**, visto unha vez na consola de produción o 16 de setembro de
   2026, entre o ruído das extensións do navegador, sen que se anotase que pasou co mapa.
   Sen investigar. O que hai que comprobar, forzándoo (`WEBGL_lose_context` desde a
   consola): que o mapa volve pintar cando o contexto se restaura, e que se non se
   restaura cae ás teselas ráster en vez de quedar en branco.
   *Feito (19 de setembro de 2026, rolda 19 do rexistro): forzado, o renderizador volve
   pintar só cando o contexto se restaura; se non se restaura, quedaba en branco para
   sempre. Agora, cinco segundos sen volver —contados só coa páxina visible— e a capa
   cámbiase pola ráster no mesmo mapa; os mapas que nazan despois xa nacen ráster.*
8. **Volver mirar os buscadores** nunhas semanas, cousa do dono: en Search Console, que
   «Páxinas» amose as seis; en Bing Webmaster, que o escaneo do sitio xa non avise de
   «H1 tag missing» (arranxado o 16 de setembro cun `<h1>` estático en cada copia).
   *A configuración está feita desde o 15 de setembro (verificación, sitemap enviado en
   Google e importado en Bing); o que queda é só mirar. O 21 de setembro, desde fóra:
   `site:braisbrg.github.io` sen resultados aínda en DuckDuckGo (índice de Bing); Google
   non se deixa preguntar desde un guión. Se en dúas semanas Bing segue sen nada, «Submit
   URLs» a man en Bing Webmaster ou IndexNow desde o despregue, que é unha petición máis
   a un terceiro e decídea o dono.*
   *O que si dixo Search Console, o 21 de setembro: «Duplicada: Google elixiu unha
   canónica diferente» para `/paradas/`, coa raíz como a súa. Certo: a raíz é a pestana de
   paradas e as dúas páxinas debuxan o mesmo. `/paradas/` leva agora a raíz como canónica e
   o sitemap queda en seis URL. O «non se puido ler» do sitemap, con cinco días e o
   ficheiro servido con 200, `application/xml` e XML válido (comprobado con `curl`), é o
   que Search Console amosa nas propiedades novas ata que o procesa; non hai nada que
   arranxar no ficheiro. Bing: «Discovered but not crawled» na raíz é o estado normal dun
   sitio novo sen ligazóns de entrada; o que se pode facer é «Request indexing» nas seis
   URL, unha vez. IndexNow é o protocolo para avisar a Bing en cada cambio de contido
   desde o despregue; con seis URL fixas, o botón fai o mesmo.*
9. **Os festivos.** `dayKind()` non os coñece: un festivo entre semana é «laborable» para
   a app e «domingo e festivos» para o operador, así que ese día o taboleiro amosa un
   cadro que non circula, etiquetado HORARIO OFICIAL. Visto o 19 de setembro de 2026 ao
   revisar as varreduras: ningunha pasa por un festivo, e o README dicía «non se
   distinguen dos domingos», que era o contrario do que fai o código (corrixido). O que
   fai falta é dato con fonte, non código: `data/festivos.json` por ano —os nacionais e os
   galegos do calendario laboral do DOG, os dous locais do Concello—, `dayKind` que
   devolva `domingo` neses días, a varredura de invariantes cun festivo entre os seus
   días, e un check que falle en xaneiro se o ano en curso non está no ficheiro, que é o
   recordatorio honesto de que caduca. Decisión do dono: fonte e quen a mantén cada ano.
   *Feito o 21 de setembro de 2026, coa fonte atopada: o Decreto 46/2025 (DOG do 20 de
   xuño de 2025) dá os doce festivos galegos de 2026 —co 19 de marzo e o 24 de xuño no
   lugar do 1 de novembro e do 6 de decembro, que caen en domingo, e sen o 17 de maio, que
   tamén— e a Resolución do 21 de outubro de 2025 (DOG do 30 de outubro) os dous locais de
   Lugo: 17 de febreiro, Martes de Entroido, e 5 de outubro, San Froilán. Catorce días en
   `src/data/festivos.json`, coas dúas ligazóns; `dayKind` devolve `domingo` neses días,
   as dúas pantallas que din «non circula hoxe» din tamén «hoxe é festivo», o recuo ao
   seguinte día de servizo salta o festivo, a varredura de invariantes pasa polo 12 de
   outubro, e o check falla o 1 de xaneiro de 2027 se ninguén engade o ano: quen o
   mantén é quen o vexa fallar, cos dous DOG de cada ano (o decreto sae en xuño, os locais
   en outubro).*

### Lista para o iPhone

Media hora cun iPhone real, en Safari, con iOS 16.4 ou máis. Anotar o modelo e a versión.

1. Abrir `braisbrg.github.io/urbanos-lugo/`. O taboleiro con horas en menos de 3 s, sen
   marco branco antes do tema escuro.
2. Compartir → **Engadir á pantalla de inicio**. Abrir desde a icona: pantalla completa,
   sen barra de Safari, a icona correcta.
3. Buscar «catedral» tecleando: as filas aparecen letra a letra sen que o teclado tape o
   campo. Abrir unha parada; premer **copiar ligazón** e pegala en Notas: ten `?parada=`.
4. **Mapa**: debuxa (é MapLibre, WebGL2); pinza e xiro van fluídos; os nomes das paradas
   lense; a folla de controis sobe desde abaixo e non queda tapada pola barra de inicio
   (é onde `100dvh` e as zonas seguras rompen).
5. Xirar o teléfono a horizontal e volver: nada queda cortado.
6. **Ruta**: calcular Praza Maior → HULA; ao calcular, a pantalla vai á resposta. Premer
   **Vou nesta**: pide o GPS, e a pantalla non se apaga durante un minuto (a *wake lock*,
   iOS 16.4+; se non existe, non debe saír erro ningún).
7. Cambiar tema e idioma desde o menú: as cores (`oklch()`) e os textos cambian enteiros.
8. Modo avión, pechar a app, abrila de novo desde a icona: abre, o taboleiro ten horas, e
   Avisos amosa unha resposta con data (a última ou a copia gardada), non unha lista baleira.
9. **Axustes → Accesibilidade → Texto máis grande**, ao máximo: nada se solapa nin se
   corta; a barra de abaixo segue con catro destinos.
10. **VoiceOver** un minuto: as pestanas anúncianse como ligazóns co seu nome; dentro do
    menú, pasar co dedo non sae del; ao calcular unha ruta, le a resposta.

Un fallo en calquera punto é un erro de verdade e vai ao rexistro con modelo e versión.

## Feito dende que se escribiu isto

- **O RSS do Concello** lese en cada sincronización e as notas de prensa amósanse á parte
  dos avisos do servizo, sen contar para o distintivo. Dende o 15 de setembro de 2026, só a
  etiqueta *Tráfico*, só a última semana, e só os titulares que anuncian un corte, un
  desvío ou unha restrición: auditados sesenta días de tres etiquetas, o que entraba era un
  récord de viaxeiros, unha declaración política e os cortes dunha carreira que seguirían
  en pantalla ata novembro. «Tráfico» a secas non vale como palabra —é o nome dun
  organismo tanto como unha condición da rúa—; as palabras do suceso si.
- **A instantánea de avisos vive en `public/alerts.json`**, non no paquete (19 de setembro
  de 2026, rolda 20). Importada, cada refresco horario renomeaba seis anacos —medio
  megabyte comprimido— e era a orixe das recargas por «anaco desaparecido». Como ficheiro
  á parte, un refresco move 1,3 KB. O mesmo día: o «No existen avisos en este momento» da
  campá xa non conta como incidencia, e a data dun aviso do operador di que é a da lectura.
- **Os minutos de `info.urbanoslugo.com`** amósanse só a quen chega escaneando o QR dese
  poste. É a páxina á que apunta a pegatina; en calquera outro sitio serían dúas listas de
  horas que se contradín sen que ninguén poida dicir cal manda.
- **O trazado** compárase cada semana contra Overpass, como se describe arriba.
- **As tarifas** compróbanse no mesmo traballo. `buslugo.com/tarifas` publícaas nunha
  táboa de dúas columnas, e `tools/checkFares.ts` empareja por etiqueta e non por posición
  —unha fila engadida movería unha lectura por posición ao prezo equivocado, que é o tipo
  de fallo que parece un acerto. Comprobado: os cinco prezos cadran, e cunha suba falsa de
  0,64 a 0,70 falla e sae con 1.

  **O que non cobre, e dise:** a ventá de transbordo de 75 minutos e a tarxeta TMG da
  Xunta non están nesa páxina. Afirmar que se vixía a táboa enteira cando dous terzos
  dunha tarxeta quedan fóra sería peor que non vixiar nada.
