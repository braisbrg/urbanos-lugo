# Contribuír

Grazas por parar aquí. Isto é o pouco que hai que saber para que un cambio entre á
primeira; o resto está no [README](README.md), que é a documentación enteira.

## Antes de tocar nada

- **`src/data/*.json` é xerado.** Non se edita a man: cámbiase o xerador en `tools/` e
  execútase `pnpm run data:build`. Un PR que toque eses ficheiros directamente non se pode
  aceptar, aínda que o cambio sexa correcto, porque a seguinte rexeneración o borraría.
- **Ningunha hora é unha medida.** Esta rede non publica posicións. Cada hora que aparece
  en pantalla vén do cadro do operador ou se deriva del, e leva a súa etiqueta —`HORARIO
  OFICIAL` ou `~ ESTIMADO`—. Unha hora sen etiqueta é un erro, non unha simplificación.
- **As coordenadas das paradas son as do operador.** Non se corrixen a ollo, nin cando
  parecen mal: [`DATA.md`](DATA.md) di de onde sae cada ficheiro e con que licenza.
- **Textos en tres idiomas.** `src/i18n/gl.ts` é a forma; unha clave que falte en `es.ts`
  ou `en.ts` non compila, e iso é adrede. Nada de texto para o lector escrito nun compoñente.

## Como se traballa

```bash
pnpm install          # pnpm, sempre; o lockfile é pnpm-lock.yaml
pnpm dev              # Express + Vite en http://localhost:3001
```

Antes de abrir o PR, as catro portas que pasa a integración continua:

```bash
pnpm run lint && pnpm test && pnpm run check:deep && pnpm run build
```

`check:deep` fai catro peticións a servidores alleos (buslugo.com); pásao unha vez ao
final, non en cada iteración. As ferramentas de `tools/` que len de fóra —`data:fetch`,
`reconcile`, `compare:operator` e as demais que o README marca— non van nunca nun bucle.

## O que pide un cambio

- **Un check por erro.** A suite é un só ficheiro, `tools/test.ts`, con `assert` e sen
  *framework*; cada comprobación nomea nun comentario o erro real que a motivou. Se
  arranxas lóxica, deixa o check que fallaría sen o arranxo. Nunca se relaxa nin se borra
  un check para chegar a verde: se falla, o que está mal é o código.
- **A documentación no mesmo commit.** Se o cambio fai que algo do README deixe de ser
  certo —un comportamento, unha cifra—, o README cambia no mesmo commit. As cifras medidas
  viven só en `README.md`; `README.es.md` e `README.en.md` son un resumo cada un.
- **Mensaxes de commit que contan que pasou**, e por que, en inglés, como o código e os
  comentarios. As notas de deseño (`design/*.md`) van en galego.
- **Nada que non sexa público.** Sen nomes de persoas, sen credenciais, sen directorios de
  asistentes (`.claude/`, `.agents/` e similares están ignorados a propósito).

## Erros e ideas

Abre unha *issue* con como reproducilo e, se é un dato —unha hora, unha parada, un
percorrido—, con que di o operador en buslugo.com. As ideas grandes xa avaliadas están no
README, en «Ideas para máis adiante», coa razón de cada unha.
