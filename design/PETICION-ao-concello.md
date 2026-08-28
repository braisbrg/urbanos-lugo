# Que pedir ao Concello, e como

Escrito o 28 de agosto de 2026. Isto é o que faría falta para que esta web deixase de
adiviñar, por orde do que máis cambia as cousas.

Todo o que aquí se pide **xa existe**: non se lle pide a ninguén que constrúa nada novo,
senón que publique o que xa ten. Iso é o que fai a petición razoable.

---

## Por que agora

O propio Concello anda, segundo as súas notas de prensa (etiqueta *Buses urbanos*),
elaborando **un novo modelo de transporte público** con encontros veciñais. Un prego novo
é o momento en que se decide que datos se publican e en que formato; despois de asinado xa
non se toca en anos. Se hai un momento para pedir isto, é este.

---

## O que se pide, por orde

### 1. As posicións dos autobuses en tempo real, en GTFS-Realtime

**É o que máis cambia a app, e xa existe.** A operadora ten un SAE —sistema de axuda á
explotación— e publícao xa: `info.urbanoslugo.com/qr-demo-paradas/<código>` devolve os
minutos que faltan, parada por parada, e refréscase soa cada 30 segundos. Comprobado o 28
de agosto en 40 paradas repartidas pola rede: **responden as 40**, incluídas 15 que nin
sequera teñen adhesivo de QR nos nosos datos.

O que se pide non é ese HTML, senón o mesmo dato no formato estándar:

- **`VehiclePositions`** — onde está cada bus.
- **`TripUpdates`** — canto leva de adianto ou de atraso cada expedición.

É o formato que usan Google, Apple, Moovit e calquera app de transporte, e publicalo unha
vez serve para todas. Hoxe esta app estima eses minutos a partir do horario e do tempo de
percorrido medido, e **acabamos de medir canto nos equivocamos: a mediana é de 1 minuto,
pero só 38 de 82 comparacións caeron dentro de 2 minutos**. Con esta fonte, cero.

### 2. O cadro horario como GTFS Static

Hoxe esta app **le as 24 páxinas de liña de buslugo.com e interprétaas**. Funciona, hai un
traballo semanal que avisa se cambian, e aínda así é fráxil: unha reforma da web e queda
todo roto.

Un GTFS estático (`stops.txt`, `routes.txt`, `trips.txt`, `stop_times.txt`, `calendar.txt`)
elimina iso de raíz e trae de balde o que agora hai que adiviñar:

- **os identificadores e as coordenadas oficiais de cada poste**, en vez de cruzalos co
  levantamento de OpenStreetMap;
- **os días de servizo de verdade**, incluídos festivos e período de verán;
- os percorridos, sen ter que deducilos.

### 3. Un aviso de servizo que se poida ler

Cando hai unha obra, un corte ou un desvío, hoxe hai que atopalo nunha campá do menú de
buslugo.com. Pídese calquera das dúas:

- **GTFS-Realtime `ServiceAlerts`** (o mesmo estándar de arriba), ou
- un **JSON ou RSS estable** con: título, texto, liñas afectadas, paradas afectadas e
  **desde cando e ata cando**. Ese último campo é o que hoxe falta en todas partes: sen
  data de fin, un aviso queda para sempre.

O Concello xa publica por etiquetas (*Obras en ejecución*, *Tráfico*, *Buses urbanos*) e
esta app xa as le. O que non teñen é a liña afectada nin a vixencia, e iso é o que
convertería unha nota de prensa nun aviso útil.

### 4. As tarifas como dato

Un ficheiro pequeno cos prezos vixentes e a data desde a que o son. Hoxe están escritos a
man neste repositorio e compróbanse contra unha táboa HTML. Cambia unha vez ao ano, pero
cando cambia, cambia para todos.

### 5. Permiso por escrito, e a licenza

Isto é o menos vistoso e o máis importante:

- **Unha licenza explícita de reutilización.** O ideal, **CC BY 4.0** ou **ODbL**. Sen
  licenza, calquera uso vive da tolerancia de quen mande ese ano.
- **A cadencia coa que están cómodos.** Esta app consulta buslugo.com unha vez cada hora e
  as súas páxinas de liña unha vez por semana. Se prefiren outra cousa, dígase e cámbiase.
- **Un contacto técnico** para cando o dato rompa, que romperá.

---

## Como pedilo

**A quen.** Son dous e fai falta escribirlle aos dous:

- **Concello de Lugo, área de Mobilidade.** É quen contrata o servizo e quen pode meter a
  obriga de publicar datos no prego. Rexístrese por **instancia xeral na sede electrónica**
  para que quede constancia; un correo pérdese, un rexistro non. Copia ao **010**.
- **A operadora (Monbus Urbanos S.A. / AULUSA)**, `info@urbanoslugo.com`. O SAE é seu e o
  dato sae dos seus vehículos. Sen eles non hai tempo real, mande quen mande.

**Como redactalo.** Tres parágrafos chegan:

1. **Que é isto.** Unha web libre e gratuíta que xa amosa os seus horarios, sen publicidade,
   sen recoller datos de ninguén, con código aberto e acreditándoos a eles en cada pantalla.
   Adxúntase a ligazón. Non se pide diñeiro nin exclusividade.
2. **Que se pide, e por que lles convén.** O de arriba, na súa orde. O argumento que lles
   interesa non é que a min me veña ben: é que **publicalo unha vez serve para todas as
   apps**, e que unha rede cuxos datos se poden ler acaba en Google Maps e en Moovit sen que
   o Concello teña que pagar por integrarse en ningunha delas.
3. **Que se fará mentres tanto.** Seguir lendo o que publican, coa cadencia que digan, e
   corrixir calquera cousa que lles pareza mal. Ofrecer amosar o resultado.

**Que axuda a que digan que si:**

- Mencionar a **Lei 37/2007 de reutilización da información do sector público** e a **Lei
  19/2013 de transparencia**: os datos de servizos públicos contratados están pensados para
  ser reutilizables. Non como ameaza — como o marco no que a petición é normal.
- Mencionar que **outras cidades galegas xa o fan** e que o custo é publicar o que o SAE xa
  produce.
- Deixar claro que **esta app non se presenta como oficial** en ningunha pantalla, e que
  seguirá sen facelo. É unha preocupación real deles e convén desactivala antes de que a
  formulen.

**Que non pedir:** acceso privilexiado, exclusividade, nin nada que os obrigue a manter unha
API só para isto. Pídese o estándar, público, para todo o mundo. Iso é máis doado de
conceder que un favor.
