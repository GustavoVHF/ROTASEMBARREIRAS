# Verification — Remove community filter + OSM/CARTO attribution

First iteration (no `review.json` present). Both changes implemented per `plan.md`.

## Commands run

- `npm run build` (from `d:\ROTASEMBARREIRAS`) → **exit code 0**. `✓ Compiled successfully`, TypeScript finished, 39/39 static pages generated. Lint runs separately in this Next 16 setup, so it does not gate the build.

## Grep confirmations

- `Mostrar locais da comunidade` across `src/` → **no matches**.
- `L.control.attribution` across `src/` → **no matches**.
- `attribution:` (tileLayer option) in `src/components/CustomMap.tsx` → **no matches**.
- `attribution` remaining in `src/components/CustomMap.tsx` → only `attributionControl: false` (map init, intended — disables default control).
- `handleToggleCommunity` / `setShowCommunity` across `src/` → **no matches**.

## Files / changes

### `src/app/page.tsx` (CHANGE 1)
- Removed `Users` from the `lucide-react` import (was used only by the removed toggle).
- Removed the `showCommunity` state (`const [showCommunity, setShowCommunity] = useState(true);`) and its two comment lines.
- Removed the `handleToggleCommunity` handler, which also removed the `track("filtro_aplicado", { tipo: "comunidade", ... })` call.
- Removed the filter `<button>` ("Mostrar locais da comunidade", `<Users/>` icon, `aria-pressed`/`onClick`) and the preceding `<span aria-hidden ... />` vertical divider that only separated it from the category chips.
- Changed the CustomMap prop from `showCommunity={showCommunity}` to `showCommunity={true}` — community points now always visible.
- `communityCategory={selectedCategory}` wiring left unchanged. `track` import still used by other handlers.

### `src/components/CustomMap.tsx` (CHANGE 2 code)
- Removed `L.control.attribution({ position: "bottomleft", prefix: false }).addTo(map);` and its comment.
- Removed the `attribution:` property from the CartoDB `L.tileLayer(...)` options (kept `maxZoom`, `updateWhenZooming`, `keepBuffer`, and the tile URL).
- Removed the stale comment that referenced adding attribution "abaixo"; left `attributionControl: false` in the map init.
- Updated the `showCommunity` prop doc comment (no longer references the removed filter control). Prop + `setEnabled` effect behavior unchanged.

### `src/app/globals.css` (CHANGE 2 CSS)
- Removed the now-dead attribution rules: `.leaflet-control-attribution`, `.leaflet-control-attribution a`, the `@media (min-width: 1280px) { .leaflet-bottom.leaflet-left { ... } }` repositioning block, and the two `.theme-high-contrast .leaflet-control-attribution` / `... a` variants, plus their heading comment.
- Unrelated map CSS (community pins/clusters, RELATO options) left intact.

## Design/accessibility compliance
- Changes only remove UI elements; no new colors, motion, or dialogs introduced. No `alert()`/`confirm()` used. High Contrast and `reduce_motion` behavior unaffected.
- Attribution removal done on the user's explicit statement of written organizational authorization.

Not committed, not pushed (orchestrator handles commit after review).
