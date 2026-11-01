# Relatório de verificação final — osm-ui-v2 (Em mapeamento v2)

Data: execução final antes do commit, branch `master`, HEAD de partida `8863fca`.

## Decisões (do plan.md)

- Limiar de zoom (D1): `MIN_COMMUNITY_ZOOM = 12` (= `minZoom` do mapa; a camada fica ligada em todos os zooms, incluindo o inicial 13). `SELECT_FOCUS_ZOOM = 15` para o `flyTo` de seleção/recentralizar (comportamento antigo).
- Grade no servidor (D2, migração 04): célula de 80 px até o zoom 14 e 56 px nos zooms 15–16; pontos individuais a partir do zoom 17; aceita `p_zoom >= 12` e até 1,5° por lado; agregação alinhada à grade (chaves/contagens independentes da borda do bbox).
- Busca no cliente (D3): bbox com margem `pad(0.5)`, limitado a 1,5°; sem nova busca enquanto a tela fica dentro da área buscada/em andamento; debounce 300 ms; `MAX_ITENS = 299`.
- Linha de aviso (D7): mantida como UMA linha discreta `role="note"`: "Informações da comunidade, ainda sem dados oficiais de acessibilidade." (sem o cartão grande).
- Consenso (D8): só uma linha de texto secundária dentro de "Condições recentes", exibida apenas quando `consenso_recursos` devolve linhas ("Relatado pela comunidade: …"); sem linhas "não verificado".
- Etiquetas (D5): pins em mapeamento sempre com nome (máx. 160 px + reticências); grupos só com número.

## Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npm run build` | PASSOU (Next 16.3.3; TypeScript ok; 39/39 páginas geradas; exit 0) |
| `npm run test:ui` | 12/12 pass, 0 fail |
| `npm run test:osm` | 20/20 pass, 0 fail |
| `npx eslint` nos 13 arquivos tocados/novos (lista abaixo) | 11 problemas (3 erros, 8 avisos), todos em `src/app/page.tsx` |
| `git show HEAD:src/app/page.tsx \| npx eslint --stdin --stdin-filename src/app/page.tsx` | 11 problemas (3 erros, 8 avisos) — idêntico ao HEAD |
| `npm run check:bbox` (somente leitura, chave anon) | zoom 13: 22/20 linhas; zoom 15: 22/20; zoom 16: 5/7; 0 diferenças na sobreposição |
| `node check.mjs` (harness Playwright temporário em `%TEMP%\rsb-e2e`) | 32/34 — as 2 falhas são 403 preexistentes (ver abaixo) |

Arquivos no lint: `src/app/page.tsx`, `src/components/CustomMap.tsx`, `src/components/map/communityLayer.ts`, `src/components/map/communityViewport.ts`, `src/components/point/ReportResourcesFieldset.tsx`, `src/components/point/CommunityPointSheet.tsx`, `src/lib/communityResources.ts`, `src/lib/relativeTime.ts`, `src/services/pointsService.ts`, `scripts/check-community-bbox.mjs`, `scripts/ui/*.test.mjs` (3). Todos exceto page.tsx: 0 erros/0 avisos. Erros de page.tsx (preexistentes, iguais ao HEAD): `set-state-in-effect` (2) e `prefer-const` (1). Nenhum erro novo.

## Check 1 — build

`npm run build` passou sem erros (exit 0).

## Check 2 — lint

Nenhum erro novo em relação ao HEAD (comparado executando o eslint sobre a versão do HEAD de page.tsx via stdin). Arquivos novos com 0/0.

## Check 3 — mapa em tempo de execução (automação de navegador DISPONÍVEL)

Ferramenta: `playwright-core@1.64.1` + Microsoft Edge headless, instalado em `%TEMP%\rsb-e2e` (fora do repo, nada no package.json), contra `npm run dev` (http://localhost:3000, Supabase de prod somente leitura). O modal de avaliação foi fechado pelo botão "Fechar avaliação" antes de cada interação.

A migração 04 JÁ ESTÁ aplicada em prod: `check:bbox` devolve linhas no zoom 13 e 0 diferenças entre dois bboxes deslocados 15 % (chaves estáveis no servidor).

Celular 390×844:
- Zoom 13 (inicial, novo limiar): 14 pins em mapeamento + 13 grupos visíveis; 14/14 pins com etiqueta de nome exibida. (Antes da mudança: 0 abaixo do zoom 15.)
- Zoom 15: 35 pins + 3 grupos.
- Arrastos pequenos (80, −80, 40 px): 5 marcadores sondados, 0 desconectados do DOM, 0 remoções no `.leaflet-marker-pane`, 0 pedidos à RPC → os MESMOS elementos DOM persistem.
- Pan grande (2 × 234 px): 1 pedido à RPC, 38 remoções, 0 remoções de chaves presentes antes E depois (nada recriado; só saíram os que deixaram a área).
- Zoom 16: 7/7 pins visíveis com etiqueta não vazia (ex.: "Churrascaria do Dorval", "Mirante Ary Menezes"); 0 etiquetas em grupos.
- Captura do zoom 13 conferida: grupos com número e pins vazados com nome, nomes longos com "…".

Console: nenhum erro do mapa/camada da comunidade/RPC. Únicos erros: `403` em `rest/v1/accessibility_preferences` (upsert em `AuthContext.tsx`) e `rest/v1/user_searches` (`recordSearch`). Nenhum desses arquivos/chamadas está no diff → preexistentes, fora do escopo. Nenhum diálogo nativo (`alert`/`confirm`) apareceu.

## Check 4 — "Ver detalhes" em mapeamento + tela oficial

Verificado em tempo de execução (mesmo harness):
- Celular: pin individual → prévia → "Ver Detalhes do Local" → `[role="dialog"]` (bottom sheet) com h2 do nome, "Em mapeamento", 1 `role="note"`, "Como está este local agora?", "Condições recentes". SEM "Endereço", "Como chegar", "Fonte: OpenStreetMap", "Segundo o OpenStreetMap", "Horário", "Telefone", "em construção".
- 5 blocos de recurso `aria-pressed`, alternam false→true→false, 107×92 px (≥ 44×44). "Enviar relato" desabilitado sem condição e habilitado após "Está tudo bem" (NADA foi enviado; sem escrita em prod). Escape fecha.
- Reduzir movimento (`reducedMotion: "reduce"`): o sheet já aparece na posição final (y 101 → 101).
- Desktop 1440×900: pin em mapeamento abre o painel lateral direto (x=0, largura 390), sem endereço/OSM/"Como chegar"; "Fechar" fecha.
- Ponto OFICIAL (desktop): abre o PointDetails de sempre com "Acessibilidade no Local", cartão de endereço e "Como chegar" (captura conferida: foto, categoria, endereço, galeria, leitor de voz). `PointDetails.tsx` não aparece no diff (inalterado).
- Roteamento: `src/app/page.tsx` renderiza `CommunityPointSheet` quando `activeDetailsPoint.status === "em_mapeamento"`, senão o mesmo `PointDetails`.

## O que NÃO foi verificado

- Envio real de relato (evitado de propósito: sem escrita em prod).
- Botão "Ouvir" com Voz Alta ligada (não exercitado no harness).
- Alto contraste nesta rodada final (verificado com capturas na rodada de implementação, ver VERIFICATION.md).

## Limpeza

Servidor de desenvolvimento parado (árvore de processos encerrada, porta 3000 livre). `%TEMP%\rsb-e2e` (harness, capturas, log) apagado.
