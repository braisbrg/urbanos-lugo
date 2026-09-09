# Plan: o mapa de debaixo é noso

Decidido con Brais o 8 de setembro de 2026 e feito o 9. Ata agora o mapa era o estilo
publicado de OpenFreeMap con parches de cor aplicados en tempo de execución. Pasa a
ser un estilo do repositorio, derivado do seu, xerado por unha ferramenta.

O encargo era «faino máis noso». O que apareceu ao medilo foi outra cousa.

---

## Para que é este mapa

Non é un mapa de Lugo. É o fondo sobre o que se debuxan **24 cores de liña e 417
paradas**, e esa é a única pregunta que responde a pantalla. Todo o que hai nel ten
que recuar para que se lea o que se pinta enriba.

Iso non era o que estaba pasando.

## O amplificador

O suelo que a folla de estilo dicía que era `#171a1f` chegaba á pantalla como
`#404850`. Contado sobre o fotograma composto: o 54 % da área do mapa nese ton, que
non é ningún dos que hai no estilo.

A causa estaba nunha regra de CSS:

```css
/* CARTO Dark Matter is honest cartography but nearly monochrome... */
.dark .leaflet-tile-pane { filter: brightness(2.8); }
```

Escribiuse cando o basemap era **raster de CARTO**. Cunha imaxe xa coloreada, o único
resorte que hai é amplificala. En agosto de 2026 CARTO substituíuse por teselas
vectoriais e o filtro non, así que durante meses cada cor do estilo chegou á pantalla
multiplicada por 2,8.

Dúas consecuencias, e a segunda é a que importa:

1. **Ningunha cor significaba o que dicía.** Todas se escolleron a ollo a través dun
   amplificador, incluídas as que se axustaron na auditoría de accesibilidade.
2. **O filtro colle o `tile-pane` e non o `overlay-pane`.** As rutas e as paradas
   debúxanse enriba, no segundo. O basemap ía multiplicado por 2,8 e a nosa tinta por
   1. Esa é a razón enteira de que unha liña de bus desaparecese na rúa de debaixo.

O estilo vectorial ten as cores nun ficheiro que é noso, así que o amplificador xa
non ten nada que facer. Quitalo é o cambio; o resto é poñer no estilo a xerarquía
que o filtro intentaba arrincar por forza.

## O que se mediu

As liñas debúxanse como polilíñas de 6 px sen bordo nin halo: a cor vai directa
contra o basemap. Medidos os 21 tons distintos das 24 liñas:

| | |
| :--- | ---: |
| rúa máis clara do basemap, como se servía | 1,67 sobre o chan |
| liña máis apagada, a 11 (`#78350f`) | 1,92 sobre o chan |
| **esa liña sobre esa rúa** | **1,15** |
| tons de liña por debaixo de 1,5 contra a rúa | **6 de 21** |

No tema claro non hai problema: o peor caso é 4,04. O filtro tampouco o tocaba, que é
por que só o escuro estaba mal.

## A paleta escura

A estrutura correcta xa estaba no estilo publicado e tirámola: **as rúas son escuras
cun bordo claro**, non cintas claras. Unha rúa lese pola súa forma, non pola súa masa.
Ao invertelo puxemos vinte píxeles de gris claro debaixo de seis píxeles de cor.

| Capa | Cor | Sobre o chan | Por que |
| :--- | :--- | ---: | :--- |
| chan | `#171a1f` | 1,00 | o listón; a app é `#110d0d` arredor |
| auga | `#0e151d` | — | máis escura e azul de verdade, para que o Miño sexa un río |
| rúa maior, interior | `#1e222a` | 1,09 | aquí cae a tinta: mínimo 1,76 |
| **edificios** | `#232830` | **1,18** | eran 1,07, que non é un escalón |
| parque e bosque | `#1e2a1b` | 1,16 | verde abondo para ser parque |
| rúa menor | `#2b3038` | 1,31 | non ten bordo, así que cárgase soa |
| rúa maior, bordo | `#39404b` | 1,67 | un fío, 0,65 px por lado a zoom 14 |

O interior da rúa maior queda **por debaixo** dos edificios a propósito: unha vía
principal lese como unha canle escura de bordos claros cortando as mazás, que é o que
é. Os edificios, á súa vez, quedan por debaixo das rúas menores.

Sobre os edificios a 1,18, as 24 liñas seguen a 1,63 ou mellor.

### O teito non é gusto

O límite ponno a liña 11. O seu marrón é escuro porque **o badge leva o número en
branco a 10 px e tiña que pasar 4,5:1** — foi unha decisión de accesibilidade
anterior, e é boa. Pero as dúas esixencias tiran en sentidos opostos: o que fai
lexible o badge é o que fai que a liña desapareza nun mapa escuro.

Subir a rúa maior un paso máis deixa a 11 por debaixo de 1,5. Se algún día o basemap
ten que ser máis claro que isto, o resorte é **un fío escuro debaixo da liña de
ruta**, non outro paso aquí.

### Rótulos

Van medidos contra 4,5, que é o listón do texto e non o do fondo. O estilo publicado
non chega: os nomes de rúa veñen en rgba(80,78,78) e os de lugar en rgb(101,101,101),
2,3 e 3,0 sobre o chan. O nome da auga vén en negro ao 70 % sobre un mapa case negro,
que non é tenue, é ausente. Corríxense os tres.

## Tipografía

No mapa había **tres tipografías**:

| onde | cal |
| :--- | :--- |
| toda a interface | Atkinson Hyperlegible Next, autoaloxada |
| nomes de rúa e lugar do basemap | Noto Sans, de OpenFreeMap |
| **o número dentro do pin de parada** | `sans-serif`, o que puxese o sistema |

A terceira é un erro e arránxase: o número da liña é o dato máis importante da
pantalla e estaba escrito na única fonte que a app decidiu non usar. Pasa a
`var(--font-sans)`, que é a cara que se escolleu precisamente pola lexibilidade.

A segunda **queda como está**, e é unha decisión. Os glifos veñen prerenderizados en
SDF dende OpenFreeMap; servir Atkinson aí significaría xerar e aloxar as nosas propias
teselas de fonte, un ou dous megabytes, para un texto que **desaparece por riba do
zoom 16,5**, que é exactamente onde os nosos rótulos toman o relevo. A cara que
importa á distancia de lectura xa é a nosa.

## O que non se toca

- **A atribución.** OpenFreeMap, OpenMapTiles e OpenStreetMap seguen igual, e agora
  van tamén dentro do propio ficheiro, non só no control do mapa.
- **As fontes de datos.** Teselas, sprites e glifos seguen vindo de
  `tiles.openfreemap.org`: a política de `src/security/csp.ts` non gaña orixes.
- **O tema claro**, máis alá do arranxo dos rótulos. Positron xa mide ben para este
  traballo; redeseñalo sería redeseñar por redeseñar.
- **As nove capas que nunca poden debuxar en Lugo** — xeleiros, fronteiras de país e
  de estado, cero elementos na caixa segundo Overpass. Quitalas aforra tres kilobytes
  e estropea o mapa se alguén se afasta.
- **Os puntos de parada.** Seguen sendo un anel branco de 4 px de radio sobre o
  recheo escuro. Non se rediseñan neste plan; queda anotado que son o elemento máis
  forte do mapa (17,6:1 contra o chan, máis que calquera liña) e que o radio é fixo a
  todos os zooms.

## O que se atopou de camiño

O axuste que apaga os nomes de rúa a partir do zoom 16 **nunca se aplicou no tema
claro**. Os dous estilos publicados non son o mesmo deseño: dark chama ás capas con
guión baixo (`highway_name_other`) e positron con guión (`highway-name-minor`), e o
axuste só nomeaba as de dark. O `try`/`catch` que perdoa un cambio de nome augas
arriba tragou o erro en silencio todo o tempo que estivo publicado.

Ese é o argumento enteiro para ter o estilo no repositorio: un ficheiro que se
comproba na build, en vez dun parche que se perdoa en execución.

## Como se fai

`tools/buildMapStyle.ts` le o estilo publicado da caché e escribe
`src/data/map-style-light.json` e `src/data/map-style-dark.json`. Non se editan a
man, coma todo o que hai en `src/data/`: cámbiase a táboa de transformacións, que
cabe nunha pantalla, e vólvese executar con `pnpm run map:style`. Con `--fetch`
volve baixar os estilos publicados, cunha petición por segundo.

Gaña tres cousas fronte aos parches en execución: non hai fogonazo das cores
publicadas en cada cambio de tema; se `/styles/dark` cambia de forma seguimos tendo
mapa; e os ids compróbanse cando se constrúe en vez de perdoarse cando se executa.

Perde unha: xa non se pode abrir o estilo en Maputnik, tocalo e gardalo de volta.
Ábrese igual para miralo, porque o JSON xerado é un estilo válido, pero o cambio hai
que levalo á táboa.

## A porta

Cinco checks en `tools/test.ts`:

- os dous estilos cargan, seguen na versión 8, e sprite e glifos seguen en
  OpenFreeMap — cambialos sería un cambio de política, non de estilo;
- as tres atribucións seguen dentro do ficheiro;
- ningunha capa pide ao sprite unha imaxe que non ten (o `wood-pattern` que xa
  comemos);
- as 24 liñas están a **1,45 ou máis** contra as tres capas de rúa sobre as que se
  debuxan, os edificios e o verde separan do chan, e ningún rótulo baixa de 4,5;
- **o `tile-pane` non volve levar ningún filtro**, que é o que puña toda a paleta
  fóra do alcance da medida.

## Despois

Brais deixou aberto se paga a pena algunha animación ou efecto. Non é prioridade e
non se fai neste plan.
