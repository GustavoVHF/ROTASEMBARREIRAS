# Design review (rodada 3) — OSM "Em mapeamento" + relatos da comunidade

Revisado: `d:\ROTASEMBARREIRAS\.agents\tasks\osm-em-mapeamento\design.md` (Revisão 3) contra `requirements.md` e a mensagem original do usuário. Código lido nesta rodada para conferir as suposições novas: `supabase/migrations.sql` (handle_new_user, set_atualizado_em, pontos, relatos), `supabase/migrations_relato.sql`, `supabase/migrations_sugestoes.sql` (suggest_local e seus grants), `supabase/migrations_admin.sql` (is_admin e grants), `supabase/migrations_trilhas.sql` (sync_ponto_auto_trilha, trilha_pontos, cidade/xp_value), demais `migrations_*.sql` (busca de `security definer`, `create function`, `grant/revoke`, `add column`), `src/services/pointsService.ts`, `src/components/CustomMap.tsx`, `src/components/PointDetails.tsx` (chamada de `createRelato`), `src/app/admin/pontos/page.tsx`, `src/services/trailsService.ts` e todos os `from("pontos")` em `src/`, `scripts/` e `supabase/functions/`.

Os 10 findings da rodada 2 foram tratados, e conferi as correções no texto: `_osm_atualizar_mapeamento` está entre as internas revogadas; o caso P5 e a guarda no fim da migração 03 existem; CA-11 a CA-16 têm linhas no §9; `out center;` com guarda `sem_coordenadas_node` e fixture real; filtro `status = 'em_mapeamento'` em `buscar_pontos_comunidade`; desvio de retenção registrado com `pg_cron` opcional; QR da promoção calculado contra os oficiais; `p_max_itens: 149` com o pin selecionado fora da reconciliação; dois clientes isolados no teste; trigger de derivados nas cinco colunas; decisão sobre a atribuição sob o preview.

As decisões antes em aberto continuam fechadas e sem ambiguidade: script Node + RPC transacional (D-5), trigger no banco lendo `request.headers` com diagnóstico por `p_ip_esperado` e opção `desligado` (D-9), `amenity=toilets` → Lazer (D-1), consenso 365 d / ≥ 3 sessões / ≥ 70 % / N = apoiadores (D-8). Todos os caminhos do §14 são absolutos ou declarados relativos a `d:\ROTASEMBARREIRAS\`.

Sobrou um problema novo, introduzido pela própria correção do HIGH da rodada 2: a guarda P5 vai abortar a migração 03 em um banco Supabase padrão.

## Findings

### 1. HIGH — A guarda P5 aborta a migração 03 porque `suggest_local` é executável por `anon`

Onde: §2 "Regras transversais" (linha "Existentes, sem mudança") e §9 (SQL do P5, repetido como guarda fatal no fim da migração 03).

O próprio §2 afirma que o Supabase concede EXECUTE em funções novas de `public` para `anon`/`authenticated` por default privileges. Esse grant é direto ao papel `anon`, não via `PUBLIC`. Em `migrations_sugestoes.sql` (linhas 117–118) o projeto faz só:

```sql
revoke all on function public.suggest_local(text, text, double precision, double precision) from public;
grant execute on function public.suggest_local(text, text, double precision, double precision) to authenticated;
```

O `revoke … from public` não remove o grant direto a `anon` vindo das default privileges. Então `has_function_privilege('anon', 'public.suggest_local(...)', 'execute')` volta `true`. `suggest_local` é `SECURITY DEFINER` e está só em `v_auth`, não em `v_publicas`. A primeira consulta do P5 devolve `'suggest_local'` e a guarda faz `raise exception`. Resultado: a migração 03 é revertida inteira na primeira execução (passo 2 do §10), o que bloqueia (e)–(h), CA-9, CA-10 e CA-18 ("migrações rodam duas vezes sem erro"). O §9 manda o implementador parar e perguntar ao usuário nesse caso, mas a falha é previsível e não precisa dessa volta. A linha "`suggest_local` (só authenticated) … já têm privilégio explícito … não tocar" do §2 é uma suposição errada pelo mesmo motivo. `is_admin` não tem o problema porque está em `v_publicas`.

Não é falha de segurança (`suggest_local` recusa `auth.uid()` nulo com `not_authenticated`), mas trava a entrega.

Correção: na migração 03, antes da guarda P5, alinhar o privilégio à intenção documentada em `migrations_sugestoes.sql` ("Not granted to anon or public"). É uma linha aditiva, sem editar o arquivo antigo (RNF-8):

```sql
-- suggest_local: o comentário de migrations_sugestoes.sql diz "não concedido a anon",
-- mas as default privileges do Supabase concedem EXECUTE direto a anon.
revoke execute on function public.suggest_local(text, text, double precision, double precision) from anon;
```

Mover `suggest_local` da linha "Existentes, sem mudança" para uma linha "Existentes, privilégio corrigido na migração 03" (`revoke … from anon`; continua `grant … to authenticated`), e incluir no caso P4 uma chamada como `anon` a `suggest_local` esperando `42501`. Como regra geral, toda função existente que a guarda vai avaliar precisa de `revoke … from anon` (ou `from anon, authenticated`) explícito, não só `from public`. Conferi todas as `SECURITY DEFINER` de `public` nos arquivos do repositório: `handle_new_user`, `ensure_relato_identity` e `sync_ponto_auto_trilha` já recebem esse revoke no design; `is_admin` está na lista de `anon`; `suggest_local` é a única que sobra.

### 2. NIT — `out center;` contradiz o texto de RF-1.3 sem registro do desvio

Onde: §4.2 ("Verbosidade: `out center;`") × `requirements.md` RF-1.3 ("DEVE … `out center tags`").

A escolha do design é a mais segura e o pedido do usuário não fixa a verbosidade (só pede centróide). Mas os dois documentos ficam em conflito, e quem conferir a entrega contra RF-1.3 vai acusar falha. Correção: acrescentar ao §1 (ou ao §16, rodada 3) uma linha "RF-1.3 atendido com `out center;` no lugar de `out center tags;` (motivo no §4.2); a intenção do requisito, centróide em ways/relations e uma consulta só, fica igual", ou atualizar RF-1.3 no `requirements.md` para "`out center` (body)".

### 3. NIT — `pontos_comunidade_bbox` (invoker) não fixa `search_path`, e o operador `&&` de geography não está qualificado

Onde: §2.2, "Mapa por bbox com cluster": `geog && extensions.st_makeenvelope(...)::extensions.geography`.

A regra transversal de `set search_path = public, extensions` vale só para as `SECURITY DEFINER`. A bbox é `security invoker`, então herda o `search_path` da sessão do PostgREST. As funções estão qualificadas, mas o operador `&&` para `geography` mora em `extensions` e é resolvido pelo `search_path`. No Supabase padrão `extensions` costuma estar no caminho, mas isso não está garantido e não é verificado no design. Se não estiver, a chamada falha com `operator does not exist: extensions.geography && extensions.geography`. O mesmo vale para as chamadas a `f_unaccent` dentro da função (já qualificadas, sem problema). Correção: declarar `set search_path = public, extensions` também na `pontos_comunidade_bbox` (e em qualquer outra função plpgsql/sql invoker nova), ou escrever `geog operator(extensions.&&) extensions.st_makeenvelope(...)`. O caso P2 (`anon` chamando a bbox) já cobre a verificação.

## Verified Assumptions

- Todas as `SECURITY DEFINER` de `public` presentes no repositório: `handle_new_user` (`migrations.sql`), `is_admin` (`migrations_admin.sql`, `revoke from public` + `grant to authenticated, anon`), `ensure_relato_identity` (`migrations_relato.sql`), `suggest_local` (`migrations_sugestoes.sql`, `revoke from public` + `grant to authenticated`) e `sync_ponto_auto_trilha` (`migrations_trilhas.sql`). `set_atualizado_em` não é definer. Nenhuma outra definer existe nos arquivos.
- `sync_ponto_auto_trilha` foi criada com `create function` (sem `or replace`), e o trigger atual é `after insert or update of cidade`. O design usa `create or replace` e recria o trigger com `update of cidade, status`, o que funciona e mantém o vínculo na promoção. A tabela de vínculo é `public.trilha_pontos` com `on conflict (trilha_id, ponto_id) do nothing`.
- O trigger `pontos_set_atualizado_em` é `before update on public.pontos` (todas as colunas). O backfill que o desabilita é necessário para o CA-2, e o nome usado no design está certo.
- `pontos.cidade` (`not null default ''`) e `xp_value` (`not null default 10`) têm default; `qr_code_value` é `unique` e nullable; as flags `acessibilidade_*` têm default `false`. `_osm_criar` não precisa fornecer nada além do que o design lista.
- `relatos_pontos` atual: INSERT `to authenticated` com subselect inline, trigger `on_relato_insert` que faz `new.user_id := auth.uid()`. A troca pela função definer `relato_recente_existe` e a remoção da reescrita são necessárias para (f) e (g). A policy antiga de `migrations.sql` (`to anon, authenticated`) foi substituída pela de mesmo nome em `migrations_relato.sql`; a guarda de `pg_policies` pega qualquer sobra.
- RLS do INSERT anônimo: papel `authenticated`, `WITH CHECK (auth.uid() is not null and user_id = auth.uid() and not relato_recente_existe(ponto_id))`, sem policy para `anon`, sem UPDATE/DELETE. Os triggers BEFORE rodam em ordem alfabética antes do `WITH CHECK`, e uma recusa da RLS aborta o statement (revertendo o evento de origem e o insert de `profiles`).
- Consenso: `distinct on (user_id, recurso)` com `order by criado_em desc`, `ceil(0.70 * total)`. Dá 3×0 sim, 3×1 sim, 2×1 não, 4×2 não; ocultos excluídos explicitamente; N = apoiadores.
- Dedup: ≤ 60 m + `nome_similaridade ≥ 0,55` → vínculo só preenchendo vazios (`coalesce(nullif(btrim(c),''), osm)`); ≤ 150 m + (nome similar ou mesma categoria) → fila; senão cria. `ST_DWithin` sobre `geography` com GiST, `pg_trgm` sobre `nome_normalizado` com GIN, oficiais comparados sem filtro de cidade. O desvio OSM×OSM (sem o critério de categoria) está registrado para o relatório final, com reversão de uma linha.
- Idempotência: `pontos_osm` (PK por elemento) consultado primeiro; `pontos_osm_elemento_key`; `candidatos_elemento_ponto_key`; `_osm_atualizar_mapeamento` e o passo 3 só gravam quando algo muda e ignoram `osm_sincronizado_em`. A 2ª execução com o mesmo payload dá `criados = fila_novos = atualizados = fila_atualizados = 0`.
- LGPD: só `sha256(sal || '|' || ip)` em `bytea`, sal no Vault, IP só em variável local, retenção de 2 h com purga em quatro gatilhos e `pg_cron` opcional, tabela sem acesso a `anon`/`authenticated`, `p_ip_esperado` nunca gravado nem devolvido.
- `pointsService.ts` tem `rowToPoint`, `queryWithSessionRecovery` (ambos ainda não exportados; o design manda exportar), `POINTS_CACHE_VERSION = 5`, `fetchAllPontosAdmin()` sem parâmetro, `attachConditions`, `fetchRelatosForPoint` e `createRelato(pontoId, tipo, texto, userId)`. O único chamador de `createRelato` é `PointDetails.tsx` (linha ~321), e os de `fetchAllPontosAdmin` estão só em `admin/pontos/page.tsx`. As mudanças de assinatura são locais.
- `CustomMap.tsx` tem `escapeHtml` e `pinHtml` locais, como o design diz. Todos os leitores de `pontos` em `src/`, `scripts/` e `voice-token` estão na lista do §3.1. As leituras por join (`trilha_pontos → pontos(*)`, `user_scans → pontos(xp_value)`) não trazem em mapeamento, porque o trigger de trilha e a ausência de QR impedem esses vínculos. `user_searches → pontos(*)` pode trazer um ponto em mapeamento no histórico, e isso funciona, porque `rowToPoint` passa a mapear `status` e o detalhe abre na variante certa.
- Regras de UI: nenhuma cor nova; pin vazado se distingue por preenchimento; nenhum `alert`/`confirm` (erros inline, `ConfirmDialog`); HC explícito para pin, cluster, `.rsb-choice`, atribuição, abas, cards e aviso; `animate: !reduceMotion`, nenhuma transição nova. Nada de selo, pílula decorativa ou divisória de cidade.
- Verificação: (a)–(h), CA-9 a CA-17, privilégios (P1–P5), policies, diagnóstico, limpeza, `npm run test:osm`, `npm run lint`, `npm run build` e as migrações rodadas 2× estão no §9 com critérios objetivos.

## Unverified / Wrong Assumptions

- **Errado**: "`suggest_local` (só authenticated) … já têm privilégio explícito … não tocar" (§2). Com as default privileges do Supabase que o próprio §2 descreve, `anon` tem EXECUTE direto, e a guarda P5 falha (finding 1). Não rodei a consulta no banco, mas o design aceita a premissa das default privileges, e com ela a conclusão é certa.
- **Não verificado**: se `extensions` está no `search_path` das sessões do PostgREST neste projeto (finding 3).
- **Não verificável daqui** (cobertos por diagnóstico ou fallback no design): presença e posição confiável de `cf-connecting-ip`/`x-forwarded-for` em `request.headers`; leitura de `vault.decrypted_secrets` pelo dono das funções (`sal_configurado`); limite de corpo do gateway para `p_elementos` grande (irrelevante para GV); existência de `IBGE:GEOCODIGO=3127701` na relação de GV (protegida pela checagem de "0 ou mais de 1 área").
- **Não verificado**: se a verbosidade `out center tags` omitiria `lat`/`lon` de nodes. Ficou irrelevante com a troca para `out center;` (finding 2 trata só do registro do desvio).

## Verdict

1 HIGH + 0 MEDIUM → **CHANGES_REQUESTED**.
