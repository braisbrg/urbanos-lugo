# A mudanza a unha organización de GitHub

NOTAS, Pendente 5: a web en `https://urbanos-lugo.github.io/`, na raíz, para que os
buscadores lle dean nome e icona propios. Preparado o 9 de outubro de 2026, para facer
cando aínda ninguén usa a web, e o enderezo pode cambiar sen custarlle nada a ninguén.

## Como vai (13 de outubro de 2026)

Os pasos 1 a 6 están feitos o 13 de outubro: a organización `urbanos-lugo`, o repositorio
transferido e renomeado a `urbanos-lugo.github.io`, Pages e o worker despregados de novo e
o remoto local apuntando ao novo. A web serve en `https://urbanos-lugo.github.io/` e o
worker responde con `access-control-allow-origin: https://urbanos-lugo.github.io`. O
paso 7, o que cambia no repositorio (tres portadas, `SECURITY.md`, `src/project.ts`, a
documentación e as comprobacións), saíu na 1.4.0 o 14 de outubro.

O paso 8 fíxose o 14 de outubro. A propiedade nova de Search Console verificouse soa coa
etiqueta HTML que xa levaba `index.html`: o seu valor é o da conta de Google, non o do
enderezo, así que non houbo que cambiala. O sitemap novo enviouse; a proba en tempo real
dixo que Google o pode ler, e o informe tarda uns días en pasar a «Correcto». Bing
importouno de Search Console, e o sitemap e o sitio vellos quitáronse dos dous paneis. O
enderezo vello non redirixe: non se creou o repositorio da última sección, e non se
recomenda (ver abaixo).

## Xa feito

- O despregue de Pages constrúe para a raíz cando o repositorio se chama
  `<propietario>.github.io` (`deploy-pages.yml`, cunha comprobación na suite). Para o
  repositorio de hoxe non cambia nada.
- O worker toma `ALLOWED_ORIGIN` do propietario do repositorio en cada despregue, así que
  pasará a `https://urbanos-lugo.github.io` el só.
- O código da app non leva o enderezo: usa `BASE_URL` e `SITE_URL`. Construída para a raíz
  e a URL nova, o canónico, o `sitemap.xml`, o `robots.txt` e o manifesto saen ben.
- A rama `org-move` leva o que cambia despois do traspaso: as tres portadas,
  `SECURITY.md`, `src/project.ts` (ligazón de incidencias e User-Agent), a documentación
  do traslado e as comprobacións, incluída unha que falla se un ficheiro que non sexa
  rexistro volve nomear `braisbrg.github.io`.

## Os pasos, en orde

1. **Feito.** **Crear a organización** `urbanos-lugo`, no plan gratuíto:
   <https://github.com/account/organizations/new>.
2. **Feito.** **Transferir o repositorio**: Settings → General → Danger Zone → *Transfer ownership* →
   `urbanos-lugo`.
3. **Feito.** **Renomealo** a `urbanos-lugo.github.io`: Settings → General → *Repository name*.
4. **Feito en parte.** **Comprobar** no repositorio xa movido (Pages, a variable `API_ORIGIN` e `DENO_DEPLOY_ORG` están lidas e correctas; o resto non se le pola API e é do dono):
   - Settings → Pages: *Source: GitHub Actions*.
   - Settings → Environments: o do worker, co segredo de Deno.
   - Settings → Secrets and variables → Actions: o segredo, e a variable `API_ORIGIN`.
   - Settings → Rules → Rulesets: `main` e `develop`, como estaban.
5. **Feito.** **Despregar de novo os dous**: Actions → *Deploy to GitHub Pages* → *Run workflow*, e
   o mesmo con *Deploy the API worker*. O primeiro constrúe para a raíz; o segundo cambia
   `ALLOWED_ORIGIN`. Ata entón, a web nova ve a copia dos avisos en vez do worker.
6. **Feito.** **No clon local**:
   `git remote set-url origin https://github.com/urbanos-lugo/urbanos-lugo.github.io.git`.
7. **Feito (1.4.0).** **Fusionar `org-move`** en `develop`, pasar as portas e publicar.
8. **Feito.** **Buscadores**: en Search Console, unha propiedade nova de prefixo de URL,
   `https://urbanos-lugo.github.io/`. Verificala coa etiqueta HTML: a de `index.html` valeu
   tal como estaba, porque é a da conta. Enviar
   `https://urbanos-lugo.github.io/sitemap.xml`. En Bing Webmaster, importar desde Search
   Console.

## O enderezo vello, se se quere que redirixa

Opcional, e non feito. Desde o traspaso `braisbrg.github.io/urbanos-lugo/` dá 404, e o
repositorio que o servía non existe baixo ese nome. Para que redirixa,
hai que crear un repositorio novo `braisbrg/urbanos-lugo` con estes tres ficheiros na súa
raíz, e Settings → Pages → *Deploy from a branch*, `main`, `/ (root)`. Crealo rompe a
redirección que GitHub fai por si só de `github.com/braisbrg/urbanos-lugo` ao repositorio
movido, que deixa de facer falta unha vez actualizadas as ligazóns. Sen usuarios que
conserven a ligazón, e con ese custo, o razoable é non crealo: os buscadores deixan caer
os enderezos vellos por si sós despois do 404. O que si daría é limpar o *service worker* de
quen instalase a app vella, e só importa se alguén o fixo.

Unha advertencia sobre as ligazóns profundas: unha páxina de proxecto só pode responder
en `braisbrg.github.io/urbanos-lugo/…` con ficheiros do repositorio, así que
`/urbanos-lugo/linhas/` só redirixe se o repositorio ten un `404.html` na súa raíz coa mesma
escritura de `index.html`, como se indica abaixo; sen el, dá o 404 de Pages.

`index.html`, e o mesmo como `404.html`, para que tamén redirixan as ligazóns profundas:

```html
<!doctype html>
<html lang="gl">
<meta charset="utf-8" />
<meta name="robots" content="noindex" />
<title>Urbanos de Lugo mudouse</title>
<script>
  // A mesma páxina no enderezo novo: o camiño despois de /urbanos-lugo, a consulta e o fragmento.
  var rest = location.pathname.replace(/^\/urbanos-lugo/, '') || '/';
  location.replace('https://urbanos-lugo.github.io' + rest + location.search + location.hash);
</script>
<p>Urbanos de Lugo está agora en <a href="https://urbanos-lugo.github.io/">urbanos-lugo.github.io</a>.</p>
</html>
```

`sw.js`, no mesmo camiño que o *service worker* da app vella, para que unha copia
instalada deixe de servir a app vella e chegue á redirección:

```js
// Substitúe o service worker vello e retírase; as xanelas abertas cargan de novo e redirixen.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
    })(),
  );
});
```

Os favoritos e as paradas recentes gárdanse por orixe e non pasan á web nova. Sen
usuarios, non se levan; se un día houbese que levalos, iría no fragmento da ligazón.
