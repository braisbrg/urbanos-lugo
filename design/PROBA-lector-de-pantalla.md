# Proba a man: lector de pantalla nun teléfono

O que `audit:browser` non pode facer é escoitar. Mide nomes, papeis, estados, orde e
idioma no código da páxina, pero non sabe como os di VoiceOver nin TalkBack, nin se
alguén que non ve a pantalla chega ao que busca. Este guión é para facelo cun teléfono de
verdade, nunha media hora por lector. Apúntase o resultado no cadro do final e, se algo
falla, abre unha rolda en `REXISTRO-probas.md`.

Contra o sitio publicado ou contra un servidor local ao que chegue o teléfono. De día, cos
buses circulando: de noite moitas pantallas están baleiras. Primeiro en galego; ao final,
unha volta curta en castelán e en inglés.

## 0. Preparar

**iPhone, VoiceOver, Safari.** Axustes › Accesibilidade › VoiceOver. Para acendelo e
apagalo sen buscalo: Axustes › Accesibilidade › Atallo de accesibilidade › VoiceOver, e
logo tres clics no botón lateral.

**Android, TalkBack, Chrome.** Axustes › Accesibilidade › TalkBack. O atallo habitual é
manter as dúas teclas de volume tres segundos.

Xestos que fan falta, nos dous:

| | VoiceOver | TalkBack |
| :--- | :--- | :--- |
| Seguinte / anterior | deslizar á dereita / á esquerda | deslizar á dereita / á esquerda |
| Activar | dobre toque | dobre toque |
| Ler desde o principio | deslizar dous dedos cara arriba | menú de TalkBack › Ler desde o principio |
| Ir por títulos, ligazóns, controis | rotor (xirar dous dedos) e logo deslizar arriba/abaixo | controis de lectura, e logo deslizar arriba/abaixo |
| Saír dun diálogo | xesto de escape: dous dedos en zigzag | o botón «Pechar» do diálogo (o xesto «atrás» é o do navegador e sae da páxina) |

Antes de empezar: o teléfono en galego ou non, dá igual; a app en galego desde o menú.

## 1. A páxina enteira

1. Abrir a app. Ler desde o principio.
   - Debe dicir o título da pantalla e chegar a «Ir ao contido» como primeira cousa.
   - A voz debe ser galega (ou a máis próxima que teña o teléfono) e non ler as palabras
     galegas cunha pronuncia inglesa. Se a pronuncia é inglesa, `lang` non chegou.
2. Activar «Ir ao contido». O seguinte elemento debe ser o principio do contido, non a
   barra de arriba.
3. No rotor ou nos controis de lectura, «Títulos»: percorrer os da pantalla. Deben ter
   sentido sós, sen o que os rodea.
4. «Puntos de referencia» (VoiceOver) ou «Rexións» (TalkBack): debe haber cabeceira,
   navegación e contido principal.

## 2. Paradas e taboleiro

1. Na caixa de busca, escribir «praza». Debe anunciarse cantas suxestións hai. Percorrelas:
   cada unha di o seu nome enteiro.
2. Escribir «tarifas». Debe aparecer un grupo «Pantallas» e a pantalla Tarifas nel.
   Activala: abre Tarifas.
3. Volver a Paradas. Buscar unha parada con moitas liñas e abrila.
4. No taboleiro, percorrer tres filas. Para cada unha, apuntar **exactamente** o que di:
   - a liña e o destino;
   - a hora ou os minutos;
   - se é horario oficial ou estimado. Na pantalla, o estimado leva «~». **Comprobar se o
     lector di «estimado» e non só un número, e se le o «~» como «til», «aproximadamente»
     ou nada.** Isto non se pode saber desde un ordenador.
5. Cambiar a «Por liña» e volver. O control debe dicir cal está seleccionado.
6. «Engadir a gardadas» (a estrela): debe dicir o seu nome e, ao activalo, que cambiou.
7. «Ver no mapa»: abrir o despregable «Outros postes aquí preto». Debe dicir que está
   pregado ou despregado, e os postes deben lerse coa distancia.
8. «Avisarme ao chegar»: activar, escoitar que cambia de estado, desactivar.

## 3. Liñas

1. Abrir a lista. Cada fila debe dicir número, nome e cantos buses hai en ruta.
2. Abrir unha liña. As frechas das saídas deben chamarse «Saída anterior» e «Saída
   seguinte», e a saída á vista debe dicir que está seleccionada.
3. Percorrer as paradas da liña: cada unha co seu nome e a súa hora, e as estimadas dito.

## 4. Mapa

1. Entrar no mapa. O mapa debe anunciarse como unha rexión co seu nome e unha descrición
   do que ten.
2. Os botóns «Achegar o mapa» e «Afastar o mapa» deben dicirse así, en galego.
3. As liñas de enriba: cada unha di «Liña N: destino». O despregable di cantas son.
4. «Filtros e capas»: ábrese un diálogo. O foco debe entrar nel e **non saír** ao
   percorrelo cara adiante. O primeiro despois do botón de pechar deben ser os filtros
   rápidos, despois «A miña localización» e «Centrar Lugo», despois as capas e as liñas: a
   mesma orde na que se ven. Pechalo co escape ou co seu botón: o foco volve ao botón que o
   abriu.
5. Activar a capa «Buses». Percorrer o mapa: cada bus debe lerse como unha imaxe con liña e
   destino. Debe lerse o aviso «Posición dos buses estimada polo horario, non en
   directo» e o seu botón para ocultalos, despois das liñas e non antes.
6. Tocar unha parada do mapa: ábrese a súa ficha como diálogo. Agardar dez segundos sen
   tocar nada nun dos botóns de dentro: **o foco non debe moverse só**.
7. Co lector apagado: un toque nun punto do mapa debe levar ese punto ao centro, sen
   arrastrar.

## 5. Ruta

1. Orixe e destino: cada campo di a súa etiqueta. Escribir no destino e escoitar o número
   de suxestións.
2. Os destinos rápidos (HULA, Campus…): o elixido di que está seleccionado.
3. «Calcular ruta». Mentres calcula debe dicir «Calculando». Ao rematar, o foco debe ir
   á resposta (as tres cifras ou a frase de que non hai ruta), non ao principio da páxina.
4. As rutas recentes: unha debe lerse «Orixe ata Destino», non os dous nomes xuntos.
5. «Borrar» as rutas recentes: debe anunciarse que se borraron, e o mesmo botón debe
   dicir agora «Desfacer». Activalo: as rutas volven.
6. «Vou nesta»: a pantalla da viaxe. A barra de abaixo non debe tapar o control que ten o
   foco. Xa no bus, a marca da seguinte parada late dúas veces cada vez que cambia e queda
   quieta; apuntar se o lector di algo dela (non debería).

## 6. Avisos e tarifas

1. Avisos: «Comprobar agora». Debe dicir que está comprobando e, ao rematar, o que
   atopou (cantos avisos, ou que non se puido saber).
2. Un aviso citado do operador está en castelán: **a voz debe cambiar á castelá** ao
   lelo e volver á galega despois. VoiceOver adoita facelo; TalkBack depende do motor de
   voz instalado. Apuntar o que pase.
3. Cada aviso debe dicir todas as liñas que nomea, sen «+N».
4. Tarifas: percorrer as tarxetas. Cada prezo debe lerse xunto ao nome do seu billete.

## 7. Diálogos e erros

1. Menú: ábrese como diálogo, o foco entra, non sae cara adiante, pecha co escape e volve
   ao botón do menú. O botón do menú debe dicir cantos avisos hai.
2. Favoritos, co baleiro: debe dicir «Preme na estrela dunha parada, «Engadir a gardadas»…».
3. Lector QR: o campo chámase «Código do poste». Escribir «zzz» e consultar: o erro debe
   anunciarse só, sen ir buscalo, e o campo debe dicir que non é válido.
4. Ruta co GPS denegado (permisos do navegador): a negativa debe anunciarse.

## 8. Sen lector

1. **Texto grande.** iPhone: en Safari, «aA» › texto ao 200 % (ou máis). Android: Axustes
   › Accesibilidade › Tamaño da letra ao máximo, e en Chrome Axustes › Accesibilidade ›
   Escalado de texto ao 200 %. Percorrer Paradas, unha liña, a ruta planificada e «Vou
   nesta»: ningún nome cortado con «…», nada fóra da pantalla.
2. **Movemento reducido.** iPhone: Accesibilidade › Movemento › Reducir movemento.
   Android: Accesibilidade › Quitar animacións. Abrir menú, ficha do mapa e «Vou nesta»:
   nada debe moverse, tampouco o latexo.
3. **Teléfono deitado.** Todas as pantallas deben seguir usándose.
4. **Contraste.** Tema claro e escuro desde o menú, ao sol se se pode: as horas e os
   números das liñas deben lerse.
5. **Teclado físico** (opcional, Bluetooth). iPhone: Accesibilidade › Teclados › Acceso
   total co teclado. Tab percorre todo, o foco vese sempre, Escape pecha os diálogos.

## 9. Volta curta nos outros dous idiomas

Cambiar a castelán no menú e repetir 1.1, 2.4 e 6.2: a voz debe ser castelá en toda a
páxina. Logo inglés: 1.1 e 2.4.

## Resultados

| Paso | VoiceOver | TalkBack | Notas |
| :--- | :---: | :---: | :--- |
| 1.1 Título, salto, voz | | | |
| 1.3 Títulos | | | |
| 1.4 Rexións | | | |
| 2.1 Suxestións anunciadas | | | |
| 2.2 «Pantallas» na busca | | | |
| 2.4 Fila do taboleiro (que di do «~») | | | |
| 2.5 Taboleiro / Por liña | | | |
| 2.6 Estrela | | | |
| 2.7 Postes aquí preto | | | |
| 3.2 Frechas e saída seleccionada | | | |
| 4.1 Rexión do mapa | | | |
| 4.3 Liñas do mapa | | | |
| 4.4 Filtros e capas: orde e retención | | | |
| 4.5 Buses como imaxes | | | |
| 4.6 O foco non se move só | | | |
| 5.3 Calculando e foco á resposta | | | |
| 5.4 «ata» | | | |
| 5.5 Borrar e desfacer | | | |
| 6.1 Comprobar avisos | | | |
| 6.2 Voz castelá nos avisos | | | |
| 7.3 Erro do QR | | | |
| 8.1 Texto grande | | | |
| 8.2 Movemento reducido | | | |
| 9 Castelán e inglés | | | |

Teléfono, versión do sistema e do lector, data: ________________
