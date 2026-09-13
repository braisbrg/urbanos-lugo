# Urbanos de Lugo

### 👉 [**braisbrg.github.io/urbanos-lugo**](https://braisbrg.github.io/urbanos-lugo/)

**Cuándo pasa tu bus en Lugo.** Todas las líneas, todas las paradas y la hora a la que
pasan, en una web que abre en un segundo y funciona sin cobertura.

> **No es la app oficial.** No está hecha, revisada ni respaldada por AULUSA, Grupo
> Monbus ni el Concello de Lugo. Lee los horarios que el operador publica en
> <https://buslugo.com>. Si algo depende de un horario, manda la fuente oficial.

> 🇬🇧 [English](README.en.md) · 🇬🇦 [Galego — documento completo](README.md)
>
> Esta página es un resumen. La documentación entera —cómo se construye el dataset, cómo
> se calculan los tiempos, qué comprueba cada test y por qué— está en el README en
> gallego, y se mantiene ahí para que no haya tres versiones de la misma cifra.

---

## Para qué sirve

- **Llegas a una parada y quieres saber cuánto falta.** Escaneas el código del poste o
  buscas la parada por su nombre, y tienes la lista de lo que viene.
- **No sabes qué bus coger.** Escribes de dónde sales y a dónde vas —una calle, una
  plaza, el hospital— y te da el trayecto entero.
- **Quieres ver por dónde pasan.** El mapa muestra las 24 líneas con sus recorridos
  reales por las calles y las 417 paradas.
- **Te bajas en una parada que no conoces.** Pones una alarma y el móvil te avisa cuando
  estás cerca.
- **Vas en el bus y no quieres pasarte.** Pulsa **«Vou nesta»** en el trayecto y la
  pantalla cuenta las paradas que faltan contra tu GPS, dice los minutos según el cuadro y
  te avisa antes de bajar — también en el transbordo.
- **No tienes datos.** Una vez abierta funciona sin conexión. Los horarios van dentro.

## Lo que esta app NO puede hacer

**No sabe dónde está el bus.** Nadie lo publica: esta red no emite la posición de los
vehículos. Así que **ninguna hora de esta web es una medición**; o es la que el operador
imprime en su cuadro, o es un cálculo hecho a partir de ella. Y cada hora en pantalla
dice cuál de las dos es:

| | |
| :--- | :--- |
| `HORARIO OFICIAL` | El operador publica esa hora para esa parada. |
| `~ ESTIMADO` | Salida de cabecera publicada, más el tiempo de recorrido medido por carretera. |

## Privacidad

No hay cuenta, ni registro, ni analítica, ni publicidad, ni cookies, ni ningún servidor
nuestro que guarde constancia de una visita. **Tu ubicación no sale de este móvil** — ni
siquiera para trazar el camino a pie, porque la red peatonal de Lugo va dentro de la
aplicación y la ruta se calcula en tu propio dispositivo.

El detalle completo, escrito desde el código y no desde la intención, está en
[PRIVACY.md](PRIVACY.md).

## Ejecutarla

```bash
pnpm install
pnpm dev      # Express + Vite
pnpm test     # la suite entera, un solo fichero, sin framework
```

Node 22 o superior, y **pnpm siempre**: CI instala con `--frozen-lockfile` desde
`pnpm-lock.yaml`.

## Datos, licencias y créditos

- [DATA.md](DATA.md) — de dónde sale cada fichero y bajo qué condiciones.
- [NOTICE.md](NOTICE.md) — a quién hay que dar crédito.
- [SECURITY.md](SECURITY.md) — cómo reportar un fallo de seguridad.

El código es MIT. La geometría derivada de OpenStreetMap es ODbL, que no es lo mismo, y
en DATA.md está dicho cuál es cuál.
