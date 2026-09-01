# cerini-css — ARCHIVADO (2026-08-31)

> **Este repo ya no se usa.** Su contenido vive ahora dentro del tema, en
> [`PowEcommerce/cerini`](https://github.com/PowEcommerce/cerini):
>
> | antes (acá)  | ahora (en el tema)     |
> |--------------|------------------------|
> | `theme.css`  | `static/css/custom.css` |
> | `cerini.js`  | `static/js/custom.js`   |
>
> Se edita ahí y `nuvemshop theme push` lo publica. **No hace falta tocar dos
> repos ni bumpear ningún `?v=N`.**

## Por qué existía

`css_code` tiene un tope de 15000 caracteres y la hoja no entraba, así que el CSS
vivía acá y el tema lo cargaba con un `@import` desde `css_code`, servido por
GitHub Pages.

## Por qué se archivó

Ese tope es del **campo** `css_code`, no del tema: `static/css/` no lo tiene. Lo
que impedía usarlo era que sin `theme fork` no se puede pushear `static/`. El tema
se forkeó el 2026-08-31 y el split dejó de tener motivo.

Además el esquema tenía dos fallas propias:

1. **Publicar dependía de un push a otro repo.** El `?v=N` del `@import` sólo
   bustea caché — no despliega nada. Una corrida escribió 340 líneas acá que nunca
   se publicaron, y midió tres iteraciones contra una página sin estilos.
2. **El CSS llegaba en una cadena de tres saltos** (HTML → `@import` a github.io →
   `@import` a Google Fonts), y ninguno era precargable: el preload scanner no mira
   dentro de un `@import`.

Se deja el historial por referencia. No commitear nada nuevo acá.
