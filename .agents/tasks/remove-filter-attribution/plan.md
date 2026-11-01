# Implementation Plan — Remove "Mostrar locais da comunidade" filter + OSM/CARTO attribution

Small, well-scoped UI change. Work directly in `d:\ROTASEMBARREIRAS` (no worktree). Do NOT commit, do NOT push.

## Context from exploration

- `CustomMap.tsx` is a client-side Leaflet component (uses `useEffect`/`useRef`, `import L from "leaflet"`). The attribution removal is pure client DOM — the non-standard Next.js guides under `node_modules/next/dist/docs/` do not affect this change. No deprecations apply.
- Design rules (AGENTS.md): clean/minimal UI, only existing brand palette, High Contrast + `reduce_motion` support, never `alert()`/`confirm()`. These changes only REMOVE elements, so no new colors/motion/dialogs are introduced.
- Build: `npm run build` = `next build`. Lint is separate (`eslint`), so pre-existing lint errors are fine for verification.

### Grep results that anchor the edits

**`showCommunity` / toggle (CHANGE 1):**
- `src/app/page.tsx:104` — `const [showCommunity, setShowCommunity] = useState(true);` (+ comment lines 102-103)
- `src/app/page.tsx:247-251` — `handleToggleCommunity` (contains the `track("filtro_aplicado", { tipo: "comunidade", ... })` call)
- `src/app/page.tsx:855-866` — the filter `<button>` (onClick `handleToggleCommunity`, `aria-pressed={showCommunity}`, `<Users ... />` icon, text "Mostrar locais da comunidade"). There is exactly ONE such control (single filter bar used for both mobile/desktop via responsive classes `xl:` on its container).
- `src/app/page.tsx:877` — `showCommunity={showCommunity}` prop on `<CustomMap ... />`
- `src/app/page.tsx:49` — `Users` imported from `lucide-react`; used ONLY by this toggle (grep confirms no other `Users` usage), so its import becomes unused and must be removed to avoid a lint-only leftover (not required for build, but clean).
- `src/components/CustomMap.tsx:19-20, 80, 258-259` — the `showCommunity` prop + its `useEffect` (`communityRef.current?.setEnabled(showCommunity)`). This plumbing STAYS; it will just always receive `true`.

**Attribution (CHANGE 2):**
- `src/components/CustomMap.tsx:125` — `L.control.attribution({ position: "bottomleft", prefix: false }).addTo(map);` (preceded by comment line 124) — REMOVE.
- `src/components/CustomMap.tsx:134-136` — the `attribution:` property inside the CartoDB `L.tileLayer(...)` options — REMOVE (keep `maxZoom`, `updateWhenZooming`, `keepBuffer` and the tile URL).
- `src/app/globals.css:946-979` — attribution CSS block (`.leaflet-control-attribution`, `.leaflet-control-attribution a`, their `.theme-high-contrast` variants) plus the `@media (min-width: 1280px) { .leaflet-bottom.leaflet-left { ... } }` rule that only repositions the attribution control. All of these style ONLY the attribution control and become dead — REMOVE.

### What must NOT break

- `communityCategory` wiring: `communityCategory={selectedCategory}` prop and the `setCategory` effect stay untouched.
- Community points keep rendering: the `showCommunity` prop and its `setEnabled` effect stay; only the user-facing toggle/state is removed and `true` is passed instead.
- Other `L.tileLayer` options (`maxZoom`, `updateWhenZooming`, `keepBuffer`) and the tile URL stay.
- Unrelated map CSS (community pins `.rsb-marker--community*`, clusters `.rsb-cluster*`, halo, relato choices) stays. Only the attribution-specific rules are removed.

---

## Steps

- [ ] 1. CHANGE 1 — Remove the community filter control and state from `src/app/page.tsx`; keep community points always on.
      Edits (all in `src/app/page.tsx`):
      - Delete the `showCommunity` state + its two comment lines (102-104): `const [showCommunity, setShowCommunity] = useState(true);`.
      - Delete the `handleToggleCommunity` handler (247-251), which also removes the `track("filtro_aplicado", { tipo: "comunidade", ... })` call.
      - Delete the filter `<button>` element (855-866) including its `<Users ... />` icon, the text "Mostrar locais da comunidade", and the preceding `<span aria-hidden ... />` vertical divider that only separated it from the category chips (confirm it is only the separator before this button).
      - Change the CustomMap prop from `showCommunity={showCommunity}` to `showCommunity={true}` (877).
      - Remove `Users` from the `lucide-react` import on line 49 (now unused). Leave all other imports intact.
      Files: `src/app/page.tsx`
      Verify: run `npm run build` after step 2 (both changes build together); expected: build succeeds. Interim check: grep `src/app/page.tsx` for `showCommunity`, `handleToggleCommunity`, `Mostrar locais da comunidade`, and `Users` — only the CustomMap `showCommunity={true}` prop should remain for `showCommunity`; the other three return no matches.

- [ ] 2. CHANGE 2 (code) — Remove the attribution control and tileLayer attribution from `src/components/CustomMap.tsx`.
      Edits (all in `src/components/CustomMap.tsx`):
      - Delete the comment (124) and the line (125): `L.control.attribution({ position: "bottomleft", prefix: false }).addTo(map);`.
      - In the CartoDB `L.tileLayer(...)` options object, delete the `attribution:` property and its string value (134-136). Keep `maxZoom`, `updateWhenZooming`, `keepBuffer`, and the tile URL unchanged.
      - Optionally tidy the stale comment on lines 119-120 that references adding attribution "abaixo" (it now describes nothing). Leave `attributionControl: false` as-is.
      Do NOT touch the `showCommunity`/`communityCategory` props or effects.
      Files: `src/components/CustomMap.tsx`
      Verify: `npm run build` — expected: build succeeds. Grep `src/components/CustomMap.tsx` for `L.control.attribution` and `attribution:` — both return no matches.

- [ ] 3. CHANGE 2 (CSS) — Remove the now-dead attribution styling from `src/app/globals.css`.
      Edits: delete the attribution rules starting at the comment `/* Atribuição "© OpenStreetMap contributors" (sempre visível). */` — i.e. `.leaflet-control-attribution`, `.leaflet-control-attribution a`, the `@media (min-width: 1280px) { .leaflet-bottom.leaflet-left { ... } }` block (only repositions the attribution control), and the two `.theme-high-contrast .leaflet-control-attribution` / `... a` rules (946-979 region).
      Do NOT remove the `MAPA — PONTOS DA COMUNIDADE` community pin/cluster rules or the `RELATO — OPÇÕES` block that follow; those are unrelated map CSS. Fix the preceding `attributionControl` comment reference in CustomMap if it still points readers to this CSS block.
      Files: `src/app/globals.css`
      Verify: `npm run build` — expected: build succeeds (CSS is bundled by `next build`). Grep `src/app/globals.css` for `attribution` and `leaflet-control-attribution` — both return no matches.

- [ ] 4. Final verification of both changes.
      Run the project's real build and the required grep confirmations.
      Files: none (verification only)
      Verify:
      - `npm run build` from `d:\ROTASEMBARREIRAS` — expected: compiles successfully (lint runs separately, so pre-existing lint errors do not fail this).
      - Grep across `src/` for `Mostrar locais da comunidade` → no matches.
      - Grep across `src/` for `L.control.attribution` → no matches.
      - Grep `src/components/CustomMap.tsx` for `attribution:` (tileLayer option) → no matches.
      - Confirm `showCommunity` still exists on CustomMap (prop + `setEnabled` effect) and is passed `true` from `page.tsx`, and that `communityCategory={selectedCategory}` wiring is unchanged.

## Notes / assumptions

- The single filter bar in `page.tsx` serves both mobile and desktop via responsive `xl:` classes on its container, so there is only one toggle occurrence to remove (grep confirmed one `handleToggleCommunity`/button). If a second occurrence surfaces during editing, remove it the same way.
- Removing the attribution control is done on the user's explicit statement of written organizational authorization; this plan proceeds on that basis per the task.
