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

## Pendente

1. **Outra rolda de auditoría e de comprobacións**, coa mesma disciplina: medir antes de
   afirmar, e correr cada aviso ata a súa causa antes de descartalo.
2. **Comprobar navegadores e sistemas.** Non se probou máis que nun Chromium. Importa
   especialmente: **Safari en iOS**, que é o outro medio Lugo, e onde `100dvh`, os
   `<details>`, `oklch()` e o `ResizeObserver` do mapa son os candidatos a romper. Tamén
   Firefox e Chrome en Android. Hai que decidir cal é o chan que se soporta e escribilo.
3. **Atar as tarifas** ao traballo semanal, para que fallen cando cambien.
4. **Consultar o RSS do Concello** no mesmo traballo horario, filtrando só o que fale de
   transporte e etiquetándoo como nota de prensa coa súa data. É a única fonte municipal
   lexible por máquina que existe.
5. **Decidir que facer cos minutos de `info.urbanoslugo.com`**, coas cautelas de arriba.
