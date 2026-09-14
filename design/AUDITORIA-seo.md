# Auditoría SEO: por que ninguén atopa o sitio, e que facer

Auditoría do 14 de setembro de 2026 sobre <https://braisbrg.github.io/urbanos-lugo/>.
**Nada disto está feito**: é a lista de cousas para máis adiante, coa medida de cada unha
para que quen a retome saiba de onde parte e poida comprobar se cambiou.

Método: o HTML tal e como o serve Pages (`curl`), as cabeceiras, `robots.txt` e
`sitemap.xml`; o DOM renderizado no navegador cun viewport de 375×812; e tres buscadores
(Google, Bing e DuckDuckGo) preguntados por `site:braisbrg.github.io`. Sen ferramenta SEO
conectada (Ahrefs, Semrush): os volumes de busca son estimacións cualitativas, non cifras.
Todo o demais está medido.

---

## Resumo

**O sitio non está indexado.** `site:braisbrg.github.io` non devolve ningún enderezo en
ningún dos tres buscadores; o único que aparece é o repositorio de GitHub. Non é raro: o
repositorio ten once días (creado o 3 de setembro), a única ligazón que entra é o README
de GitHub —que leva `rel="nofollow"`— e ninguén enviou o sitemap a Search Console.

**As sete URL do sitemap son a mesma páxina.** Mesmo `<title>`, mesma descrición, e as
seis pestanas declaran `canonical` cara á raíz. Indexado ou non, o sitio só pode
posicionar **unha** páxina para «horarios», «tarifas», «liñas», «mapa» e «avisos» á vez.

**Non hai ningunha ligazón interna que un rastrexador poida seguir.** As pestanas son
`<button>` con `pushState`; o DOM renderizado ten unha soa `<a>` interna, o salto a
`#contido`. E o HTML chega baleiro (`<div id="root">`): a portada renderizada son uns 450
caracteres de texto.

O punto forte é técnico: 134 KB brotli de primeira carga, HTTPS con HSTS, CSP, PWA
instalable, JSON-LD honesto, cero imaxes sen `alt`, un só `<h1>` por vista, CLS 0. E os
datos son mellores ca os da competencia —417 paradas fronte ás 388 que anuncia Moovit—,
pero ningún deses datos é visible para un rastrexador.

Tres prioridades, por esta orde:

1. Verificar o sitio en Search Console e Bing Webmaster e enviar o sitemap.
2. Título, descrición e canónica propios por pestana: unha tarde, e multiplica por sete
   as páxinas indexables.
3. Páxinas estáticas por liña (e despois por parada): aí vive toda a demanda de cola
   longa que hoxe se reparten buslugo.com e Moovit.

---

## O que se mediu

| Feito | Valor | Como se mediu |
| :--- | :--- | :--- |
| URL do sitio nos buscadores | 0 (Google, Bing, DuckDuckGo) | `site:braisbrg.github.io`, 14-09-2026 |
| Idade do repositorio | 11 días | `gh repo view` → `createdAt: 2026-09-03` |
| URL no sitemap | 7 | `sitemap.xml` |
| Canónicas distintas | 1 (a raíz, nas sete) | `curl` de cada copia |
| Títulos distintos | 1 | ídem |
| Rutas do sitemap que responden 301 | 6 de 7 (`/paradas` → `/paradas/`) | `curl -w %{http_code}` |
| Ligazóns internas no DOM renderizado | 1 (`#contido`) | `document.querySelectorAll('a[href]')` |
| Texto renderizado na portada | ~450 caracteres | `document.body.innerText.length` |
| Texto renderizado en `/linhas/` | ~2.500 caracteres | ídem |
| `<title>` | 44 caracteres | `index.html` |
| `<meta name="description">` | 173 caracteres (córtase sobre os 155) | `index.html` |
| `og:image` | Ausente (pero `icon-512.png` xa se serve) | `index.html` |
| Imaxes sen `alt` | 0 | DOM |
| TTFB | 159–206 ms | `performance.getEntriesByType('navigation')` |
| FCP / LCP | 288 ms en `/linhas/`, 732 ms en paradas co mapa | `PerformanceObserver`, **CPU de escritorio e caché HTTP quente** |
| CLS | 0 | ídem |
| Tarefas longas na carga | 0 | ídem, mesma advertencia |
| JS a analizar antes de pintar nada | 552 KB (146 KB comprimido) | `resource` timing da build que hai en `main` |
| `Cache-Control` | `max-age=600` en todo | cabeceiras de Pages |
| HSTS | `max-age=31556952` | cabeceiras |

As medidas de velocidade son optimistas: un panel de escritorio con todo en caché. En
frío, nun móbil lento, o LCP é un `<p>` que pinta React despois de analizar o bundle,
porque non hai shell HTML previo.

---

## Palabras clave

Posición actual: **ningunha**, en todas. O mercado busca sobre todo en castelán, pero
*horarios*, *paradas*, *bus*, *Lugo*, *HULA* son idénticas en galego, así que un título en
galego cobre a maioría dos termos.

| Palabra clave | Dificultade | Oportunidade | Intención | Onde respondela |
| :--- | :--- | :--- | :--- | :--- |
| horarios bus lugo / horario autobús urbano lugo | Media | **Alta** | Informativa | Portada + páxinas por liña |
| líneas bus lugo / liñas bus urbano lugo | Media | **Alta** | Informativa | `/linhas/` con título propio |
| línea 1 bus lugo, línea 4 lugo, bus 12 lugo… (×24) | Baixa-media | **Alta** (en suma) | Informativa | Páxina estática por liña |
| bus hula lugo / qué bus va al hospital lugo | Baixa | **Alta** | Informativa | Páxinas de 1.2, 1.4, 4.1, 4.2, 5.x + FAQ |
| tarifas bus lugo / precio bus urbano lugo | Media | **Alta** | Informativa | `/tarifas/` con título propio |
| tarjeta ciudadana bus lugo / bono bus lugo | Media | Media | Informativa | `/tarifas/` |
| cuánto cuesta el bus en lugo | Baixa | **Alta** | Pregunta | Frase estática en `/tarifas/` |
| mapa líneas bus lugo / plano autobuses lugo | Baixa | Media | Informativa | `/mapa/` con título propio |
| avisos bus lugo / desvíos bus lugo hoy | Baixa | Media | Informativa, fresca | `/avisos/`: refréscase cada hora e ninguén máis o indexa ben |
| bus campus lugo usc / bus veterinaria lugo | Baixa | Media | Informativa | Páxinas de 1.3 e 6 |
| bus estación de autobuses lugo / estación tren | Baixa | Media | Informativa | Páxinas por liña + FAQ |
| bus o ceao / fontiñas / a tolda / gándaras | Baixa | Media | Informativa | Páxinas por liña (os nomes xa están en `lines.json`) |
| horario bus lugo domingo / festivos | Baixa | Media | Pregunta | Páxinas por liña: ventás de servizo |
| bus nocturno lugo / hasta qué hora hay bus | Baixa | Media | Pregunta | FAQ + última saída por liña |
| bus san froilán lugo horarios | Baixa, estacional (4–12 out.) | Media | Informativa | `/avisos/`, só se o operador publica os especiais |
| app bus lugo / aplicación autobuses lugo | Media | Media | Navegacional | Portada: instálase, funciona sen conexión |
| paradas bus lugo / parada bus [rúa] | Baixa | Media (en suma) | Informativa | Páxinas estáticas por parada (417) |
| cómo ir en bus lugo / planificador | Baixa | Baixa-media | Transaccional | `/ruta/` con título propio |
| urbanos de lugo | Media | Media | Navegacional, mesturada co operador | Portada con «non oficial» na descrición |
| bus lugo tiempo real | Media | **Non perseguir** | — | Ninguén publica posicións; o título nunca o prometerá |
| buslugo | — | **Non perseguir** | Marca allea | — |

---

## Problemas na páxina

| Páxina | Problema | Gravidade | Arranxo |
| :--- | :--- | :--- | :--- |
| Todas | Non indexado en Google, Bing nin DuckDuckGo | **Crítico** | Verificar en Search Console e Bing Webmaster (importa de GSC), enviar `sitemap.xml`, inspeccionar a raíz |
| `/paradas/` … `/tarifas/` | As seis copias declaran `canonical` cara á raíz | **Alto** | En `emitSpaFallback` (`vite.config.ts`), canónica propia por ruta |
| As sete | Mesmo `<title>` e `description`; `document.title` tampouco cambia por pestana (`App.tsx`) | **Alto** | Táboa de títulos e descricións por ruta en `seo.ts` (galego), inxectada en cada copia; na app, título por pestana nos tres dicionarios |
| Navegación | Pestanas como `<button>`: 0 ligazóns internas para o rastrexador | **Alto** | `<a href>` + `preventDefault` + `pushState` en `BottomNav` e `SideNav` |
| `/` | ~450 caracteres de texto renderizado; nada sen JS | **Alto** | Bloque estático no HTML: que é isto, «non oficial», as 24 liñas ligadas |
| Liñas e paradas | Sen URL propia (0 de 441 páxinas posibles) | **Crítico, estratéxico** | Prerender por liña e por parada, ver o plan |
| `sitemap.xml` | As seis rutas sen barra final → 301; `urlForTab` fai o mesmo ao compartir | Medio | Barra final en `sitemapXml` e en `urlForTab` |
| `/` | Descrición de 173 caracteres, córtase; non di «non oficial» | Medio | ≤155 con «non oficial», 24 liñas, 417 paradas, sen conexión |
| `/` | Título sen «bus» nin «autobús», o termo de máis volume | Medio | `Urbanos de Lugo \| Bus urbano: liñas, horarios e paradas` (55) |
| `/` | Sen `og:image` nin `twitter:image`; o comentario di que non hai arte aloxada, pero `icon-512.png` xa se serve | Medio | `og:image` = `icon-512.png` con largo e alto: as previsualizacións do «copiar ligazón» deixan de saír en branco |
| Todas | Sen `<noscript>` nin contido previo a JS | Baixo | Resólveo o bloque estático |
| Todas | `og:locale:alternate` para idiomas sen URL; sen `hreflang` | Baixo | Nada ata que existan URL por idioma (non se recomendan aínda) |

---

## Ocos de contido

| Tema | Por que importa | Formato | Prioridade | Esforzo |
| :--- | :--- | :--- | :--- | :--- |
| Páxina por liña (24) | É a consulta natural («línea 4 lugo»); téñena buslugo.com e Moovit, nós non. Os datos xa están en `lines.json` e `stops.json` | HTML estático en `dist/linhas/<nº>/index.html`: nome, cabeceiras, paradas de ida e volta ligadas, primeira e última saída e cadencia **só do cadro publicado**, e a app tomando o control ao cargar; o enrutador le o segundo segmento | **Alta** | Substancial, 1–2 días |
| Títulos e descricións por pestana | Converte 1 páxina indexable en 7 con intencións distintas | Táboa en `seo.ts` + inxección por copia + check en `test.ts` | **Alta** | Rápido, 1–2 h |
| Portada con texto | Hoxe o rastrexador ve 450 caracteres | Parágrafo «que é isto» + lista das 24 liñas con ligazón | **Alta** | Rápido |
| Tarifas indexables | «cuánto cuesta el bus en lugo» respóndena o Concello e El Progreso; nós xa temos os prezos que publica buslugo.com | Título propio + unha frase estática cos prezos (fonte: `transitData.ts`, nunca inferidos) | **Alta** | Rápido |
| Avisos con `lastmod` | Reconstrúese cada hora cos avisos do operador: frescura real que ninguén máis ofrece indexada | Título propio «hoxe» + `<lastmod>` desde a data da instantánea, só para esa URL | Media | Rápido |
| FAQ honesta | Preguntas reais: que liña vai ao HULA, hai bus de noite, como pagar coa Tarxeta Cidadá | Bloque estático (os resultados enriquecidos de FAQ xa non se dan a sitios coma este; vale polo texto, non polo marcado) | Media | Moderado |
| Páxina por parada (417) | Pouco volume cada unha; o valor é que a ligazón compartida (`?parada=`) pase a ser unha URL con título e previsualización | Igual ca as liñas; `?parada=` segue funcionando polos QR | Media | Substancial |
| San Froilán (4–12 de outubro) | Pico estacional | Só se os especiais chegan polos avisos do operador; non inventar horarios | Media, con prazo | Rápido se hai datos |

---

## Lista técnica

| Comprobación | Estado | Detalle |
| :--- | :--- | :--- |
| HTTPS / HSTS | Ben | `max-age=31556952`, `upgrade-insecure-requests` na CSP |
| `robots.txt` | Ben | `Allow: /` + sitemap |
| `sitemap.xml` | Aviso | 7 URL; 6 responden 301 pola barra final; sen `lastmod` |
| Canónica | **Mal** | Unha soa para sete URL |
| Indexación | **Mal** | 0 URL en tres buscadores |
| Ligazóns internas | **Mal** | 1 `<a>` interna no DOM renderizado |
| Ligazóns rotas | Ben | As externas son atribución (Leaflet, OpenFreeMap, OSM) e a incidencia de GitHub |
| Datos estruturados | Ben | `WebApplication` con `disambiguatingDescription` «non oficial»; ben escollido |
| Velocidade | Ben | Ver a táboa de medidas e a súa advertencia |
| Core Web Vitals | Aviso | CLS 0; o LCP é un `<p>` que pinta React: sen shell HTML, nun móbil lento espera polo bundle |
| Móbil | Ben | Viewport, obxectivos de 44 px, tipografía ≥ 12 px (auditoría de accesibilidade da semana anterior) |
| Fontes | Ben | Self-hosted woff2, `font-display: swap`, unha cara na primeira carga (34 KB) |
| Imaxes | Ben | 0 sen `alt` |
| Encabezados | Ben | Un `<h1>` por vista (`sr-only`), H2/H3 coherentes |
| Caché | Aviso | `max-age=600` en todo (límite de Pages); o service worker compénsao nas visitas repetidas |
| Contido duplicado | Aviso | 6 copias idénticas de `index.html`: inofensivo mentres a canónica apunte á raíz, e desaparece ao darlles título e canónica propios |
| Dominio | Aviso | `github.io` está na Public Suffix List: `braisbrg.github.io` é un sitio á parte, non herda autoridade de GitHub. Un dominio propio axudaría á marca e ás ligazóns; a build xa o soporta (`SITE_URL`) |

---

## Competencia

| Dimensión | Este sitio | buslugo.com | Moovit | Gaña |
| :--- | :--- | :--- | :--- | :--- |
| Páxinas indexables | 1 (7 URL, 1 canónica), non indexada | ~30: 24 liñas + buscador + tarifas | Centos: liña e parada, con FAQ | Moovit |
| Profundidade | 417 paradas, 24 liñas, ambos sentidos, estimacións etiquetadas: invisible ao rastrexador | Horarios e paradas por liña, ligadas entre si, GL/ES/EN, servido no servidor | 388 paradas (menos ca as reais), patrón masivo | buslugo.com, hoxe |
| Frescura | Avisos cada hora, non indexados | Sen data visible | «(Actualizado)» no título | Empate |
| Ligazóns entrantes | ~0 (README con nofollow) | Concello, prensa, Moovit | Autoridade de dominio enorme | Moovit |
| Técnica | 134 KB br, PWA, CSP, CLS 0 | Táboas densas no móbil | Pesado, chamadas á descarga | **Este sitio** |
| Presenza na SERP | Ningunha | Posicións 3–10 nos termos de cabeza | Cola longa por liña, sitelinks | Moovit |

Fóra da táboa: un artigo de El Progreso de 2023 é o primeiro resultado para «horarios
líneas tarifas», o Concello posiciona tarifas e Tarxeta Cidadá, e «app bus lugo» gáñana
as fichas de tenda de Lucus Bus (3pies). Moovit e El Progreso non se deixaron ler coa
ferramenta (bloquean a descarga): o que se di deles vén dos títulos da SERP.

---

## Plan

### Esta semana: rápido e de moito efecto

1. **Search Console e Bing Webmaster.** Só o pode facer o dono da conta. Verificación
   por etiqueta `<meta>` ou por ficheiro HTML en `public/` —o token é público, non é
   unha credencial—, enviar o sitemap e «Inspeccionar URL → Solicitar indexación» na raíz.
2. **Título, descrición e canónica por pestana.** `seo.ts` + `vite.config.ts` +
   `App.tsx` + os tres dicionarios, e un check en `test.ts`: cada copia con título
   distinto e canónica propia.
3. **Barra final no sitemap e en `urlForTab`.** Quita os seis 301.
4. **Descrición ≤ 155 con «non oficial», título con «bus», `og:image` co icono.** Coherente
   coas tres portadas: o que non é oficial dise en todas partes.
5. **Bloque estático na portada** (parágrafo + 24 liñas ligadas). Depende de decidir onde
   vai nunha app a pantalla completa: a proposta é que viva no HTML e a app o substitúa
   ao montar; para Google conta o renderizado, así que as mesmas 24 liñas teñen que
   estar tamén no DOM da app —xa o están en `/linhas/`.
6. **Descrición e temas do repositorio**, hoxe baleiros. O repositorio si está indexado e
   é a única porta que hai:

   ```bash
   gh repo edit braisbrg/urbanos-lugo --description "App non oficial do bus urbano de Lugo: 24 liñas, 417 paradas, horarios oficiais e estimacións etiquetadas. PWA, sen conexión." --add-topic lugo --add-topic galicia --add-topic public-transport --add-topic bus --add-topic pwa --add-topic react --add-topic maplibre --add-topic openstreetmap
   ```

### Este trimestre: estratéxico

7. **Páxinas estáticas por liña.** Depende de 2 e 3. Xerador en `tools/` desde
   `src/data/*.json`, enrutador lendo `/linhas/<nº>/`, sitemap a 31 URL. Só horas do
   cadro publicado; nada de «próximo bus» no HTML estático. Ataca a metade da táboa de
   palabras clave.
8. **Páxinas por parada.** Un día máis sobre a 7. O «copiar ligazón» pasa a dar unha URL
   con título e previsualización; o sitemap sobe a 448.
9. **Ligazóns.** Custa tempo, non código: nota de prensa a El Progreso e La Voz de Lugo,
   a wiki de OSM (páxina de Lugo, apps que usan datos OSM: lexítimo, xa se atribúe a
   ODbL), a lista `awesome-transit`, r/galicia, GPUL e o Mastodon galego. Non hai portal
   de datos abertos municipal onde listala (README, «Por que non se usa GTFS»).
10. **Dominio propio.** Decisión do dono, uns 15–30 € ao ano. Que non imite ao operador
    (`buslugo` e `urbanoslugo` son seus). A build xa emite canónica e sitemap para a orixe
    que se lle dea.

---

## O que non se move

- **Ningún título nin descrición promete «tempo real».** Ninguén publica a posición dos
  vehículos desta rede, e o README dío na sección «O que esta app NON pode facer». A
  palabra clave «bus lugo tiempo real» ten demanda e non se persegue.
- **«Non oficial» vai na descrición**, como nas tres portadas e no JSON-LD. O nome
  «Urbanos de Lugo» coincide co que Moovit lle chama ao operador; a ambigüidade resólvese
  dicíndoo, non aproveitándoa.
- **A marca do operador non se usa** como palabra clave.
- **As páxinas estáticas só levan horas do cadro publicado** —`HORARIO OFICIAL`—; as
  estimacións quedan na app, coa súa etiqueta.
- **As coordenadas das paradas son as do operador** e non se tocan por facer unha páxina
  bonita.

---

## Fontes consultadas

- buslugo.com: <https://buslugo.com/lineas/>, <https://buslugo.com/linea/?id=3>,
  <https://buslugo.com/tarifas/>
- Concello de Lugo: <https://concellodelugo.gal/es/actuaciones/autobuses-urbanos>,
  <https://concellodelugo.gal/es/noticias/ruben-arroxo-anuncia-descuentos-en-el-precio-del-bus-urbano-y-trasbordos-gratuitos>,
  <https://concellodelugo.gal/es/noticias/ruben-arroxo-anuncia-las-lineas-de-bus-especiales-para-el-san-froilan>
- El Progreso: <https://www.elprogreso.es/articulo/lugo/autobus-urbano-lugo-horario-lineas-tarifas/202309111049411690927.html>
- Moovit: <https://moovitapp.com/index/en/public_transit-lines-Vigo-3841-3755394>,
  <https://moovitapp.com/index/en/public_transit-line-1_4-Vigo-3841-3755394-157737866-1>
- urbanoslugo.com: <http://urbanoslugo.com/es/info-en-tiempo-real.html>
- Lucus Bus: <https://apps.apple.com/es/app/lucus-bus-bus-lugo/id1611708157>,
  <https://play.google.com/store/apps/details?id=com.trespies.busurbano>
- O repositorio: <https://github.com/braisbrg/urbanos-lugo>
