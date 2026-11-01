# Remove community filter control and OpenStreetMap/CARTO attribution

The change drops the "Mostrar locais da comunidade" toggle from the map UI and removes the OSM/CARTO attribution overlay from the Leaflet map. Community points are no longer gated behind a filter — they render unconditionally now that `CustomMap` always receives `showCommunity={true}`. The attribution removal was done on the user's explicit statement of written organizational authorization. The diff is tightly scoped to the three expected files (`page.tsx`, `CustomMap.tsx`, `globals.css`), all removals, with no behavioral additions.

Watch for: nothing blocking. The task brief assumed two filter-control occurrences (mobile + desktop); the committed source only ever had one shared control, which is fully removed (confirmed). The attribution removal is a licensing/legal decision the user owns, not a code concern.

**Verdict**: APPROVED

## High-level view

The filter removal is clean: the `showCommunity` session state, the `handleToggleCommunity` handler (which carried the only `track("filtro_aplicado",{tipo:"comunidade"})` call), the rendered button, and its divider span are all gone, and the now-unused `Users` lucide import was dropped with them. The `CustomMap` prop flipped from `showCommunity={showCommunity}` to a literal `true`, so points always show. The `communityCategory={selectedCategory}` wiring is untouched, and inside `CustomMap` the `setEnabled`/`setCategory` effects still fire — so category filtering of community points continues to work (confirmed).

The attribution removal spans code and CSS consistently: the standalone `L.control.attribution(...).addTo(map)` call and the tileLayer `attribution:` string are both removed, leaving `attributionControl: false` plus `maxZoom`/`updateWhenZooming`/`keepBuffer` and the tile URL intact. The matching dead CSS (`.leaflet-control-attribution` rules, the desktop `@media` repositioning block, and both high-contrast variants) is removed in the same pass, so no orphaned selectors or styling-only concern remains.

No new colors, motion, or dialogs enter the tree; both changes are deletions. High Contrast and `reduce_motion` handling are unaffected because the only high-contrast rules removed were the attribution ones that no longer have a target. pt-BR text is intact, and no `alert()`/`confirm()` was introduced (confirmed).

<details>
<summary>Issues (0)</summary>

No blocking or non-blocking action items. The attribution removal is a user-owned licensing decision outside code review scope.

</details>

<details>
<summary>Details</summary>

## Filter removal and always-on community points

The toggle was a single shared control in the committed source — `git show HEAD:src/app/page.tsx` has exactly one `handleToggleCommunity` reference and one "Mostrar locais da comunidade" label, so the task's "mobile and desktop occurrences" phrasing describes one responsive control, not two. It and the preceding `<span aria-hidden ... />` divider are removed, along with the `showCommunity` state and the handler. Because `handleToggleCommunity` was the sole caller of `track("filtro_aplicado", { tipo: "comunidade" })`, that analytics event is correctly retired with the control; the category-filter `track("filtro_aplicado", { tipo: "categoria" })` call and the `track` import survive for other handlers.

Points are now unconditional via `showCommunity={true}` on `CustomMap`. The grep confirms the layer still reacts to the prop and the category: `communityRef.current?.setEnabled(showCommunity)` and `setCategory(communityCategory)` effects are unchanged, and `communityCategory={selectedCategory}` is still passed. So the category filter continues to narrow community points while the show/hide gate is permanently open — the intended end state.

The `Users` icon was dropped from the `lucide-react` import since the removed button was its only consumer; no dangling import or unused symbol.

## Attribution removal across code and CSS

Both attribution insertion paths are gone: the explicit `L.control.attribution({ position: "bottomleft", prefix: false }).addTo(map)` and the `attribution:` option on the CartoDB tileLayer. What remains on the tileLayer is `maxZoom`, `updateWhenZooming: false`, `keepBuffer: 3`, and the unchanged tile URL — exactly the brief. `attributionControl: false` stays in the map init (grep shows it as the only `attribution` match left in `CustomMap.tsx`), which is correct: it keeps Leaflet's default control suppressed.

The dead CSS removal is surgical. The excised block sat between the high-contrast cluster rules and the RELATO options section; both neighbors are intact after the cut. Removed selectors were all attribution-scoped (`.leaflet-control-attribution`, its `a`, the `@media (min-width: 1280px)` `.leaflet-bottom.leaflet-left` repositioning, and the two `.theme-high-contrast .leaflet-control-attribution` variants) — none have a remaining target now that the control is gone, so no orphaned styling.

</details>

<details>
<summary>File map</summary>

- `src/app/page.tsx` — removed `showCommunity` state, `handleToggleCommunity` (and its comunidade analytics call), the toggle button + divider, and the `Users` import; `CustomMap` prop set to `showCommunity={true}`.
- `src/components/CustomMap.tsx` — removed `L.control.attribution(...).addTo(map)` and the tileLayer `attribution:` option; updated the `showCommunity` prop doc comment; `attributionControl: false` and layer effects unchanged.
- `src/app/globals.css` — removed the dead `.leaflet-control-attribution` rules, desktop repositioning `@media` block, and high-contrast attribution variants.

Full diff: `git diff HEAD` in `d:\ROTASEMBARREIRAS` (base branch `master`; changes uncommitted).

</details>
