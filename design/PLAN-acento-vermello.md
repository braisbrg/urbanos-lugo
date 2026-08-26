# Plan: A Mosqueira en vermello

Decidido con Brais o 27 de agosto de 2026, tras tres roldas de bocetos.
**Non empezado.** Este ficheiro é o encargo completo para a sesión seguinte.

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
