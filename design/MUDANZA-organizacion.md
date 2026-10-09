# A mudanza a unha organización de GitHub

NOTAS, Pendente 5: a web en `https://urbanos-lugo.github.io/`, na raíz, para que os
buscadores lle dean nome e icona propios. Preparado o 9 de outubro de 2026, para facer
cando aínda ninguén usa a web, e o enderezo pode cambiar sen custarlle nada a ninguén.

## Xa feito

- O despregue de Pages constrúe para a raíz cando o repositorio se chama
  `<propietario>.github.io` (`deploy-pages.yml`, cunha comprobación na suite). Para o
  repositorio de hoxe non cambia nada.
- O worker toma `ALLOWED_ORIGIN` do propietario do repositorio en cada despregue, así que
  pasará a `https://urbanos-lugo.github.io` el só.
- O código da app non leva o enderezo: usa `BASE_URL` e `SITE_URL`. Construída para a raíz
  e a URL nova, o canónico, o `sitemap.xml`, o `robots.txt` e o manifesto saen ben.
- A rama local `org-move` leva o que cambia despois do traspaso: as tres portadas,
  `SECURITY.md`, `src/project.ts` (ligazón de incidencias e User-Agent) e as comprobacións.

## Os pasos, en orde

1. **Crear a organización** `urbanos-lugo`, no plan gratuíto:
   <https://github.com/account/organizations/new>.
2. **Transferir o repositorio**: Settings → General → Danger Zone → *Transfer ownership* →
   `urbanos-lugo`.
3. **Renomealo** a `urbanos-lugo.github.io`: Settings → General → *Repository name*.
4. **Comprobar** no repositorio xa movido:
   - Settings → Pages: *Source: GitHub Actions*.
   - Settings → Environments: o do worker, co segredo de Deno.
   - Settings → Secrets and variables → Actions: o segredo, e a variable `API_ORIGIN`.
   - Settings → Rules → Rulesets: `main` e `develop`, como estaban.
5. **Despregar de novo os dous**: Actions → *Deploy to GitHub Pages* → *Run workflow*, e
   o mesmo con *Deploy the API worker*. O primeiro constrúe para a raíz; o segundo cambia
   `ALLOWED_ORIGIN`. Ata entón, a web nova ve a copia dos avisos en vez do worker.
6. **No clon local**:
   `git remote set-url origin https://github.com/urbanos-lugo/urbanos-lugo.github.io.git`.
7. **Fusionar `org-move`** en `develop`, pasar as portas e publicar.
8. **Buscadores**: en Search Console, unha propiedade nova de prefixo de URL,
   `https://urbanos-lugo.github.io/`. Verificala coa etiqueta HTML: a de agora vai en
   `index.html`, e se Google dá outra hai que cambiala. Enviar
   `https://urbanos-lugo.github.io/sitemap.xml`. En Bing Webmaster, importar desde Search
   Console.

## O enderezo vello, se se quere que redirixa

Ao transferir, `braisbrg.github.io/urbanos-lugo/` deixa de servirse. Para que redirixa,
hai que crear un repositorio novo `braisbrg/urbanos-lugo` con estes tres ficheiros na súa
raíz, e Settings → Pages → *Deploy from a branch*, `main`, `/ (root)`. Crealo rompe a
redirección que GitHub fai por si só de `github.com/braisbrg/urbanos-lugo` ao repositorio
movido, que deixa de facer falta unha vez actualizadas as ligazóns.

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
