# Implementation Plan — OSM "Em mapeamento" + relatos da comunidade

Source of truth: `.agents/tasks/osm-em-mapeamento/design.md` (Revisão 4, APPROVED). Every item below cites the design section to implement **exactly**; do not reopen decisions D-1…D-15. Requirements IDs (RF/RNF/CA) are in `requirements.md`.

## Ground rules for the implementer (read before item 1)

- Repo: `d:\ROTASEMBARREIRAS` (Windows/PowerShell), branch `master`, no worktree. Do not commit unless the workflow/user asks.
- Real commands (from `package.json`): `npm run lint` (eslint 9, `eslint-config-next` core-web-vitals + typescript; includes `react-hooks/set-state-in-effect`), `npx tsc --noEmit`, `npm run build` (Next 16.3), `npm run generate-qr-codes`. New scripts added in item 5: `test:osm`, `sync-osm`, `test:relatos`.
- Next.js 16.3 is non-standard. Consulted `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`: `dynamic(..., { ssr: false })` only works inside Client Components (as `src/app/page.tsx` already does, `"use client"` on line 1). Next 16 renamed middleware → `src/proxy.ts` (`03-api-reference/03-file-conventions/proxy.md`); it is NOT touched. New admin pages are `"use client"` `page.tsx` with no `params`/`searchParams` (in Next 16 those are Promises — avoid them entirely, as the design says). No route handlers, no `next.config.ts` change.
- UI constraints on every new element: only brand palette (`brand`, `brand-light`, `brand-dark`, `text-main`, `text-secondary`, `accent-text`, white/gray already used) — no new colors; no decorative badges/pills/stars; mobile = existing `BottomSheet`, desktop = existing `PointDetails` side sheet; High Contrast via `.theme-high-contrast` rules (yellow/black); `reduce_motion_enabled` → no transitions / `animate: false` / `duration: 0`; NEVER `alert()`/`confirm()`/native dialogs (use inline UI or `src/components/admin/ConfirmDialog.tsx`); text pt-BR; term "Em mapeamento" (never "em construção"); NO `<input type="file">`/`capture=` added anywhere for users; no `dangerouslySetInnerHTML` in touched files.
- Supabase dashboard: agents NEVER enable extensions, Vault secrets, auth providers or run SQL against the production project. SQL files use `create extension if not exists` guards; anything needing the dashboard is a PAUSE (`send_message` severity `warning` with copy-paste instructions from design §7) — see items 4, 17.
- Secrets: `d:\ROTASEMBARREIRAS\.env.local` and `scripts/.env` (does not exist yet; user creates it) are never printed. `service_role` only in `scripts/`.

---

## Phase A — SQL migrations (dependency order 01 → 02 → 03)

- [x] 1. Create migration 01 `pontos` geo/normalization layer exactly per design §2.1 and §2 "Regras transversais".
      Contents in order: extension block (`create extension if not exists postgis|pg_trgm|unaccent with schema extensions` + schema check that raises the documented message); `mapeamento_config` (single row, RLS on, no policies, `revoke all`); `f_unaccent`, `normalizar_nome_local` (prefix list), `nome_similaridade`, `categoria_compativel` (all `set search_path = public, extensions`); new `pontos` columns + named CHECKs via `do $$ if not exists (pg_constraint)` blocks; `pontos_osm_elemento_key unique (osm_tipo, osm_id)`; GiST/GIN trgm/status indexes; trigger `pontos_derivados` (`before insert or update of nome, latitude, longitude, geog, nome_normalizado`); backfill with `pontos_set_atualizado_em` disabled/re-enabled, then `geog set not null`; `sync_ponto_auto_trilha` recreated from `migrations_trilhas.sql` body with the `status` early-return and trigger `after insert or update of cidade, status`; `pontos_osm` table + index + RLS + `pontos_osm_select_admin`; final grants block for the helpers (`anon, authenticated, service_role`) and revoke for trigger functions (`pontos_sync_derivados`, `sync_ponto_auto_trilha`). Idempotent style of `supabase/migrations_admin.sql`; no existing file edited.
      Files: `supabase/migrations_osm_01_pontos_geo.sql` (new). Read first: `supabase/migrations.sql`, `migrations_admin.sql`, `migrations_trilhas.sql` (exact trigger/function names `pontos_set_atualizado_em`, `sync_ponto_auto_trilha`).
      Verify: static review only at this point (no DB access) — every function has `set search_path = public, extensions`, every `create` is guarded/`or replace`. DB execution happens in item 4.

- [x] 2. Create migration 02 dedup + sync RPCs exactly per design §2.2.
      Contents: `candidatos_duplicidade` (+ `candidatos_elemento_ponto_key`, index, RLS + `candidatos_select_admin`); `osm_sync_execucoes` (RLS, admin select); internal definer functions `_osm_validar`, `_osm_candidatos`, `_osm_criar`, `_osm_vincular` (only-fill-empty, never `nome/categoria/coords`), `_osm_atualizar_mapeamento` (the `is distinct from` UPDATE verbatim), `_osm_criar_ou_mesclar(p_cidade, p_el, p_permitir_fila)`; `osm_sync_aplicar` (validation codes `cidade_invalida|payload_invalido|payload_grande_demais`, loop by `ordem`, steps 1–7 incl. step 3 queue refresh/discard and step 5 reopen, report keys listed in §2.2, dry-run via `P0D01` sub-block, log to `osm_sync_execucoes` + call `_purgar_origem_eventos()` outside dry-run); `admin_resolver_candidato` (`vincular|separar`, `for update`, race guard); `verificar_local_existente`; `pontos_comunidade_bbox` (security invoker, plpgsql, validation `bbox_invalida|bbox_grande_demais`, zoom<15 → empty, grid doubling ≤6×, `truncado` row, `p_excluir_id`). OSM×OSM queue uses name similarity only (deliberate deviation, §1).
      Dependency: `_purgar_origem_eventos` is created in migration 03 — plpgsql bodies are not validated at create time, so referencing it from `osm_sync_aplicar` is fine; do NOT make these functions `language sql`. `buscar_pontos_comunidade` is NOT created here (it goes in 03).
      Grants block at end per §2 table: internals revoked from `public, anon, authenticated`; `osm_sync_aplicar` service_role only; `verificar_local_existente`, `pontos_comunidade_bbox` to `anon, authenticated`; `admin_resolver_candidato` revoke `public, anon` + grant `authenticated`.
      Files: `supabase/migrations_osm_02_dedup_sync.sql` (new).
      Verify: static review; DB execution in item 4.

- [x] 3. Create migration 03 relatos comunidade exactly per design §2.3, closing in the mandated order.
      Contents: `relatos_pontos` new columns + `user_id default auth.uid()` + index; `relato_recursos_validos` + `relatos_pontos_recursos_check` (guarded); `ensure_relato_identity` replaced (no rewrite of a foreign `user_id`, forces `criado_em := now()` and `oculto := false`); `relatos_validar_texto` trigger (280 chars, link regex → `texto_muito_longo|texto_com_link`); `relato_recente_existe`, `relato_bloqueado_ate`; policies `relatos_insert_rate` (to authenticated, `user_id = auth.uid() and not relato_recente_existe`) and `relatos_select_public` (`oculto = false or is_admin()`); `relatos_origem_eventos`; `_purgar_origem_eventos`; `relatos_limite_origem` + trigger `relatos_z_limite_origem` (headers → IP by `origem_fonte`, Vault salt with fail-open `raise warning`, `sha256`, purge, advisory lock, `origem_rate_limited`); `diagnostico_origem(p_ip_esperado)`; `consenso_recursos` (SQL verbatim); `admin_ocultar_relato`; `buscar_pontos_comunidade` (status `em_mapeamento` only, `parametro_invalido`). Closing: (1) grants/revokes for functions created here; (2) `revoke execute on function public.handle_new_user() from public, anon, authenticated;` (3) `revoke execute on function public.suggest_local(text, text, double precision, double precision) from anon;` (4) `pg_policies` single-INSERT-policy guard; (5) P5 guard (§9 SQL with `raise exception`) as the LAST block.
      Files: `supabase/migrations_osm_03_relatos_comunidade.sql` (new). Read first: `migrations_relato.sql`, `migrations_sugestoes.sql`, `migrations.sql` (`handle_new_user`, existing `on_relato_insert`/policies names to drop).
      Verify: static review; DB execution in item 4.

- [~] 4. Write the SQL test files, then PAUSE for the user to do dashboard setup and run migrations + tests.
      a) `supabase/tests/osm_em_mapeamento_testes.sql`: single `begin; … rollback;`, fixtures at `lat -10.0 / lng -30.0`, `cidade='QA Teste'`, `osm_id ≥ 9000000000`, fixture users in `auth.users` + admin via `profiles.is_admin`. Cases (each a `do $$ … assert … $$`): C1–C7 (dedup/queue/merge/separar/idempotence with `atualizados=0`, `fila_atualizados=0` on 2nd run), H1 (hide → consensus drops, condition counts 2), H2 (0/2/3 relatos and 2×1 → expected consensus), S1 (`verificar_local_existente` 40 m/300 m/unrelated), T1–T4 (text), O1–O3 (origin limit with `set local request.headers`, SKIP notice without salt; diagnostic recommendations; `desligado`), P1–P5 (privileges incl. `suggest_local` as anon → 42501 and as authenticated not permission-denied; direct `_osm_atualizar_mapeamento` as anon → 42501), (g) in SQL (`set local role authenticated` + claims of A inserting `user_id = B` → 42501), policy-guard case (extra INSERT policy inside a sub-transaction → migration 03 guard raises).
      b) `supabase/tests/osm_verificacao_pos_sync.sql`: commented blocks "rodar antes" (`create schema if not exists qa; create table qa.oficiais_antes as …` + counts), "rodar depois" (counts, duplicate `group by … having count(*)>1` on `pontos`, `pontos_osm`, `candidatos_duplicidade`; column-by-column diff vs snapshot; 60 m/150 m proximity checks excluding `separado`; queue invariant query), "calibração" (§11), "promoção" (CA-14), "consumidores" (QR count = 0 for em_mapeamento), "ids para teste de relatos", "limpeza pós-teste" (§7 item 10 with placeholders, `and is_anonymous`), and final `drop schema qa cascade;`.
      c) PAUSE: `send_message` severity `warning` listing, copy-paste ready, design §7 items 1 (extensions in schema `extensions`, with relocation SQL), 2 (allow anonymous sign-ins), 3 (Vault secret `relatos_origem_sal` + PowerShell generator), 4 (run 01→02→03 in SQL Editor, then run each again to prove idempotence), then run `osm_em_mapeamento_testes.sql` and paste the output; also ask to create `scripts/.env` from `scripts/.env.example` with `OSM_CONTACT` and `SUPABASE_ANON_KEY` (§7 item 6) and to confirm the IBGE tag `3127701` on the GV relation.
      Files: `supabase/tests/osm_em_mapeamento_testes.sql`, `supabase/tests/osm_verificacao_pos_sync.sql` (new).
      Verify: user reports migrations 01–03 ran twice without error and the test file finished with no failed assert (O1 may print SKIP only if salt absent — then ask to add salt and rerun). Fix any SQL error reported and re-pause. Continue front-end items (9+) only after this; items 5–8 can be written meanwhile.

## Phase B — OSM sync script + editable type→category config

- [x] 5. Create the editable config and pure transform/overpass modules with `node:test` unit tests, and register npm scripts.
      `scripts/osm/config.mjs` verbatim from §4.2 (`OVERPASS_ENDPOINT`, `CIDADES["governador-valadares"]` with `filtrosExtras`, ordered `REGRAS` with D-1/D-2 comments in pt-BR; no `shop`/services). `scripts/osm/transform.mjs`: `buildOverpassQuery` (single query, `.a out ids;`, one `nwr[...]["name"](area.a);` per rule, regex `^(...)$` escaped, `out center;`), `classifyElement` (first matching rule; counts `sem_nome`, `sem_regra`, `sem_coordenadas`, `sem_coordenadas_node`), area checks (0 or >1 `type:"area"` → error code 4), `toPayload` (§4.4 shape, `phone ?? contact:phone`, `website ?? contact:website`), `sortByPriority` (node<way<relation, more useful tags, `osm_id`; sets `ordem`), `buildEndereco`, `sanitizeWebsite`, `sanitizePhone`. `scripts/osm/overpass.mjs`: `fetchOverpass(query, { userAgent, fetchImpl = fetch, sleep })` with retry rules of §4.3 step 4 (429/502/503/504/network/timeout/`remark`; `Retry-After` ≤300 s else 30/60/120; max 3 retries; other 4xx not retried). Tests `scripts/osm/transform.test.mjs` and `scripts/osm/overpass.test.mjs` covering every bullet of the §9 "Script OSM" row. Fixture `scripts/osm/fixtures/overpass-gv-amostra.json`: fetch once with the generated query using a small GV-center bbox instead of the area selector (curl/`Invoke-RestMethod` POST to Overpass, with User-Agent; one request only); if no network, mark the fixture test `skip` with reason. ODbL attribution comment at top of the test.
      `package.json` scripts: `"sync-osm"`, `"test:osm"`, `"test:relatos"` exactly as §4.1. `.gitignore`: add `scripts/osm/cache/`. `scripts/.env.example`: add `SUPABASE_ANON_KEY=` and `OSM_CONTACT=`.
      Files: `scripts/osm/config.mjs`, `scripts/osm/transform.mjs`, `scripts/osm/overpass.mjs`, `scripts/osm/transform.test.mjs`, `scripts/osm/overpass.test.mjs`, `scripts/osm/fixtures/overpass-gv-amostra.json` (new); `package.json`, `.gitignore`, `scripts/.env.example`.
      Verify: `npm run test:osm` — all tests pass (fixture test passes or is explicitly skipped with reason).

- [x] 6. Create the CLI `scripts/sync-osm.mjs` per §4.3 (depends on 5).
      Args `--cidade`, `--dry-run`, `--arquivo`; env checks (`exit 1`), unknown city (`exit 2`), Overpass errors (`exit 3`), area/coords/zero elements (`exit 4`), RPC error (`exit 5`, special hint for `57014`); save successful real response to `scripts/osm/cache/<slug>-<ISO>.json`; call `supabase.rpc("osm_sync_aplicar", { p_cidade, p_elementos, p_dry_run })` with a `service_role` client (`persistSession:false`), print merged JSON report. Never print keys. Follow the style of `scripts/generate-qr-codes.mjs`.
      Files: `scripts/sync-osm.mjs` (new).
      Verify: `npm run test:osm` still passes; `node scripts/sync-osm.mjs --cidade xyz` without env exits 1 with message (no network, no DB). Real/dry runs happen in item 17.

- [x] 7. Add `--dry-run` and `status='oficial'` filter to the QR script (§3.1).
      Files: `scripts/generate-qr-codes.mjs`.
      Verify: `node --check scripts/generate-qr-codes.mjs`; real `--dry-run` run is in item 17 (needs `scripts/.env`).

- [x] 8. Create the anon/RLS integration script `scripts/test-relatos-anon.mjs` per §9 rows (e)(f)(g)(h).
      Uses only `SUPABASE_URL` + `SUPABASE_ANON_KEY`; two isolated clients (`storageKey: "qa-a"|"qa-b"`, `persistSession:false, autoRefreshToken:false`) plus a session-less reader; args `--oficial <id> --mapeamento <id>` and `--verificar-oculto <relatoId>`; fixed text "Teste automatizado — pode ser ignorado."; PASS/FAIL per case, non-zero exit on failure; always prints `TEST_USER_IDS=` and `TEST_RELATO_IDS=` (in `finally`).
      Files: `scripts/test-relatos-anon.mjs` (new).
      Verify: `node --check scripts/test-relatos-anon.mjs`; execution in item 17.

## Phase C — Reports RLS on the client side (anonymous INSERT with `user_id = auth.uid()`)

The DB policy itself is migration 03 (item 3). This phase removes every client-side login gate and adapts types/services.

- [x] 9. Types, shared libs and services foundation (§3.2, §5.1 libs, §5.3, §3.1).
      `src/types/database.ts`: `PontoRow` (`status`, `origem`, `osm_tipo`, `osm_id`, `osm_*`), `RelatoRow` (`recursos`, `oculto`, `ocultado_em`), new `CandidatoDuplicidadeRow`, `ConsensoRecursoRow`, `CommunityLayerRow` (`tipo: "ponto"|"grupo"|"truncado"`), `ExistingPlaceMatch`, `PointStatus`. `src/types/point.ts`: `TouristPoint.status` + `osm`; `rowToPoint` fills them (export it if not exported). New `src/lib/communityResources.ts` (D-7 list, `OSM_VALUE_LABEL`, `formatOpeningHours`, `phoneHref`, `websiteLabel`) and `src/lib/relatoText.ts` (`RELATO_MAX_CHARS`, `RELATO_LINK_REGEX`, `validateRelatoText` with the exact pt-BR messages). `src/services/pointsService.ts`: `.eq("status","oficial")` in `fetchPointsFromNetwork` and `fetchPointByQrCode`; `POINTS_CACHE_VERSION = 6` with comment; `fetchAllPontosAdmin(status = "oficial")`; `.eq("oculto", false)` in `attachConditions` and `fetchRelatosForPoint`; export `queryWithSessionRecovery`; `PontoUpdateInput.status?`; new `createRelato({ pontoId, tipo, texto, recursos })` + `RelatoError` with the session-recovery (`signInAnonymously` once) and error mapping of §5.3 (no `user_id` sent). `src/lib/pontosPublic.ts`: `.eq("status","oficial")`. `src/lib/analytics.ts`: `relato_enviado.status_ponto`, `filtro_aplicado.tipo` accepts `"comunidade"`. Update the single existing caller of `createRelato` in `PointDetails.tsx` to the new signature (minimal change; full UI work is item 13).
      Files: listed above.
      Verify: `npx tsc --noEmit` and `npm run lint` — no errors.

- [x] 10. New community service (§3.3 service list).
      `src/services/communityPointsService.ts`: `fetchCommunityLayer` (with `.abortSignal`), `fetchCommunityPoint`, `fetchPontoById`, `fetchConsensus` (`[]` on error), `checkExistingPlace` (throws), `searchCommunityPointsForVoice` (truncates to RPC limits, `[]` on error), `rowToCommunityTouristPoint`. Uses `createClient()` from the existing supabase client module and `queryWithSessionRecovery`.
      Files: `src/services/communityPointsService.ts` (new).
      Verify: `npx tsc --noEmit`, `npm run lint`.

## Phase D — Map display (outline pin, bbox + zoom ≥15 + server cluster, filter, attribution)

- [x] 11. Community layer controller + map integration + CSS (§3.3, §3.4, §3.6).
      Move `escapeHtml` from `CustomMap.tsx` to `src/components/map/escapeHtml.ts` (import in both). New `src/components/map/communityLayer.ts`: `MIN_COMMUNITY_ZOOM = 15`, `CommunityLayerController` (own `layerGroup`, `moveend/zoomend` → 400 ms debounce, abort + `seq` stale guard, `maxItens: 149`, reconcile by `chave`, filter `truncado` with dev-only warn, `communityPinHtml` copying the exact MapPin path from `pinHtml` with `fill="none" stroke="currentColor"`, `zIndexOffset: -1000`, `role="button"`, `aria-label` "Abrir <nome>, <categoria>, em mapeamento" / "N locais da comunidade, ampliar", click + `keypress` Enter/Space like official pins, cluster `fitBounds`/`setView` with `animate: !reduceMotion`, `selectedMarker` handling, `setEnabled/setCategory/setReduceMotion/setSelected/destroy`). `src/components/CustomMap.tsx`: props `showCommunity`, `communityCategory`, `onSelectCommunityPoint` (ref), controller init/destroy, four thin effects, both `flyTo` use `Math.max(map.getZoom(), 15)`, `L.control.attribution({ position: "bottomleft", prefix: false })` + tile `attribution` string with OSM and CARTO links (keep `attributionControl: false`). `src/app/globals.css`: block "MAPA — PONTOS DA COMUNIDADE" right after "MAPA — PINS" (outline pin, hidden label except `.is-selected`/`:focus-visible`, `.rsb-cluster` 48 px, HC rules, attribution styles + `@media (min-width:1280px)` reposition + HC), no transitions.
      Files: `src/components/map/escapeHtml.ts`, `src/components/map/communityLayer.ts` (new); `src/components/CustomMap.tsx`, `src/app/globals.css`.
      Verify: `npx tsc --noEmit`, `npm run lint`, `npm run build` — pass.

- [x] 12. Page wiring: filter chip "Mostrar locais da comunidade" (on by default, not persisted), community selection, preview text (§3.5, §3.7).
      `src/app/page.tsx`: `useState(true)`; divider + chip after `CATEGORIES.map` (`aria-pressed`, existing chip classes, `Users` icon `aria-hidden`, `min-h-12`, `track("filtro_aplicado", { tipo: "comunidade", … })`); pass props to `CustomMap` (`communityCategory` = selected category or `null` for "Todos"); `handleSelectCommunityPoint` → `fetchCommunityPoint` → `handleSelectPointFromMapOrSearch`, failure → announce "Não foi possível abrir este local agora." through the existing `aria-live` region (line ~646); `SuggestLocationSheet onOpenExistingPoint` (search `points`, else `fetchPontoById`, close sheet, select). `src/components/BottomSheet.tsx`: for `status === "em_mapeamento"` replace description/chips with the single pt-BR paragraph from §3.7.
      Files: `src/app/page.tsx`, `src/components/BottomSheet.tsx`.
      Verify: `npx tsc --noEmit`, `npm run lint`, `npm run build`.

## Phase E — "Em mapeamento" point screen + report flow

- [x] 13. Point components and `PointDetails` mapping branch + report form (§5.1 components, §5.2).
      New `src/components/point/MappingNotice.tsx` (`id="aviso-mapeamento"`, `role="note"`, exact RF-4.2 text, `bg-brand-light` literal, `border border-brand rounded-3xl p-5`), `OsmInfoCard.tsx` ("Fonte: OpenStreetMap"; Horário/Telefone/Site; separate lighter "Segundo o OpenStreetMap" block for wheelchair/toilets:wheelchair), `CommunityAccessibilityCard.tsx` (5 resources via `AccessibilityDetailItem`, caption "Relatado pela comunidade (N pessoas)", default "não verificado"), `ReportResourcesFieldset.tsx` (nested fieldsets, radios `sr-only` inside `label.rsb-choice`, "Tem/Não tem/Não sei"). `globals.css`: block "RELATO — OPÇÕES" verbatim from §5.1. `src/components/PointDetails.tsx`: `AccessibilityDetailItem` gains `caption?` + sr-only state; `isMapping` branch (compact header, "Em mapeamento" text line, `<section aria-labelledby="ponto-titulo" aria-describedby="aviso-mapeamento">`, content order of §5.2, no gallery/chips/media/"Informações atualizadas"/"História"); `Promise.all([fetchRelatosForPoint, fetchConsensus])`; speech segments; remove the `isAnonymous` "Entre na sua conta…" block (line ~313); textarea for both types in mapping (only "problema" in official), `maxLength={280}`, live counter "N/280", local `validateRelatoText`, discreet "Você pode enviar sem criar conta." when `isAnonymous`, `role="alert"` inline error with `AlertTriangle text-brand`, map `RelatoError.code` messages, reload relatos + consensus after send, recent relatos list shows "Marcou: …" in plain text, `track("relato_enviado", { …, status_ponto })`. All DB text rendered through JSX only.
      Files: `src/components/point/MappingNotice.tsx`, `OsmInfoCard.tsx`, `CommunityAccessibilityCard.tsx`, `ReportResourcesFieldset.tsx` (new); `src/components/PointDetails.tsx`, `src/app/globals.css`.
      Verify: `npx tsc --noEmit`, `npm run lint`, `npm run build`; `rg -n "alert\(|confirm\(|dangerouslySetInnerHTML|type=\"file\"|capture=" src` shows no new occurrence.

- [x] 14. "Sugerir um local" pre-check (§6.5).
      `src/components/SuggestLocationSheet.tsx`: prop `onOpenExistingPoint`; in `handleSubmit` before the existing `isAnonymous` gate (A-6, unchanged), `checkExistingPlace` with status `"checking"` / "Verificando..."; match panel `role="status" aria-live="polite"` "Este local já está no mapa" + name + "Ponto oficial"/"Em mapeamento" + "a N m"; actions "Ver local" (primary `bg-brand`) and "É outro local, enviar mesmo assim" (secondary link, sets `ignorarDuplicata`); failure → proceed; reset in `resetForm`; HC/reduce-motion compliant.
      Files: `src/components/SuggestLocationSheet.tsx`.
      Verify: `npx tsc --noEmit`, `npm run lint`, `npm run build`.

## Phase F — Admin additions

- [x] 15. Admin: nav/cards, Relatos page (logical hide), Duplicidades queue, Pontos tabs + promote-in-place + create pre-check (§6.1–6.4).
      `src/app/admin/layout.tsx` `NAV_ITEMS` + `src/app/admin/page.tsx` `CARDS` (`MessageSquareText` "Relatos", `GitMerge` "Duplicidades"). New `src/services/relatosAdminService.ts` (`fetchRecentRelatos` with cursor, `hideRelato` → `admin_ocultar_relato`) and `src/services/duplicidadesAdminService.ts` (`fetchPendingCandidatos` with the FK-named embed, `resolveCandidato`). New `src/app/admin/relatos/page.tsx` and `src/app/admin/duplicidades/page.tsx` following `src/app/admin/sugestoes/page.tsx` (cards `bg-white border border-gray-200 rounded-3xl`, inline error banners `text-accent-text`, `ConfirmDialog` for hide with the §6.2 texts, "Carregar mais", "Oculto em dd/mm", duplicidades two-column text + distance/similarity/category lines, "Vincular ao ponto existente" / "Criar como ponto separado" with `aria-label`s, reload after resolve, inline `candidato_ja_resolvido`/`forbidden`). `src/app/admin/pontos/page.tsx`: tabs "Oficiais"/"Em mapeamento" (`aria-pressed`, literal `bg-brand`, no transition), mapping rows with "Fonte: OpenStreetMap" + "Promover a oficial" (`BadgeCheck`), delete confirm text for mapping, `EditState.mode` `"editar"|"promover"` with modal title/subtitle/button texts, promote payload adds `status: "oficial"` (single UPDATE by id, never INSERT), QR computed against `fetchAllPontosAdmin("oficial")` with inline failure message, `23505 qr_code_value` → inline message, `clearPointsCache()` after save; `handleCreate` pre-check via `checkExistingPlace` with inline `role="status"` panel and "Promover este ponto" / "Abrir ponto oficial" / "Cadastrar mesmo assim".
      Files: `src/app/admin/layout.tsx`, `src/app/admin/page.tsx`, `src/app/admin/pontos/page.tsx`; new `src/app/admin/relatos/page.tsx`, `src/app/admin/duplicidades/page.tsx`, `src/services/relatosAdminService.ts`, `src/services/duplicidadesAdminService.ts`.
      Verify: `npx tsc --noEmit`, `npm run lint`, `npm run build` (routes `/admin/relatos` and `/admin/duplicidades` appear in the build output).

## Phase G — Voice assistant

- [x] 16. Include community points in voice queries, always labeled non-official (§8).
      `src/services/voiceActionExecutor.ts`: `communitySummary(row)`; fallback in `get_point_info`/`get_point_history`; `community_points` in `find_points` (category + accessibility consensus filter mapping) and `list_points_in_city` (+ `community_note`); `nearby_community` in `navigate_to_nearest_point`; non-fatal failure with `voiceLog("community_search_failed", …)` from `src/lib/voice/logger.ts`. `supabase/functions/voice-token/index.ts`: official summary `.eq("status","oficial").limit(200)`, second query for `em_mapeamento` (limit 60, `count: "exact"`), separate summary text, new rule in `buildSystemInstruction` (verbatim §8), tool description additions. Docs: `docs/SUPABASE_PONTOS_SETUP.md` (table 1.1 rows + section "OSM em mapeamento" with §7 steps) and `docs/analytics-eventos.md`.
      Files: `src/services/voiceActionExecutor.ts`, `supabase/functions/voice-token/index.ts`, `docs/SUPABASE_PONTOS_SETUP.md`, `docs/analytics-eventos.md`.
      Verify: `npx tsc --noEmit`, `npm run lint`, `npm run build`. If `deno` is installed, `deno check supabase/functions/voice-token/index.ts`; otherwise state it was not type-checked. Deploy is the user's (§7 item 7).

## Phase H — Verification (design §9 checks a–h and CA-11..CA-16)

- [~] 17. Static + automated checks, then PAUSE for the user-run DB/sync/manual checks.
      Agent-run: `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run test:osm`; `rg -n "overpass" src` empty; `rg -n "alert\(|confirm\(|dangerouslySetInnerHTML|type=\"file\"|capture=" src` no new occurrences vs `git diff`; `rg -n "em construção" src` empty.
      PAUSE (`send_message` warning) with the exact ordered procedure, because these hit the production Supabase project and need `scripts/.env`, dashboard and deploys:
      1. §7 item 5 `diagnostico_origem` with `p_ip_esperado`; set `origem_fonte` if recommended; confirm `sal_configurado = true`.
      2. (b) setup: run "rodar antes" of `osm_verificacao_pos_sync.sql` (snapshot `qa.oficiais_antes`, expect 22).
      3. `npm run sync-osm -- --cidade governador-valadares --dry-run` → review counts; calibration (§11).
      4. (a) real sync, then 2nd run with `--arquivo scripts/osm/cache/<file>.json` → 2nd report `criados=0, fila_novos=0, atualizados=0, fila_atualizados=0, fila_descartados=0`; "rodar depois" duplicate queries empty.
      5. (b) diff query zero rows, `count=22`, proximity checks empty.
      6. (c) SQL test file C1–C7 already passed (item 4) + queue invariant query empty on real data; in `/admin/duplicidades` vincular 1, separar 1, rerun `--arquivo` → resolved ones do not return as `pendente`.
      7. (e)(f)(g): `npm run test:relatos -- --oficial <id> --mapeamento <id>` → all PASS; manual anon browser window, two points, no login prompt, second report blocked with "Você já relatou este ponto recentemente…".
      8. (h): hide the (e) mapping relato in `/admin/relatos`; `npm run test:relatos -- --verificar-oculto <relatoId>` PASS; UI no longer lists/counts it; H1 SQL already passed.
      9. (d) + CA-11 + CA-17: `npm run build && npm run start`, DevTools checklist of §9 rows (d), CA-11 (achromatopsia, aria-labels, zoom 14 no community pins, attribution at 390/1440 px, chip `aria-pressed="true"` keyboard toggle → no bbox calls), CA-17 (HC + reduce motion list).
      10. CA-12 (screen reader on a real mapping point; H2 SQL passed), CA-13 (suggest-sheet near an official / far away), CA-14 ("promoção" block before/after promote: same id, same counts, `trilha_pontos` row, unique QR, listed in `/pontos`, filled pin), CA-15 (sitemap/`llms.txt`/`/pontos` count = snapshot, `node --env-file=scripts/.env scripts/generate-qr-codes.mjs --dry-run`, QR count for em_mapeamento = 0), CA-16 (after `npx supabase functions deploy voice-token`: three voice questions).
      11. §7 item 10 cleanup with the printed `TEST_USER_IDS`/`TEST_RELATO_IDS`, then `drop schema qa cascade;` (destructive, user-run only).
      Fix any failure reported, re-run the relevant agent checks, re-pause until all pass.
      Final report must present to the user, as decisions to confirm: (1) OSM×OSM queue uses name similarity only (one-line reversal in §1/§2.2 step 6); (2) origin-hash retention relies on usage-triggered purge, with optional `pg_cron` (§7 item 11); (3) RF-1.3 uses `out center;` instead of `out center tags;`.
      Files: none new (fixes only).
      Verify: all agent-run commands pass; user confirms each of (a)–(h), CA-11..CA-17, P1–P5, O1–O3, T1–T4 results.

---

## Implementation notes — iteration 1 (evidence for the reviewer)

Status: items 1–3 and 5–16 implemented. Items 4 and 17 are written/agent-checked but **paused on user dashboard actions** (extensions, anonymous sign-ins, Vault salt, running migrations 01→03 twice + `supabase/tests/osm_em_mapeamento_testes.sql`, `scripts/.env`). No SQL was executed against the Supabase project by the agent. Nothing committed.

Commands run (all from `d:\ROTASEMBARREIRAS`):

| Command | Result |
|---|---|
| `npm run test:osm` | 20 tests, 20 pass, 0 fail, 0 skipped (fixture test ran against the real sample) |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 1 — 43 problems (21 errors, 22 warnings), **all pre-existing**. Per-file comparison against `HEAD` copies of every modified `src` file: identical rule/severity counts before and after (page.tsx 8 warn + 3 err, PointDetails.tsx 4 err, SuggestLocationSheet.tsx 1 err). `npx eslint` on every new `src` file + voiceActionExecutor/admin/BottomSheet/CustomMap/pointsService: exit 0 |
| `npm run build` | exit 0 (Next 16.3.3). Routes `/admin/relatos` and `/admin/duplicidades` listed. Note: until migration 01 runs, `/pontos`, sitemap and `llms.txt` prerender empty because `status` does not exist yet (expected, design §10 deploy order) |
| `node --check scripts/sync-osm.mjs`, `scripts/test-relatos-anon.mjs`, `scripts/generate-qr-codes.mjs` | exit 0 |
| `node scripts/sync-osm.mjs --cidade xyz` (no env) | prints missing vars, exit 1 |
| search `overpass` in `src` | no match |
| search `em construção` in `src` | no match |
| added lines in `git diff src` matching `alert(`/`confirm(`/`dangerouslySetInnerHTML`/`type="file"`/`capture=` | none (new files also clean) |
| `deno check supabase/functions/voice-token/index.ts` | **not run** — deno is not installed; the edge function was not type-checked |

Fixture: `scripts/osm/fixtures/overpass-gv-amostra.json` fetched once (single POST, User-Agent set) with the generated query over bbox `-18.858,-41.958,-18.846,-41.940`: 27 elements (6 node, 20 way, 1 relation), all with coordinates.

Small deviations (behavior unchanged):
- `AccessibilityDetailItem` moved to `src/components/point/AccessibilityDetailItem.tsx` (shared by `PointDetails` and `CommunityAccessibilityCard` without a circular import); it gained `caption?` and the sr-only state as designed.
- `searchCommunityPointsForVoice` catches errors itself, logs `voiceLog("community_search_failed")` and returns `[]` (design §3.3 + §8 combined).
- Migration 01 adds one extra named CHECK `pontos_osm_tags_tamanho_check` enforcing the 32/255 limits of the column table.
- Admin "Novo ponto": QR is computed against the official list also when the "Em mapeamento" tab is open (same reasoning as the promote case).

Decisions to present to the user in the final report (design §1/§2.3): (1) OSM×OSM queue uses name similarity only; (2) origin-hash retention relies on usage-triggered purge (optional `pg_cron`, §7 item 11); (3) RF-1.3 uses `out center;` instead of `out center tags;`.
