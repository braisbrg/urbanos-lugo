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

### O achado: o operador si publica tempos por parada

`https://info.urbanoslugo.com/qr-demo-paradas/uilP` devolve HTML cos minutos que faltan
(`<p>9 min</p>`) e refréscase só cada 30 segundos. **Usa os mesmos códigos de parada que
esta app** — `uilP` é Rda. Muralla 56 (Sindicatos) aquí tamén.

Iso abre dúas cousas, e a segunda importa máis:

1. Poderíanse amosar os minutos do operador no canto —ou ao lado— das estimacións propias.
2. **Poderíase comprobar canto se afastan as nosas estimacións das súas.** Este proxecto
   enteiro está construído arredor de distinguir o publicado do calculado; ter unha fonte
   contra a que medir o erro real das estimacións é exactamente o que faltaba.

Antes de tocar nada hai que resolver: se eses minutos son GPS ou horario (o propio RSS do
operador aínda di «muy pronto info en tiempo real», o que apunta a horario), se `qr-demo-`
significa que é provisional, e se os seus termos permiten lelo. **Non presentar eses
minutos como medidos ata sabelo.**

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

## Pendente

1. **Outra rolda de auditoría e de comprobacións**, coa mesma disciplina: medir antes de
   afirmar, e correr cada aviso ata a súa causa antes de descartalo.
2. **Comprobar navegadores e sistemas.** Non se probou máis que nun Chromium. Importa
   especialmente: **Safari en iOS**, que é o outro medio Lugo, e onde `100dvh`, os
   `<details>`, `oklch()` e o `ResizeObserver` do mapa son os candidatos a romper. Tamén
   Firefox e Chrome en Android. Hai que decidir cal é o chan que se soporta e escribilo.
3. **Atar as tarifas** ao traballo semanal, para que fallen cando cambien.
4. **Normativa**: paga a pena engadila, pero resumida con palabras propias e ligando á
   fonte, non copiada. O útil de verdade son catro feitos que cambian o que fai alguén na
   porta do bus: **máximo 5 € en billete**, os nenos pagan **desde os 4 anos**, hai que
   **conservar o ticket** ata o final, e **pedir a parada con antelación**.
5. **Decidir que facer cos minutos de `info.urbanoslugo.com`**, coas cautelas de arriba.
