# cerini-css

CSS externo del theme **Cerini** (Tiendanube, modo compose-only) — mismo método que `kevingston-css`.

## Por qué existe
El campo `css_code` del theme tiene un límite de **15000 caracteres** y toda la web no entra.
Solución: el CSS vive acá (sin límite, legible, versionado) y el theme lo carga con un
`@import` chiquito desde `settings_data.json`.

## Cómo se conecta
En el `css_code` del theme queda solo el loader:

```css
@import url("https://powecommerce.github.io/cerini-css/theme.css?v=1");
```

## Flujo de trabajo
1. Editás `theme.css` acá.
2. `git push` a GitHub (repo `PowEcommerce/cerini-css`, GitHub Pages).
3. Se actualiza en la tienda (según caché CDN, entre instantáneo y ~10 min).

Para forzar refresco durante desarrollo, bumpear `?v=N` en el `@import` del `css_code`.

## Alcance (compose-only)
Solo se puede editar CSS sobre el markup existente de Ipanema. Lo que requiere markup/JS
nuevos (cucardas por categoría, favoritos, vista rápida, compra rápida) queda documentado en
`cerini/FORK-TODO.md` para cuando TN habilite `theme fork`.
