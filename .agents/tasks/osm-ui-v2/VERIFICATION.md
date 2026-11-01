# Verificação — osm-ui-v2

## Baseline de lint (HEAD 8863fca, antes de qualquer mudança)

`npx eslint src/app/page.tsx src/components/CustomMap.tsx src/components/map/communityLayer.ts src/components/point/ReportResourcesFieldset.tsx src/lib/communityResources.ts src/services/pointsService.ts`

| Arquivo | Erros | Avisos |
|---|---|---|
| src/app/page.tsx | 3 | 8 |
| src/components/CustomMap.tsx | 0 | 0 |
| src/components/map/communityLayer.ts | 0 | 0 |
| src/components/point/ReportResourcesFieldset.tsx | 0 | 0 |
| src/lib/communityResources.ts | 0 | 0 |
| src/services/pointsService.ts | 0 | 0 |

## Item 1 — helpers + testes

`npm run test:ui` → 12 testes, 12 pass, 0 fail (Node v24.13 carrega os .ts direto; só um aviso MODULE_TYPELESS_PACKAGE_JSON, inofensivo).

## Item 2 — migração 04

`supabase/migrations_osm_04_mapa_cluster_estavel.sql` criada. Conferida linha a linha contra a função da migração 02: mesma assinatura (8 parâmetros, mesmos defaults), mesmas 12 colunas de retorno, `language plpgsql stable security invoker`, `set search_path = public, extensions`, `#variable_conflict use_column`, mesmos formatos de chave (`p:<uuid>`, `g:<round(cell*1e7)>:<gx>:<gy>`, `truncado`), mesmo `bbox_invalida`, mesmo grant para anon/authenticated. `supabase/tests/osm_em_mapeamento_testes.sql` chama a RPC com zoom 16 e área 0,02° → continua compatível.
PENDENTE: execução pelo usuário no SQL Editor (não há banco local; nada foi executado em prod).

## Item 3 — diagnóstico da RPC atual em prod (somente leitura, chave anon)

`npm run check:bbox` (RPC da migração 02, antes da 04):

`
zoom 13: A=0 linhas, B=0 linhas, na sobreposição A=0 B=0, só em A=0, só em B=0, alteradas=0
zoom 15: A=38 linhas, B=34 linhas, na sobreposição A=26 B=26, só em A=0, só em B=0, alteradas=0
zoom 16: A=12 linhas, B=15 linhas, na sobreposição A=6 B=6, só em A=0, só em B=0, alteradas=0
Total de diferenças na sobreposição: 0
`

- Zoom 13 → 0 linhas: confirma a causa 1 (nada abaixo do zoom 15).
- Zoom 15/16 com deslocamento de 15 %: 0 diferenças nesta amostra (os grupos cortados pela borda não caíram na faixa de sobreposição). A correção no cliente (item 4) continua necessária pelas causas 2, 4 e 5.
- Pós-deploy (depois da migração 04): esperado zoom 13 com linhas e 0 diferenças.

## Itens 4/5/7/8/9 — build e lint

- `npm run build` → passou (Next 16.3.3, "Compiled successfully"), rodado de novo depois da última correção.
- `npx eslint` nos arquivos tocados/novos: page.tsx 3 erros / 8 avisos (= baseline, todos preexistentes); CustomMap.tsx, communityLayer.ts, communityViewport.ts, ReportResourcesFieldset.tsx, CommunityPointSheet.tsx, communityResources.ts, relativeTime.ts, pointsService.ts → 0 erros / 0 avisos. Nenhum erro novo.
- PointDetails.tsx NÃO foi editado (a tela oficial é a mesma; o ramo isMapping dele ficou sem uso).

## Item 6 — verificação do mapa em tempo de execução

Harness temporário em %TEMP%\rsb-e2e (playwright-core 1.64.1 + Microsoft Edge headless), app rodando com `next start` (build de produção, Supabase de prod só leitura). O modal de avaliação (RatingModal) aparece depois de uns segundos e fica POR CIMA do mapa (o textarea dele bloqueava o arrasto); o harness fecha ele pelo botão "Fechar avaliação" antes de testar.

Celular 390×844:
- zoom 13 (inicial): 0 pontos da comunidade / 0 grupos (esperado antes da migração 04: a RPC antiga devolve [] abaixo do zoom 15).
- (a) zoom 15: 53 pins da comunidade + 20 grupos.
- (b) arrasto de 80 px com o mouse (o mapa andou 80 px): 5 marcadores de teste, 0 desconectados, 0 remoções, 0 pedidos à RPC (a tela continuou dentro da área com margem).
- (c) 3 arrastos de 234 px (≈1,8× a largura): 2 pedidos à RPC; 54 remoções, todas de chaves que não aparecem mais depois (saíram da área nova); 0 remoções de chaves presentes antes E depois. Os 7 marcadores de teste foram removidos porque foram parar a ~700 px, fora da área nova (esperado).
- (d) etiquetas: zoom 15 → 16–18 pins comunitários visíveis, todos com etiqueta exibida e não vazia; zoom 16 → 7–8/7–8; 0 etiquetas em grupos.
Desktop 1440×900, zoom 15: 79 pins + 31 grupos; 47/47 etiquetas visíveis.
Capturas conferidas: zoom 15 normal (pins vazados com nome, nomes longos cortados com "…", grupos só com número); zoom 15 em alto contraste (pins/grupos pretos com contorno amarelo, etiquetas pretas com texto amarelo).

## Item 10 — verificação da tela em mapeamento + regressão do oficial

`sheet-check.mjs`: 49/49 verificações passaram.
- Celular: pin individual → prévia → "Ver Detalhes do Local" → `[role=dialog]` com h2, "Em mapeamento", 1 `role=note`; SEM "Endereço", "Como chegar", "Fonte: OpenStreetMap", "Segundo o OpenStreetMap", "Horário", "Telefone", "em construção"; 5 blocos `aria-pressed` (107×92 e 166×88 px); bloco alterna false→true→false; "Enviar relato" desabilitado sem condição e habilitado depois de "Está tudo bem"; textarea maxlength 280; Escape fecha. Nada foi enviado (sem escrita em prod).
- Reduzir movimento (emulado com `prefers-reduced-motion: reduce`, que o MotionConfig do app respeita): o sheet já aparece na posição final (y 101 → 101).
- Desktop: pin comunitário abre o painel lateral direto (x=0, largura 390), sem prévia; "Fechar" fecha; pin oficial abre o PointDetails com "Acessibilidade no Local" + cartão de endereço + "Como chegar" (sem mudança).
- Alto contraste no sheet: achei a legenda "O que você viu no local?" com contraste baixo (`legend` não entra na regra global de texto do tema) → corrigido envolvendo o texto em `<span>`; reconferido na captura (branco sobre preto; bloco ligado amarelo com texto preto e ✓).
- Nenhum diálogo nativo foi aberto em nenhum teste.
Harness e capturas apagados depois (`%TEMP%\rsb-e2e` removido).

## Item 11 — verificações finais

- `npm run build` passou; `npm run test:ui` 12/12; `npm run test:osm` 20/20.
- Lint: nenhum erro novo (ver acima).
- Busca nos arquivos tocados: nenhum `alert(`/`confirm(`, nenhum "em construção", nenhum "Mostrar locais da comunidade"; `attribution` só aparece como `attributionControl: false`.
- `git status`: só os arquivos do plano, `package.json`, docs, migração nova, scripts novos e `.agents/tasks/osm-ui-v2/*`. Nenhum arquivo .env, captura ou harness.

## Ação do usuário

1. No Supabase, abra o **SQL Editor** e rode o arquivo `supabase/migrations_osm_04_mapa_cluster_estavel.sql` (pode rodar mais de uma vez sem problema). Até rodar, os pontos em mapeamento só aparecem a partir do zoom 15, como hoje; o resto (etiquetas com o nome, mapa sem piscar, nova tela do ponto, blocos de recurso) já funciona sem a migração.
2. Depois, rode `npm run check:bbox`: o esperado é ter linhas no zoom 13 e 0 diferenças.
3. Abra o mapa em produção no zoom inicial (13) e confira: pontos/grupos aparecendo de longe e nada piscando ao arrastar.

## Status da migração 04

PENDENTE de execução pelo usuário no SQL Editor (repassado pelo orquestrador). A checagem de pontos a partir do zoom 12/13 em tempo de execução depende dela (pós-deploy: `npm run check:bbox` com linhas no zoom 13 e 0 diferenças; mapa no zoom 13 mostrando pontos/grupos). Sem ela o frontend volta ao comportamento antigo (pontos a partir do zoom 15) sem erro.
