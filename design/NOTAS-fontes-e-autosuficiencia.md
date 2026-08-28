# Fontes, e que a web se manteña soa

Brais o 28 de agosto de 2026: «quiero que cuando lo tengamos acabado, a menos que cambie
alguna ruta o algún bus, la web se mantenga sola». Isto é o inventario do que hai, do que
falta, e do que xa non cadra entre unhas fontes e outras.

## O que xa se comproba só

- **Avisos do operador, cada hora.** `deploy-pages.yml` corre `tools/fetchAlerts.ts` antes
  de cada despregue e volve despregar cada hora. Le só buslugo.com.
- **A rede, cada semana.** `check-source.yml` corre `tools/reconcile.ts --fresh`, que volve
  ler as 24 páxinas de liña do operador e compara co que se publica aquí. Falla se algo
  discrepa, que é o único sinal que merece interromper a alguén: se cambia un itinerario ou
  un horario, os datos que servimos quedan mal e nada dentro da app pode darse conta.

## O que non se comproba

- **As obras e avisos municipais.** Os tres avisos estruturais están escritos a man. Levan
  data de revisión e din en voz alta cando esa data envellece, pero ninguén os vai buscar.

## As fontes, unha por unha

| Fonte | Que serve | Serve para automatizar? |
|---|---|---|
| **buslugo.com** | portal do operador; avisos e as páxinas de liña | **Si**, e xa se usa: avisos cada hora, reconciliación semanal |
| **urbanoslugo.com** | a web da propia operadora, Monbus Urbanos S.A. | **Non hoxe.** Ver abaixo |
| **datosabertos.lugo.gal** | portal de datos abertos do Concello | **Non.** 503 nos endpoints CKAN, 404 nos catálogos estándar; só HTML |
| **Folleto impreso do Concello** | tarifas, nomes de liña, planos | **Non**, é papel; pero vale como contraste |

### urbanoslugo.com, en detalle

Comprobado o 28 de agosto:

- **Non ten HTTPS.** `https://` devolve 301 cara a `http://`. Por iso non se pode ligar
  desde a app e por iso saíu da tarxeta de portais.
- **Ten RSS**: `http://urbanoslugo.com/es/rss.xml`, 200, XML válido. Pero está abandonado:
  dúas entradas de recheo — «Inauguracion del nuevo servicio de transporte» e «Muy pronto
  info en tiempo real» — sen datas e todas apuntando á portada. **Non serve hoxe**, pero é
  un punto que xa é lexible por máquina: se algún día o operador o usa, os avisos chegarían
  de balde. Custa case nada consultalo de cando en vez.
- Esa segunda entrada, «muy pronto info en tiempo real», confirma o que a app leva dicindo:
  esta rede non publica GPS da flota.
- Tamén serve `/files/plano_rede.pdf`, que semella ser o mesmo plano que Brais pasou.

## O contraste co folleto do Concello

Brais pasou o folleto oficial (24 páxinas: tarifas, nomes de liña e planos). Primeiro
cotexo, e sae unha discrepancia que hai que resolver.

### Cadra exactamente

Billete ordinario **0,64 €**, bono ordinario **0,45 €**, bono social **0,31 €**. Son os
tres prezos que a app amosa e os tres que o folleto imprime.

### **Non cadra: o transbordo**

O folleto imprime **transbordo ordinario 0,19 €** e **transbordo social 0,10 €**. A app ten
`transfer: 0` e di «transbordo gratuíto (75 min)».

Isto é unha afirmación sobre cartos, así que non se toca ningunha das dúas ata sabelo. As
posibilidades son que o folleto sexa anterior a un cambio de política, ou que a app estea
mal. Nunha sesión anterior verificouse que os transbordos eran de balde e deuse por boa;
esa verificación agora ten unha fonte que a contradí. **Volver á fonte antes de cambiar
nada**, e deixar dito de onde saíu a resposta.

### Os nomes de liña do Concello son mellores

O folleto nomea as liñas polo corredor; buslugo nómeas polas cabeceiras. Compárense:

| | Concello | O que amosa a app |
|---|---|---|
| 1.1 | Campus Universitario – Fingoi – O Ceao | Opuesto Piscina Pedreiras – Rúa Mercadorías (Terminal) |
| 3.1 | Rda. Muralla (Sindicatos) – Av. Coruña – Montirón – UNED | Rda. Muralla 56 (Sindicatos) – A Tolda (UNED) |
| 7 | Casco Histórico (Bolaño) – Barrio da Ponte | Bolaño Ribadeneira 1 – A Ponte (cruce Fl…) |

O do Concello dille a alguén por onde vai a liña; o do operador dille onde remata. Paga a
pena consideralo, pero é un cambio de datos, non de interface: os nomes veñen do scrape e
habería que decidir cal manda e como se reconcilia iso.

## Que faría a continuación

1. **Resolver o transbordo.** É o único punto onde a app afirma algo que outra fonte nega.
2. **Consultar o RSS do operador** no mesmo traballo horario que xa le buslugo.com. Hoxe non
   devolve nada útil, pero é barato e xa é XML; o día que o usen, chega só.
3. **Deixar as obras municipais como están** —escritas a man, con data e con aviso de
   caducidade— ata que apareza unha fonte que se poida ler sen adiviñar. Raspar a web do
   Concello é un proxecto propio, e habería que ler os seus termos antes.
