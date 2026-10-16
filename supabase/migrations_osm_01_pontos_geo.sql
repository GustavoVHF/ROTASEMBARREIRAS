-- ============================================================
-- Rota sem Barreiras — OSM "Em mapeamento" (1/3): camada geo + normalização
-- ADDITIVE ONLY. Não apaga nada das migrações anteriores.
-- Idempotente: pode rodar mais de uma vez (if not exists / or replace /
-- drop ... if exists + create / constraints nomeadas em blocos do $$).
-- Ordem: 01 -> 02 -> 03, no SQL Editor do Supabase.
--
-- Pré-requisito (painel do Supabase, feito pelo usuário):
--   Database -> Extensions -> habilitar postgis, pg_trgm e unaccent
--   no schema "extensions". Ver docs/SUPABASE_PONTOS_SETUP.md §OSM.
-- ============================================================

-- ---------- Extensões (guardas) ----------
create schema if not exists extensions;

do $$
declare
  r record;
  v_qtd integer;
begin
  create extension if not exists postgis with schema extensions;
  create extension if not exists pg_trgm with schema extensions;
  create extension if not exists unaccent with schema extensions;

  for r in
    select e.extname, n.nspname
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname in ('postgis', 'pg_trgm', 'unaccent')
  loop
    if r.nspname <> 'extensions' then
      raise exception 'Extensão % está no schema %, esperado extensions. Ver docs/SUPABASE_PONTOS_SETUP.md §OSM.',
        r.extname, r.nspname;
    end if;
  end loop;

  select count(*) into v_qtd from pg_extension
  where extname in ('postgis', 'pg_trgm', 'unaccent');
  if v_qtd < 3 then
    raise exception 'Extensões postgis, pg_trgm e unaccent precisam estar habilitadas no schema extensions. Ver docs/SUPABASE_PONTOS_SETUP.md §OSM.';
  end if;
end $$;

-- ---------- Config única (uma linha) ----------
-- Lida só pelas funções SECURITY DEFINER. Editar pelo Table Editor ou SQL Editor.
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

-- ---------- Normalização de nome (lugar único, RF-2.2) ----------
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
  -- Lista de prefixos genéricos (editar aqui; depois rodar o refresh do backfill abaixo
  -- com "where true").
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

-- Mesma semântica do filtro do mapa: "Patrimônio" casa com "Patrimônio Histórico".
create or replace function public.categoria_compativel(p_oficial text, p_osm text) returns boolean
language sql immutable parallel safe
set search_path = public, extensions
as $$ select coalesce(p_osm,'') <> '' and
  lower(public.f_unaccent(coalesce(p_oficial,''))) like '%' || lower(public.f_unaccent(p_osm)) || '%' $$;

-- ---------- Colunas novas em pontos ----------
alter table public.pontos add column if not exists status text not null default 'oficial';
alter table public.pontos add column if not exists origem text not null default 'oficial';
alter table public.pontos add column if not exists osm_tipo text;
alter table public.pontos add column if not exists osm_id bigint;
alter table public.pontos add column if not exists osm_wheelchair text;
alter table public.pontos add column if not exists osm_toilets_wheelchair text;
alter table public.pontos add column if not exists osm_opening_hours text;
alter table public.pontos add column if not exists osm_phone text;
alter table public.pontos add column if not exists osm_website text;
alter table public.pontos add column if not exists osm_sincronizado_em timestamptz;
alter table public.pontos add column if not exists nome_normalizado text not null default '';
alter table public.pontos add column if not exists geog extensions.geography(Point, 4326);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pontos_status_check') then
    alter table public.pontos add constraint pontos_status_check
      check (status in ('oficial', 'em_mapeamento'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pontos_origem_check') then
    alter table public.pontos add constraint pontos_origem_check
      check (origem in ('oficial', 'osm'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pontos_osm_tipo_check') then
    alter table public.pontos add constraint pontos_osm_tipo_check
      check (osm_tipo in ('node', 'way', 'relation'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pontos_osm_par_check') then
    alter table public.pontos add constraint pontos_osm_par_check
      check ((osm_tipo is null) = (osm_id is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pontos_osm_tags_tamanho_check') then
    alter table public.pontos add constraint pontos_osm_tags_tamanho_check
      check (
        (osm_wheelchair is null or char_length(osm_wheelchair) <= 32)
        and (osm_toilets_wheelchair is null or char_length(osm_toilets_wheelchair) <= 32)
        and (osm_opening_hours is null or char_length(osm_opening_hours) <= 255)
        and (osm_phone is null or char_length(osm_phone) <= 255)
      );
  end if;
  -- Impede javascript: e afins em link.
  if not exists (select 1 from pg_constraint where conname = 'pontos_osm_website_check') then
    alter table public.pontos add constraint pontos_osm_website_check
      check (osm_website is null or osm_website ~* '^https?://');
  end if;
  -- Unicidade do elemento OSM primário (vários NULL são permitidos).
  if not exists (select 1 from pg_constraint where conname = 'pontos_osm_elemento_key') then
    alter table public.pontos add constraint pontos_osm_elemento_key unique (osm_tipo, osm_id);
  end if;
end $$;

create index if not exists pontos_geog_gist on public.pontos using gist (geog);
create index if not exists pontos_nome_norm_trgm on public.pontos using gin (nome_normalizado extensions.gin_trgm_ops);
create index if not exists pontos_status_idx on public.pontos (status);

-- ---------- Trigger de derivados (geog + nome_normalizado) ----------
-- Sempre recalcula a partir de nome/latitude/longitude (fonte da verdade);
-- o valor enviado em geog/nome_normalizado é descartado.
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

-- ---------- Backfill sem mexer em atualizado_em dos oficiais ----------
-- Depois de editar a lista de prefixos de normalizar_nome_local, rodar este
-- mesmo bloco trocando o "where" por "where true".
alter table public.pontos disable trigger pontos_set_atualizado_em;
update public.pontos set
  geog = extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography,
  nome_normalizado = public.normalizar_nome_local(nome)
where geog is null or nome_normalizado = '';
alter table public.pontos enable trigger pontos_set_atualizado_em;
alter table public.pontos alter column geog set not null;

-- ---------- Trilha automática só para oficiais (RF-3.3) ----------
-- Mesmo corpo de migrations_trilhas.sql, com o retorno antecipado por status.
-- O trigger passa a disparar também em "update of status": a promoção de um
-- ponto em mapeamento a oficial vincula a trilha da cidade.
create or replace function public.sync_ponto_auto_trilha()
returns trigger
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  v_trilha_id uuid;
  v_next_ordem integer;
begin
  -- Pontos em mapeamento não entram em trilhas.
  if new.status is distinct from 'oficial' then
    return new;
  end if;

  if new.cidade is null or trim(new.cidade) = '' then
    return new;
  end if;

  select id into v_trilha_id
  from public.trilhas
  where cidade = new.cidade and is_auto = true
  limit 1;

  if v_trilha_id is null then
    insert into public.trilhas (titulo, descricao, cidade, is_auto)
    values (
      'Trilha ' || new.cidade,
      'Explore os pontos turísticos cadastrados em ' || new.cidade || '.',
      new.cidade,
      true
    )
    returning id into v_trilha_id;
  end if;

  select coalesce(max(ordem), -1) + 1 into v_next_ordem
  from public.trilha_pontos
  where trilha_id = v_trilha_id;

  insert into public.trilha_pontos (trilha_id, ponto_id, ordem)
  values (v_trilha_id, new.id, v_next_ordem)
  on conflict (trilha_id, ponto_id) do nothing;

  return new;
end;
$$;

drop trigger if exists pontos_sync_auto_trilha on public.pontos;
create trigger pontos_sync_auto_trilha
  after insert or update of cidade, status on public.pontos
  for each row execute procedure public.sync_ponto_auto_trilha();

-- ---------- Vínculo de elementos OSM (D-14) ----------
-- Todo elemento OSM ligado a um ponto. ponto_id nulo = elemento ignorado
-- (ponto excluído pelo admin), para a exclusão não "voltar" na próxima sync.
create table if not exists public.pontos_osm (
  osm_tipo text not null check (osm_tipo in ('node','way','relation')),
  osm_id bigint not null check (osm_id > 0),
  ponto_id uuid references public.pontos(id) on delete set null,
  papel text not null check (papel in ('primario','secundario','vinculado')),
  criado_em timestamptz not null default now(),
  primary key (osm_tipo, osm_id)
);
create index if not exists pontos_osm_ponto_idx on public.pontos_osm (ponto_id);
alter table public.pontos_osm enable row level security;
revoke all on public.pontos_osm from anon;

drop policy if exists "pontos_osm_select_admin" on public.pontos_osm;
create policy "pontos_osm_select_admin" on public.pontos_osm
  for select to authenticated using (public.is_admin());

-- A policy de SELECT pública de pontos não muda: o bbox e o detalhe precisam
-- ler pontos em mapeamento como anon.

-- ---------- Privilégios das funções criadas aqui ----------
-- Helpers puros: usados por trigger invoker, CHECK e RPC invoker. Nunca revogar.
grant execute on function public.f_unaccent(text) to anon, authenticated, service_role;
grant execute on function public.normalizar_nome_local(text) to anon, authenticated, service_role;
grant execute on function public.nome_similaridade(text, text) to anon, authenticated, service_role;
grant execute on function public.categoria_compativel(text, text) to anon, authenticated, service_role;

-- Funções de trigger: EXECUTE só é checado no CREATE TRIGGER; revogar evita chamada direta.
revoke execute on function public.pontos_sync_derivados() from public, anon, authenticated;
revoke execute on function public.sync_ponto_auto_trilha() from public, anon, authenticated;
