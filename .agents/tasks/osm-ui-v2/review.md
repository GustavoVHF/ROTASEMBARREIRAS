# Em mapeamento v2: stable community map layer, name labels and a feedback-only sheet

The change does three things. It rewrites the community ("Em mapeamento") map layer so markers stay put while the map moves. It shows name labels on community pins. It routes "ver detalhes" for em_mapeamento points to a new `CommunityPointSheet` (bottom sheet on mobile, left side sheet on desktop). That sheet has only the condition/feedback form and a simplified "Condições recentes" list. The resource "tem/não tem" radios became square icon toggle tiles that reuse the official accessibility-chip look. Visibility from farther away is split in two: the client now asks for points from zoom 12, and a new migration (`migrations_osm_04_mapa_cluster_estavel.sql`) makes the RPC answer at zoom ≥ 12 with an edge-independent grid. `PointDetails.tsx` is untouched, so the official screen does not change.

Watch for: request 1 (points visible from far) only works in prod after the user runs migration 04 in the SQL Editor. Until then the map behaves as before below zoom 15 (confirmed, documented as a user action). The new sheet is `role="dialog"` with no focus trap and no focus return to the trigger (confirmed, not blocking).

**Verdict**: APPROVED

## High-level view

The flicker fix is client-side and does not need the migration. The layer requests a bbox padded to 2× the viewport (capped at 1.5°), skips refetching while the viewport stays inside the last fetched or in-flight area with the same zoom/category/excluded id, debounces at 300 ms, and drops stale responses by sequence number. Reconciliation now updates surviving keys in place (position, count, label) and only removes missing keys. The selected pin reuses the normal pin element and goes back to being a normal pin on deselect. Runtime evidence: an 80 px drag gives 0 removals and 0 RPC calls, and a large pan gives 0 removals of keys that are present both before and after.

Distance visibility depends on migration 04. It accepts zoom ≥ 12 and spans up to 1.5°, and it aggregates cells over a grid-aligned envelope so cluster keys, counts and centroids don't depend on where the bbox edge falls. Signature, return columns, key formats and grant match migration 02. It has not been executed. Before it runs, the client falls back on `bbox_grande_demais` by retrying with the unpadded viewport.

Community pins now always show the `.rsb-pin-label` name, capped at 160 px with an ellipsis, the same rule as official pins. Clusters keep count-only markup. The runtime harness found labels on 100 % of visible community pins and on no clusters, and High Contrast screenshots showed black/yellow.

`CommunityPointSheet` contains the header (category, name, "Em mapeamento", close, optional "Ouvir"), the plan's one-line notice (D7), the form and "Condições recentes" (a summary line, an optional consensus line per D8, then a plain list). It has no address, no "Como chegar" and no OSM block, which the runtime harness asserted. Submission keeps validation, the 280-char limit, anonymous sessions, the 7-day `RelatoError` message and the "Você pode enviar sem criar conta." line. The tiles send `"tem"` when on and omit the key when off, which `relato_recursos_validos` already accepts, so no SQL change is needed.

<details>
<summary>Issues (5)</summary>

1. **Migration 04 not executed** — zoom 12–14 visibility (request 1) is invisible in prod until the user runs `migrations_osm_04_mapa_cluster_estavel.sql` and then `npm run check:bbox`. Make sure the final handoff states this clearly. (confirmed, non-blocking)
2. **Sheet dialog focus management** — focus moves into the sheet but is not trapped and does not return to the pin/"Ver Detalhes" button on close. Consider restoring focus to the opener. (confirmed, non-blocking)
3. **Global Escape listener** — `window` keydown Escape closes the sheet even when another overlay (VLibras, RatingModal) is on top. Consider scoping it to the sheet. (likely, non-blocking)
4. **Label density at city zoom unverified** — always-on community labels at zoom 13–14 can only be seen after migration 04. Re-check density post-deploy. (likely, non-blocking)
5. **Hook-dep suppressions** — the two `eslint-disable-next-line react-hooks/exhaustive-deps` in `CommunityPointSheet` reach the "0 warnings" bar by suppression. The usage is benign: `reader` stop on voice off and on unmount. (confirmed, non-blocking)

</details>

<details>
<summary>Details</summary>

### Fetch window and reconciliation in `CommunityLayerController`

The `inFlight` containment check stops a slow request from being aborted and re-sent on every small move. The `bbox_grande_demais` retry is gated on the current sequence and a non-aborted controller, so a stale retry can't overwrite a newer response.

Selecting or deselecting changes `excludeId`, so every selection triggers one refetch (likely). Reconciliation absorbs it in place. The only visible change is a 2-point cell turning into a single pin while its sibling is selected, which is inherent to excluding the selected point server-side. Before the migration, on screens wide enough that the padded span exceeds 0.25°, `lastFetched` holds the unpadded viewport, so every pan refetches as before. This is documented in D4.

```
viewport ──pad 0.5──▶ padded (≤1.5°) ──RPC──▶ rows
   │                                   │
   └─ inside lastFetched/inFlight? ── skip
                                       ▼
                       reconcile: remove missing keys,
                       update survivors in place, add new
```

### Migration 04 grid

The cell size depends only on the zoom: 80 px at zoom ≤ 14, 56 px at 15–16. The overload-guard loop recomputes the aligned envelope whenever it doubles the cell. The truncation count is computed from the same aligned base. The individual-point path (zoom ≥ 17) still filters on the requested `v_env` rather than the aligned envelope. That is fine because those keys are per point. The SQL has only been compared by reading it, not executed, as the coder recorded.

### Em mapeamento sheet routing and content

`page.tsx` switches on `activeDetailsPoint.status === "em_mapeamento"` inside the existing `AnimatePresence`, so every entry point (preview "Ver Detalhes", desktop pin click, profile history, voice `goToPoint`) reaches the new sheet. The official branch passes the same props to `PointDetails`. Under `reduce_motion_enabled` the backdrop and sheet use initial = final with `duration: 0`. Spinners rely on the global `.reduce-motion` CSS. The backdrop `bg-black/30` is a neutral overlay in the same family as AdminModal's `bg-black/40`, not a new palette color. Relato text is rendered as JSX text and is never treated as HTML.

### Resource tiles

The tiles are `<button aria-pressed>` elements with the visible `short` label as their accessible name, a `Check` icon when on (so state is not shown by color alone), a minimum height of 88 px, and `rsb-tile:focus-visible` outline rules in both normal and High Contrast themes. They have no transition or scale. The runtime harness measured 107×92 and 166×88 px tiles and confirmed the false→true→false toggle. Reporting "não tem" is no longer possible, which matches the user asking for toggles to replace "tem ou não tem". Older `nao_tem` relatos still render through `recursosResumo` and `consensoResumo`.

### Verification evidence

VERIFICATION.md records the build passing, `test:ui` 12/12, `test:osm` 20/20, and eslint baseline parity: page.tsx 3 errors / 8 warnings before and after, all other touched and new files 0/0. It also records the map harness (mobile and desktop drag/pan, labels, High Contrast) and the sheet harness (49/49, including the official PointDetails regression and the reduce-motion placement). Nothing was written to prod. The evidence is complete and consistent with the diff, so no spot-check was run. Not tested: zoom 13 at runtime (blocked on migration 04), the voice "Ouvir" button with Voz Alta on, and actual relato submission (prod writes were deliberately avoided).

</details>

<details>
<summary>File map</summary>

- `src/components/map/communityLayer.ts`: padded/skip-refetch fetching, in-place reconcile, selected-pin reuse, `data-chave`
- `src/components/map/communityViewport.ts` (new): pure bbox helpers
- `src/components/CustomMap.tsx`: `SELECT_FOCUS_ZOOM` in both `flyTo` calls
- `src/app/globals.css`: community labels always on with ellipsis; `.rsb-choice` replaced by `.rsb-tile` High Contrast/focus rules
- `src/app/page.tsx`: routes em_mapeamento details to `CommunityPointSheet`
- `src/components/point/CommunityPointSheet.tsx` (new): bottom/side sheet with form + recent conditions
- `src/components/point/ReportResourcesFieldset.tsx`: icon toggle tiles
- `src/lib/communityResources.ts`: `short` labels, `toggleRecurso`, `recursosResumo`, `consensoResumo`
- `src/lib/relativeTime.ts` (new): "hoje/ontem/há N dias"
- `src/services/pointsService.ts`: export `CONDITION_WINDOW_DAYS`
- `supabase/migrations_osm_04_mapa_cluster_estavel.sql` (new): stable-grid RPC
- `scripts/check-community-bbox.mjs`, `scripts/ui/*.test.mjs`, `package.json`, `docs/SUPABASE_PONTOS_SETUP.md`: diagnostics, tests, scripts, docs

Full diff: `git diff` plus the untracked files listed above.

</details>
