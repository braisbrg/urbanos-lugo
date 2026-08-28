# Fontes, e que a web se manteña soa

Brais o 28 de agosto de 2026: «quiero que cuando lo tengamos acabado, a menos que cambie
alguna ruta o algún bus, la web se mantenga sola». Isto é o inventario do que hai, do que
falta, e —o máis importante— **onde está a raia** entre o que se pode deixar só e o que
non.

---

## A raia: que pode ir só e que non

### Pode ir só, e xa vai

| | Cada canto | Como |
|---|---|---|
| **Avisos do operador** | cada hora | `deploy-pages.yml` corre `tools/fetchAlerts.ts` e volve despregar |
| **Itinerarios e horarios** | cada semana | `check-source.yml` corre `reconcile --fresh` e **falla** se a páxina do operador xa non di o que publicamos |

Iso cobre o que Brais pediu: mentres non cambie unha ruta nin un bus, ninguén ten que
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
| **buslugo.com/tarifas/** | a táboa de prezos vixente | **Si.** Pendente de atar |
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

Brais preguntou por elas. A resposta curta é **non hai por onde**, e convén que quede
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

Pregunta de Brais: se aparece unha rotonda nova e a ruta cambia, actualízase soa?
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
2. **Comprobar navegadores e sistemas.** Non se probou máis que nun Chromium. Importa
   especialmente: **Safari en iOS**, que é o outro medio Lugo, e onde `100dvh`, os
   `<details>`, `oklch()` e o `ResizeObserver` do mapa son os candidatos a romper. Tamén
   Firefox e Chrome en Android. Hai que decidir cal é o chan que se soporta e escribilo.
3. **Atar as tarifas** ao traballo semanal, para que fallen cando cambien.

## Feito dende que se escribiu isto

- **O RSS do Concello** lese en cada sincronización, filtrado por sucesos e non por temas
  —«tráfico» é o nome dun organismo tanto como unha condición da rúa— e as notas de prensa
  amósanse á parte dos avisos do servizo, sen contar para o distintivo.
- **Os minutos de `info.urbanoslugo.com`** amósanse só a quen chega escaneando o QR dese
  poste. É a páxina á que apunta a pegatina; en calquera outro sitio serían dúas listas de
  horas que se contradín sen que ninguén poida dicir cal manda.
- **O trazado** compárase cada semana contra Overpass, como se describe arriba.
