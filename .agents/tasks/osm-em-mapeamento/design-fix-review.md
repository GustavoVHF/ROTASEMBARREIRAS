# Design fix review (rodada 4, escopo restrito) — OSM "Em mapeamento"

Escopo: conferir só os 3 findings da rodada 3 (`design-review.md`) e possíveis regressões causadas por essas edições. Não é uma revisão completa nova.

Lido: `design.md` (cabeçalho, §1, §2 regras transversais e tabela de privilégios, §2.2 `pontos_comunidade_bbox`, §2.3 fechamento do arquivo 03, §4.2, §9 P4/P5, §16 Revisão 4), `requirements.md` RF-1.3, e no repositório `supabase/migrations_sugestoes.sql`, `migrations_admin.sql`, `migrations.sql`, `migrations_relato.sql`, `migrations_trilhas.sql` (todas as `security definer` existentes).

## Conferência dos findings da rodada 3

### 1. HIGH (guarda P5 x `suggest_local`): resolvido

- §2.3, "Fechamento do arquivo 03, nesta ordem": (1) grants/revokes das funções novas, (2) revoke de `handle_new_user`, (3) `revoke execute on function public.suggest_local(text, text, double precision, double precision) from anon;`, (4) guarda de `pg_policies`, (5) guarda P5 como último bloco. O revoke vem antes da guarda. O comentário diz que o `grant … to authenticated` de `migrations_sugestoes.sql` continua. A assinatura bate com `migrations_sugestoes.sql:117-118`.
- §2, tabela: `suggest_local` saiu de "Existentes, sem mudança" (agora só `is_admin`) e entrou na linha nova "Existentes, privilégio corrigido na migração 03", com o motivo (o `revoke … from public` não remove o grant direto a `anon`).
- §9 P4: chama `select public.suggest_local('QA Fixture', 'Endereço QA', -10.0, -30.0)` como `anon` esperando `42501`, e como `authenticated` sem `permission denied`. A ordem dos argumentos (nome, endereço, latitude, longitude) bate com `migrations_sugestoes.sql:48`.
- Regra geral: está escrita logo abaixo da tabela do §2 ("`revoke … from public` sozinho não basta"). A frase "Conferido no repositório" está correta: as únicas `security definer` existentes em `supabase/` são `handle_new_user` (migrations.sql:56), `ensure_relato_identity` (migrations_relato.sql:62), `sync_ponto_auto_trilha` (migrations_trilhas.sql:132), `is_admin` (migrations_admin.sql:51) e `suggest_local` (migrations_sugestoes.sql:66). As três primeiras estão na classe de trigger (revoke de `public, anon, authenticated`), `is_admin` está nas duas listas permitidas e `suggest_local` está só em `v_auth`.
- SQL do P5 (§9): `suggest_local` está em `v_auth` e não em `v_publicas`. A nota depois do bloco explica o revoke direto. Idempotência (CA-18) mantida, já que o revoke pode rodar de novo sem erro.

### 2. NIT (RF-1.3 `out center;` x `out center tags;`): resolvido

Opção de registro escolhida e aplicada de forma consistente: o §1 tem um item novo dizendo que RF-1.3 é atendido com `out center;` (motivo no §4.2) e que `requirements.md` não foi alterado. Confere: `requirements.md` RF-1.3 continua com `out center tags`. O §4.2 (query termina em `out center;`, linha "Verbosidade") e o caso "Script OSM" do §9 também usam `out center;`. O §16 (Revisão 4, item 2) diz a mesma coisa. Não há contradição entre as seções.

### 3. NIT (`search_path` em funções invoker): resolvido

- A regra transversal do §2 agora cobre toda função nova (definer ou invoker, sql ou plpgsql, trigger e helpers) com `set search_path = public, extensions`, e explica por que isso resolve o operador `&&`.
- `pontos_comunidade_bbox` (§2.2) declara explicitamente `security invoker`, `language plpgsql`, `set search_path = public, extensions`.
- Uma busca por `search_path = public` sem `, extensions` em `design.md` só achou o texto explicativo do §16. Nenhuma definição de função nova ficou com só `public`. Os helpers do §2.1 (`f_unaccent`, `normalizar_nome_local`, `nome_similaridade`, `categoria_compativel`), `pontos_sync_derivados`, `relato_recente_existe` e as funções alinhadas citadas no §16 usam `public, extensions`.
- A forma escolhida é uma só: `set search_path`, sem `operator(extensions.&&)`. Está declarado assim no §2 e no §16.

### Nota "Revisão 4" no §16

Existe (`### Revisão 4 (rodada 3 do review)`), com os três itens e os locais. O cabeçalho do documento também cita a Revisão 4.

## Regressões

Nenhuma encontrada. Verificado: a ordem do fechamento do arquivo 03 deixa a guarda P5 por último; `is_admin` continua nas duas listas permitidas; trocar `public` por `public, extensions` nas funções que não usam extensões não muda comportamento; P4 como `authenticated` aceita erro de negócio e roda dentro de `rollback`, então não sobra dado.

## Findings

Nenhum.

## Verified Assumptions

- `migrations_sugestoes.sql` faz só `revoke all … from public` + `grant execute … to authenticated` para `suggest_local(text, text, double precision, double precision)` (linhas 117–118).
- `suggest_local` recebe `(nome, endereco, latitude, longitude)`.
- As cinco funções `security definer` existentes em `supabase/` são as listadas acima. Nenhuma ficou de fora da regra geral.
- `requirements.md` RF-1.3 não foi alterado e diz `out center tags`. O desvio está registrado no design.

## Unverified / Wrong Assumptions

- Não verificado em banco real: que as default privileges do projeto Supabase de fato concedem EXECUTE direto a `anon`. Isso não importa para a correção, porque o `revoke … from anon` é inofensivo se o grant não existir, e a guarda P5 confirma o estado final.
- Nenhuma suposição incorreta encontrada.

## Verdict

0 HIGH, 0 MEDIUM → **APPROVED**.
