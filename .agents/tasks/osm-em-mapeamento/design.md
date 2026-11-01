# Design técnico — Locais do OpenStreetMap "Em mapeamento" + relatos da comunidade

Base: `d:\ROTASEMBARREIRAS\.agents\tasks\osm-em-mapeamento\requirements.md` (RF/RNF/CA citados por ID). **Revisão 4**: incorpora a rodada 3 do review `design-review.md` (1 HIGH, 2 NIT), depois da rodada 2 (1 HIGH, 1 MEDIUM, 8 NIT) e da rodada 1 (1 HIGH, 5 MEDIUM, 10 NIT). As respostas às três rodadas estão no §16.

## 0. Visão geral

Os locais do OSM entram na própria tabela `public.pontos` (suposição A-1), separados dos oficiais por duas colunas: `status` (`oficial` | `em_mapeamento`), que diz como o registro é tratado, e `origem` (`oficial` | `osm`), que diz de onde ele nasceu. Toda a lógica que decide criar, vincular, mesclar ou mandar para revisão fica no Postgres, em uma RPC transacional (`osm_sync_aplicar`). Essa RPC recebe a lista de elementos já baixada e classificada por um script Node (`scripts/sync-osm.mjs`), que é o único código que fala com a Overpass. Proximidade usa PostGIS (`geography` + GiST + `ST_DWithin`) e nomes usam `pg_trgm` sobre um nome normalizado por uma função SQL única.

Os consumidores atuais (mapa, `/pontos`, sitemap, `llms.txt`, QR, script de QR, resumo do `voice-token`) passam a ler só `status = 'oficial'`. Os pontos em mapeamento chegam ao mapa por uma RPC de bounding box que já devolve os pontos agrupados (cluster por grade no servidor), só a partir do zoom 15 e só com o filtro "Mostrar locais da comunidade" ligado.

Os relatos passam a aceitar sessões anônimas. A identidade é garantida pela RLS (`user_id = auth.uid()`, sem reescrita silenciosa). O limite de 7 dias usa uma função `SECURITY DEFINER`, para que relatos ocultos continuem contando. O limite por origem roda em um trigger no banco, que lê o IP do cabeçalho repassado pelo gateway, guarda só `sha256(sal || ip)` e apaga os hashes em 2 h. O consenso por recurso é calculado no banco. O admin ganha três telas/fluxos: Relatos (ocultar), Duplicidades (fila) e Promover (na tela de Pontos, reaproveitando o mesmo registro).

### Stack (fixada)

- Banco: Supabase Postgres 17 (`supabase/.temp/postgres-version` = 17.6), extensões `postgis`, `pg_trgm` e `unaccent` no schema `extensions`, e Supabase Vault (`supabase_vault`, já presente por padrão) para o sal.
- Sincronização: Node ≥ 20.6 (já exigido por `--env-file` no script de QR), `fetch` global, `@supabase/supabase-js` (já é dependência), sem dependência nova.
- Testes do script: `node:test` embutido no Node, sem dependência nova. Testes de banco: arquivo SQL com `begin … rollback` e `assert`.
- Front: Next.js 16.3 (App Router, componentes `"use client"` como o resto do app), Leaflet 1.9.4 já instalado, framer-motion, lucide-react. **Nenhuma dependência nova.** O cluster é feito no servidor (decisão D-15, §3.3), sem `leaflet.markercluster`.
- Edge Function: só a existente `voice-token`, alterada (deploy feito pelo usuário).

Guia Next consultado: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`, `proxy.md` e `01-getting-started/05-server-and-client-components.md`. As páginas admin novas seguem exatamente o padrão das existentes: `page.tsx` com `"use client"`, sem `params`/`searchParams` (então nenhuma Promise de params entra em jogo), e servidas pelo rewrite de subdomínio do `src/proxy.ts`, que não muda. Nenhum route handler novo, nenhuma mudança em `proxy.ts`/`next.config.ts`.

## 1. Decisões principais (resolvem D-1 … D-15)

| ID | Decisão | Motivo |
|---|---|---|
| D-1 | `amenity=toilets` → **Lazer**, mantido no arquivo de config. | Nenhuma das 6 categorias descreve banheiro. "Lazer" é a mais neutra para equipamento público de praça/parque. Como D-3 descarta elementos sem nome, quase nenhum banheiro entra (raramente têm `name`). Isso fica comentado no config. |
| D-2 | `tourism=attraction` → **Lazer**, e é a última regra de turismo na ordem. | É a tag mais genérica. Ficando por último, um elemento que também tenha `historic`/`tourism=museum` fica com a categoria específica. |
| D-3 | Ignorar elementos sem `name`, já na query Overpass (`["name"]`). | Reduz o payload e não piora a deduplicação por nome. |
| D-4 | Score = `greatest(similarity(a,b), word_similarity(a,b), word_similarity(b,a))` sobre `nome_normalizado`. Limiar inicial **0,55**, guardado em `mapeamento_config.similaridade_min`. | `word_similarity` cobre nome parcial ("santo antonio" × "de santo antonio"). Como o score é mais generoso que o `similarity` puro, o limiar sobe de 0,45 para 0,55. A distância já restringe muito os falsos positivos. A calibração está no §9 (dry-run mostra `similaridade` em cada caso). |
| D-5 | **Script Node** `scripts/sync-osm.mjs` + RPC transacional. Sem Edge Function. | (1) Backoff exigido (30 + 60 + 120 s + até 180 s de consulta) passa do tempo de parede de uma Edge Function. (2) Mesmo padrão de `generate-qr-codes.mjs` (`scripts/.env`, `service_role` fora de `src/`). (3) Dá para rodar à mão nos testes (a)–(c) e com arquivo local (RNF-11). (4) Não precisa de `pg_cron` nem de deploy. Contra: não agenda sozinho. A lógica de banco fica toda na RPC, então uma Edge Function futura só chamaria a mesma RPC. |
| D-6 | Zoom mínimo **15** (`MIN_COMMUNITY_ZOOM` no cliente). A RPC também devolve vazio abaixo de 15. | Mapa abre em 13 e o `flyTo` usa 15. A dupla checagem impede carga pesada mesmo chamando a RPC direto. |
| D-7 | 5 recursos fixos: `entrada` "Entrada sem degraus ou com rampa", `banheiro` "Banheiro adaptado", `braille` "Braille ou sinalização tátil", `libras` "Atendimento em Libras", `atendimento` "Atendimento preparado para PCD". **"Áudio guia" removido.** | Áudio guia é raro em locais comuns e um visitante não consegue observar. As chaves ficam em uma lista no TS (`src/lib/communityResources.ts`) e uma no SQL (`relato_recursos_validos`). |
| D-8 | Janela 365 dias, último relato de cada `user_id` por recurso, mínimo 3 sessões, vencedor ≥ 70%, N = apoiadores do vencedor. Tudo em `mapeamento_config`. | Regra padrão dos requisitos (3×0 ✓, 3×1 ✓, 2×1 ✗, 4×2 ✗). |
| D-9 | **Trigger no banco** lendo `current_setting('request.headers', true)`. Fonte configurável (`mapeamento_config.origem_fonte`, padrão `cf-connecting-ip`, com fallback para o 1º item de `x-forwarded-for`), validada pelo usuário com a RPC `diagnostico_origem(p_ip_esperado)` (§7 item 5), com a opção `'desligado'` se nenhuma fonte for confiável. | Só o banco não pode ser contornado: a INSERT policy tem que continuar aberta para `authenticated` (pedido do usuário), então uma Edge Function ou rota Next poderia ser ignorada com um POST direto no PostgREST. Comparação no §5.4. |
| D-10 | Sal no **Supabase Vault** (`relatos_origem_sal`), lido pelo trigger `SECURITY DEFINER`. Sem sal: **fail-open** com `RAISE WARNING`. | Falta de configuração não pode bloquear todos os relatos. O limite de 7 dias continua valendo. |
| D-11 | Mostrar também "É outro local, enviar mesmo assim" (ação secundária). | O casamento por nome tem falso positivo. A ação principal continua sendo "Ver local". |
| D-12 | Tela em mapeamento mantém "Como chegar", leitura em voz alta (que lê o aviso) e relatos. Favoritar não existe hoje na tela de detalhe, então nada é adicionado. | Mantém a tela simples (RF-4.8). |
| D-13 | SearchBar fora do escopo (só oficiais). | Não foi pedido. |
| D-14 | Tabela de vínculo `pontos_osm` (PK `osm_tipo, osm_id`) para todos os elementos OSM ligados a um ponto, mais colunas `osm_tipo`/`osm_id` (UNIQUE juntas) em `pontos` para o elemento primário. | Unicidade real de todo elemento (RF-1.10), e o pedido literal ("guarde em cada registro osm_id e osm_tipo com unicidade") é atendido. `ponto_id` nulo = elemento ignorado (ponto excluído pelo admin), assim a exclusão não "volta" na próxima sincronização. |
| D-15 | **Cluster por grade no servidor** dentro da RPC de bbox (sem plugin). | Sem dependência nova nem CSS de terceiros (cores do plugin fogem da paleta). O DOM fica limitado por construção (a RPC recalcula com célula maior até ficar ≤ 150 itens), e só pontos visíveis trafegam. A grade é ancorada em coordenadas absolutas, então os grupos não "pulam" ao arrastar no mesmo zoom. |

Outras decisões que o implementador não precisa tomar:

- Retenção dos hashes de origem: **2 h** (requisito pede ≤ 24 h e a janela de contagem é 1 h).
- Persistência do filtro "Mostrar locais da comunidade": **não persiste** (estado de sessão, padrão ligado). Ler `localStorage` no render do `page.tsx` causaria hydration mismatch, e a regra de lint `react-hooks/set-state-in-effect` impede sincronizar por efeito.
- Validação de texto do relato: **trigger BEFORE INSERT**, não CHECK. Um CHECK `NOT VALID` ainda é avaliado em UPDATE, e ocultar um relato antigo que tenha link falharia.
- OSM×OSM (RF-2.6): mesma regra de 60 m + nome similar (mescla) e 150 m **com nome similar** (fila). O critério "mesma categoria" NÃO se aplica entre dois elementos OSM, porque restaurantes/igrejas vizinhos no OSM são, por padrão, lugares distintos e cada um tem seu id. Com esse critério, a fila encheria de falsos casos. **Isto é um desvio deliberado** do pedido literal ("a mesma verificação"): o relatório final da implementação deve apresentá-lo ao usuário como decisão a confirmar. Reversão simples: no passo 6 do algoritmo (§2.2), trocar `sim ≥ similaridade_min` por `sim ≥ similaridade_min or mesma_cat`.
- Verbosidade da consulta Overpass: RF-1.3 é atendido com `out center;` (body) no lugar de `out center tags;` (motivo no §4.2: em `tags` não está garantido que nodes tragam `lat`/`lon`). A intenção do requisito (centróide em ways/relations, uma consulta só por cidade) fica igual; `requirements.md` não foi alterado, e quem conferir RF-1.3 deve ler este item.
- Um ponto em mapeamento já existente não é reavaliado contra oficiais criados depois. Para isso não acontecer, o cadastro admin faz a mesma pré-checagem e oferece "Promover este ponto" (§6.3).

## 2. Banco de dados (migrações novas)

Três arquivos novos, nessa ordem, todos idempotentes (`if not exists`, `create or replace`, `drop … if exists` + `create`, constraints nomeadas criadas em bloco `do $$ … if not exists (select 1 from pg_constraint …)`), no estilo de `migrations_admin.sql`. Nenhum arquivo existente é editado.

1. `d:\ROTASEMBARREIRAS\supabase\migrations_osm_01_pontos_geo.sql`
2. `d:\ROTASEMBARREIRAS\supabase\migrations_osm_02_dedup_sync.sql`
3. `d:\ROTASEMBARREIRAS\supabase\migrations_osm_03_relatos_comunidade.sql`

Regras transversais:

- Todas as funções **novas** (`SECURITY DEFINER` ou `security invoker`, `language sql` ou `plpgsql`, inclusive as de trigger e helpers) declaram `set search_path = public, extensions` (PostGIS e pg_trgm moram em `extensions`; com só `public` elas quebrariam). Isso vale em especial para `pontos_comunidade_bbox` (invoker): sem a cláusula, ela herdaria o `search_path` da sessão do PostgREST, e o operador `&&` de `geography` (que mora em `extensions` e é resolvido pelo `search_path`, não pela qualificação das funções) poderia não ser encontrado. Chamadas a PostGIS/pg_trgm/unaccent continuam qualificadas (`extensions.st_dwithin`, …); operadores não são qualificados, e a cláusula `set search_path` é o que os resolve.
- O Supabase concede EXECUTE em funções novas de `public` para `anon`/`authenticated` por default privileges. Toda função recebe privilégio **explícito**, segundo esta classificação fechada (cada migração termina com o bloco de grants/revokes das funções que cria):

  | Classe | Funções | Privilégio | Motivo |
  |---|---|---|---|
  | Helpers puros (chamados por trigger invoker, CHECK ou RPC invoker) | `f_unaccent(text)`, `normalizar_nome_local(text)`, `nome_similaridade(text,text)`, `categoria_compativel(text,text)` | `grant execute … to anon, authenticated, service_role` — **nunca revogar** | `pontos_sync_derivados` roda como `authenticated` no cadastro/edição admin; `pontos_comunidade_bbox` (invoker) roda como `anon`. |
  | Helper de CHECK | `relato_recursos_validos(jsonb)` | `grant execute … to authenticated, service_role` | O EXECUTE de função em CHECK é verificado para quem insere. |
  | Funções de trigger | `pontos_sync_derivados`, `relatos_validar_texto`, `relatos_limite_origem`, `ensure_relato_identity`, `sync_ponto_auto_trilha`, e a existente `handle_new_user` (só `revoke`, sem redefinir; feito na migração 03) | `revoke execute … from public, anon, authenticated` | O EXECUTE de função de trigger só é checado no `CREATE TRIGGER`; revogar é inofensivo e evita chamada direta. `handle_new_user` entra aqui porque é `SECURITY DEFINER` em `migrations.sql` sem revoke, e o caso P5 (§9) a acusaria. |
  | Internas de sincronização | `_osm_validar`, `_osm_criar`, `_osm_vincular`, `_osm_atualizar_mapeamento`, `_osm_candidatos`, `_osm_criar_ou_mesclar`, `_purgar_origem_eventos` | `revoke … from public, anon, authenticated` (sem grant) | Só chamadas por funções definer do mesmo dono. `_osm_atualizar_mapeamento` reescreve nome/categoria/coordenadas de pontos em mapeamento sem validar: exposta, seria uma RPC pública de escrita. |
  | Só serviço | `osm_sync_aplicar` | `revoke … from public, anon, authenticated; grant … to service_role` | Chamada apenas pelo script. |
  | Públicas | `verificar_local_existente`, `pontos_comunidade_bbox`, `consenso_recursos`, `buscar_pontos_comunidade`, `diagnostico_origem` | `grant … to anon, authenticated` | Mapa, detalhe, sugestão, voz, diagnóstico. |
  | Só `authenticated` | `relato_recente_existe`, `relato_bloqueado_ate`, `admin_resolver_candidato`, `admin_ocultar_relato` | `revoke … from public, anon; grant … to authenticated` | As admin checam `is_admin()` dentro. |
  | Existentes, sem mudança | `is_admin` (anon + authenticated, `migrations_admin.sql`) | não tocar | Já tem privilégio explícito para os dois papéis. Está nas duas listas permitidas do P5. |
  | Existentes, privilégio corrigido na migração 03 | `suggest_local(text, text, double precision, double precision)` (`migrations_sugestoes.sql`) | `revoke execute … from anon` (aditivo, sem editar o arquivo antigo); o `grant execute … to authenticated` existente continua | `migrations_sugestoes.sql` só fez `revoke … from public`, o que não remove o EXECUTE concedido **direto** a `anon` pelas default privileges do Supabase. Sem este revoke, a guarda P5 acusaria `suggest_local` e reverteria a migração 03. Fica só na lista permitida de `authenticated` do P5. |

  Regra geral para funções existentes: toda função já existente que a guarda P5 avalia e que não deve ser executável por `anon` (ou por `authenticated`) precisa de `revoke execute … from anon` (ou `from anon, authenticated`) **explícito**; `revoke … from public` sozinho não basta, porque as default privileges do Supabase concedem EXECUTE direto a esses papéis. Conferido no repositório: `handle_new_user`, `ensure_relato_identity` e `sync_ponto_auto_trilha` já recebem `revoke … from public, anon, authenticated` (classe de trigger); `is_admin` é permitida para `anon`; `suggest_local` é a única que precisava da correção acima.

  Regra de manutenção: toda função `SECURITY DEFINER` nova em `public` tem que aparecer nesta tabela. O caso P5 (§9) não depende da tabela: ele lista toda definer de `public` executável por `anon`/`authenticated` fora das listas permitidas e falha, então uma omissão futura é pega mesmo que a tabela esteja errada. A migração 03 termina com esse mesmo bloco como guarda (`raise exception`, fatal, revertendo a migração), além do caso de teste.
- Tabelas novas: `enable row level security` sempre. As internas não têm policy nenhuma, mais `revoke all … from anon, authenticated`.
- Erros de negócio: `raise exception using errcode = 'P0001', message = '<codigo_snake_case>'`. O PostgREST devolve isso como HTTP 400 com `code: "P0001"` e `message: "<codigo>"`, que o cliente mapeia por `message`.

### 2.1 `migrations_osm_01_pontos_geo.sql`

**Pré-checagem.** Um bloco `do $$` cria as extensões (`create extension if not exists postgis with schema extensions;`, idem `pg_trgm` e `unaccent`) e, em seguida, verifica em `pg_extension` + `pg_namespace` se as três estão no schema `extensions`. Se alguma estiver em outro schema (por exemplo `public`, porque foi habilitada antes manualmente), ele aborta com `raise exception 'Extensão % está no schema %, esperado extensions. Ver docs/SUPABASE_PONTOS_SETUP.md §OSM.'`. Isso é fatal e intencional: as funções abaixo dependem dos nomes qualificados. A correção (feita pelo usuário, §7 item 1) é documentada em `SUPABASE_PONTOS_SETUP.md`: `pg_trgm` e `unaccent` são realocáveis (`alter extension pg_trgm set schema extensions;`, idem `unaccent`). PostGIS não é: se estiver em `public` e nada depender dele (`select * from pg_depend` não lista colunas/objetos do usuário; na prática, nenhuma tabela usa `geometry`/`geography` hoje), `drop extension postgis; create extension postgis with schema extensions;`. Se houver dependências, parar e pedir ajuda.

**Config única** (`public.mapeamento_config`, uma linha):

```sql
create table if not exists public.mapeamento_config (
  id boolean primary key default true check (id),
  similaridade_min numeric(3,2) not null default 0.55,
  dist_vinculo_m integer not null default 60,
  dist_revisao_m integer not null default 150,
  consenso_min_sessoes integer not null default 3,
  consenso_fracao_min numeric(3,2) not null default 0.70,
  consenso_janela_dias integer not null default 365,
  relatos_por_origem_hora integer not null default 40,
  origem_retencao_horas integer not null default 2,
  origem_fonte text not null default 'cf-connecting-ip'
    check (origem_fonte in ('cf-connecting-ip','xff-primeiro','xff-ultimo','desligado'))
);
insert into public.mapeamento_config (id) values (true) on conflict (id) do nothing;
alter table public.mapeamento_config enable row level security;  -- sem policies
revoke all on public.mapeamento_config from anon, authenticated;
```

A edição é feita pelo Table Editor ou SQL Editor. Quem lê são só as funções definer.

**Normalização de nome.** Fica em um único lugar e cobre RF-2.2:

```sql
create or replace function public.f_unaccent(text) returns text
language sql immutable strict parallel safe
set search_path = public, extensions
as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, $1) $$;

create or replace function public.normalizar_nome_local(p text) returns text
language plpgsql immutable parallel safe
set search_path = public, extensions
as $$
declare base text; s text;
begin
  if p is null then return ''; end if;
  base := lower(public.f_unaccent(p));
  base := btrim(regexp_replace(regexp_replace(base, '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g'));
  -- Lista de prefixos genéricos (editar aqui; depois rodar o refresh abaixo).
  -- Ordem: multi-palavra antes de palavra única.
  s := regexp_replace(base,
    '^(centro cultural|igreja matriz|mercado municipal|praca|igreja|paroquia|capela|catedral|santuario|museu|parque|teatro|biblioteca|restaurante|cafeteria|cafe|mercado|mirante|cachoeira|pico|galeria)\y( (de|do|da|dos|das|e))?\s*',
    '');
  s := btrim(s);
  return case when s = '' then base else s end;   -- "Praça" sozinho continua "praca"
end $$;

create or replace function public.nome_similaridade(a text, b text) returns real
language sql stable parallel safe
set search_path = public, extensions
as $$ select greatest(extensions.similarity(a,b), extensions.word_similarity(a,b), extensions.word_similarity(b,a)) $$;

create or replace function public.categoria_compativel(p_oficial text, p_osm text) returns boolean
language sql immutable parallel safe
set search_path = public, extensions
as $$ select coalesce(p_osm,'') <> '' and
  lower(public.f_unaccent(coalesce(p_oficial,''))) like '%' || lower(public.f_unaccent(p_osm)) || '%' $$;
```

`categoria_compativel` reproduz a semântica do filtro do mapa (RF-2.7: "Patrimônio" casa com "Patrimônio Histórico").

**Colunas novas em `pontos`** (`add column if not exists`):

| Coluna | Tipo | Regra |
|---|---|---|
| `status` | text not null default `'oficial'` | check `pontos_status_check in ('oficial','em_mapeamento')` |
| `origem` | text not null default `'oficial'` | check `pontos_origem_check in ('oficial','osm')` |
| `osm_tipo` | text null | check `pontos_osm_tipo_check in ('node','way','relation')` |
| `osm_id` | bigint null | check `pontos_osm_par_check ((osm_tipo is null) = (osm_id is null))` |
| `osm_wheelchair`, `osm_toilets_wheelchair` | text null | ≤ 32 caracteres (truncado na RPC) |
| `osm_opening_hours`, `osm_phone` | text null | ≤ 255 |
| `osm_website` | text null | check `pontos_osm_website_check (osm_website is null or osm_website ~* '^https?://')`, que impede `javascript:` em link |
| `osm_sincronizado_em` | timestamptz null | |
| `nome_normalizado` | text not null default `''` | mantido por trigger |
| `geog` | `extensions.geography(Point,4326)` null → not null após backfill | mantido por trigger |

Constraint `pontos_osm_elemento_key unique (osm_tipo, osm_id)` (vários NULL são permitidos). Índices: `pontos_geog_gist using gist (geog)`, `pontos_nome_norm_trgm using gin (nome_normalizado extensions.gin_trgm_ops)` e `pontos_status_idx (status)`.

**Trigger de derivados** (escolhido no lugar de coluna gerada: `unaccent` não é imutável de fábrica, e o trigger deixa a lista de prefixos editável):

```sql
create or replace function public.pontos_sync_derivados() returns trigger
language plpgsql set search_path = public, extensions as $$
begin
  new.geog := extensions.st_setsrid(extensions.st_makepoint(new.longitude, new.latitude), 4326)::extensions.geography;
  new.nome_normalizado := public.normalizar_nome_local(new.nome);
  return new;
end $$;
drop trigger if exists pontos_derivados on public.pontos;
create trigger pontos_derivados before insert or update of nome, latitude, longitude, geog, nome_normalizado
  on public.pontos for each row execute procedure public.pontos_sync_derivados();
```

`geog` e `nome_normalizado` estão na lista de colunas para que um `UPDATE pontos set geog = …` direto (por exemplo de um admin pelo PostgREST) também dispare o trigger, que recalcula sempre a partir de `nome`/`latitude`/`longitude` (a fonte da verdade, RF-2.1). O valor enviado nessas duas colunas é sempre descartado.

**Backfill sem mexer em `atualizado_em` dos 22 oficiais** (necessário para o CA-2):

```sql
alter table public.pontos disable trigger pontos_set_atualizado_em;
update public.pontos set
  geog = extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography,
  nome_normalizado = public.normalizar_nome_local(nome)
where geog is null or nome_normalizado = '';
alter table public.pontos enable trigger pontos_set_atualizado_em;
alter table public.pontos alter column geog set not null;
```

Comentário no arquivo: depois de editar a lista de prefixos, rodar esse mesmo bloco trocando o `where` por `where true`.

**Trilha automática só para oficiais** (RF-3.3): `create or replace function public.sync_ponto_auto_trilha()` com o mesmo corpo de `migrations_trilhas.sql` e, logo no início, `if new.status is distinct from 'oficial' then return new; end if;`. O trigger é recriado como `after insert or update of cidade, status`, então a promoção (UPDATE de `status`) vincula a trilha.

**Vínculo de elementos OSM** (D-14):

```sql
create table if not exists public.pontos_osm (
  osm_tipo text not null check (osm_tipo in ('node','way','relation')),
  osm_id bigint not null check (osm_id > 0),
  ponto_id uuid references public.pontos(id) on delete set null,  -- null = ignorar (ponto excluído)
  papel text not null check (papel in ('primario','secundario','vinculado')),
  criado_em timestamptz not null default now(),
  primary key (osm_tipo, osm_id)
);
create index if not exists pontos_osm_ponto_idx on public.pontos_osm (ponto_id);
alter table public.pontos_osm enable row level security;
-- policy pontos_osm_select_admin: for select to authenticated using (public.is_admin())
```

A policy de SELECT pública de `pontos` não muda: o bbox e o detalhe precisam ler `em_mapeamento` como anon.

### 2.2 `migrations_osm_02_dedup_sync.sql`

**Fila de revisão:**

```sql
create table if not exists public.candidatos_duplicidade (
  id uuid primary key default gen_random_uuid(),
  osm_tipo text not null check (osm_tipo in ('node','way','relation')),
  osm_id bigint not null,
  cidade text not null,
  nome text not null,
  categoria text not null,
  latitude double precision not null,
  longitude double precision not null,
  elemento jsonb not null,               -- payload normalizado (§4.4), usado ao resolver
  ponto_existente_id uuid not null references public.pontos(id) on delete cascade,
  distancia_m numeric(8,1) not null,
  similaridade numeric(4,3) not null,
  mesma_categoria boolean not null,
  status text not null default 'pendente'
    check (status in ('pendente','vinculado','separado','descartado')),
  resolvido_por uuid references auth.users(id) on delete set null,
  resolvido_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint candidatos_elemento_ponto_key unique (osm_tipo, osm_id, ponto_existente_id)
);
create index if not exists candidatos_status_idx on public.candidatos_duplicidade (status, distancia_m);
```

RLS: `candidatos_select_admin` (select, `is_admin()`). Não há policy de escrita, porque as escritas só acontecem pelas RPCs. O status `descartado` (acréscimo aos três dos requisitos) marca as outras linhas do mesmo elemento quando ele é resolvido contra um ponto diferente.

**Log de execuções:** `public.osm_sync_execucoes (id bigint identity pk, cidade text, dry_run boolean, relatorio jsonb, executado_em timestamptz default now())`, com RLS e select só para admin. É gravada pela RPC (exceto no dry-run).

**Funções internas** (`SECURITY DEFINER`, EXECUTE revogado de `public, anon, authenticated`). Todas recebem o elemento `p_el jsonb` no formato do §4.4:

- `_osm_validar(p_el jsonb) returns jsonb`: devolve o elemento saneado ou `null` se inválido. Regras: `osm_tipo` ∈ {node, way, relation}; `osm_id` inteiro > 0; `nome` com `btrim` e 1–200 caracteres; `categoria` ∈ {Patrimônio, Cultura, Lazer, Gastronomia, Natureza, Religião}; `lat` ∈ [-90, 90] e `lng` ∈ [-180, 180], ambos finitos; tags de texto truncadas (32/255); `website` vira `null` se não casar `^https?://`; `phone` mantém só `[0-9+()\- ]` e vira `null` se ficar sem dígito; `endereco` ≤ 255 ou `null`.
- `_osm_criar(p_cidade text, p_el jsonb) returns uuid`: `insert into pontos (nome, categoria, cidade, latitude, longitude, endereco, status, origem, osm_tipo, osm_id, osm_*, osm_sincronizado_em) values (…, 'em_mapeamento', 'osm', …)` + `insert into pontos_osm (…, papel 'primario')`. `qr_code_value` fica nulo e os flags `acessibilidade_*` ficam com os defaults (`false`).
- `_osm_vincular(p_ponto_id uuid, p_el jsonb, p_papel text)`: preenche **apenas campos vazios**. Para cada coluna c em (`endereco`, `osm_wheelchair`, `osm_toilets_wheelchair`, `osm_opening_hours`, `osm_phone`, `osm_website`): `c = coalesce(nullif(btrim(c),''), <valor osm>)`. Se `pontos.osm_tipo` é nulo, grava o par do elemento nele (é o "vincule o osm_id ao ponto oficial"), com papel efetivo `vinculado`. Senão, só `pontos_osm` com papel `secundario`. O `UPDATE` só é emitido se algum valor realmente mudar (`where … and (<alguma coluna vazia> and <valor osm não nulo>)`), e é isso que mantém a idempotência e não mexe em `atualizado_em` à toa. `nome`, `categoria`, coordenadas e campos de cadastro nunca entram no SET. Sempre faz `insert into pontos_osm … on conflict (osm_tipo, osm_id) do nothing`.
- `_osm_atualizar_mapeamento(p_ponto_id uuid, p_el jsonb) returns boolean`: só para `status = 'em_mapeamento'` e com o elemento como primário. `nome`, `categoria`, `latitude` e `longitude` são sempre sobrescritos pelo OSM (nunca nulos depois de `_osm_validar`). `endereco` e as tags `osm_*` só são sobrescritos quando o valor do OSM **não é nulo** (`coalesce(v.x, p.x)`), para não desfazer o que um elemento secundário preencheu. O `UPDATE` só acontece se algo mudar, e `osm_sincronizado_em` fica fora da comparação (senão toda linha "mudaria"). Devolve `found` (contagem `atualizados` × `inalterados`):

```sql
update public.pontos p set
  nome = v.nome, categoria = v.categoria, latitude = v.lat, longitude = v.lng,
  endereco               = coalesce(v.endereco, p.endereco),
  osm_wheelchair         = coalesce(v.wheelchair, p.osm_wheelchair),
  osm_toilets_wheelchair = coalesce(v.toilets_wheelchair, p.osm_toilets_wheelchair),
  osm_opening_hours      = coalesce(v.opening_hours, p.osm_opening_hours),
  osm_phone              = coalesce(v.phone, p.osm_phone),
  osm_website            = coalesce(v.website, p.osm_website),
  osm_sincronizado_em    = now()
where p.id = p_ponto_id and p.status = 'em_mapeamento'
  and (p.nome, p.categoria, p.latitude, p.longitude, p.endereco, p.osm_wheelchair,
       p.osm_toilets_wheelchair, p.osm_opening_hours, p.osm_phone, p.osm_website)
      is distinct from
      (v.nome, v.categoria, v.lat, v.lng, coalesce(v.endereco, p.endereco),
       coalesce(v.wheelchair, p.osm_wheelchair), coalesce(v.toilets_wheelchair, p.osm_toilets_wheelchair),
       coalesce(v.opening_hours, p.osm_opening_hours), coalesce(v.phone, p.osm_phone),
       coalesce(v.website, p.osm_website));
return found;
```

  (`v` é o registro extraído de `p_el` via `jsonb_to_record`.) Consequência aceita: uma tag removida no OSM não é apagada do ponto em mapeamento (mesma política do A-5 para elementos removidos).
- `_osm_criar_ou_mesclar(p_cidade text, p_el jsonb, p_permitir_fila boolean) returns jsonb`: encapsula os passos 6–7 do algoritmo abaixo (checagem OSM×OSM e criação), para ser reaproveitada por `admin_resolver_candidato('separar')`. Com `p_permitir_fila = false` (uso do admin), o caso "fila" do passo 6 é pulado: a decisão do admin já resolveu a ambiguidade, e só a mescla ≤ 60 m + nome similar continua valendo. Devolve `{"acao":"mesclado"|"fila"|"criado", "ponto_id": uuid|null}`.
- `_osm_candidatos(p_geog geography, p_nome_norm text, p_categoria text, p_status text, p_raio int) returns table(ponto_id uuid, dist double precision, sim real, mesma_cat boolean)`:

```sql
select p.id, extensions.st_distance(p.geog, p_geog), public.nome_similaridade(p.nome_normalizado, p_nome_norm),
       public.categoria_compativel(p.categoria, p_categoria)
from public.pontos p
where p.status = p_status
  and (p_status = 'oficial' or p.origem = 'osm')
  and extensions.st_dwithin(p.geog, p_geog, p_raio)
order by 2;
```

**RPC de sincronização** `public.osm_sync_aplicar(p_cidade text, p_elementos jsonb, p_dry_run boolean default false) returns jsonb`. É `SECURITY DEFINER` e tem `grant execute … to service_role` apenas.

Validação de entrada (todas fatais, nada é gravado): `p_cidade` com `btrim` 1–80 caracteres, senão `cidade_invalida`; `jsonb_typeof(p_elementos) = 'array'`, senão `payload_invalido`; `jsonb_array_length` ≤ 10000, senão `payload_grande_demais`.

Algoritmo, com os elementos iterados em `order by (e->>'ordem')::int` (a ordem de prioridade vem do script, §4.3):

1. `v := _osm_validar(e)`. Se for nulo, `invalidos++` e passa para o próximo.
2. **Já conhecido?** `select ponto_id, papel from pontos_osm where (osm_tipo, osm_id) = (v.tipo, v.id)`.
   - Linha existe e `ponto_id` é nulo → `ignorados_excluidos++` e passa.
   - Ponto `em_mapeamento` e papel `primario` → `_osm_atualizar_mapeamento` (`atualizados++` ou `inalterados++`).
   - Caso contrário (ponto oficial, promovido ou elemento secundário) → `_osm_vincular(ponto, v, 'secundario')`, ou seja, só preenche vazios (`inalterados++` / `atualizados++`).
   - Passa para o próximo.
3. **Já está na fila?** Se existir em `candidatos_duplicidade` alguma linha do elemento com status `pendente`, as linhas `pendente` são atualizadas (`nome`, `categoria`, `latitude`, `longitude`, `elemento`, `distancia_m`, `similaridade`, `mesma_categoria`), com distância, similaridade e categoria recalculadas contra o ponto existente. `atualizado_em = now()` só entra quando algum desses valores muda (`is distinct from`), e só então conta `fila_atualizados++`. Em seguida, as linhas `pendente` que **deixaram de atender** à regra da fila (`distancia_m > dist_revisao_m`, ou `similaridade < similaridade_min` e não `mesma_categoria`; para pontos existentes `em_mapeamento`, só o critério de nome) viram `descartado` (`fila_descartados++`). Se ainda sobrar alguma `pendente` → passa para o próximo. Se não sobrar nenhuma → segue para os passos 4–7 com o elemento, como se fosse novo. Isso mantém o invariante de (c) válido. Linhas `descartado` sem `pontos_osm` são normais (descarte automático acima) e não impedem nada. Status `vinculado`/`separado` sem `pontos_osm` não deveria acontecer (as RPCs gravam os dois juntos). Se acontecer, o elemento é tratado como "ignorados_decididos" e passa, sem criar nada.
4. `g := geography(v)`, `n := normalizar_nome_local(v.nome)`, `cfg := mapeamento_config`.
5. **Contra oficiais** (`_osm_candidatos(g, n, v.categoria, 'oficial', cfg.dist_revisao_m)`):
   - Existe linha com `dist ≤ dist_vinculo_m` e `sim ≥ similaridade_min` → vincula à de maior `sim` (desempate por menor `dist`) com `_osm_vincular(…, 'vinculado')`, conta `vinculados_oficial++` e passa.
   - Senão, para cada linha com `sim ≥ similaridade_min` ou `mesma_cat` → `insert into candidatos_duplicidade … on conflict (osm_tipo, osm_id, ponto_existente_id) do update set …, status = 'pendente', atualizado_em = now() where candidatos_duplicidade.status in ('pendente','descartado')`. Reabrir uma linha `descartado` é seguro: o descarte por resolução de irmão sempre vem com `pontos_osm` gravado, e esse elemento já sai no passo 2. Se alguma linha foi inserida ou reaberta, conta `fila_novos++` (uma vez por elemento). Passa.
Passos 6–7 = `_osm_criar_ou_mesclar(p_cidade, v, p_permitir_fila => true)`:

6. **Contra OSM em mapeamento** (`_osm_candidatos(g, n, v.categoria, 'em_mapeamento', cfg.dist_revisao_m)`, que inclui os criados neste mesmo lote, porque o loop é sequencial):
   - `dist ≤ dist_vinculo_m` e `sim ≥ similaridade_min` → `_osm_vincular(ponto, v, 'secundario')` e `mesclados_osm++`.
   - Senão, se `p_permitir_fila`, linhas com `sim ≥ similaridade_min` (sem o critério de categoria, ver §1 e §16 finding 13) → fila, como no passo 5.
7. Sem correspondência → `_osm_criar(p_cidade, v)` e `criados++`.

O relatório final (`jsonb`) traz: `recebidos`, `invalidos`, `criados`, `atualizados`, `inalterados`, `vinculados_oficial`, `fila_novos`, `fila_atualizados`, `fila_descartados`, `mesclados_osm`, `ignorados_excluidos`, `ignorados_decididos`, `dry_run`. Fora do dry-run, a RPC também chama `_purgar_origem_eventos()` (retenção de hashes, finding 8). Fora do dry-run, ele também é gravado em `osm_sync_execucoes`.

**Atomicidade e dry-run.** Uma chamada RPC é uma transação: qualquer exceção desfaz tudo (RF-1.13). O dry-run envolve o loop em um bloco `begin … raise exception using errcode = 'P0D01', message = 'dry_run'; exception when sqlstate 'P0D01' then return v_relatorio || '{"dry_run":true}'; end;`. A subtransação do bloco é revertida e o relatório volta mesmo assim, então o dry-run não grava nada (nem log).

**Resolução da fila (admin):** `public.admin_resolver_candidato(p_candidato_id uuid, p_acao text) returns jsonb`. É `SECURITY DEFINER` com grant para `authenticated`.

- Se não for `is_admin()` → `42501` / `forbidden`.
- `p_acao` fora de {`vincular`, `separar`} → `acao_invalida`.
- Candidato inexistente → `candidato_nao_encontrado`. Candidato com status ≠ `pendente` → `candidato_ja_resolvido`. Todos esses erros são recuperáveis, e a UI mostra mensagem inline.
- `vincular`: `_osm_vincular(ponto_existente_id, elemento, 'vinculado')`. A linha vira `vinculado` e as outras `pendente` do mesmo elemento viram `descartado`.
- `separar`: `_osm_criar_ou_mesclar(cidade, elemento, p_permitir_fila => false)`. Se outro elemento OSM já virou ponto `em_mapeamento` a ≤ 60 m com nome similar, o elemento é vinculado a ele como `secundario` (nenhum pin novo) e a resposta é `{acao:'separar', ponto_id:<existente>, mesclado:true}`. Senão cria o ponto (`mesclado:false`). Nos dois casos a linha vira `separado` e as outras do elemento também (`separado`).
- Grava `resolvido_por = auth.uid()` e `resolvido_em = now()`. Devolve `{acao, ponto_id}`.
- Guarda contra corrida: `select … for update` na linha do candidato. Se `pontos_osm` já tiver o elemento (corrida com uma sincronização), a ação é tratada como vincular ao ponto que já está em `pontos_osm`, e `on conflict do nothing` evita a duplicata.

**Pré-checagem de local existente** (RF-2.11 e cadastro admin): `public.verificar_local_existente(p_nome text, p_latitude double precision, p_longitude double precision) returns table (ponto_id uuid, nome text, categoria text, status text, distancia_m integer)`. É `SECURITY DEFINER` (lê a config), `stable`, com grant para `anon, authenticated`. Validação: `btrim(p_nome)` com 1–120 caracteres, senão `invalid_nome`; coordenadas no intervalo e não nulas, senão `invalid_coords`. Devolve até 3 pontos `status in ('oficial','em_mapeamento')` com `st_dwithin(geog, ponto, dist_revisao_m)` e `nome_similaridade ≥ similaridade_min`, ordenados por `sim desc, dist asc`.

**Mapa por bbox com cluster** (RF-3.5–3.7): `public.pontos_comunidade_bbox(p_oeste, p_sul, p_leste, p_norte double precision, p_zoom integer, p_categoria text default null, p_excluir_id uuid default null, p_max_itens integer default 150)`. Devolve `table (tipo text, chave text, ponto_id uuid, nome text, categoria text, latitude double precision, longitude double precision, quantidade integer, sul double precision, oeste double precision, norte double precision, leste double precision)`. É `security invoker` (`pontos` é público), `stable`, `language plpgsql`, com `set search_path = public, extensions` (regra transversal do §2: resolve o operador `&&` de `geography`, que fica em `extensions`), e grant para `anon, authenticated`.

- Validação: algum parâmetro de bbox nulo ou `oeste ≥ leste`/`sul ≥ norte` → `bbox_invalida`. `leste - oeste > 0.25` ou `norte - sul > 0.25` → `bbox_grande_demais`. `p_zoom < 15` → nenhuma linha. `p_zoom` > 19 → 19. `p_max_itens` limitado a 20..300. `p_categoria` com `btrim`, até 40 caracteres, normalizada com `lower(f_unaccent())`. O filtro é `lower(f_unaccent(categoria)) like '%'||cat||'%'`, a mesma semântica do filtro do mapa.
- Base: `status = 'em_mapeamento' and geog && extensions.st_makeenvelope(oeste,sul,leste,norte,4326)::extensions.geography` (usa o GiST), excluindo `p_excluir_id`, com `limit 3000`.
- Célula: `cell = 360.0 / (256 * 2^zoom) * 64` graus (≈ 300 m no zoom 15). Com zoom ≥ 18, os pontos saem individuais **se** a base tiver ≤ `p_max_itens` pontos; senão, a grade é aplicada também (começando pela célula do zoom 18). O plpgsql conta as células distintas (`floor(lng/cell)`, `floor(lat/cell)`) e, enquanto passar de `p_max_itens`, dobra a célula (máximo 6 iterações, ou seja, até 64× a célula inicial). Com isso a contagem de elementos no DOM fica limitada por construção (CA-4).
- Truncamento: se, depois das dobras, ainda houver mais de `p_max_itens` células, ou a base bater no `limit 3000`, a saída é cortada em `p_max_itens - 1` linhas e recebe uma linha final `tipo = 'truncado'` (`chave 'truncado'`, `quantidade` = itens omitidos, demais colunas nulas). O `CommunityLayerController` ignora essa linha no desenho e faz `console.warn` só em dev. Na prática não ocorre em GV (centenas de pontos, bbox ≤ 0,25°).
- Saída: células com 1 ponto → `tipo 'ponto'`, `chave 'p:'||id`, com nome/categoria/coordenadas reais. Células com mais de 1 → `tipo 'grupo'`, `chave 'g:'||round(cell*1e7)||':'||gx||':'||gy` (o tamanho final da célula entra na chave, então mudar o zoom troca as chaves dos grupos), `quantidade`, centróide médio e extremos (`min/max lat/lng`) para o `fitBounds`. `limit p_max_itens`.

**Busca para o assistente de voz** (RF-6.1). A função é especificada aqui, mas **criada no arquivo 03**, depois de `consenso_recursos`, porque funções `language sql` validam o corpo na criação. `public.buscar_pontos_comunidade(p_texto text default null, p_cidade text default null, p_latitude double precision default null, p_longitude double precision default null, p_raio_m integer default 2000, p_limite integer default 5, p_categoria text default null)`. É `SECURITY DEFINER` (consenso + config), `stable`, com grant para `anon, authenticated`.

- Base: `from public.pontos p where p.status = 'em_mapeamento'`. Oficiais nunca saem desta função (o executor já os busca pelo caminho existente; sem o filtro, um oficial voltaria rotulado como não oficial no §8).
- Devolve `table (ponto_id, nome, categoria, cidade, endereco, latitude, longitude, distancia_m integer, osm_wheelchair, osm_toilets_wheelchair, osm_opening_hours, osm_phone, osm_website, consenso jsonb)`.
- Limites: `p_texto` ≤ 120 (filtro `nome_similaridade(nome_normalizado, normalizar_nome_local(p_texto)) ≥ 0.35`); `p_cidade` ≤ 80 (filtro `like` sem acento); `p_categoria` com `btrim`, ≤ 40 (vazio = sem filtro), mesma semântica do bbox: `lower(f_unaccent(categoria)) like '%' || lower(f_unaccent(p_categoria)) || '%'`; parâmetros de texto acima do limite → `raise … message = 'parametro_invalido'`; `p_raio_m` limitado a 100..10000 (só se lat/lng vierem); `p_limite` limitado a 1..10.
- Ordem: distância (com coordenadas) ou similaridade.
- `consenso` = `jsonb_agg` das linhas de `consenso_recursos(ponto_id)` (§2.3), ou `[]`.

### 2.3 `migrations_osm_03_relatos_comunidade.sql`

**Colunas em `relatos_pontos`:**

```sql
alter table public.relatos_pontos
  add column if not exists recursos jsonb,
  add column if not exists oculto boolean not null default false,
  add column if not exists ocultado_em timestamptz,
  add column if not exists ocultado_por uuid references auth.users(id) on delete set null;
alter table public.relatos_pontos alter column user_id set default auth.uid();
create index if not exists relatos_pontos_user_ponto_idx on public.relatos_pontos (user_id, ponto_id, criado_em desc);
```

`public.relato_recursos_validos(jsonb) returns boolean` (immutable): `null` é válido. Fora isso, precisa ser objeto JSON com chaves ⊆ {`entrada`, `banheiro`, `braille`, `libras`, `atendimento`}, valores ∈ {`tem`, `nao_tem`} e no máximo 5 chaves. Constraint `relatos_pontos_recursos_check check (public.relato_recursos_validos(recursos))`. As linhas antigas têm `null`, então não há risco de violação.

**Identidade, sem reescrita** (RF-5.3). `ensure_relato_identity()` é substituída com `create or replace`, e o trigger `on_relato_insert` é mantido:

```sql
begin
  if new.user_id is null then new.user_id := auth.uid(); end if;   -- redundante ao default
  -- Nunca reescrever um user_id diferente: a RLS recusa (42501).
  if new.user_id is not null and new.user_id = auth.uid() then
    insert into public.profiles (id, full_name)
    values (new.user_id, (select coalesce(raw_user_meta_data->>'full_name', nullif(split_part(email,'@',1),''))
                          from auth.users where id = new.user_id))
    on conflict (id) do nothing;
  end if;
  new.criado_em := now();           -- impede retroagir a data para fugir dos 7 dias
  new.oculto := false; new.ocultado_em := null; new.ocultado_por := null;  -- cliente não insere já oculto
  return new;
end;
```

**Validação de texto** (RF-5.7): trigger `relatos_validar_texto` BEFORE INSERT, função `public.relatos_validar_texto()`.

- Normaliza `texto := nullif(btrim(new.texto), '')`.
- Se `char_length > 280` → `raise … message = 'texto_muito_longo'`.
- Se casar `~* '(https?://|www\.|\m[a-z0-9-]+\.(com|net|org|br|io|me|info|biz|xyz|app|site|online|ly|gl|co|link|tk|ru)\M)'` → `texto_com_link`.
- A mesma regex existe em TS (`src/lib/relatoText.ts`, com `\b`).

**Limite de 7 dias que conta relatos ocultos** (RF-5.4). Dentro de uma policy, um subselect em `relatos_pontos` passa pela própria policy de SELECT, que agora filtra `oculto = false`. Por isso a checagem vai para uma função definer:

```sql
create or replace function public.relato_recente_existe(p_ponto_id uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.relatos_pontos r
    where r.ponto_id = p_ponto_id and r.user_id = auth.uid() and r.criado_em > now() - interval '7 days');
$$;
revoke execute on function public.relato_recente_existe(uuid) from public, anon;
grant execute on function public.relato_recente_existe(uuid) to authenticated;

create or replace function public.relato_bloqueado_ate(p_ponto_id uuid) returns timestamptz
language sql stable security definer set search_path = public, extensions as $$
  select max(r.criado_em) + interval '7 days' from public.relatos_pontos r
  where r.ponto_id = p_ponto_id and r.user_id = auth.uid() and r.criado_em > now() - interval '7 days';
$$;   -- mesmo revoke/grant; usado pelo cliente para distinguir o 42501
```

**Policies** (RF-5.2, RF-5.10):

```sql
drop policy if exists "relatos_insert_rate" on public.relatos_pontos;
create policy "relatos_insert_rate" on public.relatos_pontos
  for insert to authenticated
  with check (auth.uid() is not null and user_id = auth.uid()
              and not public.relato_recente_existe(ponto_id));

drop policy if exists "relatos_select_public" on public.relatos_pontos;
create policy "relatos_select_public" on public.relatos_pontos
  for select to anon, authenticated
  using (oculto = false or public.is_admin());
```

Não há policy de INSERT para `anon`, nem de UPDATE/DELETE para ninguém (continua append-only; ocultar é feito por RPC).

Guarda contra policies permissivas que sobraram (policies se combinam por OR, e uma criada à mão anularia o (g)). No final da migração 03:

```sql
do $$ begin
  if exists (select 1 from pg_policies
             where schemaname = 'public' and tablename = 'relatos_pontos'
               and cmd in ('INSERT','ALL') and policyname <> 'relatos_insert_rate') then
    raise exception 'Há outra policy de INSERT/ALL em relatos_pontos; remova-a (ver pg_policies) e rode de novo.';
  end if;
end $$;
```

É fatal de propósito: a migração inteira é revertida e o usuário remove a policy extra no painel (Authentication → Policies) antes de repetir. Sessões anônimas do Supabase usam o papel `authenticated` (com `is_anonymous` no JWT), então passam pela policy, que é o requisito.

Ordem de execução no INSERT: os triggers BEFORE rodam em ordem alfabética (`on_relato_insert`, `relatos_validar_texto`, `relatos_z_limite_origem`) e depois vem o `WITH CHECK`. Com `user_id` forjado, nenhum trigger toca nele e a RLS recusa com 42501 (CA-7). O evento de origem gravado pelo trigger é revertido junto, porque o statement aborta.

**Limite por origem** (RF-5.5, 5.6; D-9, D-10):

```sql
create table if not exists public.relatos_origem_eventos (
  id bigint generated always as identity primary key,
  origem_hash bytea not null,
  criado_em timestamptz not null default now()
);
create index if not exists relatos_origem_hash_idx on public.relatos_origem_eventos (origem_hash, criado_em);
create index if not exists relatos_origem_criado_idx on public.relatos_origem_eventos (criado_em);
alter table public.relatos_origem_eventos enable row level security;   -- sem policies
revoke all on public.relatos_origem_eventos from anon, authenticated;
```

`public.relatos_limite_origem()` é `SECURITY DEFINER`, `set search_path = public, extensions`, e roda no trigger `relatos_z_limite_origem` BEFORE INSERT. Passos:

1. `h := nullif(current_setting('request.headers', true), '')::jsonb`. Se for nulo (SQL Editor ou service_role sem cabeçalho) → `return new` (sem limite, de propósito).
2. IP conforme `cfg.origem_fonte`:
   - `cf-connecting-ip` → `h->>'cf-connecting-ip'`, com fallback para o 1º item de `x-forwarded-for`.
   - `xff-primeiro` → `btrim(split_part(h->>'x-forwarded-for', ',', 1))`.
   - `xff-ultimo` → o último item.
   - `desligado` → `return new` (fail-open explícito, escolhido pelo usuário quando o diagnóstico não acha fonte confiável, §7 item 5).
   - Valor vazio → `return new`.
3. Sal: `select decrypted_secret from vault.decrypted_secrets where name = 'relatos_origem_sal'` dentro de `begin … exception when undefined_table or insufficient_privilege then v_sal := null; end`. Se o sal for nulo ou tiver menos de 16 caracteres → `raise warning 'relatos_origem_sal ausente: limite por origem desativado'` (log do Postgres, nível WARNING) e `return new` (fail-open).
4. `v_hash := sha256(convert_to(v_sal || '|' || v_ip, 'UTF8'))`. É função nativa do PG ≥ 11, então não precisa de pgcrypto. O IP só existe nessa variável local e nunca é gravado nem logado.
5. `perform public._purgar_origem_eventos();` (retenção curta, sem `pg_cron`).

`public._purgar_origem_eventos() returns void` (`SECURITY DEFINER`, `set search_path = public, extensions`, interna): `delete from relatos_origem_eventos where criado_em < now() - make_interval(hours => (select origem_retencao_horas from mapeamento_config where id))`. Para que os hashes não passem das 2 h mesmo sem relatos novos, ela também é chamada por `osm_sync_aplicar` (fora do dry-run), `admin_ocultar_relato` e `diagnostico_origem`. Esses gatilhos cobrem o uso real do sistema sem agendamento. O limite de 24 h do RNF-7 só seria excedido se ninguém relatar, sincronizar ou moderar por mais de um dia; nesse caso existem no máximo hashes de até 40 eventos/h, nenhum IP em texto, e o próximo uso os apaga. **Isto é um desvio do "DEVE" de RF-5.6/RNF-7** e o relatório final da implementação deve apresentá-lo ao usuário, junto com o desvio OSM×OSM (§1), como decisão a confirmar. Para fechar o desvio sem tornar o núcleo dependente de agendamento, o §7 item 11 traz um passo **opcional** do usuário: habilitar `pg_cron` e agendar `_purgar_origem_eventos()` de hora em hora. Com ou sem ele, o comportamento do trigger é o mesmo.
6. `perform pg_advisory_xact_lock(hashtextextended(encode(v_hash,'hex'), 0))` serializa a mesma origem. Em READ COMMITTED, a contagem a seguir já vê os commits.
7. Se `count(*)` com o mesmo hash e `criado_em > now() - interval '1 hour'` for ≥ `cfg.relatos_por_origem_hora` → `raise exception using errcode='P0001', message='origem_rate_limited'`.
8. `insert into relatos_origem_eventos (origem_hash) values (v_hash); return new;`

Observação LGPD no arquivo: o espaço IPv4 é pequeno, então o hash só protege enquanto o sal for secreto. Por isso o sal fica no Vault, fora do repositório e fora de `.env.local`.

**Diagnóstico do cabeçalho** (validação do D-9, sem expor IP): `public.diagnostico_origem(p_ip_esperado text default null) returns jsonb`, `SECURITY DEFINER`, grant para `anon, authenticated`.

- `p_ip_esperado`: opcional; o IP público do próprio usuário (visto em um serviço de "qual é meu IP"). Validação: `btrim`, ≤ 45 caracteres, e `p_ip_esperado::inet` dentro de `begin … exception when invalid_text_representation` → se inválido, `raise … message = 'ip_invalido'`. Nunca é gravado, devolvido nem logado; só é comparado.
- Devolve apenas booleanos e contagens:
  - `tem_cf_connecting_ip`, `tem_x_real_ip`, `xff_qtd_itens`;
  - `cf_e_sentinela` / `xff_primeiro_e_sentinela` / `xff_ultimo_e_sentinela` (compara com o literal `203.0.113.9`, IP de documentação);
  - `cf_igual_esperado` / `xff_primeiro_igual_esperado` / `xff_ultimo_igual_esperado` (`null` quando `p_ip_esperado` não veio; comparação por `inet`, então formatos IPv6 equivalentes casam);
  - `fonte_atual` (valor de `mapeamento_config.origem_fonte`) e `fonte_recomendada`: a primeira de `cf-connecting-ip`, `xff-primeiro`, `xff-ultimo` que é **igual ao esperado e não é o sentinela**; se nenhuma, `'desligado'`; `null` sem `p_ip_esperado`;
  - `sal_configurado`, calculado com **a mesma consulta e o mesmo `begin … exception`** do trigger (mesmo dono, mesmo privilégio), então reflete exatamente o que o trigger vê.
- Chama `_purgar_origem_eventos()`.

Uso no §7 item 5.

**Consenso** (RF-5.9): `public.consenso_recursos(p_ponto_id uuid) returns table (recurso text, estado text, apoiadores integer, total integer)`. É `SECURITY DEFINER` (ignora a RLS, mas filtra `oculto` explicitamente e lê a config), `stable`, com grant para `anon, authenticated`.

```sql
with cfg as (select * from public.mapeamento_config where id),
marcas as (
  select distinct on (r.user_id, k.key) r.user_id, k.key as recurso, k.value as estado
  from public.relatos_pontos r
  cross join lateral jsonb_each_text(coalesce(r.recursos, '{}'::jsonb)) k, cfg
  where r.ponto_id = p_ponto_id and r.oculto = false and r.user_id is not null
    and r.criado_em > now() - make_interval(days => cfg.consenso_janela_dias)
    and k.value in ('tem','nao_tem')
  order by r.user_id, k.key, r.criado_em desc
),
agg as (select recurso, estado, count(*)::int n from marcas group by 1,2),
tot as (select recurso, sum(n)::int total from agg group by 1)
select a.recurso, a.estado, a.n, t.total
from agg a join tot t using (recurso), cfg
where t.total >= cfg.consenso_min_sessoes
  and a.n >= ceil(cfg.consenso_fracao_min * t.total);
```

Com fração ≥ 0,5 só pode haver um vencedor por recurso. Recursos ausentes no resultado = "não verificado".

**Ocultar** (RF-5.11): `public.admin_ocultar_relato(p_relato_id uuid) returns void`, `SECURITY DEFINER`, grant para `authenticated`. Sem `is_admin()` → `42501`/`forbidden`. Faz `update … set oculto = true, ocultado_em = now(), ocultado_por = auth.uid() where id = p_relato_id and oculto = false`. Se nenhuma linha mudou e o id não existe → `relato_nao_encontrado`. Se já estava oculto → no-op (idempotente). Nunca apaga. No fim, chama `_purgar_origem_eventos()`.

Por fim, este arquivo cria `buscar_pontos_comunidade` (§2.2).

**Fechamento do arquivo 03, nesta ordem:** (1) bloco de grants/revokes das funções criadas aqui; (2) `revoke execute on function public.handle_new_user() from public, anon, authenticated;` (3) a correção de `suggest_local`, **antes** da guarda P5:

```sql
-- suggest_local: o comentário de migrations_sugestoes.sql diz "não concedido a anon",
-- mas as default privileges do Supabase concedem EXECUTE direto a anon
-- (o revoke ... from public de lá não remove esse grant).
revoke execute on function public.suggest_local(text, text, double precision, double precision) from anon;
-- o grant ... to authenticated de migrations_sugestoes.sql continua valendo (não é tocado).
```

(4) guarda de `pg_policies` (uma única policy de INSERT); (5) guarda P5 (§9), que tem que ser o último bloco. O `revoke` é idempotente, então a migração continua rodando duas vezes sem erro (CA-18).

## 3. Mapa

### 3.1 Consumidores existentes passam a ler só oficiais (RF-3.2, CA-15)

- `d:\ROTASEMBARREIRAS\src\services\pointsService.ts`
  - `fetchPointsFromNetwork` e `fetchPointByQrCode` ganham `.eq("status", "oficial")`.
  - `POINTS_CACHE_VERSION = 6` (com comentário "v6: status + osm").
  - `fetchAllPontosAdmin(status: PointStatus = "oficial")` ganha `.eq("status", status)` e, para `em_mapeamento`, `.order("nome").limit(2000)`.
- `d:\ROTASEMBARREIRAS\src\lib\pontosPublic.ts`, `fetchPublicPontos`: `.eq("status", "oficial")` (cobre `/pontos`, `/pontos/[slug]`, sitemap e `llms.txt`).
- `d:\ROTASEMBARREIRAS\scripts\generate-qr-codes.mjs`: `.eq("status", "oficial")`, e uma flag `--dry-run` (`process.argv.includes("--dry-run")`) que só imprime `Would generate N QR code(s)` e a lista, sem gravar PNG (usada no CA-15, §9).
- `voice-token`: ver §8.
- `attachConditions` e `fetchRelatosForPoint`: `.eq("oculto", false)` explícito, porque um admin logado no app leria os ocultos via `is_admin()`.
- **Ordem de deploy obrigatória:** migrações antes do deploy do app, já que o filtro `status` falha se a coluna não existir (§10).

### 3.2 Tipos

`d:\ROTASEMBARREIRAS\src\types\database.ts`:

- `PontoRow` ganha `status: "oficial" | "em_mapeamento"`, `origem: "oficial" | "osm"`, `osm_tipo`, `osm_id: number | null` e as colunas `osm_*` (`string | null`).
- `RelatoRow` ganha `recursos: Partial<Record<CommunityResourceKey, "tem" | "nao_tem">> | null`, `oculto: boolean` e `ocultado_em: string | null`.
- Novos: `CandidatoDuplicidadeRow`, `ConsensoRecursoRow { recurso: CommunityResourceKey; estado: "tem" | "nao_tem"; apoiadores: number; total: number }`, `CommunityLayerRow` (saída do bbox) e `ExistingPlaceMatch`.

`d:\ROTASEMBARREIRAS\src\types\point.ts`: `TouristPoint` ganha `status: "oficial" | "em_mapeamento"` e `osm: { wheelchair: string | null; toiletsWheelchair: string | null; openingHours: string | null; phone: string | null; website: string | null } | null`. `rowToPoint` preenche `status: row.status ?? "oficial"` e `osm`, que fica `null` se todas as tags forem nulas.

### 3.3 Camada comunitária

Arquivo novo `d:\ROTASEMBARREIRAS\src\components\map\communityLayer.ts`, com a classe `CommunityLayerController`, sem React, para manter o `CustomMap` enxuto:

- `constructor(map: L.Map, opts: { onSelect: (row: CommunityLayerRow) => void })` cria um `L.layerGroup().addTo(map)` próprio, `markers = new Map<string, L.Marker>()` e ouve `moveend`/`zoomend` → `schedule()`.
- Setters `setEnabled(b)`, `setCategory(c: string | null)`, `setReduceMotion(b)`, `setSelected(point: TouristPoint | null)` e `destroy()`.
- `schedule()`: debounce de **400 ms** (`setTimeout`). Em `refresh()`:
  - Se `!enabled || map.getZoom() < MIN_COMMUNITY_ZOOM` → aborta o pedido em andamento, `clearLayers()`, `markers.clear()` e retorna, sem requisição (RF-3.5, RF-3.8).
  - Senão: `abortController?.abort()`, novo `AbortController`, `seq++`, e chama `fetchCommunityLayer({ bounds: map.getBounds(), zoom, category, excludeId: selected?.status === "em_mapeamento" ? selected.id : null, maxItens: 149, signal })`. O teto de 149 + o pin selecionado desenhado à parte dá no máximo 150 elementos no DOM (CA-4). Ao voltar, se `mySeq !== seq`, descarta (resposta obsoleta).
  - Erro (rede, RPC, `bbox_grande_demais`): recuperável. Mantém os marcadores atuais, sem UI e sem log em produção (`if (process.env.NODE_ENV !== "production") console.warn`). O próximo movimento tenta de novo.
- **Reconciliação por `chave`**: remove as chaves que saíram, cria só as novas e mantém as existentes (mesmo padrão do `CustomMap`, RNF-5). Linhas `tipo = 'truncado'` são filtradas antes da reconciliação (`console.warn` com `quantidade` só em dev); `CommunityLayerRow.tipo` é `"ponto" | "grupo" | "truncado"`.
  - `ponto` → `L.marker` com `divIcon({ className: "rsb-marker rsb-marker--community", html: communityPinHtml(nome), iconSize: [0,0], iconAnchor: [0,0] })`, `zIndexOffset: -1000` (oficiais por cima), `keyboard: true`, `title`/`alt` = `"<nome> — <categoria>, em mapeamento"`. No elemento: `role="button"`, `aria-label="Abrir <nome>, <categoria>, em mapeamento"`, `data-map-marker`. `.on("click", …)` → `onSelect(row)`, e `.on("keypress", (e: L.LeafletKeyboardEvent) => …)` com `Enter` ou `" "` → `e.originalEvent.preventDefault()` + `onSelect(row)`, exatamente como os oficiais em `CustomMap.tsx` (linhas ~202–206). O mesmo vale para os grupos.

  O HTML do pin reaproveita o markup de `pinHtml(point)` do `CustomMap.tsx` (halo, `--pin-size`, foco), mudando só o `stroke` do SVG para `currentColor` (o CSS do §3.6 define a cor):

  ```ts
  function communityPinHtml(nome: string): string {
    return `<span class="rsb-pin-halo" aria-hidden="true"></span>
    <span class="rsb-pin"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></span>
    <span class="rsb-pin-label">${escapeHtml(nome)}</span>`;
  }
  ```

  A cor do contorno vem de `color` em `.rsb-marker--community .rsb-pin` (§3.6). O path é o mesmo ícone `MapPin` do lucide usado hoje no `pinHtml` (o implementador copia o path exato de lá, se diferir).
  - `grupo` → `divIcon({ className: "rsb-cluster-marker", html: '<span class="rsb-cluster" aria-hidden="true">N</span>' })`, com `role="button"`, `aria-label="N locais da comunidade, ampliar"` e `data-map-marker`. Clique/Enter/Espaço → `map.fitBounds([[sul, oeste], [norte, leste]], { padding: [48, 48], maxZoom: Math.min(map.getZoom() + 2, 18), animate: !reduceMotion })`. Se os extremos forem iguais, usa `map.setView(centro, Math.min(zoom + 2, 18), { animate: !reduceMotion })`.
  - Os nomes entram via `escapeHtml` (a função existente vai para `src/components/map/escapeHtml.ts` e é importada pelos dois arquivos).
- **Seleção**: o ponto comunitário selecionado é sempre desenhado como pin individual com `is-selected`. Ele é excluído do agrupamento pela RPC (`p_excluir_id`), então nunca some dentro de um grupo. O pin é criado pelo próprio `setSelected(point)` a partir do `TouristPoint` recebido (`point.coords`, `point.name`, `point.category`), com o mesmo `communityPinHtml` e os mesmos handlers, guardado em um campo `selectedMarker` separado de `markers` (chave lógica `p:<id>`; a reconciliação nunca o remove). `setSelected(null)`, a troca para outro ponto ou um `point.status === "oficial"` removem o `selectedMarker`; em seguida `schedule()` refaz o bbox, para o ponto voltar à grade sem o `p_excluir_id`. Se o ponto já estiver em `markers` como individual (resposta anterior à seleção), essa entrada é removida ao criar o `selectedMarker`, para não haver dois pins.
- Constante `export const MIN_COMMUNITY_ZOOM = 15;` neste arquivo.

`d:\ROTASEMBARREIRAS\src\services\communityPointsService.ts` (novo, cliente `createClient()` e `queryWithSessionRecovery`, que vira `export` em `pointsService.ts`):

- `fetchCommunityLayer(params)` → `supabase.rpc("pontos_comunidade_bbox", { p_oeste, p_sul, p_leste, p_norte, p_zoom: Math.floor(zoom), p_categoria, p_excluir_id, p_max_itens: params.maxItens }).abortSignal(signal)`, que lança em caso de erro.
- `fetchCommunityPoint(id)` → `from("pontos").select("*").eq("id", id).eq("status", "em_mapeamento").maybeSingle()` → `rowToPoint` (exportado) ou `null`.
- `fetchPontoById(id)` → mesmo, sem filtro de status (usado por "Ver local").
- `fetchConsensus(pontoId)` → `rpc("consenso_recursos")`, que devolve `[]` em caso de erro (o consenso é complementar; o erro aparece como "não verificado").
- `checkExistingPlace(nome, lat, lng)` → `rpc("verificar_local_existente")`, que lança.
- `searchCommunityPointsForVoice(params: { texto?, cidade?, latitude?, longitude?, raioM?, limite?, categoria? })` → `rpc("buscar_pontos_comunidade", { p_texto, p_cidade, p_latitude, p_longitude, p_raio_m, p_limite, p_categoria })`, cortando strings nos limites da RPC antes de enviar; devolve `[]` em caso de erro.
- `rowToCommunityTouristPoint(row)` converte uma linha de `buscar_pontos_comunidade` em `TouristPoint` (`status: "em_mapeamento"`, `image: ""`, `gallery: []`, flags `false`, `details: []`, `osm` preenchido) para `goToPoint`.

### 3.4 `CustomMap.tsx`

`d:\ROTASEMBARREIRAS\src\components\CustomMap.tsx`:

- Props novas: `showCommunity: boolean`, `communityCategory: string | null` e `onSelectCommunityPoint: (row: CommunityLayerRow) => void` (lido via ref, como `onSelectRef`).
- No efeito de init: `communityRef.current = new CommunityLayerController(map, { onSelect: (row) => onSelectCommunityRef.current(row) })`, e `destroy()` no cleanup.
- Efeitos finos: `[showCommunity]` → `setEnabled`; `[communityCategory]` → `setCategory`; `[reduceMotion]` → `setReduceMotion`; `[selectedPoint]` → `setSelected`.
- **Seleção sem afastar o zoom**: os dois `flyTo` passam a usar `Math.max(map.getZoom(), 15)` no lugar de `15`. Selecionar um pin no zoom 17 não volta mais para 15 (o que reagruparia os pontos). Não muda nada visualmente para quem está em 13–15.
- **Atribuição** (RF-3.9): `attributionControl: false` continua, e é adicionado explicitamente `L.control.attribution({ position: "bottomleft", prefix: false }).addTo(map)`. O tile layer ganha `attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>'`. No mobile, o canto inferior esquerdo está livre (recentrar e "Sugerir um local" ficam à direita). No xl, o CSS move o controle para a direita, acima dos botões (§3.6), para não ficar sob o side sheet de 390 px que abre à esquerda.
- **Atribuição × preview mobile (decisão)**: o `ExploreBottomSheet` está desativado em `page.tsx`, então sem ponto selecionado o canto inferior esquerdo fica livre e a atribuição aparece. Enquanto o preview `BottomSheet` de um ponto está aberto (`absolute bottom-0` no mesmo container), ele cobre a atribuição. Isso é **aceito**: o preview é uma sheet aberta, não "recolhida" (o caso de RF-3.9), tem botão de fechar, e esse é o comportamento comum de apps de mapa. Nada é repetido no rodapé do `BottomSheet`. CA-11 é verificado com o preview fechado (§9).

### 3.5 `page.tsx`

`d:\ROTASEMBARREIRAS\src\app\page.tsx`:

- `const [showCommunity, setShowCommunity] = useState(true);`.
- Na linha de filtros, depois do `CATEGORIES.map`: um divisor `<span aria-hidden className="w-px self-stretch bg-gray-200 flex-shrink-0" />` e o botão `"Mostrar locais da comunidade"` com `aria-pressed={showCommunity}` e as mesmas classes de chip (`bg-brand border-brand text-white` quando ligado, `bg-white border-gray-150 text-text-main` quando desligado), ícone `Users` (lucide, `aria-hidden`), `min-h-12`. O `onClick` alterna e chama `track("filtro_aplicado", { tipo: "comunidade", valor: on ? "ligado" : "desligado" })`.
- `<CustomMap … showCommunity={showCommunity} communityCategory={selectedCategory} onSelectCommunityPoint={handleSelectCommunityPoint} />`.
- `handleSelectCommunityPoint(row)`: `fetchCommunityPoint(row.ponto_id)`. Se vier, chama `handleSelectPointFromMapOrSearch(point)` (mobile: `BottomSheet`; desktop: `PointDetails`, RF-3.10). Se der `null` ou erro, nada abre e a região `aria-live` existente da página anuncia "Não foi possível abrir este local agora." (nenhum `alert`).
- `SuggestLocationSheet` ganha `onOpenExistingPoint={(id) => …}`. Procura em `points` (oficial) e, se não achar, usa `fetchPontoById(id)`. Depois fecha a sheet e chama `handleSelectPointFromMapOrSearch`.

### 3.6 CSS (`d:\ROTASEMBARREIRAS\src\app\globals.css`)

Bloco novo "MAPA — PONTOS DA COMUNIDADE", logo depois de "MAPA — PINS". Só usa as variáveis da paleta e brancos/cinzas já usados:

- `.rsb-marker--community .rsb-pin { background-color: #ffffff; border: 3px solid var(--color-brand); color: var(--color-brand); }` (pin vazado; o SVG usa `stroke="currentColor"`). O tamanho é o mesmo `--pin-size`, para manter o alvo de toque.
- `.rsb-marker--community .rsb-pin-label { display: none }`. A etiqueta aparece em `.is-selected` e `:focus-visible` (mapa limpo).
- `.rsb-cluster`: 48×48 px, `border-radius: 9999px`, fundo `#ffffff`, `border: 3px solid var(--color-brand)`, texto `var(--color-text-main)`, `font-weight: 800`, 14 px, `box-shadow` igual ao `.rsb-pin`, posicionado com `left/top: -24px`. O foco usa o mesmo anel de `.rsb-marker:focus-visible .rsb-pin`.
- Alto contraste: `.theme-high-contrast .rsb-marker--community .rsb-pin { background-color: #000 !important; border-color: #ffff00 !important; }` e `color: #ffff00 !important`. Assim, o oficial é amarelo preenchido com borda preta e o comunitário é preto vazado com borda amarela, e a diferença é de preenchimento, não de matiz. `.theme-high-contrast .rsb-cluster { background:#000; color:#ffff00; border-color:#ffff00 }`.
- Atribuição: `.leaflet-control-attribution { font-size: 11px; background: rgba(255,255,255,.9); color: var(--color-text-main); padding: 2px 8px; border-radius: 9999px 9999px 0 0; }` e links `color: var(--color-text-main); text-decoration: underline`. Em `@media (min-width:1280px)`: `.leaflet-bottom.leaflet-left { left: auto; right: 24px; bottom: 76px; }`. Alto contraste: fundo `#000`, texto/links `#ffff00`, `outline: 2px solid #ffff00`. A regra existente de links dentro de `[data-map-surface]` já aplica contorno.
- Reduzir movimento: nenhum elemento novo tem transição. `.reduce-motion` e a media query global já cobrem, e o `fitBounds`/`setView` usam `animate: !reduceMotion`.

### 3.7 `BottomSheet.tsx` (preview mobile)

`d:\ROTASEMBARREIRAS\src\components\BottomSheet.tsx`: quando `point.status === "em_mapeamento"`, no lugar da descrição e dos chips de acessibilidade aparece um parágrafo `text-sm text-text-secondary font-semibold`: "Em mapeamento. Informações da comunidade, ainda sem dados oficiais de acessibilidade." O botão "Ver Detalhes do Local" continua igual. Não entra selo nem cor nova: a pílula de categoria já existe e é funcional.

## 4. Sincronização OSM (`scripts/`)

### 4.1 Arquivos

- `d:\ROTASEMBARREIRAS\scripts\sync-osm.mjs`: CLI.
- `d:\ROTASEMBARREIRAS\scripts\osm\config.mjs`: **o arquivo editável**, com `OVERPASS_ENDPOINT`, `CIDADES` e `REGRAS`, comentado em português.
- `d:\ROTASEMBARREIRAS\scripts\osm\transform.mjs`: funções puras `buildOverpassQuery`, `classifyElement`, `toPayload`, `sortByPriority`, `buildEndereco`, `sanitizeWebsite`, `sanitizePhone`.
- `d:\ROTASEMBARREIRAS\scripts\osm\overpass.mjs`: `fetchOverpass(query, { userAgent, fetchImpl = fetch, sleep })` com backoff.
- `d:\ROTASEMBARREIRAS\scripts\osm\transform.test.mjs` e `d:\ROTASEMBARREIRAS\scripts\osm\overpass.test.mjs` (`node:test` + `node:assert/strict`, com `fetch` e `sleep` injetados).
- `package.json`:
  - `"sync-osm": "node --env-file=scripts/.env scripts/sync-osm.mjs"`
  - `"test:osm": "node --test scripts/osm/transform.test.mjs scripts/osm/overpass.test.mjs"`
  - `"test:relatos": "node --env-file=scripts/.env scripts/test-relatos-anon.mjs"` (§9)
- `scripts/.env.example` ganha `SUPABASE_ANON_KEY=` e `OSM_CONTACT=` (e-mail ou URL de contato).
- `.gitignore` ganha `scripts/osm/cache/`.

Garantia de servidor (RF-1.1): nada em `src/` importa `scripts/` nem cita `overpass`. Isso é verificado por busca no §9. A `service_role` só é lida de `scripts/.env`.

### 4.2 Config

```js
// scripts/osm/config.mjs
export const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
export const CIDADES = {
  "governador-valadares": {
    nome: "Governador Valadares",           // gravado em pontos.cidade
    area: {
      name: "Governador Valadares", admin_level: "8",          // relação municipal no OSM
      // Filtros extras para não casar com homônimos. Confirmar no OSM antes da 1ª execução
      // (relação do município → aba Tags). Remover a linha se a tag não existir.
      filtrosExtras: { "IBGE:GEOCODIGO": "3127701" },
    },
    timeoutSegundos: 180,
  },
};
// Ordem importa: vale a PRIMEIRA regra que casar (específicas antes de genéricas).
export const REGRAS = [
  { chave: "tourism", valores: ["museum", "gallery"], categoria: "Cultura" },
  { chave: "amenity", valores: ["theatre", "arts_centre", "library"], categoria: "Cultura" },
  { chave: "amenity", valores: ["place_of_worship"], categoria: "Religião" },
  { chave: "historic", valores: "*", categoria: "Patrimônio" },
  { chave: "tourism", valores: ["viewpoint"], categoria: "Natureza" },
  { chave: "natural", valores: ["peak", "waterfall"], categoria: "Natureza" },
  { chave: "leisure", valores: ["park", "playground", "sports_centre"], categoria: "Lazer" },
  { chave: "amenity", valores: ["restaurant", "cafe", "marketplace"], categoria: "Gastronomia" },
  { chave: "tourism", valores: ["attraction"], categoria: "Lazer" },      // genérica (D-2)
  { chave: "amenity", valores: ["toilets"], categoria: "Lazer" },        // D-1: quase nunca tem nome
];
```

`buildOverpassQuery(cidade, REGRAS)` gera **uma** consulta:

```
[out:json][timeout:180];
area["boundary"="administrative"]["admin_level"="8"]["name"="Governador Valadares"]["IBGE:GEOCODIGO"="3127701"]->.a;
.a out ids;
(
  nwr["tourism"~"^(museum|gallery)$"]["name"](area.a);
  nwr["historic"]["name"](area.a);
  …uma linha por regra…
);
out center;
```

**Verbosidade: `out center;` (body), não `out center tags;`.** Pela documentação do Overpass QL, a verbosidade `tags` imprime só ids e tags, e não está garantido que nodes recebam `lat`/`lon` nesse modo. Como nodes são a maioria dos POIs, o risco não compensa a economia. `out center;` devolve `lat`/`lon` em nodes, `center` em ways/relations e as tags de todos; o corpo é maior (inclui as referências de nós dos ways e os membros das relations), mas continua sendo **uma** consulta e, para GV, alguns MB no máximo. `transform.mjs` ignora `nodes`/`members`.

Com várias áreas no conjunto `.a`, `(area.a)` buscaria em todas, por isso a checagem abaixo é necessária. Os valores entram na regex com `^…$`, escapados, e o nome da área e os `filtrosExtras` (cada par vira mais um `["chave"="valor"]` no seletor `area`) são escapados para aspas/barras. A coordenada de um node é `lat`/`lon`; a de um way/relation é `center.lat`/`center.lon` (centróide, RF-1.8).

**Fixture real.** Antes da 1ª execução, o implementador roda a query gerada (trocando o seletor de área por um bbox pequeno do centro de GV, para a resposta ficar com poucas dezenas de elementos) no overpass-turbo ou com `curl` e salva a resposta em `d:\ROTASEMBARREIRAS\scripts\osm\fixtures\overpass-gv-amostra.json` (versionada; dados OSM sob ODbL, com a atribuição no topo do teste). `transform.test.mjs` a usa para afirmar que todo node tem `lat`/`lon` numéricos e todo way/relation tem `center`. Se o implementador não tiver rede, o teste com fixture fica marcado `skip` com a razão, e a guarda `sem_coordenadas` abaixo continua protegendo a execução real.

Homônimos: a mesma consulta inclui, antes do bloco de elementos, `area.a out ids;` (saída `type: "area"`, poucos bytes). Isso não é uma segunda consulta: é a mesma requisição. Se a resposta trouxer **mais de uma** área → `exit 4` ("a área casou com N relações; adicione filtrosExtras"), sem gravar. Zero áreas → `exit 4` também. Os elementos `type: "area"` são descartados antes da classificação.

### 4.3 Fluxo do CLI

Uso: `npm run sync-osm -- --cidade governador-valadares [--dry-run] [--arquivo caminho.json]`

1. Valida o ambiente: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `OSM_CONTACT`. Se faltar algo → mensagem e `exit 1`.
2. Cidade desconhecida → lista as chaves de `CIDADES` e faz `exit 2`.
3. Origem dos dados:
   - Com `--arquivo`, lê o JSON local (formato Overpass), sem rede (RNF-11).
   - Sem `--arquivo`, chama `fetchOverpass`: `POST` `application/x-www-form-urlencoded` (`data=<query>`), `User-Agent: RotaSemBarreiras-OSMSync/1.0 (+https://rotasembarreiras.com.br; contato: ${OSM_CONTACT})` e `AbortSignal.timeout((timeoutSegundos + 30) * 1000)`.
4. Backoff (RF-1.4):
   - Retentáveis: HTTP 429, 502, 503, 504, erro de rede, timeout, e HTTP 200 cujo JSON traz `remark` com `/runtime error|timed out|out of memory/i`.
   - Espera: `Retry-After` (segundos ou data HTTP), limitado a 300 s; sem o cabeçalho, 30 s, 60 s e 120 s.
   - No máximo 3 retentativas (4 tentativas no total). Outros 4xx não são retentados.
   - Esgotou → `exit 3` com o último status, sem gravar nada.
   - Cada espera é logada (`Overpass 429, nova tentativa em 60 s (2/3)`).
5. Uma resposta real bem-sucedida é salva em `scripts/osm/cache/<slug>-<ISO>.json`, para reprocessar com `--arquivo` sem nova consulta.
6. `classifyElement` aplica a primeira regra que casar. Elementos sem nome ou sem regra são contados (`sem_nome`, `sem_regra`) e descartados. Um node sem `lat`/`lon` numéricos finitos, ou um way/relation sem `center.lat`/`center.lon`, é contado em `sem_coordenadas` e descartado. Se algum **node** ficou sem coordenada (`sem_coordenadas_node > 0`) → `exit 4` ("a resposta não trouxe coordenadas para N nodes; confira a verbosidade `out center;` em transform.mjs"), sem gravar: em modo body todo node tem `lat`/`lon`, então isso é sinal de query errada, não de dado ruim. Way/relation sem `center` (relação quebrada no OSM) é só contado em `sem_coordenadas` e descartado, sem abortar. Zero elementos válidos → `exit 4` ("nenhum elemento: verifique a área"), sem gravar.
7. `toPayload` + `sortByPriority`. A ordem é: `node` < `way` < `relation`; dentro do mesmo tipo, mais tags úteis primeiro (`wheelchair`, `toilets:wheelchair`, `opening_hours`, `phone`, `website`, `addr:street`); desempate por `osm_id` crescente. Grava `ordem` = índice (RF-2.6: o node com mais tags vira primário).
8. `supabase.rpc("osm_sync_aplicar", { p_cidade: cidade.nome, p_elementos, p_dry_run })`. Erro → imprime `code`/`message` e faz `exit 5`. A transação no banco garante que nada parcial fica gravado. Se o código for `57014` (statement timeout), a mensagem orienta o usuário (§7, item 9).
9. Imprime o relatório (contagens do script + da RPC) como JSON e faz `exit 0`.

A chave nunca é impressa. Logs só vão para `stdout`/`stderr`.

### 4.4 Formato do elemento (`p_elementos[]`)

```json
{ "ordem": 0, "osm_tipo": "node", "osm_id": 123, "nome": "Praça X", "categoria": "Lazer",
  "lat": -18.85, "lng": -41.94, "endereco": "Rua A, 10 - Centro",
  "wheelchair": "yes", "toilets_wheelchair": null, "opening_hours": "Mo-Fr 08:00-18:00",
  "phone": "+55 33 3333-3333", "website": "https://exemplo.org" }
```

- `phone` = `phone ?? contact:phone`; `website` = `website ?? contact:website` (só `http(s)://`, senão `null`).
- `endereco` = `addr:street` + `, addr:housenumber` + ` - addr:suburb`. Sem rua → `null`.

A RPC revalida tudo (§2.2, `_osm_validar`), sem confiar no script.

## 5. Tela do ponto em mapeamento e fluxo de relato

### 5.1 Módulos novos

- `d:\ROTASEMBARREIRAS\src\lib\communityResources.ts`:
  - `COMMUNITY_RESOURCES: { key: CommunityResourceKey; label: string }[]` (D-7);
  - `OSM_VALUE_LABEL = { yes: "sim", limited: "parcial", no: "não", designated: "sim, adaptado" }` (valores desconhecidos são omitidos);
  - `formatOpeningHours(raw)`, que é pura: troca `Mo Tu We Th Fr Sa Su PH` → `seg ter qua qui sex sáb dom feriados`, `off` → `fechado` e `;` → `; `, e devolve o texto original se não reconhecer nada;
  - `phoneHref(raw)` → `tel:+5533…` (só dígitos e `+`);
  - `websiteLabel(url)` → hostname.
- `d:\ROTASEMBARREIRAS\src\lib\relatoText.ts`: `RELATO_MAX_CHARS = 280`, `RELATO_LINK_REGEX` (equivalente à regex SQL) e `validateRelatoText(texto): string | null`, com as mensagens "O texto pode ter no máximo 280 caracteres." e "Remova links ou endereços de sites do texto para enviar."
- Componentes em `d:\ROTASEMBARREIRAS\src\components\point\`:
  - `MappingNotice.tsx`: `<div id="aviso-mapeamento" role="note">` (o id é o alvo do `aria-describedby` da seção, §5.2), ícone `Info` `text-brand` (aria-hidden), e o texto exato de RF-4.2 em `text-base font-semibold text-text-main`, sobre fundo `bg-brand-light` **literal, sem modificador de opacidade** (`#fff4e6` já é bem claro) com `border border-brand rounded-3xl p-5`. Assim casa com a regra existente `.theme-high-contrast .bg-brand-light` (amarelo com texto preto) e ganha o destaque de HC.
  - `OsmInfoCard.tsx`: card branco padrão com título "Fonte: OpenStreetMap" e linhas Horário / Telefone (`<a href={phoneHref}>`) / Site (`<a target="_blank" rel="noopener noreferrer">`). Não renderiza se não houver dados. Abaixo, se `wheelchair`/`toilets:wheelchair` existirem, um bloco `border-t` com subtítulo `text-xs font-extrabold uppercase text-text-secondary` "Segundo o OpenStreetMap" e linhas `text-sm text-text-secondary` ("Acesso para cadeira de rodas: parcial", "Banheiro acessível: sim"), sem ícone de estado e com peso menor (RF-4.4).
  - `CommunityAccessibilityCard.tsx`: título "Acessibilidade relatada pela comunidade". Para cada `COMMUNITY_RESOURCES`, renderiza `AccessibilityDetailItem` com o estado do consenso (ou `nao_verificado`). Quando há consenso, aparece a legenda `text-xs text-text-secondary` "Relatado pela comunidade (N pessoas)" ("1 pessoa" no singular, embora com mínimo 3 nunca ocorra). Enquanto o consenso carrega, tudo fica "não verificado" (sem skeleton piscando).
  - `ReportResourcesFieldset.tsx`: um `<fieldset>` com `<legend>` "O que você viu no local? (opcional)". Para cada recurso, um `<fieldset>` interno com `<legend>` = rótulo do recurso (o agrupamento nativo de rádios dispensa `role="radiogroup"`) e 3 opções "Tem", "Não tem" e "Não sei" (padrão, que não envia nada). Cada opção é `<label className="rsb-choice inline-flex items-center justify-center min-h-12 px-4 rounded-full border-2 border-gray-200 bg-white text-text-main font-bold">` contendo `<input type="radio" className="sr-only" name={`recurso-${key}`} value=…>` + texto. O estado selecionado é **só CSS** via `:has(input:checked)` (sem classe condicional no React, que o HC não reconheceria), e sem `transition`. CSS novo em `globals.css`, bloco "RELATO — OPÇÕES":

    ```css
    .rsb-choice:has(input:checked) { background-color: var(--color-brand); color: #fff; border-color: var(--color-brand); }
    .rsb-choice:has(input:focus-visible) { outline: 3px solid var(--color-brand-dark); outline-offset: 2px; }
    .theme-high-contrast .rsb-choice { background-color: #000 !important; color: #fff !important; border: 2px solid #fff !important; }
    .theme-high-contrast .rsb-choice:has(input:checked) { background-color: #ffff00 !important; color: #000 !important; border-color: #000 !important; }
    .theme-high-contrast .rsb-choice:has(input:checked) * { color: #000 !important; }
    .theme-high-contrast .rsb-choice:has(input:focus-visible) { outline: 3px solid #ffff00 !important; }
    ```

    Nota: a regra genérica do HC que pinta `label`/`span` de branco tem especificidade menor que `.theme-high-contrast .rsb-choice:has(input:checked) *` com `!important`, então o texto da opção marcada fica preto sobre amarelo. Verificado no checklist de CA-17 (§9).
- `AccessibilityDetailItem` (em `PointDetails.tsx`) ganha a prop opcional `caption?: string` e um `<span className="sr-only">` com o estado ("tem", "não tem", "não verificado"), já que hoje o estado é só ícone. Isso também melhora os pontos oficiais.

### 5.2 `PointDetails.tsx`

`d:\ROTASEMBARREIRAS\src\components\PointDetails.tsx`, com `const isMapping = point.status === "em_mapeamento"`:

- **Cabeçalho**: com `isMapping`, sempre usa o cabeçalho compacto (o mesmo do `hideImages`, RF-4.8). Abaixo do `h2`, entra uma linha de texto `text-sm font-bold text-text-secondary` "Em mapeamento" (sem pílula, RF-4.1). O conteúdo da tela é envolvido por `<section aria-labelledby="ponto-titulo">` (região nomeada, sem `role="dialog"`, porque `PointDetails` não faz gestão de foco e isso está fora do escopo) e, em mapeamento, também `aria-describedby="aviso-mapeamento"`. O `h2` do nome recebe `id="ponto-titulo"`. O `MappingNotice` é o primeiro bloco do DOM depois do cabeçalho, então é lido logo após o título na navegação sequencial (CA-12).
- **Ordem do conteúdo em mapeamento**: `MappingNotice` → card de endereço com "Como chegar" (sem mudança; endereço vazio vira "Endereço não informado") → `OsmInfoCard` → `CommunityAccessibilityCard` + link/formulário de relato → card "Condição recente" (existente, sem mudança visual).
- Galeria, chips, mídias, "Informações atualizadas em" e "História & Importância" não são renderizados em mapeamento (RF-4.8). Não existe controle de foto em nenhum ramo (RF-4.9).
- **Carga**: com `isMapping`, no `useEffect([point.id])`, roda `Promise.all([fetchRelatosForPoint, fetchConsensus])`. Isso preenche `condition` (contagem de 14 dias, como hoje) e `consensus`. Erro nos relatos → lista vazia + texto existente "Nenhum relato detalhado ainda."; erro no consenso → `[]`.
- **Leitura em voz alta**: segmentos `name`, `mapping` ("Em mapeamento. " + aviso), `address`, `osm` (linhas do card OSM), `community` (recurso: estado e "relatado pela comunidade" quando houver).
- **Formulário de relato**:
  - Remover o bloco `if (isAnonymous) { … "Entre na sua conta…" }` (RF-5.1).
  - Em mapeamento, entram o `ReportResourcesFieldset` e o `textarea`, que aparece para os dois tipos (em pontos oficiais continua só para "problema", RF-5.13). O `textarea` usa `maxLength={280}`, contador `aria-live="polite"` "N/280" e `aria-describedby` apontando para o erro inline.
  - Validação local com `validateRelatoText` antes de enviar.
  - Linha discreta `text-xs text-text-secondary` "Você pode enviar sem criar conta.", só quando `isAnonymous` (RF-5.12), acima do botão.
  - Mensagens de erro em `<p role="alert" className="text-sm font-bold text-text-main">` com ícone `AlertTriangle text-brand` (aria-hidden). Isso tem contraste melhor que o `text-brand` atual, sem cor nova.
  - Depois de enviar, recarrega relatos + consenso.
  - Na lista de relatos recentes, em mapeamento, cada item mostra também "Marcou: Entrada sem degraus: tem; Banheiro adaptado: não tem" em texto puro.
  - `track("relato_enviado", { ponto_id, tipo, caracteres, status_ponto })`. O tipo `relato_enviado` em `d:\ROTASEMBARREIRAS\src\lib\analytics.ts` ganha `status_ponto: "oficial" | "em_mapeamento"`. `docs/analytics-eventos.md` é atualizado.
- Todo texto vindo do banco é renderizado via JSX (escapado). Não pode haver `dangerouslySetInnerHTML` nos arquivos tocados (RF-5.7). Os nomes no mapa passam por `escapeHtml`.

### 5.3 `createRelato` e mapeamento de erros

`d:\ROTASEMBARREIRAS\src\services\pointsService.ts`. A nova assinatura é `createRelato(input: { pontoId: string; tipo: "ok" | "problema"; texto: string | null; recursos?: Partial<Record<CommunityResourceKey, "tem" | "nao_tem">> }): Promise<void>`. Ela lança `RelatoError extends Error { code: "sete_dias" | "origem" | "texto" | "sessao" | "generico" }`.

1. `validateRelatoText` → se falhar, `RelatoError("texto")` (sem rede).
2. Garante sessão: se `(await supabase.auth.getSession()).data.session` for nulo (o fallback "guest" do `AuthContext`), tenta `signInAnonymously()` uma vez. Se falhar → `RelatoError("sessao", "Não foi possível enviar agora. Tente novamente em instantes.")`. Isso não é aviso de conta (RF-5.1).
3. `insert({ ponto_id, tipo, texto, recursos: recursos com ao menos 1 chave ou null })`. O `user_id` vem do default `auth.uid()` (o cliente não envia nada).
4. Mapeamento por `error.message` / `error.code`:
   - `origem_rate_limited` → `"origem"`: "Muitos relatos enviados desta rede agora. Tente novamente mais tarde."
   - `texto_com_link` / `texto_muito_longo` → `"texto"`, com as mensagens de `relatoText.ts`.
   - `42501` → `rpc("relato_bloqueado_ate", { p_ponto_id })`. Se devolver uma data → `"sete_dias"`: "Você já relatou este ponto recentemente. Tente novamente em alguns dias." Senão → `"generico"`.
   - `23514` (recursos) e qualquer outro → `"generico"`: "Não foi possível enviar o relato. Tente novamente."
5. Nenhum erro é logado com conteúdo do texto.

O `userId` sai da assinatura e deixa de ser necessário.

### 5.4 Captura de IP: comparação das opções (D-9)

| Opção | Pode ser contornada? | IP confiável? | Custo |
|---|---|---|---|
| Trigger no banco (`request.headers`) **(escolhida)** | Não. Vale para todo INSERT via PostgREST, inclusive chamadas diretas. | Depende do cabeçalho do gateway. `cf-connecting-ip` é sobrescrito pela Cloudflare na borda do Supabase, e o `diagnostico_origem` confirma isso no projeto. | Zero infra nova. Fail-open sem cabeçalho/sal. |
| Edge Function que insere com service_role | Sim, enquanto a INSERT policy estiver aberta para `authenticated` (exigência do usuário). Fechar a policy contraria o pedido. | Mesmo cabeçalho do gateway. | Deploy + secret + latência extra. |
| Rota Next.js (Vercel) | Sim, pelo mesmo motivo. | `x-forwarded-for` da Vercel é confiável. | Exigiria a `service_role` no servidor Next, o que hoje é proibido pelo projeto. |

Se `cf-connecting-ip` não aparecer em `request.headers` neste projeto, o diagnóstico mostra qual posição do XFF é a real, e o usuário troca `mapeamento_config.origem_fonte`, sem mudar código.

## 6. Painel admin

### 6.1 Navegação

- `d:\ROTASEMBARREIRAS\src\app\admin\layout.tsx`: `NAV_ITEMS` ganha `{ href: "/admin/relatos", label: "Relatos", icon: MessageSquareText }` e `{ href: "/admin/duplicidades", label: "Duplicidades", icon: GitMerge }`.
- `d:\ROTASEMBARREIRAS\src\app\admin\page.tsx`: `CARDS` ganha dois cards correspondentes.
- O gate continua o mesmo (`is_admin`), e a imposição real é feita pelas RPCs/policies.

### 6.2 Relatos (`d:\ROTASEMBARREIRAS\src\app\admin\relatos\page.tsx`, novo)

Usa o serviço `d:\ROTASEMBARREIRAS\src\services\relatosAdminService.ts`:

- `fetchRecentRelatos({ before?: string, limit = 30 })` → `from("relatos_pontos").select("id, ponto_id, tipo, texto, recursos, criado_em, oculto, ocultado_em, pontos(nome, status, cidade)").order("criado_em", { ascending: false }).limit(limit)` + `.lt("criado_em", before)` quando houver cursor.
- `hideRelato(id)` → `rpc("admin_ocultar_relato", { p_relato_id: id })`.

UI no padrão de `/admin/sugestoes`:

- Cabeçalho com "Atualizar"; cada item mostra ponto (nome · "Em mapeamento"/"Oficial" em texto), data `pt-BR`, tipo, recursos marcados e texto (JSX puro).
- Botão "Ocultar" (`aria-label="Ocultar relato de <ponto> de <data>"`) → `ConfirmDialog` ("Ocultar relato" / "O relato deixa de aparecer no app e não conta mais para a condição nem para o consenso. Ele continua guardado." / "Ocultar").
- Itens já ocultos mostram "Oculto em dd/mm" em texto e não têm ação.
- "Carregar mais" faz paginação por cursor.
- Erros aparecem em banner inline (`text-accent-text`, padrão já usado no admin).

### 6.3 Pontos: abas, promover, pré-checagem

`d:\ROTASEMBARREIRAS\src\app\admin\pontos\page.tsx`:

- **Abas** "Oficiais" / "Em mapeamento" na listagem: dois botões `aria-pressed`, estado `listStatus`, recarregando com `fetchAllPontosAdmin(listStatus)`. A contagem do título muda conforme a aba. Classes: ativa = `bg-brand text-white border-2 border-brand` (classe **literal** `bg-brand`, já tratada pelo HC como amarelo/preto); inativa = `bg-white text-text-main border-2 border-gray-200` (o HC genérico a deixa preta com contorno). Sem `transition-*` (ou, se o padrão de botão do admin já tiver, `motion-reduce:transition-none`). Foco: `focus-visible:outline-3 focus-visible:outline-brand-dark`, que o HC troca pelo contorno amarelo existente.
- Na aba "Em mapeamento", cada linha mostra `cidade · categoria` e "Fonte: OpenStreetMap", com as ações:
  - **"Promover a oficial"**: botão com texto e ícone `BadgeCheck`, mínimo de 40 px como os vizinhos.
  - Excluir (existente). A mensagem do `ConfirmDialog` em mapeamento é: "… será removido do mapa. Ele não voltará nas próximas sincronizações do OpenStreetMap." (efeito de `pontos_osm.ponto_id = null`).
- **Promover**: `EditState` ganha `mode: "editar" | "promover"`. `openPromote(point)` = `openEdit(point)` com `mode: "promover"`. O título do `AdminModal` fica "Promover a ponto oficial" e o subtítulo "O mesmo registro passa a ser oficial. Relatos e vínculo com o OpenStreetMap são mantidos." O botão fica "Promover e salvar". O formulário (`PontoFormFields`) vem pré-preenchido por `pointToFormValues`, e a equipe completa os dados da UAI e as imagens.
  - Em `handleSaveEdit`, se o modo for `promover`, o payload de `updatePonto` inclui `status: "oficial"` (`PontoUpdateInput` ganha `status?: PointStatus`). É um único `UPDATE … where id`, então o mesmo `id`, sem INSERT (RF-2.12, CA-14).
  - **QR na promoção**: na aba "Em mapeamento", `points` só tem pontos em mapeamento (QR nulo), então `buildQrValue(folder, points, id)` não veria os QR dos oficiais. No modo `promover`, o QR é calculado contra os oficiais: `buildQrValue(folder, await fetchAllPontosAdmin("oficial"), edit.point.id)`. Se essa busca falhar, o salvamento para com a mensagem inline "Não foi possível verificar os QR existentes. Tente de novo." (nada é gravado). Uma corrida residual com `23505` cuja mensagem cite `qr_code_value` no `UPDATE` é mapeada, em `handleSaveEdit` (os dois modos), para a mensagem inline "Já existe um QR com esse nome; ajuste o nome e tente de novo." no lugar da mensagem crua do Postgres.
  - O trigger de trilha (`update of status`) vincula à trilha da cidade. `origem` e `osm_*` não entram no payload e ficam preservados.
  - Depois de salvar: feedback "… promovido a oficial", a lista recarrega e `clearPointsCache()` faz o mapa buscar de novo.
- **Pré-checagem no cadastro novo**: em `handleCreate`, depois de `pontoFormErrors` e antes do upload, chama `checkExistingPlace(nome, lat, lng)`, a menos que `bypassConflito` seja `true`. Havendo resultado, nada é enviado e aparece um painel inline `role="status"`: "Já existe um local parecido a N m: <nome> (Em mapeamento | Oficial)". As ações são:
  - "Promover este ponto" (em mapeamento: `fetchPontoById` → `openPromote`);
  - "Abrir ponto oficial" (oficial: `openEdit`);
  - "Cadastrar mesmo assim" (`bypassConflito = true` e reenvio).

  Se a checagem falhar por rede/RPC, o cadastro segue, e isso é logado no console só em dev.

### 6.4 Duplicidades (`d:\ROTASEMBARREIRAS\src\app\admin\duplicidades\page.tsx`, novo)

Usa o serviço `d:\ROTASEMBARREIRAS\src\services\duplicidadesAdminService.ts`:

- `fetchPendingCandidatos()` → `from("candidatos_duplicidade").select("*, ponto:pontos!candidatos_duplicidade_ponto_existente_id_fkey(id, nome, categoria, status, endereco)").eq("status", "pendente").order("distancia_m")`.
- `resolveCandidato(id, acao)` → `rpc("admin_resolver_candidato", { p_candidato_id: id, p_acao: acao })`.

Cada card mostra, em duas colunas de texto, "No OpenStreetMap: nome · categoria · tipo/id" e "Já cadastrado: nome · categoria · Oficial/Em mapeamento". Embaixo vêm "Distância: N m", "Nome parecido: X%" e "Mesma categoria: sim/não".

Os cards usam o mesmo container branco do `/admin/sugestoes` (`bg-white border border-gray-200 rounded-3xl`), que o HC já converte em preto com contorno; nenhum fundo colorido novo. Ações: "Vincular ao ponto existente" (`bg-brand text-white`, literal) e "Criar como ponto separado" (`bg-gray-100 text-text-main`), cada uma com `aria-label` incluindo os nomes, sem transição. Sem confirmação extra, porque é o padrão de `/admin/sugestoes`. O item sai da lista ao resolver. Os erros `candidato_ja_resolvido` / `forbidden` aparecem inline e a lista recarrega.

Um elemento com vários candidatos aparece em vários cards. Ao resolver um deles, a página recarrega para tirar os irmãos (`descartado`/`separado`).

### 6.5 "Sugerir um local" no app (RF-2.11, CA-13)

`d:\ROTASEMBARREIRAS\src\components\SuggestLocationSheet.tsx`:

- Prop nova `onOpenExistingPoint: (pontoId: string) => void`.
- Em `handleSubmit`, antes do gate `isAnonymous` existente (A-6), roda `checkExistingPlace(nome, lat, lng)` (estado `status = "checking"`, botão "Verificando..."), a menos que `ignorarDuplicata` seja `true`.
- Havendo resultado, o formulário é substituído por um painel `role="status" aria-live="polite"`: "Este local já está no mapa", nome do primeiro match + "Ponto oficial"/"Em mapeamento" em texto e "a N m". As ações são:
  - "Ver local" (primária `bg-brand`) → `onOpenExistingPoint(id)` + `handleClose()`;
  - "É outro local, enviar mesmo assim" (link secundário) → `ignorarDuplicata = true` e reenvio.
- Se a checagem falhar, o envio segue normalmente (não bloqueia).
- O estado é resetado em `resetForm`.

## 7. Ações no painel do Supabase (feitas pelo usuário, não pelos agentes)

1. **Extensões**: Database → Extensions. Habilitar `postgis`, `pg_trgm` e `unaccent`, escolhendo o schema **`extensions`** em cada uma. Confirmar que `supabase_vault` está habilitada (vem por padrão). Se alguma já estiver em `public`, a migração 01 para com mensagem explicando. Correção no SQL Editor: `alter extension pg_trgm set schema extensions;` e `alter extension unaccent set schema extensions;`. Para `postgis` (não realocável): só se nenhuma tabela/função do projeto usar tipos PostGIS, `drop extension postgis; create extension postgis with schema extensions;`; se houver dependências (o `drop` recusa), parar e pedir ajuda.
2. **Login anônimo**: Authentication → Sign In / Providers → "Allow anonymous sign-ins" ligado. Opcional: em Authentication → Rate Limits, revisar o limite de criação de usuários anônimos por IP, que é a segunda barreira contra sessões recriadas em massa.
3. **Sal do hash de IP**: Vault (Integrations → Vault, ou Project Settings → Vault) → "Add new secret", com nome `relatos_origem_sal` e valor aleatório longo. Para gerar no PowerShell: `$b = New-Object byte[] 48; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)`. Não colar no repositório nem no `.env.local`.
4. **Migrações**: SQL Editor, rodar em ordem `migrations_osm_01_pontos_geo.sql`, `migrations_osm_02_dedup_sync.sql` e `migrations_osm_03_relatos_comunidade.sql`. Rodar tudo **antes** de publicar o app novo (§10).
5. **Cabeçalho de IP**: confirmar uma vez, com a chave anon (pública):
   ```powershell
   $h = @{ apikey = "<ANON_KEY>"; Authorization = "Bearer <ANON_KEY>"; "X-Forwarded-For" = "203.0.113.9"; "CF-Connecting-IP" = "203.0.113.9" }
   Invoke-RestMethod -Method Post -Uri "https://<ref>.supabase.co/rest/v1/rpc/diagnostico_origem" -Headers $h -ContentType "application/json" -Body "{}"
   ```
   Use `-Body '{"p_ip_esperado":"<SEU IP PÚBLICO>"}'`, com o IP visto em um serviço de "qual é meu IP" **na mesma rede** de onde o comando roda (o valor não é gravado). Regra de escolha: a fonte certa é a que é **igual ao IP esperado E não é o sentinela**; o campo `fonte_recomendada` já faz essa conta.
   - `fonte_recomendada = 'cf-connecting-ip'` (esperado): nada a fazer.
   - `xff-primeiro` ou `xff-ultimo`: `update public.mapeamento_config set origem_fonte = '<valor>';`.
   - `desligado` (nenhuma posição bate): `update public.mapeamento_config set origem_fonte = 'desligado';`. O limite por origem fica desligado explicitamente (fail-open), e continuam valendo os 7 dias e o rate limit de criação de anônimos do Auth. Nunca escolher uma posição só por "não ser o sentinela": a última do XFF costuma ser o proxy interno, igual para todos, e tornaria o limite global.
   Também conferir `sal_configurado = true`. Repetir o diagnóstico de uma rede móvel (outro IP) é recomendado para confirmar.
6. **`scripts/.env`**: acrescentar `OSM_CONTACT=<seu e-mail ou URL>` (vai no User-Agent da Overpass) e `SUPABASE_ANON_KEY=<anon key>` (usada só pelo teste de relatos).
7. **Assistente de voz**: depois do deploy do código, publicar de novo a função alterada: `npx supabase functions deploy voice-token` (o CLI já é devDependency; login/link do projeto pelo usuário).
8. **Agendamento**: nenhum nesta versão. A sincronização é manual (`npm run sync-osm -- --cidade governador-valadares`), no máximo 1× por dia (uso justo).
9. **Se a sincronização devolver `57014` (statement timeout)**: aumentar o limite do papel do serviço no SQL Editor (`alter role service_role set statement_timeout = '120s';`) e rodar de novo. Não se espera isso: GV deve ter na ordem de centenas de elementos, e cada um faz 2–3 consultas indexadas.
10. **Limpeza dos dados de teste (depois de conferir (e)–(h))**: ação destrutiva em produção, restrita aos ids impressos por `npm run test:relatos`. Rodar no SQL Editor o bloco "limpeza pós-teste" de `supabase\tests\osm_verificacao_pos_sync.sql`, trocando os placeholders:
   ```sql
   delete from public.relatos_pontos where user_id in ('<A>'::uuid, '<B>'::uuid);
   delete from auth.users where id in ('<A>'::uuid, '<B>'::uuid) and is_anonymous;
   -- opcional: eventos de origem do teste (só hashes; somem sozinhos em 2 h)
   delete from public.relatos_origem_eventos where criado_em > now() - interval '2 hours';
   ```
   O `and is_anonymous` impede apagar uma conta real por engano. Os relatos de teste feitos à mão na janela anônima não têm id impresso: localizar com `select id, user_id, ponto_id, criado_em from public.relatos_pontos order by criado_em desc limit 10` e apagar só os próprios, pelo `id`. Os agentes não executam esta etapa.
11. **Opcional: purga horária dos hashes de origem** (fecha o desvio de retenção do §2.3). Database → Extensions → habilitar `pg_cron`. Depois, no SQL Editor: `select cron.schedule('purgar-origem', '0 * * * *', 'select public._purgar_origem_eventos()');`. Para conferir: `select * from cron.job;`. Para desfazer: `select cron.unschedule('purgar-origem');`. O app funciona igual sem este passo.

## 8. Assistente de voz (RF-6)

`d:\ROTASEMBARREIRAS\src\services\voiceActionExecutor.ts` (importa `searchCommunityPointsForVoice` e `rowToCommunityTouristPoint` de `communityPointsService.ts`):

- `communitySummary(row)` devolve:
  ```ts
  {
    name, category, city, address: endereco || "Endereço não informado",
    status: "em_mapeamento",
    fonte: "Comunidade e OpenStreetMap — informação NÃO oficial",
    aviso: "Ainda não temos informações oficiais de acessibilidade deste local.",
    openstreetmap: { horario, telefone, site, cadeira_de_rodas, banheiro_acessivel }, // rótulos pt-BR, omitidos se nulos
    relatado_pela_comunidade: [{ recurso: label, estado: "tem" | "não tem", pessoas: apoiadores }],
    nao_verificado: [labels sem consenso],
  }
  ```
- `get_point_info` / `get_point_history`: se houver match oficial, a resposta é igual à de hoje. Sem match oficial → `searchCommunityPointsForVoice({ texto: query, limite: 1 })`. Achou → `{ point: communitySummary }` + `sideEffect: goToPoint(rowToCommunityTouristPoint(row))`. Não achou → o erro atual.
- `find_points`: resultado oficial como hoje, mais `community_points` (até 3) da RPC com `texto`/`cidade` e `categoria: args.category ?? null` (mesmo filtro de categoria que já se aplica aos oficiais). Com filtro de acessibilidade (`wheelchair` → `entrada`, `braille`, `libras`, `attendance` → `atendimento`; `audio` não existe na comunidade), só entram pontos cujo consenso tenha `tem` para todos os recursos pedidos. Navega para o primeiro oficial; sem oficial, para o primeiro comunitário. O `error` de "nenhum encontrado" só aparece se as duas listas estiverem vazias.
- `list_points_in_city`: resposta atual + `community_points` (até 5) + `community_note: "Locais em mapeamento: dados da comunidade/OpenStreetMap, não oficiais."`.
- `navigate_to_nearest_point`: continua navegando para o oficial mais próximo (prioridade) e acrescenta `nearby_community` (até 3, raio de 1000 m, com `fonte`). Sem oficiais, navega para o comunitário mais próximo.
- `get_top_city`, `play_audio_guide` e `open_libras_video` não mudam (só oficiais; pontos em mapeamento não têm mídia).
- Falha da RPC comunitária: não é fatal. A resposta sai só com oficiais (`[]`) e é logada com `voiceLog("community_search_failed", error)` (o logger existente em `src/lib/voice/logger.ts`, ativo só com `NEXT_PUBLIC_VOICE_DEBUG`).

`d:\ROTASEMBARREIRAS\supabase\functions\voice-token\index.ts`:

- O resumo oficial passa a ser `.eq("status", "oficial").limit(200)`.
- Segunda consulta: `.select("nome, categoria, cidade").eq("status", "em_mapeamento").order("nome").limit(60)` + `count: "exact"`. O resumo vai separado: "Pontos oficiais: …" e "Locais em mapeamento (comunidade/OpenStreetMap, NÃO oficiais; N no total, exemplos): …".
- `buildSystemInstruction` ganha a regra: "Locais em mapeamento e dados do OpenStreetMap NÃO são oficiais. Sempre que citar um deles, diga em poucas palavras que a informação vem da comunidade ou do OpenStreetMap e não é oficial. Dê prioridade aos pontos oficiais nas recomendações. Nunca diga que um local em mapeamento é acessível como fato; diga 'segundo a comunidade' ou 'segundo o OpenStreetMap'."
- As descrições de `find_points`, `get_point_info` e `list_points_in_city` ganham "inclui locais em mapeamento da comunidade, marcados como não oficiais".
- Deploy pelo usuário (§7, item 7).

## 9. Estratégia de verificação

Artefatos de teste novos:

- `d:\ROTASEMBARREIRAS\supabase\tests\osm_em_mapeamento_testes.sql`: fixtures sintéticas em uma única transação `begin; … rollback;`, rodável no SQL Editor quantas vezes for preciso.
  - Pontos de fixture ficam em coordenadas no oceano (`lat -10.0`, `lng -30.0` ± metros), com `cidade = 'QA Teste'` e `osm_id` ≥ 9 000 000 000. Não interferem nos dados reais.
  - Cada caso é um bloco `do $$ … assert …, 'mensagem'; $$`, e um assert falho aborta com a mensagem.
  - Usuários de teste são inseridos em `auth.users` (`id, aud, role, is_anonymous`) dentro da transação.
- `d:\ROTASEMBARREIRAS\supabase\tests\osm_verificacao_pos_sync.sql`: consultas sobre dados reais, em blocos comentados ("rodar antes", "rodar depois"). O snapshot fica no schema `qa`, não exposto pelo PostgREST: `create schema if not exists qa; create table qa.oficiais_antes as select * from public.pontos where status='oficial';`. No fim, `drop schema qa cascade;`.
- `d:\ROTASEMBARREIRAS\scripts\test-relatos-anon.mjs` (`npm run test:relatos`): usa só a **anon key**, passando pelo gateway real (inclui RLS e o caminho do cabeçalho de IP). Imprime PASS/FAIL por caso e sai ≠ 0 se algum falhar. Usa **dois clientes isolados**, um por sessão, porque um único `createClient` guarda uma sessão só e o `signInAnonymously` de B substituiria A: `createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, storageKey: "qa-a" } })` para A e o mesmo com `storageKey: "qa-b"` para B. Todo insert de A (inclusive o forjado com `user_id = B.id` em (g)) usa o cliente de A. Um terceiro cliente sem sessão faz as leituras "públicas" de (e) e (h).

| Teste | Como | Passa quando |
|---|---|---|
| **(a)** idempotência | Rodar `osm_verificacao_pos_sync.sql` §"antes" (contagens de `pontos`, `pontos where origem='osm'`, `pontos_osm`, `candidatos_duplicidade`). Depois `npm run sync-osm -- --cidade governador-valadares` duas vezes seguidas (a 2ª pode ser real ou `--arquivo` com o cache salvo) e o §"depois". | Contagens iguais entre a 1ª e a 2ª execução. As consultas `group by osm_tipo, osm_id having count(*) > 1` em `pontos`, `pontos_osm` e `candidatos_duplicidade` (por `osm_tipo, osm_id, ponto_existente_id`) voltam vazias. Relatório da 2ª (com os mesmos dados, ou seja, `--arquivo` com o cache da 1ª): `criados = 0`, `fila_novos = 0`, `atualizados = 0`, `fila_atualizados = 0`, `fila_descartados = 0`. Com consulta real na 2ª, `atualizados` > 0 só é aceito se o OSM mudou entre as execuções. |
| **(b)** 22 oficiais intactos | Snapshot `qa.oficiais_antes` antes da 1ª sincronização. Depois, a consulta compara coluna a coluna, para todas as colunas do snapshot exceto `atualizado_em` e as novas (`osm_*`, `geog`, `nome_normalizado`, `status`, `origem`): se o valor antes não era nulo/vazio, ele tem que ser igual depois. | `count(*) = 22` e mesmos `id`s. Zero linhas na consulta de diferenças. Zero pontos `em_mapeamento` a ≤ 60 m de um oficial com nome similar. Zero `em_mapeamento` a ≤ 150 m com nome similar ou mesma categoria, exceto os com `candidatos_duplicidade.status='separado'`. |
| **(c)** fila de ambíguos | `osm_em_mapeamento_testes.sql`, casos C1–C5: oficial fixture "Praça Fixture" (Lazer). Elementos: a 100 m, mesma categoria, nome diferente → fila `pendente`, nada em `pontos`. A 40 m, "Praca Fixture" → vinculado (`pontos.osm_id` preenchido, nome oficial intacto, `endereco` vazio preenchido). A 300 m → `em_mapeamento`. Way + node "Museu Gêmeo" a 20 m → 1 ponto + 2 linhas em `pontos_osm`; o node (primário) sem `addr:*` e o way com `addr:street` → `endereco` preenchido e **mantido** na 2ª execução (C4). Rodar `osm_sync_aplicar` 2× com o mesmo payload → contagens iguais e, na 2ª, `atualizados = 0` e `fila_atualizados = 0`. C6: o elemento da fila (100 m) volta com coordenadas a 300 m → a linha vira `descartado` e o elemento é criado `em_mapeamento`. C7: `separar` de um elemento com outro OSM já criado a 15 m e nome similar → `mesclado: true`, nenhum ponto novo. C8 (área): `npm run test:osm` cobre 2 áreas na resposta → `exit 4`. `admin_resolver_candidato('separar')` como admin fixture → cria ponto. Rodar de novo → não volta para a fila. No real: consulta de invariantes (toda linha da fila com `distancia_m ≤ 150` e (`similaridade ≥ limiar` ou `mesma_categoria`)). No admin: vincular 1 e separar 1, e rodar `--arquivo` com o cache. | Todos os asserts passam. A consulta de invariantes volta vazia. Os candidatos resolvidos não voltam como `pendente`. |
| **(d)** mapa fluido | Manual, Chrome DevTools, `npm run build && npm run start`. Centro de GV, zoom 15–17, comunidade ligada. (1) Network: filtrar `pontos_comunidade_bbox`, arrastar e soltar 5×, com no máximo 1 chamada por parada. Zoom 14 ou toggle desligado: 0 chamadas. (2) Console: `document.querySelectorAll('.rsb-marker--community, .rsb-cluster-marker').length ≤ 150` em zoom 15, 16 e 17. (3) Performance, CPU 4× mais lenta, 10 s de arraste/zoom, sem long task > 200 ms em `communityLayer.ts`/`CustomMap.tsx`. (4) Tocar oficiais e comunitários (seleção, preview, detalhe). | Os quatro itens OK. A fluidez é medida à mão, sem automação. |
| **(e)** relato anônimo | `npm run test:relatos -- --oficial <id> --mapeamento <id>` (os ids saem das consultas de `osm_verificacao_pos_sync.sql`). O script cria a sessão anônima A (`signInAnonymously`), confere `is_anonymous`, insere relato `ok` no oficial e relato com `recursos` no em mapeamento, e relê (select público) as duas linhas com `user_id = A`. Ao final (passando ou não), imprime `TEST_USER_IDS=<A>,<B>` e `TEST_RELATO_IDS=<ids>` para a limpeza (§7 item 10). O texto dos relatos de teste é fixo: "Teste automatizado — pode ser ignorado.", para ser reconhecível se a limpeza atrasar. Também à mão: janela anônima nova do navegador, abrir os dois pontos e enviar sem login nem aviso de conta. | As duas inserções retornam 201 e as linhas aparecem. Na UI, os relatos aparecem nos "relatos recentes". |
| **(f)** 7 dias | O mesmo script repete o insert de A no oficial. Também à mão na mesma janela. | Erro 42501, `relato_bloqueado_ate` não nulo e nenhuma linha nova. A UI mostra "Você já relatou este ponto recentemente…". Um relato de A em outro ponto passa (já coberto pelo relato em mapeamento de (e)). |
| **(g)** personificação | O script cria a sessão B e, com o JWT de A, insere com `user_id = B.id`. Também no SQL (`set local role authenticated` + claims de A). | Erro 42501. Nenhuma linha de A nem de B criada por essa tentativa (select público por `ponto_id` + `user_id`). |
| **(h)** ocultar | No admin `/admin/relatos`, ocultar o relato de (e) no ponto em mapeamento. `npm run test:relatos -- --verificar-oculto <relatoId>` (anon). SQL: caso H1 em `osm_em_mapeamento_testes.sql` (3 relatos "tem" em `entrada` de sessões distintas → `consenso_recursos` traz `entrada/tem/3`; ocultar 1 → nada; o card de condição conta 2). | A linha continua com `oculto = true`. A leitura anon não a traz. A UI não a lista nem a conta. O consenso volta para "não verificado". |
| CA-9 origem | Caso O1 do SQL: `set local request.headers = '{"cf-connecting-ip":"203.0.113.7"}'`, `relatos_por_origem_hora = 3` dentro da transação e 4 inserts de sessões diferentes. Se o Vault não tiver o sal, o caso imprime `SKIP` via `raise notice`. | A 4ª inserção dá erro `origem_rate_limited`. `relatos_origem_eventos` só tem `bytea` de 32 bytes. Eventos com `criado_em` forçado para há 3 h somem no insert seguinte. |
| CA-10 texto | Casos T1–T3 do SQL (281 caracteres, `https://x.com`, `www.x.com` → erros). T4: `<script>alert(1)</script>` grava como texto. À mão: aparece literal na tela e no admin. | Erros com as mensagens certas. Nada é executado. |
| Privilégios (finding 1) | Casos P1–P4 em `osm_em_mapeamento_testes.sql`. P1: `set local role authenticated` + `set local request.jwt.claims = '{"sub":"<admin fixture>","role":"authenticated"}'` (admin fixture: usuário inserido em `auth.users` + `insert into public.profiles (id, is_admin) values (<id>, true)`, que é o que `is_admin()` lê), `insert into pontos (…)` e `update pontos set nome = …` de um ponto fixture. P2: `set local role anon; select * from pontos_comunidade_bbox(-30.01,-10.01,-29.99,-9.99,16,'Lazer')`. P3: `authenticated` comum insere relato com `recursos` válido (CHECK chama `relato_recursos_validos`). P4: `anon` chamando `osm_sync_aplicar`, `_osm_criar` e `select public.suggest_local('QA Fixture', 'Endereço QA', -10.0, -30.0)` → `42501` (as três); a mesma chamada a `suggest_local` como `authenticated` (claims de um usuário fixture) não dá `permission denied` (um erro de negócio é aceito; qualquer linha criada some no `rollback`). Mais uma consulta em `information_schema.routine_privileges` listando o grant de cada função da tabela do §2. | P1–P3 passam sem `permission denied for function`. P4 recusa as três chamadas como `anon` (inclusive `suggest_local`). Os grants batem com a classificação do §2. |
| P5 definer exposta (rodada 2, finding 1) | Bloco independente da tabela, no fim de `osm_em_mapeamento_testes.sql` (e repetido como guarda no fim da migração 03): para cada papel, lista as funções `SECURITY DEFINER` de `public` que o papel pode executar fora da lista permitida. Ver o SQL logo abaixo da tabela. Também chamar, como `anon`, `select public._osm_atualizar_mapeamento(<id fixture>, '{}'::jsonb)`. | As duas consultas voltam `null` (nenhuma função fora da lista). A chamada direta dá `42501` (permission denied). Um nome inesperado (por exemplo uma definer criada à mão no painel) faz o caso falhar com o nome; ele só entra na lista depois de conferido. |
| CA-11 exibição | Manual, em 390 px e 1440 px, com o preview fechado (§3.4): DevTools → Rendering → "Emulate vision deficiencies: Achromatopsia", com um oficial e um comunitário lado a lado (zoom 16). Inspecionar o `aria-label` do pin comunitário e do cluster. Zoom 14: nenhum pin comunitário. Conferir a atribuição nos dois tamanhos e clicar no link. Tab até o chip "Mostrar locais da comunidade", Espaço e Enter. | Distinção por preenchimento visível em cinza. `aria-label` contém "em mapeamento" (pin) e "locais da comunidade" (cluster). Atribuição legível, com links OSM e CARTO, sem sobreposição da barra inferior nem dos botões. Chip começa com `aria-pressed="true"`, alterna por teclado e, desligado, os pins somem e o Network não mostra chamada de bbox. |
| CA-12 tela em mapeamento | SQL, caso H2 em `osm_em_mapeamento_testes.sql`: ponto fixture em mapeamento; 0, 2 e 3 relatos "tem" em `entrada` de sessões distintas; e um cenário 2 "tem" × 1 "nao_tem", cada um chamando `consenso_recursos`. Manual com leitor de tela (NVDA no desktop, TalkBack no mobile) num ponto em mapeamento real com tags OSM. Busca: `rg -n "type=\"file\"\|capture=" src`. | SQL: vazio, vazio, `entrada/tem/3/3`, vazio. O leitor anuncia o título e, logo depois, o aviso exato de RF-4.2. "Fonte: OpenStreetMap" e "Segundo o OpenStreetMap" visíveis e separados; com 3 relatos aparece ✓ e "Relatado pela comunidade (3 pessoas)". A busca não mostra ocorrência nova. |
| CA-13 sugerir local | SQL, caso S1: `verificar_local_existente('Praca Fixture', <lat/lng a 40 m do fixture>)` → 1 linha; o mesmo a 300 m → 0 linhas; nome sem relação a 40 m → 0 linhas. Manual: na sheet "Sugerir um local", escolher um endereço junto de um oficial real com o nome dele; depois um endereço longe de tudo. | SQL conforme. A sheet mostra "Este local já está no mapa", nome, tipo e distância; "Ver local" fecha a sheet e abre o ponto (preview no mobile, side sheet no desktop). Longe, o envio segue como antes. |
| CA-14 promoção | Bloco "promoção" de `osm_verificacao_pos_sync.sql`: anotar `id`, `select count(*) from pontos`, `select count(*) from relatos_pontos where ponto_id = <id>` de um ponto em mapeamento real. Promover no `/admin/pontos` (aba "Em mapeamento"). Repetir as consultas e rodar `select * from public.trilha_pontos where ponto_id = <id>`. Abrir `/pontos` e o mapa (o admin chama `clearPointsCache`). | Mesmo `id`, mesmo `count(*)` de pontos, `status = 'oficial'`, `origem = 'osm'` e `osm_*` preservados, mesma contagem de relatos, uma linha em `trilha_pontos` (trilha automática da cidade), `qr_code_value` não nulo e único, ponto listado em `/pontos` e pin preenchido no mapa. |
| CA-15 consumidores | Depois da sincronização real, com `npm run build && npm run start`: `(Invoke-WebRequest http://localhost:3000/sitemap.xml).Content` contando `/pontos/`; `/llms.txt` contando os pontos listados; abrir `/pontos`; `node --env-file=scripts/.env scripts/generate-qr-codes.mjs --dry-run`; SQL `select count(*) from pontos where status = 'em_mapeamento' and qr_code_value is not null` (busca por QR só acha oficiais). `ExploreBottomSheet` está desativado em `page.tsx`, então não há lista a conferir; a fonte dele (`pointsService`) já está coberta pelo mapa principal. | Cada consumidor mostra exatamente o número de oficiais do snapshot `qa.oficiais_antes` (22, se ninguém promoveu nada no meio). A consulta de QR dá 0. |
| CA-16 voz | Manual, após `npx supabase functions deploy voice-token` (§7 item 7): perguntar "me fala do <ponto em mapeamento>", "o que tem perto de mim?" (num lugar com comunitários em até 1 km) e "me fala do <ponto oficial>". | As duas primeiras respostas citam o ponto e dizem que a informação vem da comunidade/OpenStreetMap e não é oficial. A terceira responde como antes, sem a frase. |
| Policies de relato (finding 7) | Rodar a migração 03 num banco com uma policy extra de INSERT criada à mão (dentro de `begin … rollback`). | A migração aborta com a mensagem da guarda. Sem a policy extra, passa. |
| Diagnóstico de origem | §7 item 5 com `p_ip_esperado`. Caso O2 no SQL: `request.headers` com `cf-connecting-ip` = esperado e XFF `"<esperado>, 10.0.0.1"` → `fonte_recomendada = 'cf-connecting-ip'`; só XFF com o proxy no fim → `xff-primeiro`; nenhum igual → `desligado`. Caso O3: `origem_fonte = 'desligado'` → 4 inserts passam com limite 3. | Saídas conforme o caso, sem IP no retorno. |
| CA-17 Alto Contraste / reduzir movimento | Manual, com Alto Contraste e "Reduzir movimento" ligados no `AccessibilityMenu`: pin comunitário (preto vazado, borda amarela) × oficial (amarelo preenchido); cluster; `MappingNotice` (amarelo/preto); `OsmInfoCard`; `CommunityAccessibilityCard`; **pílulas do `ReportResourcesFieldset`** (opção marcada amarela com texto preto, não marcadas pretas com borda branca, foco amarelo, navegação por Tab + setas); chip "Mostrar locais da comunidade" ligado/desligado; **abas Oficiais/Em mapeamento**, cards e botões de `/admin/duplicidades` e `/admin/relatos`; painel de pré-checagem de `SuggestLocationSheet`. Com reduzir movimento, clique em cluster e seleção não animam. | Todos legíveis e distinguíveis sem depender de cor; nenhuma animação com reduzir movimento. |
| Limpeza pós-teste (finding 4) | Usuário roda §7 item 10 com os ids impressos. Depois, `select count(*) from relatos_pontos where user_id in (<A>,<B>)` e `from auth.users where id in (…)`. | Ambos 0. |
| Script OSM | `npm run test:osm`: query gerada (uma consulta, termina em `out center;`, `["name"]`), fixture real `scripts/osm/fixtures/overpass-gv-amostra.json` (todo node com `lat`/`lon`, todo way/relation com `center`), node sintético sem `lat`/`lon` → erro de coordenadas (exit 4), way sem `center` → só contado em `sem_coordenadas`, classificação pela primeira regra, `shop=*` descartado, centróide de way, ordenação de prioridade, `sanitizeWebsite` (`javascript:` → `null`), backoff (429 com `Retry-After: 2` espera 2 s, 504 → 30/60/120, 3 retentativas e erro, `remark` de timeout é retentado, 400 não é), `filtrosExtras` presentes no seletor `area`, `.a out ids;` presente, resposta com 0 ou 2 elementos `type: "area"` → erro de área (exit 4), 1 área → segue e o elemento `area` é descartado. | Todos os testes passam. |
| Estáticos | `npm run lint`, `npm run build`. Busca: `rg -n "overpass" src` vazio. `rg -n "alert\(\|confirm\(\|dangerouslySetInnerHTML" src` sem ocorrência nova. Migrações rodadas 2× seguidas sem erro. | Tudo limpo. |

SQL do P5 (o mesmo corpo, com `raise exception` no lugar de `assert`, fecha a migração 03):

```sql
do $$
declare
  v_publicas text[] := array['is_admin','verificar_local_existente','consenso_recursos',
                             'buscar_pontos_comunidade','diagnostico_origem'];
  v_auth text[] := v_publicas || array['relato_recente_existe','relato_bloqueado_ate',
                                       'admin_resolver_candidato','admin_ocultar_relato','suggest_local'];
  v text;
begin
  select string_agg(p.proname, ', ') into v
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and has_function_privilege('anon', p.oid, 'execute')
    and p.proname <> all (v_publicas);
  assert v is null, 'SECURITY DEFINER exposta a anon: ' || v;

  select string_agg(p.proname, ', ') into v
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and has_function_privilege('authenticated', p.oid, 'execute')
    and p.proname <> all (v_auth);
  assert v is null, 'SECURITY DEFINER exposta a authenticated: ' || v;
end $$;
```

`has_function_privilege` considera o grant implícito para `PUBLIC` e também os grants diretos a `anon`/`authenticated` vindos das default privileges do Supabase, então pega funções antigas sem revoke (motivo de `handle_new_user` estar na classe de trigger do §2) e funções antigas revogadas só `from public` (motivo do `revoke … from anon` de `suggest_local`, feito antes desta guarda no fechamento do arquivo 03, §2.3). `suggest_local` está só em `v_auth`, nunca em `v_publicas`. Se a guarda da migração 03 acusar um nome não previsto, a migração é revertida e o usuário recebe o nome na mensagem; o implementador avisa o usuário em vez de acrescentar o nome à lista sem conferir.

O que é unitário × integração: normalização, similaridade, decisões de dedup, consenso, limites e RLS são testados no SQL (integração com o Postgres real, sem a Overpass). Query, classificação e backoff são unitários em `node:test`. Gateway + RLS + cabeçalho são integração via `test-relatos-anon.mjs`. Mapa e telas são verificação manual, com os passos acima. O projeto não tem runner de testes de UI, e adicionar um ficaria fora do escopo.

## 10. Ordem de entrega e documentação

1. Usuário faz §7 itens 1–3.
2. Usuário roda as migrações 01→03 (§7.4). O app atual continua funcionando: as colunas novas têm default, o cliente antigo não envia `user_id` (o default `auth.uid()` cobre) e ainda bloqueia anônimos na UI. Não há mudança visível até o deploy.
3. Deploy do app (Vercel) com o código novo. O filtro `status` exige o passo 2 antes. Se o deploy vier antes, o mapa mostra o cache local e falha ao revalidar.
4. Usuário faz §7 itens 5–7.
5. `npm run sync-osm -- --cidade governador-valadares --dry-run` (revisar contagens e calibrar o limiar, §11) → execução real.

Documentação a atualizar (só arquivos existentes):

- `d:\ROTASEMBARREIRAS\docs\SUPABASE_PONTOS_SETUP.md`: três linhas novas na tabela 1.1 e a seção "OSM em mapeamento" com os passos do §7.
- `d:\ROTASEMBARREIRAS\docs\analytics-eventos.md`: `relato_enviado.status_ponto` e `filtro_aplicado.tipo = "comunidade"`.
- `d:\ROTASEMBARREIRAS\scripts\.env.example`.

## 11. Calibração do limiar (D-4)

O dry-run devolve só contagens, e o SQL Editor não lê o arquivo de cache local. Por isso a calibração usa os dados já sincronizados. A consulta em `osm_verificacao_pos_sync.sql` (§"calibração") roda depois da 1ª execução real e lista também as linhas da fila com sua `similaridade`. Ela lista os pares (oficial × `em_mapeamento`) a ≤ 150 m com `nome_similaridade` entre 0,35 e 0,7, ordenados. Se aparecer um falso negativo claro (mesmo lugar com score < 0,55), o usuário baixa `similaridade_min`, rodando `update public.mapeamento_config set similaridade_min = 0.5;`. Os pontos já criados não se desfazem sozinhos: excluir no admin (vira ignorado em `pontos_osm`) e usar "Promover"/"Vincular", ou rodar de novo depois de excluir. Esse é o motivo de recomendar o dry-run antes da primeira execução real.

## 12. Tratamento de erros (resumo por operação)

| Operação | Falha | Tipo | O que o chamador recebe | Log |
|---|---|---|---|---|
| Overpass | 429/5xx/rede/timeout/remark | Recuperável até 3×, depois fatal | `exit 3`, nada gravado | stdout em cada tentativa, stderr no fim |
| Overpass | outro 4xx | Fatal | `exit 3` com status e corpo (300 caracteres) | stderr |
| Overpass | 0 elementos, ou área casou com 0 ou mais de 1 relação | Fatal | `exit 4`, nada gravado | stderr |
| Overpass | node sem `lat`/`lon` na resposta | Fatal | `exit 4` com a contagem e a dica de verbosidade, nada gravado | stderr |
| Overpass | way/relation sem `center` | Recuperável | Descartado, contado em `sem_coordenadas` | No relatório |
| Promover (admin) | busca dos QR oficiais falha / `23505` em `qr_code_value` | Recuperável | Mensagem inline no modal, nada gravado | Nenhum |
| Migração 03 | função `SECURITY DEFINER` de `public` executável por `anon`/`authenticated` fora da lista (guarda P5) | Fatal | Exceção com o nome da função, migração revertida | SQL Editor |
| `osm_sync_aplicar` | payload/cidade inválidos | Fatal | P0001 `payload_invalido` / `cidade_invalida` / `payload_grande_demais` → `exit 5` | stderr |
| `osm_sync_aplicar` | elemento inválido | Recuperável | Contado em `invalidos` | No relatório |
| `osm_sync_aplicar` | exceção qualquer / timeout | Fatal | Rollback total → `exit 5` | stderr |
| RPC bbox | rede/abort/`bbox_*` | Recuperável | Marcadores mantidos, nova tentativa no próximo movimento | `console.warn` só em dev |
| Abrir ponto comunitário | `null`/erro | Recuperável | Nada abre, `aria-live` "Não foi possível abrir este local agora." | Nenhum |
| `consenso_recursos` (UI) | erro | Recuperável | Tudo "não verificado" | Nenhum |
| `createRelato` | texto/origem/7 dias/sessão/genérico | Recuperável | `RelatoError.code` + mensagem inline no formulário | Nenhum (sem texto do usuário) |
| Trigger de origem | sem sal | Recuperável (fail-open) | Insert segue | `RAISE WARNING` no log do Postgres |
| Trigger de origem | sem cabeçalho | Recuperável | Insert segue | Nenhum |
| `verificar_local_existente` | erro | Recuperável | Envio/cadastro segue sem checagem | `console.warn` em dev |
| `admin_resolver_candidato` | `forbidden` / `candidato_ja_resolvido` / `acao_invalida` / `candidato_nao_encontrado` | Recuperável | Banner inline + recarregar lista | Nenhum |
| `admin_ocultar_relato` | `forbidden` / `relato_nao_encontrado` | Recuperável | Banner inline | Nenhum |
| Assistente: busca comunitária | erro | Recuperável | Resposta só com oficiais | `voiceLog` (debug) |
| Migração 01 | extensão fora de `extensions` | Fatal | Exceção com instrução (correção no §7 item 1) | SQL Editor |
| Migração 03 | policy extra de INSERT/ALL em `relatos_pontos` | Fatal | Exceção, migração revertida | SQL Editor |
| `diagnostico_origem` | `p_ip_esperado` não é IP | Recuperável | P0001 `ip_invalido` | Nenhum (valor não é logado) |
| `buscar_pontos_comunidade` | parâmetro acima do limite | Recuperável | P0001 `parametro_invalido` → executor trata como erro da busca comunitária (resposta só com oficiais) | `voiceLog` (debug) |
| RPC bbox | linha `truncado` | Recuperável | Linha ignorada no desenho | `console.warn` só em dev |
| Trigger de origem | `origem_fonte = 'desligado'` | Configuração | Insert segue sem limite por origem | Nenhum |

## 13. Invariantes e quem as garante

- **Unicidade OSM**: o banco (`pontos_osm` PK + `pontos_osm_elemento_key` + `candidatos_elemento_ponto_key`). A RPC é a única escritora e roda em transação, e as constraints garantem que nem uma corrida duplica.
- **Oficial nunca sobrescrito pelo OSM**: `_osm_vincular` (SET só com `coalesce(nullif(campo,''), osm)`), única função que escreve OSM em ponto oficial. Testado em C2 e (b).
- **`user_id = auth.uid()`**: RLS `WITH CHECK`, porque é a única camada que o cliente não contorna. O trigger não reescreve.
- **7 dias contando ocultos**: `relato_recente_existe` (definer) dentro da policy.
- **`criado_em` não forjável e não inserir já oculto**: trigger `ensure_relato_identity`.
- **Limite por origem**: trigger no banco (§5.4).
- **Ocultos fora da leitura e do consenso**: policy de SELECT + filtro explícito em `consenso_recursos`, `attachConditions` e `fetchRelatosForPoint`.
- **Só oficiais em trilhas, páginas públicas, QR e mapa principal**: trigger de trilha (banco) + filtros nos consumidores (app).
- **Promoção reaproveita o registro**: UPDATE por `id` no admin. Não existe caminho de INSERT na promoção.
- **Overpass só no servidor**: não existe código em `src/`, verificado por busca.
- **Privilégios de função**: a classificação do §2 é a fonte; cada migração termina com o bloco de grants/revokes. Helpers puros nunca são revogados, porque triggers invoker, CHECK e RPCs invoker dependem deles. Testado em P1–P4.
- **Uma única policy de INSERT em `relatos_pontos`**: guarda `do $$` na migração 03.
- **Nenhuma definer pública fora da lista**: guarda P5 no fim da migração 03 (banco), porque só o catálogo vê todas as funções, inclusive as criadas fora das migrações.
- **`geog`/`nome_normalizado` derivados de `nome`/`latitude`/`longitude`**: trigger `pontos_derivados`, disparado também por escrita direta nessas colunas.
- **Sincronização estável**: `_osm_atualizar_mapeamento` não grava nulo sobre valor existente e não compara `osm_sincronizado_em`; a fila só muda `atualizado_em` quando algo muda. Testado em C4 e no relatório da 2ª execução de (a).
- **Fila só com ambíguos reais**: descarte automático no passo 3 + reabertura controlada no passo 5.

## 14. Lista de arquivos

Novos:

- `supabase\migrations_osm_01_pontos_geo.sql`, `supabase\migrations_osm_02_dedup_sync.sql`, `supabase\migrations_osm_03_relatos_comunidade.sql`
- `supabase\tests\osm_em_mapeamento_testes.sql`, `supabase\tests\osm_verificacao_pos_sync.sql`
- `scripts\sync-osm.mjs`, `scripts\osm\config.mjs`, `scripts\osm\transform.mjs`, `scripts\osm\overpass.mjs`, `scripts\osm\transform.test.mjs`, `scripts\osm\overpass.test.mjs`, `scripts\osm\fixtures\overpass-gv-amostra.json`, `scripts\test-relatos-anon.mjs`
- `src\components\map\communityLayer.ts`, `src\components\map\escapeHtml.ts`
- `src\components\point\MappingNotice.tsx`, `src\components\point\OsmInfoCard.tsx`, `src\components\point\CommunityAccessibilityCard.tsx`, `src\components\point\ReportResourcesFieldset.tsx`
- `src\lib\communityResources.ts`, `src\lib\relatoText.ts`
- `src\services\communityPointsService.ts`, `src\services\relatosAdminService.ts`, `src\services\duplicidadesAdminService.ts`
- `src\app\admin\relatos\page.tsx`, `src\app\admin\duplicidades\page.tsx`

Alterados:

- `src\components\CustomMap.tsx`, `src\app\page.tsx`, `src\app\globals.css`
- `src\components\BottomSheet.tsx`, `src\components\PointDetails.tsx`, `src\components\SuggestLocationSheet.tsx`
- `src\services\pointsService.ts`, `src\services\voiceActionExecutor.ts`, `src\lib\pontosPublic.ts`, `src\lib\analytics.ts`
- `src\types\database.ts`, `src\types\point.ts`
- `src\app\admin\layout.tsx`, `src\app\admin\page.tsx`, `src\app\admin\pontos\page.tsx`
- `supabase\functions\voice-token\index.ts`, `scripts\generate-qr-codes.mjs`, `scripts\.env.example`
- `package.json` (só `scripts`), `.gitignore`
- `docs\SUPABASE_PONTOS_SETUP.md`, `docs\analytics-eventos.md`

Todos os caminhos são relativos a `d:\ROTASEMBARREIRAS\`.

Não mudam: `src\proxy.ts`, `next.config.ts`, `RatingModal.tsx` (avaliação do site, não é relato de ponto), `AuthContext.tsx` (o fluxo anônimo já existe; a recuperação de sessão para relato fica em `createRelato`), migrações antigas, bucket `pontos-imagens` e galeria.

## 15. Riscos e suposições adicionais

- `cf-connecting-ip` em `request.headers` não pôde ser confirmado daqui. Por isso existe o diagnóstico (§7.5) e a fonte é configurável. No pior caso (nenhum cabeçalho confiável), o limite por origem fica fail-open e o limite de 7 dias + o rate limit de criação de anônimos do Auth seguem valendo.
- A área administrativa de GV no OSM é o município inteiro (inclui zona rural). Isso é aceitável, porque só entram tags da lista. Se a relação não for encontrada, `exit 4` avisa e nada é gravado.
- Duas inserções simultâneas da mesma sessão no mesmo ponto podem passar a regra de 7 dias (janela de milissegundos). O risco é aceito: o botão fica desabilitado durante o envio.
- Tamanho do corpo de `p_elementos` no gateway (até 10 000 elementos, alguns MB) não foi verificado. Para GV (centenas de elementos, dezenas de KB) não importa. Se um dia passar do limite, o script divide em lotes por `ordem`, o que é seguro porque cada lote vê os pontos criados pelos anteriores (backlog).
- Elementos removidos do OSM não são apagados (A-5). Elementos cujo ponto foi excluído no admin ficam ignorados para sempre (`pontos_osm.ponto_id = null`). Reverter isso é feito apagando a linha no Table Editor.
- O código IBGE `3127701` de GV no OSM (`IBGE:GEOCODIGO`) precisa ser confirmado pelo usuário na relação do município antes da 1ª execução. Se a tag não existir, a área sem ela continua protegida pela checagem de "mais de uma área".

## 16. Respostas ao design review

### Revisão 4 (rodada 3 do review)

| # | Sev. | Resposta | Onde |
|---|---|---|---|
| 1 | HIGH | **Resolvido.** O fechamento do arquivo 03 ganha `revoke execute on function public.suggest_local(text, text, double precision, double precision) from anon;` **antes** da guarda P5 (aditivo, sem editar `migrations_sugestoes.sql`; o `grant … to authenticated` continua). `suggest_local` sai de "Existentes, sem mudança" e vai para a nova linha "Existentes, privilégio corrigido na migração 03". Regra geral registrada: toda função existente avaliada pela guarda precisa de `revoke … from anon` (ou `from anon, authenticated`) explícito, não só `from public`. P4 passa a chamar `suggest_local` como `anon` esperando `42501` (e como `authenticated`, sem `permission denied`). | §2 Regras transversais, §2.3 (fechamento do arquivo 03), §9 (P4 e nota do P5) |
| 2 | NIT | **Resolvido no design (opção de registro).** Item novo no §1: RF-1.3 atendido com `out center;` no lugar de `out center tags;`, com o motivo no §4.2. `requirements.md` não foi alterado. | §1 |
| 3 | NIT | **Resolvido com `set search_path`.** A regra transversal passa a valer para toda função nova (definer ou invoker, sql ou plpgsql); `pontos_comunidade_bbox` declara `set search_path = public, extensions` explicitamente. Para não deixar exceções, `relato_recente_existe`, `relato_bloqueado_ate`, `relatos_limite_origem` e `_purgar_origem_eventos`, que apareciam com `set search_path = public`, foram alinhadas para `public, extensions` (sem mudança de comportamento: elas não usam extensões). Operadores não são qualificados com `operator(extensions.&&)`; a cláusula é a forma única usada em todo o design. O caso P2 (anon chamando a bbox) cobre a verificação. | §2 Regras transversais, §2.2, §2.3 |

### Rodada 2

| # | Sev. | Resposta | Onde |
|---|---|---|---|
| 1 | HIGH | **Resolvido.** `_osm_atualizar_mapeamento` entra em "Internas de sincronização" (revoke de `public, anon, authenticated`, sem grant). `handle_new_user` (definer antiga sem revoke) entra na classe de trigger. Novo caso P5, independente da tabela, para `anon` e `authenticated`, com listas permitidas que incluem as definer existentes conferidas (`is_admin`, `suggest_local`); o mesmo bloco fecha a migração 03 como guarda fatal. Chamada direta a `_osm_atualizar_mapeamento` como anon deve dar 42501. | §2 Regras transversais, §9, §12, §13 |
| 2 | MEDIUM | **Resolvido.** Linhas CA-11 a CA-16 no §9, com passos e critérios (achromatopsia, `aria-label`, toggle por teclado; caso SQL H2 + leitor de tela; caso SQL S1 + manual; `id`/`count(*)`/`trilha_pontos`; contagem em sitemap, `llms.txt`, `/pontos`, QR `--dry-run`; voz com e sem frase de procedência). `generate-qr-codes.mjs` ganha `--dry-run` para isso. `ExploreBottomSheet` está desativado, então fica registrado como não aplicável. | §3.1, §9 |
| 3 | NIT | **Resolvido de forma mais forte que o sugerido.** A query passa a usar `out center;` desde o início (não depende de comportamento não confirmado de `tags`). Guarda: node sem `lat`/`lon` → `exit 4`; way/relation sem `center` → descartado e contado. Fixture com resposta real em `scripts\osm\fixtures\`. | §4.2, §4.3, §9, §12 |
| 4 | NIT | **Resolvido.** Base `where p.status = 'em_mapeamento'` declarada. | §2.2 |
| 5 | NIT | **Resolvido.** Registrado como desvio a apresentar no relatório final (junto com OSM×OSM) e passo opcional `pg_cron` horário no §7 item 11. O núcleo continua sem depender de `pg_cron`. | §2.3, §7 |
| 6 | NIT | **Resolvido.** Na promoção, QR calculado contra `fetchAllPontosAdmin("oficial")`; `23505` em `qr_code_value` vira mensagem inline. | §6.3, §12 |
| 7 | NIT | **Resolvido.** `p_max_itens: 149`; pin selecionado criado a partir do `TouristPoint` de `setSelected`, guardado fora da reconciliação, removido ao desselecionar ou quando o ponto é oficial. | §3.3 |
| 8 | NIT | **Resolvido.** Dois clientes com `persistSession: false` e `storageKey` distintos, mais um cliente sem sessão para as leituras públicas. | §9 |
| 9 | NIT | **Resolvido.** Trigger `before insert or update of nome, latitude, longitude, geog, nome_normalizado`, sempre recalculando. | §2.1, §13 |
| 10 | NIT | **Decidido (opção a).** A atribuição fica oculta só enquanto o preview do ponto está aberto; não é a "sheet recolhida" de RF-3.9. CA-11 é verificado com o preview fechado. | §3.4, §9 |

Suposições não verificadas da rodada 2: o nome da tabela de vínculo foi conferido (`public.trilha_pontos`, `migrations_trilhas.sql`). Seguem dependentes de verificação em produção, já cobertas por diagnóstico: `cf-connecting-ip` em `request.headers` (§7 item 5) e leitura do Vault pelo dono (`sal_configurado`). O limite de corpo do gateway segue no §15.

### Rodada 1

| # | Sev. | Resposta | Onde |
|---|---|---|---|
| 1 | HIGH | **Resolvido.** Classificação fechada de privilégios por função: helpers puros com grant para `anon, authenticated, service_role` e nunca revogados; `relato_recursos_validos` para `authenticated`; triggers e internas revogadas; `osm_sync_aplicar` só `service_role`. Casos P1–P4 (admin insere/edita ponto, anon chama bbox com categoria, CHECK de recursos, anon barrado na sync). | §2 Regras transversais, §9, §13 |
| 2 | MEDIUM | **Resolvido.** `_osm_atualizar_mapeamento` usa `coalesce(osm, atual)` em `endereco`/`osm_*`, compara sem `osm_sincronizado_em`; fila só toca `atualizado_em` quando muda. C4 e (a) exigem `atualizados = 0` na 2ª execução com o mesmo dado. | §2.2, §9 |
| 3 | MEDIUM | **Resolvido.** `diagnostico_origem(p_ip_esperado)` devolve só booleanos `*_igual_esperado` + `fonte_recomendada`; regra = igual ao esperado E não sentinela; `'desligado'` no CHECK e no trigger (fail-open explícito). Caso O2/O3. | §2.1, §2.3, §7 item 5, §9 |
| 4 | MEDIUM | **Resolvido.** Script imprime `TEST_USER_IDS`/`TEST_RELATO_IDS` e usa texto fixo reconhecível; bloco "limpeza pós-teste" em `osm_verificacao_pos_sync.sql`, executado pelo usuário (§7 item 10), restrito a ids de teste e `is_anonymous`. | §7, §9 |
| 5 | MEDIUM | **Resolvido.** Pílulas `.rsb-choice` com `:has(input:checked)` e regras HC explícitas (amarelo/preto, foco amarelo), sem transição; abas e botões admin com `bg-brand` literal; `MappingNotice` passa a `bg-brand-light` sem opacidade para casar com a regra HC. Tudo no checklist CA-17. | §5.1, §6.3, §6.4, §9 |
| 6 | MEDIUM | **Resolvido.** `buscar_pontos_comunidade(…, p_categoria)` com a semântica do bbox; executor passa `args.category`. | §2.2, §3.3, §8 |
| 7 | NIT | **Resolvido.** Guarda `do $$` em `pg_policies` no fim da migração 03 + caso de teste. | §2.3, §9 |
| 8 | NIT | **Resolvido.** `_purgar_origem_eventos()` chamada pelo trigger, `osm_sync_aplicar` (fora do dry-run), `admin_ocultar_relato` e `diagnostico_origem`. `pg_cron` fica no **backlog**: exigiria habilitar extensão e agendamento no painel, e os gatilhos acima já cobrem o uso real. | §2.3 |
| 9 | NIT | **Resolvido.** `<section aria-labelledby aria-describedby>` no lugar de `role="dialog"`; `MappingNotice` vira `role="note"` com o id referenciado. | §5.1, §5.2 |
| 10 | NIT | **Resolvido.** `communityPinHtml` definido com o markup de `pinHtml` e `stroke="currentColor"`; teclado via `keypress` Enter/Espaço como os oficiais (responde também à suposição não verificada sobre Espaço). | §3.3, §3.6 |
| 11 | NIT | **Resolvido.** Correção documentada (`alter extension … set schema extensions`; PostGIS drop/recreate só sem dependências). | §2.1, §7 item 1 |
| 12 | NIT | **Resolvido.** Passo 3 descarta pendentes que deixaram de ser ambíguas e, se não sobrar nenhuma, o elemento segue para os passos 4–7; passo 5 reabre `descartado`. Caso C6. | §2.2, §9 |
| 13 | NIT | **Mantido, com comunicação.** A decisão continua (fila sem lixo de vizinhos), marcada como desvio a apresentar ao usuário no relatório final, com reversão de uma linha. | §1 |
| 14 | NIT | **Resolvido.** `separar` usa `_osm_criar_ou_mesclar(…, p_permitir_fila => false)`; mescla se já houver OSM ≤ 60 m com nome similar. Caso C7. | §2.2, §9 |
| 15 | NIT | **Resolvido.** `area.filtrosExtras` (IBGE, a confirmar) + `.a out ids;` na mesma consulta; 0 ou >1 área → `exit 4`. | §4.2, §9, §15 |
| 16 | NIT | **Resolvido.** Grade também em zoom ≥ 18 quando passa do limite, até 6 dobras, e linha `truncado` ignorada na UI e logada em dev. | §2.2, §3.3 |

Suposições não verificadas do review: `cf-connecting-ip` segue dependente do diagnóstico (agora conclusivo com `p_ip_esperado`); leitura do Vault pelo dono das funções é refletida por `sal_configurado`, que usa a mesma consulta do trigger; limite de corpo do gateway está em §15; Espaço nos marcadores está coberto pelo `keypress` explícito.
