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
