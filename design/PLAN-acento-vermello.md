# Plan: A Mosqueira en vermello

Decidido con Brais o 27 de agosto de 2026, tras tres roldas de bocetos, e **feito**
ese mesmo día. O que segue era o encargo; ao final está o que realmente saíu, que
non é exactamente isto.

Artifact coas variantes e as maquetas:
<https://claude.ai/code/artifact/ba162402-4ac7-4ec2-8062-ea4c6fcdbde5>

---

## A decisión

**Forma: F3.** A Mosqueira co remate de dous arcos tanxentes — a silueta segue as
propias fiestras e fai un pico onde se tocan. O adarve atravesa a placa de lado a
lado, e a parada é un **anel** pisando esa liña, non un punto macizo. A F3 é o
debuxo de Brais cos arcos un punto máis grandes, para que sobrevivan a 16 px.

**Cor: vermello de flota, `#d81f26`.** Os autobuses de Urbanos de Lugo son
vermellos e xa levan a silueta da muralla no lateral. O azul actual (`#1e3a8a`)
non se escolleu nunca: é o `blue-900` que trae Tailwind por defecto.

Nun momento recomendei verde, co argumento de que o vermello nunha interface
significa erro e o distintivo azul de horario oficial era intocable. **Brais dixo
que o distintivo pode cambiar de cor**, así que ese argumento caeu e o vermello
gaña. Non revisitar isto sen ese contexto.

## O SVG da F3

```svg
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>
  <rect width='24' height='24' rx='6' fill='#d81f26'/>
  <path d='M5.4 16.6v-5.6a3.15 3.15 0 0 1 6.3 0 3.15 3.15 0 0 1 6.3 0v5.6Z' fill='white'/>
  <rect x='0' y='16.4' width='24' height='3.1' fill='white'/>
  <path d='M7.3 15.4v-4a1.55 1.55 0 0 1 3.1 0v4Z' fill='#d81f26'/>
  <path d='M12.6 15.4v-4a1.55 1.55 0 0 1 3.1 0v4Z' fill='#d81f26'/>
  <circle cx='20.6' cy='18' r='2.9' fill='white'/>
  <circle cx='20.6' cy='18' r='1.15' fill='#d81f26'/>
</svg>
```

Vai nun `data:` en `index.html`, onde está o da L. Lembrar **codificar `#` como
`%23`** dentro do atributo, como fai o actual.

## Onde vive a cor (todo o que hai que tocar)

| Ficheiro | Liña | Que é |
|---|---|---|
| `src/index.css` | 37 | `--c-accent` claro `oklch(0.45 0.13 250)` |
| `src/index.css` | 63 | `--c-accent` escuro `oklch(0.76 0.12 252)` |
| `src/index.css` | 32-33 | `--c-official-bg/fg` claro — **tamén cambia** |
| `src/index.css` | 58-59 | `--c-official-bg/fg` escuro — **tamén cambia** |
| `index.html` | 11 | o `data:` do favicon |
| `index.html` | 14 | `<meta name="theme-color" content="#1e3a8a">` |
| `vite.config.ts` | 114 | `theme_color` do manifest PWA |
| `src/components/Map/palette.ts` | 40 | `originPin: '#1e3a8a'` |
| `src/components/Map/palette.ts` | 35-36, 48-49 | `stopSelected`, `userFill` en ambos temas |

`--c-accent` chega a 91 usos en 12 compoñentes a través de `bg-accent`,
`text-accent`, `border-accent` e `--color-accent`. **Non hai que tocar ningún**:
todos len o token. Só cambian as definicións.

## Como facelo

1. **Distintivo oficial primeiro, non despois.** Se se cambia o acento a vermello
   sen mover o oficial, quedan dous cálidos competindo. O oficial vai a verde:
   `oklch(0.45 0.12 155)` claro / `oklch(0.78 0.14 155)` escuro. Comprobar que non
   choca co verde de `destinationPin` (`#047857`) no mapa.
2. **Acento a vermello** nos dous temas. Punto de partida: `oklch(0.52 0.19 27)`
   claro, `oklch(0.72 0.16 30)` escuro. Axustar coa medida, non a ollo.
3. **Pines do mapa.** `originPin` ao vermello novo. `stopSelected` e `userFill` son
   azuis que agora quedan orfos do sistema: decidir se seguen azuis (distinguen ben
   sobre teselas) ou pasan ao acento. Recomendación: **deixalos azuis** e documentar
   por que — un pin de posición vermello sobre unha ruta vermella desaparece.
4. **Favicon, theme-color e manifest** ao final, que son literais soltos.

## O que hai que medir antes de dalo por bo

Isto **non** se aplica e xa. A sonda de contraste do navegador xa existe e funciona;
usala en claro e escuro nas seis pantallas:

- Texto sobre acento (botóns, pestana activa): **≥ 4,5:1**.
  Ollo: `--c-on-accent` en escuro é `oklch(0.16 0.02 255)`, tinta escura sobre
  acento claro. Con vermello hai que recalcular.
- `text-accent` sobre fondo e sobre superficie: ≥ 4,5:1.
- Distintivo oficial e estimado: seguen distinguíndose entre si e do acento.
- **Lembrar as leccións da sesión**: conxelar as transicións (`transition:none`)
  e **fundir o alfa** sobre o fondo real, ou saen falsos negativos de 1,4:1.

Engadir un test que ate as tres cores a distancia de ton suficiente entre elas
(acento / oficial / estimado), que é o fallo que había: acento en ton 250 e oficial
en 255 eran o mesmo azul.

## Estado do proxecto ao pechar

`tsc` 0 · `pnpm test` **84** · build limpo · `pnpm audit` 0 · reconcile 417/417 ·
árbore limpa. Último commit: `6825770` (rutas por pestana).

### Pendente aparte disto

- **Capturas para o README** — só as pode facer Brais.
- **Ligazón á app en vivo** arriba do README, cando Pages estea activo.
- **Publicar**: `gh auth login`, crear `braisbrg/urbanos-lugo` público,
  `git remote add origin`, `git push -u origin main`, Settings → Pages →
  Source: GitHub Actions. Vixiar o primeiro despregue: cambiouse a versión de pnpm
  e engadíronse `SITE_URL` e o `404.html`.
- **`CONTRIBUTING.md` curto** (opcional): o único que evita o PR malo probable é
  «`src/data/*.json` é xerado, tócanse as ferramentas e rexenérase».
- **441 páxinas de paradas e liñas**: descartado por agora. Só paga a pena
  **pre-renderizando** no build; sen iso son cascas baleiras para un buscador.

---

## Dúbida aberta de Brais: o «sen tráfico» da ficha de liña

**Sen responder.** Apuntado o 27 de agosto para mirar na sesión seguinte.

Brais observou que na liña 1.1 o cadro horario dá a primeira saída ás **6:58** e a
última parada ás **7:36** — trinta e oito minutos — mentres a tarxeta «Sen tráfico»
di **25 min**. Dúas preguntas, e as dúas son boas:

1. **Está ben calculado?** Trece minutos de diferenza non son ruído.
2. **Sérvelle de algo a quen le?** Se ninguén fai ese traxecto en 25 minutos, é un
   número que non describe ningunha viaxe real.

### Onde mirar

- `src/components/LinesView.tsx`, na fila de tres datos que se engadiu nesta
  sesión: `Math.round(direction.legSeconds.reduce((a, b) => a + b, 0) / 60)`.
- `legSeconds` vén do dataset: **segundos de circulación libre entre paradas
  consecutivas**, do enrutamento viario ao xerar os datos.
- `rideBetween()` en `src/utils/transitEngine.ts` **si** engade parada:
  `seconds += (legSeconds[i] ?? 90) + 20`. Ou sexa, o planificador conta 20 s por
  parada e a ficha de liña **non**. Esa é a primeira sospeita: 29 paradas × 20 s
  son case dez minutos, que explicaría boa parte dos trece.

### Antes de tocar nada

Comprobar o dato coa fonte antes de decidir: se o cadro horario publica primeira e
última hora dese sentido, a duración real está aí e non hai que estimala. Podería
ser que a tarxeta deba amosar **a duración publicada** e non un modelo — que sería
coherente co resto da app, onde o publicado sempre gaña ao calculado.

Se se queda un número calculado, o nome ten que seguir dicindo o que é. «Sen
tráfico» escolleuse a propósito para non chamarlle duración; se pasa a incluír as
paradas xa non é «sen tráfico», é outra cousa e outro nome.

---

## O que se fixo de verdade

Brais engadiu unha condición mentres se traballaba: **a paleta enteira ten que casar**,
e só as cores de liña poden desentoar, porque cada unha xa ten o seu significado. Iso
cambiou o alcance: non era cambiar o acento, era refacer o sistema.

### O que o plan non vira

- **Os grises estaban tinguidos de azul.** Todos os neutros estaban no ton 255, elixidos
  para un acento azul. Con vermello, unha base fría desafina. Pasaron ao ton 40 (claro) e
  34 (escuro), coa mesma luminosidade e case a mesma croma: o chan quenta, o contraste
  non se move. Esa é a diferenza entre unha paleta escollida e unha herdada.
- **O distintivo oficial NON foi a verde.** O plan dicía verde porque temía "dous cálidos
  competindo", pero o oficial era azul, que non é cálido: o argumento estaba mal. Segue
  azul e agora é o único azul do sistema, o que o fai máis claro, non menos. Moveuse de
  255 a 252 e subiu de croma, que é o azul máis saturado que sRGB alcanza a esa escuridade.
  Verde e vermello serían ademais o único par que un lector con daltonismo non separa.
- **O `selection:bg-sky-500` do `<body>`.** A cor de selección de texto nunca pasara por
  ningún token; era azul de Tailwind e seguiríao sendo.
- **`background_color` do manifest seguía sendo claro** (`#f1f5f9`) despois de que o tema
  escuro pasase a ser o predeterminado, así que a pantalla de inicio da app instalada
  daba un fogonazo branco.
- **A lenda do mapa mentía.** Os cadradiños de "bus" e "trazado da liña" usaban o acento,
  cando o mapa os debuxa coa cor propia de cada liña. Antes acertaba por casualidade: o
  acento vello era o mesmo azul que a liña 1.1. Agora colle a cor da liña activa, e
  neutro cando se ven todas.
- **O favicon estaba duplicado**: un `data:` en `index.html` e mais `public/favicon.svg`.
  Dous debuxos do mesmo logo divirxen. Queda un ficheiro.
- **A banda do adarve saíase da placa.** Vai de lado a lado e a placa ten as esquinas
  redondeadas, así que as puntas asomaban fóra. Recórtase coa forma da placa.

### As cores, medidas

Tres tons levan significado e ningún outro o leva: **vermello** a app, **azul** unha hora
publicada polo operador, **ámbar** unha hora calculada por esta app. Sepáranos 50 graos
ou máis. Cada valor está dentro de sRGB — un oklch fóra de gama remápao o navegador en
silencio, e entón o valor declarado é mentira — e **todos os pares que a interface pon en
pantalla pasan de 4,5:1**, o peor sendo texto de acento sobre superficie a 5,13:1.

| | claro | escuro |
|---|---|---|
| acento | `oklch(0.54 0.21 27)` `#cd171e` | `oklch(0.72 0.17 30)` `#fd7562` |
| oficial | `oklch(0.42 0.125 252)` `#014e8e` | `oklch(0.72 0.15 252)` `#57a8ff` |
| estimado | `oklch(0.45 0.09 80)` `#6f4f07` | `oklch(0.84 0.11 80)` `#f0c374` |
| neutros | ton 40 | ton 34 |

A marca en si — favicon, `theme-color`, manifest — leva o vermello de flota exacto,
`#d81f26`, porque alí é unha forma sobre o seu propio fondo e non hai que ler nada
enriba. O acento é un chisco máis escuro porque tamén é texto.

### O que quedou fóra a propósito

- **O acento non aparece no mapa.** As liñas van coa súa cor e varias son vermellas, así
  que un marcador vermello desaparecería xusto na ruta que marca.
- **O filete dos bordos segue en 1,37:1.** Está por baixo do que pediría a norma para o
  contorno dun control, pero subilo cambia o peso visual de toda a app, e iso non se
  pediu. Queda dito para decidilo aparte.

### Aberto

- **O icono lese como un «m» minúsculo.** A F3 son dous semicírculos tanxentes e o val
  entre eles baixa ata a liña de arranque, o que fai a ligadura. A 16 px, que é onde se
  decide, é un «m» vermello. Hai unha variante dun só arco sobre as dúas fiestras que
  non ten ese problema. Sen decidir.
- **As teselas do mapa saen marcadas «API KEY REQUIRED».** CARTO xa non serve o basemap
  sen chave. Comprobado o 27 de agosto baixando unha tesela: a marca vai dentro do PNG.
  Non ten que ver coa paleta pero bloquea a publicación.
