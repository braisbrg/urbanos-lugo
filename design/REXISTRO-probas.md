# Rexistro de probas e auditorías

Un sitio por rolda, co que se atopou **e co que se descartou**. O segundo importa tanto
como o primeiro: sen el, cada rolda volve mirar o mesmo e volve asustarse do mesmo.

Regras que nos impuxemos, e que xa nos aforraron erros:

1. **Medir antes de afirmar.** Dúas veces nesta sesión un valor «obvio» era falso.
2. **Comprobar o ficheiro construído, non a fonte.** Un arranxo pode ser correcto en
   `src/` e desaparecer no `dist/`.
3. **Verificar que a proba morde.** Reintroducir o fallo e ver fallar o check. Un check
   que nunca falla non é un check.
4. **Un falso positivo custa máis ca un fallo pequeno.** Cuantificar antes de alarmar.

---

## Paso de navegadores — rolda 1

### Atopado e arranxado

**N1. Toda a paleta era `oklch()` sen respaldo, e un token non pode ter respaldo por
cascada.** `--c-bg: #fefdfd; --c-bg: oklch(...)` non funciona: unha declaración de
propiedade personalizada é válida conteña o que conteña, así que a liña `oklch` gaña
mesmo onde `oklch` non significa nada. A rotura chega ao usala: `background: var(--c-bg)`
substitúese por algo que non se pode analizar, a propiedade queda *invalid at
computed-value time*, e a páxina perde as cores enteiras — fondos transparentes e texto
herdado en negro. Afecta a Safari anterior a 15.4, Chrome anterior a 111, Firefox
anterior a 113 e as WebViews vellas de Android.

Arranxo: un bloque `@supports not (color: oklch(0 0 0))` **aditivo**, coa mesma paleta en
sRGB. Un navegador que entende oklch nin sequera o le, así que a paleta medida non cambia.

Verificación: fórzase a condición a positiva, recárgase, e mídense as 36 cores pintándoas
nun canvas. **Idénticas ás 36**, nos dous temas, incluídos os scrims.

**N2. `height: 100dvh` sen respaldo** deixaba o armazón sen altura nos mesmos navegadores:
a declaración descártase, a columna flex pasa a altura automática e a barra inferior deixa
de estar fixada abaixo.

### Erros nosos durante esta rolda

- **Convertín dous scrims «a ollo» e os dous estaban mal** (#2b211d e #150f0e; os reais
  son #1c1411 e #030101). Collidos porque se converteron os 36 tokens de verdade en vez de
  fiarse dos comentarios. De paso, os 34 comentarios hex existentes son correctos.
- **O minificador comeu o respaldo `height: 100vh`.** En `src/` a regra tiña as dúas
  declaracións e no `dist/` só quedaba `height:100dvh`: esbuild elimina unha propiedade
  duplicada. Colleuse porque se mirou o ficheiro construído. Reescribiuse como
  `@supports (height: 100dvh)`, que non se pode colapsar, e comprobouse outra vez no dist.
- **Probouse `build.cssTarget: ['safari15', ...]`** pensando que preservaría os respaldos.
  Non o fai: esbuild deduplica igual. Config revertida en vez de deixala aí sen efecto.

### Mirado e descartado (non volver mirar sen motivo)

- **`AbortSignal.timeout`** só está en `alertSyncService.ts` e `operatorTimes.ts`, que son
  código de servidor. Os hooks do navegador impórtanos só como `type`, que se borra ao
  compilar. Confirmado: a cadea non aparece no *bundle* do navegador.
- **`BarcodeDetector`** non existe en Safari nin Firefox, pero xa degrada: o botón queda
  desactivado con etiqueta propia e a entrada manual segue sendo a función completa.
  Ademais, nun iPhone a cámara nativa abre `?parada=` directamente, que é o camiño real.
- **`Notification`** está protexida por `typeof Notification === 'undefined'` e o
  construtor vai dentro dun `try`, cun comentario que nomea exactamente o caso de iOS.
- **`--c-official-bg` do tema escuro sae do gamut**, pero por 0,00055 en lineal: 0,14 dun
  paso de 8 bits. Redondea ao mesmo #57a8ff. Non é un fallo.

### Aínda sen probar de verdade

Non hai aquí ningún Safari real. O anterior é unha auditoría de compatibilidade contra o
código, non unha execución. Iso hai que dicilo en vez de dar por bo o que non se probou.

---

## Paso de navegadores — rolda 2

Lente distinta a propósito: nada de buscar as mesmas APIs outra vez, senón medir o que se
debuxa. Sonda no navegador que percorre cada pantalla e mide desbordes reais, elementos
fóra do viewport e alturas de destino táctil.

**Pantallas medidas a 375 px e a 320 px** (iPhone SE, o ancho máis hostil que se usa):
paradas, liñas, mapa, ruta, avisos, tarifas, unha ficha de parada con QR e unha ficha de
liña. `scrollWidth - clientWidth` = **0 en todas**. Ningún elemento fóra do viewport,
ningún destino por debaixo de 44 px, **cero erros de consola**.

### Falso positivo, e a lección que deixa

**A sonda dixo que o enlace «Ir ao contido» quedaba en 1×1 ao enfocalo**, o que sería un
skip link roto. Non o é: `document.hasFocus()` era `false` porque o panel do navegador non
tiña o foco, e sen foco no documento as regras `:focus` non se aplican aínda que
`document.activeElement` estea posto. Facendo clic dentro da páxina primeiro, o enlace
pasa a **127×38 en (8,8)**, que é o correcto.

> **Regra para as vindeiras roldas:** calquera medida que dependa de `:focus` require
> facer clic dentro da páxina antes. Se non, mídese o panel e non a aplicación.

Tamén se afinou a sonda para ignorar os elementos dentro dun antepasado que recorta: os
paneis e o lenzo do mapa sobresaen do viewport **a propósito**, porque así funciona o
arrastre, e sinalalos cada rolda tapa un desborde de verdade.

### Mirado e descartado

- **Área segura do iPhone.** Non hai `env(safe-area-inset-*)` nin `viewport-fit=cover`, e
  está ben así: sen `viewport-fit=cover`, iOS xa mantén a páxina dentro da área segura, así
  que a barra inferior nunca queda baixo o indicador de inicio. Poñer `cover` sen engadir
  recheos `env()` en todas partes é o que **rompería**. Cambio cosmético e arriscado; non
  se toca.
- **Google Fonts.** A CSP xa permite `fonts.googleapis.com` en `style-src` e
  `fonts.gstatic.com` en `font-src`. Con `display=swap` e `system-ui` na cadea, sen rede o
  texto segue a lerse.
- **Atribución do mapa**, 14 px de alto. É a barra de créditos estándar; inflala taparía o
  mapa. Exclúese da sonda por convención, non por descoido.

---

## Paso de navegadores — rolda 3 (limpa)

Terceira lente: teclado, semántica, movemento reducido, cambio de tema e de idioma, e a
promesa de funcionar sen conexión.

**Semántica.** Un só `h1`, ningún salto na xerarquía de encabezados, un `main`, un
`header`, dúas navegacións, unha rexión `aria-live="polite"`, ningunha imaxe sen `alt` e
ningún botón sen nome accesible.

**Teclado.** Coas teclas de verdade (non `element.focus()`), `:focus-visible` aplícase e
o contorno é sólido de 1,6 px na cor de acento. O diálogo do QR ten `role="dialog"` e
`aria-modal="true"`, o foco queda dentro despois de seis tabulacións, `Escape` péchao e o
foco volve ao botón que o abriu.

**Movemento reducido.** Hai un bloque `@media (prefers-reduced-motion: reduce)` que anula
animacións, transicións e `scroll-behavior` en todo.

**Tema e idioma.** Cámbianse sen recargar; `document.documentElement.lang` e o título da
páxina seguen ao idioma.

### Segundo falso positivo da mesma familia

A sonda dixo que **14 de 14 controis non tiñan anel de foco**. Non é certo: enfocar por
script despois dun clic non activa `:focus-visible`, que é o que leva o anel. Con
tabulacións reais, aparece.

> **Regra:** o mesmo aviso ca na rolda 2, ampliado. Nada de `element.focus()` para medir
> estilos de foco. Teclas de verdade, e clic dentro da páxina antes.

### Non verificable aquí (dito, non dado por bo)

**O rexistro do service worker falla neste panel**, e non se pode atribuír á aplicación:
a páxina descarga `/sw.js` con 200 e `text/javascript`, non hai ningunha violación de CSP
na consola, e aínda así `navigator.serviceWorker.register()` devolve «unknown error
occurred when fetching the script». Iso é o navegador incrustado, que non permite
rexistrar traballadores de servizo.

O que si se puido medir é a build: **20 entradas no manifesto de precaché, 2,86 MB, e
todas existen no disco** — o armazón, os anacos de datos e o mapa. A promesa de funcionar
sen conexión está ben construída; falta executala nun navegador real.

Tamén aparece un aviso de MapLibre, `Image "wood-pattern" could not be loaded`. É do
estilo de OpenFreeMap, non noso, e é un aviso: as zonas de arboredo debúxanse sen a súa
trama. Anotado para non volver investigalo.

**Estado: dúas roldas limpas seguidas (2 e 3). Paso de navegadores pechado.**

---

## Auditoría de sobreenxeñaría — verificación dun informe externo

Chegou un informe de auditoría de todo o repositorio propoñendo cortar ~4.100 liñas.
Comprobouse afirmación por afirmación antes de tocar nada. **Dúas eran falsas e unha
terceira estaba mal enmarcada**, e as tres eran das grandes.

### Falso: «tres ferramentas que ningún script executa»

`tools/checkFares.ts` e `tools/checkOsmGeometry.ts` están **no traballo semanal**
(`.github/workflows/check-source.yml`, liñas 61 e 67), que é exactamente o mecanismo de
automantemento construído nesta sesión. Borralas quitaría en silencio a vixilancia das
tarifas e da xeometría do mapa. `compareOperatorTimes.ts` é a ferramenta de medida
documentada nas notas.

Como se produciu o erro: mirouse `package.json` e non os fluxos de traballo.

### Falso: «`hasScreen`, false nas 417 paradas»

É **`true` en 271 das 417**. É un dato levantado, non un campo morto. Borralo destruiría
información real.

### Mal enmarcado: «once endpoints de Express que a app nunca chama»

Certo que o navegador só chama dous (`/api/alerts` e `/api/paradas/:code/agora`). Pero o
`README.md` documenta **a táboa enteira de endpoints** como oferta pública, así que non son
superficie accidental: son unha función. O propio informe pedía «dígase en DATA.md, porque
non o di ningures» — dío o README. Non se tocan; `rateLimit.ts` queda con eles.

### Aplicado, tras comprobar unha por unha

- `resolve.alias '@'` en vite.config.ts: ningún ficheiro importa `@/`.
- A configuración `DISABLE_HMR`: só aparece nese ficheiro.
- `MAX_QUERY_LENGTH` declarado dúas veces; o servidor impórtao agora de `searchUtils`,
  porque dous números que teñen que coincidir son un número.
- `resetRateLimits`, cun comentario que dicía «exportada para as probas» e ningunha proba
  que a importase. Borrouse a función en vez de manter unha afirmación falsa.
- `export type { Tab }` en BottomNav: todos importan `Tab` de `navSections`.
- `STALE_AFTER_MS` deixa de exportarse; lese só no seu propio ficheiro.
- `@tailwindcss/vite`, `@vitejs/plugin-react` e `@types/leaflet` pasan a devDependencies.

**E aquí case rompemos o despregamento.** Mover tres paquetes entre seccións deixa o
`pnpm-lock.yaml` desincronizado, e CI instala con `--frozen-lockfile`. Colleuse ao executar
`pnpm install --frozen-lockfile` a posta, que fallou con `ERR_PNPM_OUTDATED_LOCKFILE`.
Rexenerouse o bloqueo e volveuse comprobar que xa pasa.

> **Regra:** calquera cambio en `package.json` remata en `pnpm install --frozen-lockfile`
> para ver o que verá CI. Un cambio cosmético de dúas liñas pode tirar o despregamento.

### Deixado como decisión de Brais, non como corte

- **Os 13 `.dc.html`** de deseño (2.648 liñas). Son o traballo de deseño orixinal, non
  código morto. Bórranse se el quere.
- **Reescribir o mapa** de Leaflet a MapLibre puro. É unha simplificación real —seis
  ficheiros, ~600 liñas, tres dependencias menos— pero é obra, non limpeza.
- **Os 1,4 MB de intermedios** baixo `src/data/` non chegan ao paquete: ningún ficheiro da
  aplicación os importa, confirmado. Movelos é orde, non peso.
- **`line.days` / `line.frequency`** e `hasScreen` son datos xerados. Quitar campos
  esixiría tocar `buildDataset.ts` e rexerar; risco medio, valor baixo.

---

## Auditoría de seguridade — un achado, verificado a man

Informe externo cun só achado confirmado (`F1`, LOW), e desta vez **era certo**. Aínda así
comprobouse antes de tocar, e a comprobación cambiou o arranxo.

### O achado

`src/security/rateLimit.ts` preguntaba `req.path.startsWith('/plan')`. Express enruta sen
distinguir maiúsculas, así que `/api/PLAN` chegaba ao planificador enteiro mentres o
limitador vía `/PLAN`, daba `false`, e nunca consultaba `MAX_PLANS_PER_WINDOW`.

**Medido contra o servidor de produción local**, non deducido:

| petición | 429 recibidos |
|---|---|
| 35 × `/api/plan` | **6** — corta na 30, como debe |
| 35 × `/api/PLAN` | **0** — pasan todas |

Catro veces a CPU que un cliente anónimo pode consumir no único endpoint medido en ~24 ms
por chamada.

### O que a comprobación engadiu ao informe

- **A codificación por cento non abre outra porta**: `/api/%70lan` dá 404. Só maiúsculas.
  Iso importa, porque significa que un `toLowerCase()` pecharía o burato de verdade.
- **O segundo sitio que sinalaba o informe non era un burato.** Dicía que
  `req.path.startsWith('/api/')` en `server.ts:46` tiña a mesma forma e deixaría sen
  `no-store` a `/API/alerts`. Comprobado: `/API/alerts` devolve **o armazón da aplicación**
  (`text/html`, `<!doctype html>`), sen cabeceira `RateLimit-Limit`, porque o montaxe
  `/api` tampouco casa. Non é unha resposta de API, así que `public, max-age=0` é correcto
  para ela.

### O arranxo, e por que non foi o que propoñía o informe

O informe propoñía montar o limitador estrito na ruta, ou `req.path.toLowerCase()`. As dúas
funcionan, pero as dúas arranxan **unha comparación**. O fallo era que dúas capas decidían
«¿isto é /plan?» con regras distintas, e hai máis dunha comparación con esa forma.

`app.set('case sensitive routing', true)` — unha liña, na orixe. Agora hai unha soa regra.
Un camiño de URL é sensible ás maiúsculas na RFC 3986 de todos os xeitos, e todos os
endpoints documentados están en minúsculas.

Verificado despois: `/api/plan` 200, `/api/PLAN` 404, `/api/Plan` 404, e os dous endpoints
que a aplicación usa de verdade seguen a responder 200.

O check garda **o axuste**, non a comparación, porque quitalo trae de volta o desacordo en
todos os sitios á vez. Comprobado que morde.

---

## Probas de esforzo — os dous candidatos que a auditoría de seguridade non puido adxudicar

Quedaban sen resolver o *buffering* sen tope e a regex cuadrática en `alertSyncService.ts`
e `operatorTimes.ts`. **Os dous eran reais**, e resólvense medindo.

### O que se midiu

`tools/stressParsers.ts` alimenta os dous parsers con marcado hostil. Catro veces a entrada
daba dezaseis veces o tempo, que é a sinatura do cuadrático:

| entrada malformada | 64 KB | 256 KB | 1 MB |
|---|---:|---:|---:|
| `parseOperatorTimes`, bloques sen pechar | 6 ms | 107 ms | **1.673 ms** |
| `extractConcelloNotices`, `<item>` sen pechar | 55 ms | 808 ms | **13.196 ms** |

Trece segundos de Node parado cun megabyte. Catro megabytes serían uns tres minutos e
medio. **Ninguén ten que atacar**: unha páxina truncada, unha interstitial de CDN ou unha
páxina de erro son exactamente «etiquetas que non pechan».

As páxinas reais miden 35–73 KB, medidas: 35.417 a do operador, 72.568 a maior do Concello.

### O arranxo

- **`readCapped`**, tope de 512 KB — sete veces a maior páxina real. Un corpo de terceiros
  non debería lerse sen teito de todos os xeitos.
- **O percorrido de `<item>` faise lineal**, con `indexOf` en vez dunha regex perezosa.
  **13.196 ms → 1 ms** cun megabyte.
- **O do operador queda como está, co teito facendo de límite**, e dise no código cun
  comentario `ponytail:` que nomea o teito (~400 ms no peor caso, unha vez por parada cada
  20 s, e só nun servidor propio) e o camiño de mellora.

### O erro que atopou a miña propia comprobación

**O tope non topaba.** `readCapped` sumaba o trozo enteiro e despois miraba o total, así que
limitaba *cantos trozos* se len e non canto texto se garda: un corpo que chega nun só trozo
pasaba enteiro. `tools/checkParsersUnchanged.ts` colleuno — 1,5 MB devoltos contra un teito
de 512 KB. Coas respostas reais, que chegan en anacos pequenos, **parecía que funcionaba**.
Agora recórtase o trozo, e o check di 524.288 de 1.572.864.

E ese mesmo check comparaba **0 contra 0** nas dúas páxinas, porque ás 22:50 non había nin
saídas nin novas recentes. Iso non é un aprobado, é unha comparación baleira; agora dío en
voz alta en vez de imprimir un visto.

### O oco que apareceu de camiño

**`parseOperatorTimes` non tiña ningunha proba**, e é todo o bloque do QR. Capturouse
marcado real do HULA ás 22:50 e escribiuse unha. Tres cousas que unha maqueta inventada non
ensinaría: hai un `<svg>` entre o div con clase e o seu `<p>`, a liña chega como `L4.2` cun
prefixo que hai que quitar, e o tempo chega como `20 min` e non como un número. Comprobado
que morde: quitando o recorte do `L`, falla con `the L prefix survived: "L4.2"`.

---

## Probas de esforzo — os camiños de cómputo, e tres escaneos da mesma forma

`tools/stressEngine.ts` mide o que a app calcula, sempre o peor caso e non a media: unha
media agocha o par de paradas que tarda dez veces máis, e é o par que alguén vai escribir.

### Ben, e agora medido

- **O taboleiro de paradas**: peor 3,9 ms nas 417 paradas, mediana ~0. E **sen deriva**:
  500 pasadas seguidas na parada de máis liñas dan 0,04 ms nas dez primeiras e 0,03 nas dez
  últimas. Recalcular cada 15 s é de balde.
- **A busca**: 200 paradas contra unha consulta de 120 caracteres dunha soa letra, 20 ms.
  Cos metacaracteres de regex, 0,6 ms — non hai ReDoS aí.
- **`findStop`**: por debaixo do milisegundo mesmo con lixo.

### O que corrixiu unha afirmación

**O planificador**: mediana 25,1 ms, **p95 67 ms, peor 82,3 ms** en 72 pares, incluídos os
catro extremos da rede uns contra outros. O comentario de `rateLimit.ts` dicía «uns 24 ms»
e dimensionaba o límite sobre iso: era **a mediana confundida co custo**. O tope non se
move —30 × 82 ms son 2,5 s de CPU por minuto e por enderezo, que é o que se pretendía— pero
o número no que se apoia é agora o medido.

### A terceira lectura sen tope, que se me escapara

O grep anterior buscaba `res.text()`. `alertSyncService.ts:342` chámalle `response`, así que
**a portada de buslugo.com seguía léndose enteira**. Agora busquei `.text()` en todo `src/`
e `server.ts`: eran tres, e as tres pasan por `readCapped`.

> **Regra:** buscar a chamada, non o nome da variable. «Arranxar todos os chamadores»
> falla se o grep só atopa un deles.

### Tres escaneos, e o teito só facía habitable un

Ao chegar alí apareceron dúas regexes máis coa mesma forma perezosa. Medidas no teito de
512 KB que permite `readCapped`, sobre marcado cuxas etiquetas nunca pechan:

| escaneo | patrón perezoso | percorrido con `indexOf` |
|---|---:|---:|
| `<article>` (portada do operador) | **3.946 ms** | **0 ms** |
| `<li>` (barra de avisos) | **4.012 ms** | **0 ms** |
| `<item>` (RSS do Concello) | 13.196 ms | 1 ms |

Unha portada truncada executa dúas delas. Os tres usan agora o mesmo percorrido; o test de
marcado real da barra do operador segue pasando, que é o que proba que len igual.

### E un que case me meto eu

Púxenlle `AbortSignal.timeout(30_000)` ao `fetch` do cliente, porque non tiña ningún prazo
e o spinner podía xirar minutos cun upstream lento. **`AbortSignal.timeout` é Safari 16**, e
este proxecto leva un respaldo sRGB precisamente para seguir funcionando en Safari 15.4.
Alí lanzaría, o `catch` de abaixo tragaríao, e amosaría o snapshot para sempre en silencio.
Chamada opcional (`?.`), que en Safari 15 dá `undefined` — que é exactamente o que había
antes desa liña.

> **Regra:** antes de engadir unha API do navegador, mirar o suelo que este rexistro xa
> ten escrito. O paso de navegadores non serve de nada se despois se rompe a man.

---

## Probas de esforzo — roldas 2, 3 e 4

### Rolda 2: a superficie HTTP (un achado)

`tools/stressHttp.ts` contra a build de produción. Ningún 500, ningunha traza de pila,
ningún colgue: código de parada baleiro, de 2.000 caracteres, `..%2F..%2Fetc%2Fpasswd`, un
byte nulo, `<script>`, unicode e unha inxección de cabeceira por salto de liña — **todos
404**. Buscas por riba do tope e con metacaracteres, 200 en 15 ms. **50 peticións
simultáneas** ao endpoint do QR: 66 ms en total, as 50 con 200, porque a caché de 20 s fai
o seu traballo. 40 plans nunha ventá: **14 rexeitados con 429**.

O achado veu do número raro: a primeira chamada ao QR tardou **4.476 ms** (o operador ese
día). `useOperatorTimes` non poñía prazo á súa propia espera, **e o `setInterval` de 30 s
dispara volva ou non a anterior**, así que unha conexión atascada apila peticións. Un prazo
de 12 s arranxa as dúas cousas: por riba do tope de 8 s do servidor e por baixo do
intervalo, así que unha petición non pode sobrevivir ao seu propio ciclo.

E chamado con `?.`, pola regra que este rexistro acaba de aprender.

### Rolda 3: os datos, todo o día, toda a rede (limpa)

`tools/stressInvariants.ts`: cada parada, cada dez minutos, en día laborable, sábado e
domingo. **180.144 taboleiros, 401.109 saídas.** Ningunha negativa, ningunha máis alá do
horizonte, ningunha vencida fóra da ventá de cinco minutos, ningunha liña que non exista,
ningunha orde rota, ningunha parada que liste unha liña que non para nela.

**Todo se sostivo.**

### Rolda 4: os traxectos do planificador (limpa, tras corrixirme dúas veces)

`tools/stressPlanner.ts`: 630 pares a sete horas distintas, **27.348 traxectos**.

Sinalou dous problemas, e **os dous eran meus**:

1. «Dille a alguén que saia despois de que pase o bus.» Non: `departureTime` é cando *podes*
   saír (agora), e `leaveAt` cando *tes* que saír. Saír ás 07:31, andar cinco minutos, coller
   o de 07:36, consultado ás 07:20. Correcto, e o comentario do tipo xa o dicía.
2. «O mellor traxecto tarda máis de tres horas.» Desde Nadela ás 07:20, si: a liña 11 non
   pasa ata as **10:00**. Son 160 minutos de espera na casa, ben informados. É a resposta
   do cadro horario, non un erro do planificador.

Ambas as dúas eran xuízos sobre a calidade do servizo disfrazados de invariantes. Quitáronse
en vez de axustarlles o limiar.

> **Regra:** un check que precisa unha excepción nova cada vez que corre non está
> comprobando nada. Ou é unha invariante, ou é unha opinión.

O que queda —que a duración declarada coincida co reloxo, que ningún tramo suba a unha liña
que non para onde sobe, que a tarifa conte os mesmos tramos que o plan— **aguantou nos
27.348**.

**Estado: dúas roldas limpas seguidas (3 e 4). Bloque de esforzo pechado.**

---

## Auditoría propia — rolda 1, lente de seguridade

Un achado real, atopado lendo o código en vez de agardar por un informe.

### Nomes raspados chegando sen escapar a un tooltip de Leaflet

`src/components/Map/escapeHtml.ts` existe precisamente para isto, e o seu propio comentario
di que os nomes de parada veñen dun raspado. Estaba usado en `RouteLayer`, `StopLayer` e
`VehicleLayer`. **`RouteMap` e `NearbyMiniMap` nin sequera o importaban**, e entre os dous
levaban oito tooltips con nomes de parada, nomes de lugar e números de liña directos a
`innerHTML`.

**Comprobado no navegador, non supoñido.** Atar `'Rda. <b id="x">Muralla</b>'` a un tooltip
deixa un elemento `<b>` real no DOM: `renderedAsMarkup: true`. Leaflet colle HTML, non texto.

Non é explotable hoxe —os nomes veñen do operador, non dun descoñecido— pero ese é
exactamente o argumento que o escapador xa rexeitaba por escrito: entrada raspada non se
presume inerte. Tres ficheiros tratábana ben e dous non, que é a forma que ten un control de
seguridade de esvarar.

Escapados os oito. Comprobado despois que o lector segue vendo o nome limpo e non entidades:
`Rda. Muralla 56 (Sindicatos)`, `anyEntities: false`.

### O guardián

Unha comprobación que percorre `src/components/Map/` e falla se calquera chamada a
`bindTooltip`, `bindPopup` ou `innerHTML =` menciona `.name`, `.zone`, `.number`, `.color`
ou `.address` sen `escapeHtml` preto. Comprobado que morde, e que nomea ficheiro e liña:

```
scraped text reaches a Leaflet tooltip without escapeHtml:
    NearbyMiniMap.tsx:118  }).bindTooltip(`${stop.name} · ~${...} m`, {
```

### Mirado e limpo

- **Sen `dangerouslySetInnerHTML`** en ningures.
- **Os badges de liña de `StopLayer`** constrúense peza a peza con `escapeHtml`, así que
  interpolar `${linesBadges}` xa é seguro. Non é descoido, é construción.
- Os `${...}` que quedan sen escapar son **números** calculados aquí, que non son marcado.

---

## Auditoría propia — rolda 1, lente de optimización

### O servidor propio enviaba catro veces o que debía

`express.static` manda os bytes tal e como están no disco. Medido contra a build de
produción: **556.913 bytes** do anaco de entrada, sen `Content-Encoding`.

GitHub Pages comprime só, así que o sitio publicado nunca tivo isto. `npm start` é a
maneira documentada de aloxalo un mesmo, e si o tiña.

| | cru | gzip | brotli |
|---|---:|---:|---:|
| anaco de entrada | 544 KB | 139 KB | **116 KB** |
| CSS de entrada | 43 KB | 9 KB | 7 KB |
| **primeira carga** | **587 KB** | ~148 KB | **~124 KB** |

**Comprimido na build, non por petición.** Un plugin de Vite —seguindo os catro que xa hai
nese ficheiro— escribe un `.br` e un `.gz` ao lado de cada activo, e un middleware de
catorce liñas entrega o que o cliente diga que sabe ler. Sen dependencia nova, sen CPU por
petición, e a build pode permitirse o brotli lento de calidade 11.

Comprobadas as tres rutas contra o servidor real: brotli **118.653 bytes**, gzip **142.833**,
`identity` **557.096**, con `Vary: Accept-Encoding` e o `Content-Type` correcto. E medido
polo propio navegador ao cargar a app: `transfer 116 KB, decoded 544 KB`.

O `Vary` non é adorno: sen el unha caché compartida podería darlle un corpo brotli a alguén
que non o pediu. O check faino fallar se desaparece, comprobado.

### Mirado e descartado

- **O anaco `palette` de 1.072 KB** é o maior do build, pero **non está na carga inicial**:
  `index.html` só trae `theme-init.js`, un CSS e o anaco de entrada. MapLibre, Leaflet, a
  xeometría das rutas e o worker cárganse cando fan falta. O nome enganaba, o peso non.

---

## Auditoría propia — rolda 2, lente de mantibilidade

### Deriva na documentación, e unha delas era de licenza

`DATA.md` tiña unha sección enteira, «Map tiles — CARTO», dicindo que as teselas as serve
CARTO. Non é certo dende que o basemap pasou a OpenFreeMap. A CSP permite
`tiles.openfreemap.org` e `tile.openstreetmap.org`, e o mapa acredita OpenFreeMap,
OpenMapTiles e OpenStreetMap na súa propia esquina.

Tres sitios corrixidos:

- **`DATA.md`**, a sección enteira, incluíndo o respaldo ráster e a política de uso de
  teselas de OSM que xa se cumpría pero non estaba escrita.
- **`README.md:635`**, que describía a propia CSP do proxecto nomeando CARTO.
- **`README.md:1046`**, a liña de atribución: *«Cartografía © OpenStreetMap contributors ©
  CARTO.»* **Iso non é cosmética.** A atribución é un termo de licenza, e acreditaba a unha
  empresa cuxas teselas non se usan mentres non acreditaba as que si.

E a árbore de ficheiros do README seguía listando `FaresAndAlertsView.tsx`, que se partiu
en dous hai unhas horas.

### Seis Haversine, agora un

A mesma fórmula co mesmo radio estaba escrita seis veces: no motor e en cinco ferramentas.
Nada derivara —eran carácter por carácter a mesma aritmética— pero é o mesmo argumento que
xa se aplicou ao escapador de HTML e ao costurado de OSM.

**Dúas funcións e non unha, porque as copias si diferían nunha cousa**: o motor e tres
ferramentas redondean ao metro; o costurado de OSM e o reconciliador acumulan metros sen
redondear ao longo dunha polilínea, e redondear cada segmento non daría a mesma lonxitude.
O redondeo queda no sitio que o quería.

**Verificado como se verifica isto aquí**: `pnpm data:build` reconstrúe o conxunto de datos
sen rede e sae **byte a byte idéntico**, e `checkOsmGeometry.ts` segue dicindo que as 48
rutas teñen a mesma forma e os mesmos metros restrinxidos.

### Mirado e descartado

- **Ningún `catch` baleiro** en todo o proxecto: todos din algo ou fan algo.
- **Ningún TODO, FIXME nin HACK.**
- **«0,93 km de 158» no README.** A miña primeira suma deu 2,78 km e pensei que derivara.
  Estaba eu mal: o README conta **cada rúa compartida unha vez** (230 + 385 para o casco,
  que comparten as catro liñas, máis 317 da 11) = **932 m**. O documento tiña razón.
- **Ficheiros grandes** (`transitEngine.ts`, 1.543 liñas). Partilo é unha refactorización,
  non un achado; e non hai duplicación dentro del.

---

## Revisión de documentación e sistema de ficheiros

### O que chega a git está limpo

**129 ficheiros, 3,5 MB.** Revisado un por un por tamaño, polos dous extremos. Nada de
restos: nin `.bak`, nin copias, nin saídas de build, nin ficheiros baleiros.

O `.gitignore` xa estaba ben pensado e comentado, e explica cada exclusión —incluído por
que `.antigravity/` e `.impeccable/` **non** son dotfiles inofensivos. As tres carpetas
`CLAUDE-SECURITY-*` non aparecen porque **se auto-ignoran** cun `.gitignore` propio dentro,
que é como as deixa a ferramenta; 76 KB no disco, cero no repositorio. `bun.lock` está
ignorado a propósito, cun comentario que di que só pnpm manda porque é o que CI usa con
`--frozen-lockfile`.

O único que había eran os meus `.snapshot` de traballo, ignorados pero no disco. Borrados.

### `src/` era o que se envía, mesturado co andamio

Catro dos dez ficheiros de `src/data` eran entradas da build que a aplicación non importa
nunca: `official-raw.json`, `osm-routes.json`, `routes.json` e `stop-amenities.json`,
**1,4 MB**. Non custaban nada en execución, por iso pasaran desapercibidos, pero custaban
dúas cousas: quen abría `src/data/` non podía saber cales viaxan ao navegador, e un
`import` distraído metería medio megabyte no paquete sen que nada avisase.

Móvense a `data/`. **Verificado como se verifica aquí**: `pnpm data:build` reconstrúe e o
que se envía sae byte a byte idéntico. E un check falla se algún volve a `src/data` ou se
algo baixo `src/` o nomea; comprobado que morde.

### Documentación posta ao día

- **`DATA.md`** e **`README.md`** deixan de acreditar a CARTO (ver rolda 2).
- **`README.md`**: «392 das 417 paradas sen hora publicada» → **390**. A aplicación amosa a
  cifra en vivo, así que só a prosa derivara.
- **`README.md`**: «Tarifas e avisos» describía unha pantalla; son dúas dende hoxe, con
  fontes distintas e as novas do Concello á parte.
- **`README.md`**: engadido o que cambiou hoxe e que un lector debe saber — que un bus
  atrasado segue cinco minutos no taboleiro, e que quen escanea o QR ve tamén o que di o
  operador.
- **`README.md`**: a táboa de tamaño de descarga levaba cifras vellas; agora leva as
  medidas de hoxe, coas tres columnas (sen comprimir, gzip, brotli).
- **`SECURITY.md`**: dicía que o servidor «proxies one scrape of buslugo.com». Son tres
  fontes, e agora di cales e que todas están capadas a 512 KB e con tempo límite.
- **`design/PLAN-acento-vermello.md`** xa estaba marcado como feito. Correcto.

---

## Preparación para produción — rolda 1: a build estática, que é a que se publica

Servida `dist/` sen o servidor Express, que é exactamente o que fai GitHub Pages.

### O que funciona sen servidor

- **A ligazón do QR** (`?parada=uilP`) abre a ficha da parada. Confirmado: encabezado
  «Rda. Muralla 56 (Sindicatos)» e o mini mapa do poste.
- **O bloque do operador non aparece**, que é o correcto: sen servidor non hai a quen
  preguntar, e a app non inventa.
- **Os avisos caen ao snapshot** commiteado e amósanse.

### O achado

O snapshot amosábase **sen dicir que o era**. A tarxeta lía «AVISO DEL OPERADOR ·
28/8/2026 · Retenciones en zona Estación Tren», e a única data era a do propio aviso, que
un lector toma por «segue pasando».

A redacción honesta xa existía —`staleStatusTitle`, `staleStatusDesc`, `lastCheck`— pero só
na tarxeta de «todo normal», que se debuxa cando **non** hai avisos. A rama que máis
precisaba dicir de onde vén a súa información era a que non o dicía.

Agora, cando os datos veñen da copia, dise enriba da lista: cando se tomou, que esta
versión non ten servidor a quen preguntar, e que se comprobe en buslugo.com. Verificado na
build estática.

### E o encuadre que corrixín a min mesmo

Dixen que iso era «o estado normal do sitio publicado». **Non o é.** `deploy-pages.yml`
corre **cada hora** (`cron: '17 * * * *'`) e refresca os avisos antes de construír, así que
en produción o snapshot ten como moito unha hora. O meu local estaba a seis días porque
aquí non corre ese traballo.

O rótulo segue facendo falta, pero por dúas razóns máis pequenas e reais: o paso de
refresco é **best-effort** —se buslugo.com non responde, publica o snapshot vello sen
queixarse— e alguén cun service worker que aínda non colleu a build nova está a ler unha
máis antiga.

---

## Preparación para produción — rolda 2: o enderezo real de Pages

A rolda 1 serviu `dist/` na raíz. O sitio publicado non vive na raíz: vive en
`https://<usuario>.github.io/<repo>/`, e o workflow pon `BASE_PATH` co nome do repositorio.
Así que esta rolda construíu con `BASE_PATH=/urbanos-lugo/` e serviu o resultado cun
servidor que imita a Pages de verdade —non `vite preview`, que reescribe calquera ruta
descoñecida a `index.html` e responde **200**. Pages busca un ficheiro no disco e, cando
non o hai, envía `404.html` **con estado 404**. Esa diferenza é a rolda enteira.

### Tres achados

**1. A pantalla de Tarifas anunciábase como a de Avisos.** O `<h1>` do shell era unha
cadea de ternarios que remataba nun caso por defecto. Cando a pantalla única se partiu en
dúas, a nova herdou o título da vella, e quen navega por encabezados —lector de pantalla,
ou o índice do navegador— oía o nome equivocado. Non era específico de Pages: pasaba en
todas as builds desde a división.

Arranxado como `Record<Tab, string>`: falta unha pestana e agora é un erro de compilación,
non un texto equivocado en pantalla.

**2. Todas as rutas do `sitemap.xml` respondían 404.** Medido: das sete que anuncia, só a
raíz devolvía 200. As outras seis debuxaban a app —o `404.html` é unha copia da páxina— pero
co estado 404. Un buscador descarta un enderezo listado que responde 404, e as aplicacións
de mensaxería saltan a vista previa dun 404, tirando as etiquetas `og:` que se engadiran
**porque** os enlaces de «copiar ligazón» se comparten.

Arranxado escribindo unha páxina en cada enderezo (`paradas/index.html`, …). As seis
responden 200 e `404.html` queda para o resto. Verificado antes e despois. E os slugs
pasaron a vivir nunha soa lista, `src/routes.ts`, porque estaban escritos en tres sitios: o
enrutador, o sitemap e —desde hoxe— a build.

**3. Sen servidor, a app pedía os minutos do operador cada 30 segundos para sempre.** En
Pages `/api/…` non existe e nunca vai existir: cada intento traía o `404.html` enteiro.
Pequeno en bytes (1,9 KB comprimido) pero é unha radio que esperta cada medio minuto no
móbil de alguén que está de pé nunha parada. Un 404 aquí é permanente —ou non hai servidor,
ou a parada non ten código do operador—, mentres que un 502 si é transitorio. Agora o 404
para o temporizador e o 502 conserva o seu reintento. Medido: 3 peticións en 80 segundos
antes, 1 despois.

### O que segue ben

- A ligazón do QR resolve, tanto `/paradas?parada=uilP` como `/paradas/?parada=uilP` —que é
  a forma á que Pages redirixe cando hai un directorio.
- Todos os activos resolven co prefixo do repositorio; o `manifest`, o `favicon` e o
  `theme-init.js` tamén.
- **Xeolocalización**: desde a Praza Maior dá Sindicatos ~209 m, Bolaño Ribadeneira ~277 m,
  Arenal ~387 m. Plausible. E se se denega o permiso di «No se pudo acceder a la ubicación.
  Revisa los permisos del navegador» en lugar de inventar unha lista desde o centro de Lugo.
- Os avisos caen ao snapshot e o rótulo da rolda 1 dise.

### Falso positivo apuntado

**O service worker non se pode probar neste navegador.** `navigator.serviceWorker.register`
falla con «An unknown error occurred when fetching the script» —e o script nin sequera se
pide ao servidor, comprobado no log—. Antes de escribilo como un fallo do proxecto probei o
caso mínimo: unha páxina de tres liñas cun service worker dunha liña, sen CSP, sen framework,
servida do mesmo xeito. **Falla igual.** Non hai violación de CSP (escoitei
`securitypolicyviolation`: cero eventos). É o panel, non a app.

O que si se pode afirmar é o que se comprobou estaticamente: `sw.js` lista 20 entradas de
precaché con URLs relativas ao seu propio directorio —que é o correcto baixo un prefixo— e
`navigateFallback` apunta a `/urbanos-lugo/index.html`. **O comportamento offline real
segue sen probarse nun navegador de verdade**, e non se vai dicir que si ata que se probe.

Regra: cando algo do navegador falla, reproducilo co caso mínimo antes de chamarlle fallo.
É a terceira vez que o panel produce un falso positivo (as dúas anteriores, `:focus` sen
foco real no documento).

---

## Rolda 3: os diagramas do README, contra o código

Non se trataba de mirar se se ven ben. Un diagrama é unha afirmación, e afirma cousas que
se poden comprobar: catro non se sostiñan.

- **«Mapa MapLibre GL»** na arquitectura. A app é **Leaflet**: seis ficheiros importan `L`
  e a atribución que sae en pantalla dio. MapLibre é unha capa vectorial dentro dese mapa,
  vía `@maplibre/maplibre-gl-leaflet`. Corrixido a «Mapa Leaflet / capa vectorial de
  MapLibre GL», que é o que atopa quen abre `src/components/Map/`.
- **Tres cifras vellas** no diagrama das etiquetas: 822 paradas no modelo de estrada, erro
  mediano 0,5 min, 8,5 min no peor. Corrín a ferramenta: **797, 0,1 e 8,3**, sobre 21
  tramos contrastables. O README levaba as mesmas tres. Corrixidos os dous, e engadido o
  38% dentro de dous minutos, que é o dato que de verdade xustifica o til.
- **«45 dos 48 sentidos»** na frecha que produce `route-geometry.json`. O ficheiro ten
  **48**: 45 de OSM e 3 debuxados como iría un coche, cousa que o propio README di dúas
  seccións antes.
- E de camiño: a liña de tecnoloxías dicía **TypeScript 5.8, Vite 6, Express 4** contra
  7.0, 8.2 e 5.2 instalados, e a sección do mapa da rede seguía acreditando **CartoDB**,
  que este proxecto deixou de usar en agosto.

**O que non se tocou.** OSRM está na fila de `importOsmRoutes.ts`, á que non alimenta, e
iso lese mal. Movelo á fila que lle toca **recházao o propio validador de composición** —o
fluxo colapsa a un segmento de 7 px e a etiqueta cae enriba de dous nodos—, así que a fila
era unha restrición e non un descoido. Revisable desde o lado do diagrama, non forzándoo.

`pnpm diagrams` agora di que falta o renderizador cando non está: vive baixo `.claude/`,
que non se segue, e antes daba un ENOENT cunha ruta e ningunha explicación.

---

## Rolda 4: o que corre en CI, e o que non

**O traballo semanal estaba a ler 1186 páxinas cada luns.** A cabeceira de `reconcile.ts`
di que `--fresh` son as 24 páxinas de liña, trinta segundos, e que as 1186 de parada son
outro flag «porque non paga a pena vinte minutos». Era certo só onde `.cache/` xa existía:
coa caché baleira, `page()` cae ao `fetch`, e en CI a caché **nunca** está porque `.cache/`
non se segue. Así que o luns pola mañá o traballo pasaba vinte e dous minutos pedíndolle
páxinas ao servidor do operador, xusto o que o proxecto di que non quere facer.

Medido antes e despois cunha simulación de CI —a caché apartada, o traballo tal cal—:
**44 segundos**, e todos os contrastes que importan seguen aí.

**E dúas comprobacións non corrían en CI sen dicilo.** A posición de cada poste contra a súa
propia páxina, e a comparación coa topografía de OpenStreetMap, dependen das dúas cachés.
En CI imprimían unha liña discreta dentro dun rexistro verde. Agora din `NOT CHECKED`, e o
comentario do workflow di cales corren alí e cales son locais.

**A Brea puña o run en vermello para sempre.** O poste está a 523 m do máis próximo
topografado en OSM, e o límite de aviso son 500. Iso non di nada da nosa coordenada: son as
do propio operador, e a pasada de arriba mídeas contra as súas propias páxinas cunha mediana
de 0 m. É unha ausencia en OSM, non un erro noso, e ningunha edición aquí a arranxa. Agora é
unha excepción con nome e data, para que un poste que **pase** a estar lonxe siga fallando.

**Un erro meu, atopado polo mesmo experimento.** Ao saltar a primeira pasada, a segunda
—postes que funden varios ids— quedou lendo unha caché baleira e dicía «0 poles merge 2+
ids» en lugar de «non comprobado». Cero non é o mesmo que non mirar. Corrixido antes de
commitear.

### E de paso, a resposta que interesaba

A reconciliación con datos de hoxe: **24/24 liñas envían o horario que imprime a páxina**,
417/417 postes levan un nome que o sitio imprime, e 417/417 levan exactamente as liñas cuxos
itinerarios pasan por alí. Non houbo cambio de horarios en setembro. A única diferenza é a
orde de tres paradas na 5.1/volta, que a ferramenta marca como informativa porque a nosa
orde é máis curta —8,2 km fronte a 19,0— e é o sitio onde os datos se arranxaron a man.
