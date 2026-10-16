-- ============================================================
-- Rota sem Barreiras — OSM "Em mapeamento" (2/3): deduplicação + sincronização
-- ADDITIVE ONLY. Idempotente. Rodar depois de migrations_osm_01_pontos_geo.sql.
--
-- Toda a decisão de criar / vincular / mesclar / mandar para revisão fica
-- aqui, na RPC transacional osm_sync_aplicar, chamada só pelo script
-- scripts/sync-osm.mjs (service_role). O navegador nunca fala com a Overpass.
--
-- Desvio deliberado (a confirmar com o usuário): entre dois elementos do
-- próprio OSM a fila de revisão usa só "nome similar" (não "mesma categoria"),
-- porque restaurantes/igrejas vizinhos no OSM são, por padrão, lugares
-- distintos. Reversão: no passo 6 (_osm_criar_ou_mesclar), trocar
-- "c.sim >= v_cfg.similaridade_min" por "(c.sim >= v_cfg.similaridade_min or c.mesma_cat)".
-- ============================================================

-- ---------- Fila de revisão ----------
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
  atualizado_em timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'candidatos_elemento_ponto_key') then
    alter table public.candidatos_duplicidade
      add constraint candidatos_elemento_ponto_key unique (osm_tipo, osm_id, ponto_existente_id);
  end if;
end $$;

create index if not exists candidatos_status_idx on public.candidatos_duplicidade (status, distancia_m);
alter table public.candidatos_duplicidade enable row level security;
revoke all on public.candidatos_duplicidade from anon;

-- Sem policy de escrita: as escritas só acontecem pelas RPCs.
drop policy if exists "candidatos_select_admin" on public.candidatos_duplicidade;
create policy "candidatos_select_admin" on public.candidatos_duplicidade
  for select to authenticated using (public.is_admin());

-- ---------- Log de execuções ----------
create table if not exists public.osm_sync_execucoes (
  id bigint generated always as identity primary key,
  cidade text not null,
  dry_run boolean not null default false,
  relatorio jsonb not null,
  executado_em timestamptz not null default now()
);
alter table public.osm_sync_execucoes enable row level security;
revoke all on public.osm_sync_execucoes from anon;

drop policy if exists "osm_sync_execucoes_select_admin" on public.osm_sync_execucoes;
create policy "osm_sync_execucoes_select_admin" on public.osm_sync_execucoes
  for select to authenticated using (public.is_admin());

-- ============================================================
-- Funções internas (SECURITY DEFINER; EXECUTE revogado no fim do arquivo)
-- Todas recebem o elemento no formato do design §4.4.
-- ============================================================

-- Devolve o elemento saneado, ou null se inválido.
create or replace function public._osm_validar(p_el jsonb) returns jsonb
language plpgsql immutable security definer
set search_path = public, extensions
as $$
declare
  v_tipo text;
  v_id bigint;
  v_nome text;
  v_cat text;
  v_lat double precision;
  v_lng double precision;
  v_web text;
  v_phone text;
  v_end text;
begin
  if p_el is null or jsonb_typeof(p_el) <> 'object' then
    return null;
  end if;

  v_tipo := p_el->>'osm_tipo';
  if v_tipo is null or v_tipo not in ('node', 'way', 'relation') then
    return null;
  end if;

  if jsonb_typeof(p_el->'osm_id') is distinct from 'number'
     or jsonb_typeof(p_el->'lat') is distinct from 'number'
     or jsonb_typeof(p_el->'lng') is distinct from 'number' then
    return null;
  end if;

  begin
    v_id := (p_el->>'osm_id')::bigint;
    v_lat := (p_el->>'lat')::double precision;
    v_lng := (p_el->>'lng')::double precision;
  exception when others then
    return null;
  end;

  if v_id is null or v_id <= 0 then return null; end if;
  if v_lat is null or v_lng is null
     or v_lat < -90 or v_lat > 90 or v_lng < -180 or v_lng > 180
     or v_lat in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
     or v_lng in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision) then
    return null;
  end if;

  v_nome := btrim(coalesce(p_el->>'nome', ''));
  if char_length(v_nome) < 1 or char_length(v_nome) > 200 then
    return null;
  end if;

  v_cat := p_el->>'categoria';
  if v_cat is null or v_cat not in ('Patrimônio', 'Cultura', 'Lazer', 'Gastronomia', 'Natureza', 'Religião') then
    return null;
  end if;

  v_web := nullif(btrim(coalesce(p_el->>'website', '')), '');
  if v_web is not null and (v_web !~* '^https?://' or char_length(v_web) > 255) then
    v_web := null;
  end if;

  v_phone := nullif(btrim(regexp_replace(coalesce(p_el->>'phone', ''), '[^0-9+() -]', '', 'g')), '');
  if v_phone is not null and v_phone !~ '[0-9]' then
    v_phone := null;
  end if;
  v_phone := left(v_phone, 255);

  v_end := nullif(btrim(coalesce(p_el->>'endereco', '')), '');
  if v_end is not null and char_length(v_end) > 255 then
    v_end := null;
  end if;

  -- "ordem" fica de fora de propósito: só serve para iterar e não deve
  -- alterar o elemento guardado na fila (idempotência).
  return jsonb_build_object(
    'osm_tipo', v_tipo,
    'osm_id', v_id,
    'nome', v_nome,
    'categoria', v_cat,
    'lat', v_lat,
    'lng', v_lng,
    'endereco', v_end,
    'wheelchair', left(nullif(btrim(coalesce(p_el->>'wheelchair', '')), ''), 32),
    'toilets_wheelchair', left(nullif(btrim(coalesce(p_el->>'toilets_wheelchair', '')), ''), 32),
    'opening_hours', left(nullif(btrim(coalesce(p_el->>'opening_hours', '')), ''), 255),
    'phone', v_phone,
    'website', v_web
  );
end $$;

-- Cria um ponto em mapeamento a partir de um elemento já validado.
create or replace function public._osm_criar(p_cidade text, p_el jsonb) returns uuid
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  insert into public.pontos (
    nome, categoria, cidade, latitude, longitude, endereco,
    status, origem, osm_tipo, osm_id,
    osm_wheelchair, osm_toilets_wheelchair, osm_opening_hours, osm_phone, osm_website,
    osm_sincronizado_em
  ) values (
    p_el->>'nome', p_el->>'categoria', btrim(p_cidade),
    (p_el->>'lat')::double precision, (p_el->>'lng')::double precision,
    p_el->>'endereco',
    'em_mapeamento', 'osm', p_el->>'osm_tipo', (p_el->>'osm_id')::bigint,
    p_el->>'wheelchair', p_el->>'toilets_wheelchair', p_el->>'opening_hours',
    p_el->>'phone', p_el->>'website',
    now()
  )
  returning id into v_id;

  -- Linha existente com ponto_id nulo (ponto excluído) só é reaproveitada
  -- quando o admin decide "separar" explicitamente.
  insert into public.pontos_osm (osm_tipo, osm_id, ponto_id, papel)
  values (p_el->>'osm_tipo', (p_el->>'osm_id')::bigint, v_id, 'primario')
  on conflict (osm_tipo, osm_id) do update
    set ponto_id = excluded.ponto_id, papel = 'primario'
    where public.pontos_osm.ponto_id is null;

  return v_id;
end $$;

-- Vincula um elemento a um ponto existente preenchendo APENAS campos vazios.
-- nome, categoria, coordenadas e campos de cadastro nunca entram no SET.
-- Devolve true se algum valor mudou.
create or replace function public._osm_vincular(p_ponto_id uuid, p_el jsonb, p_papel text) returns boolean
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_tem_par boolean;
  v_papel text;
  v_mudou boolean := false;
  v_tipo text := p_el->>'osm_tipo';
  v_osm_id bigint := (p_el->>'osm_id')::bigint;
  v_endereco text := p_el->>'endereco';
  v_wheel text := p_el->>'wheelchair';
  v_toil text := p_el->>'toilets_wheelchair';
  v_hours text := p_el->>'opening_hours';
  v_phone text := p_el->>'phone';
  v_web text := p_el->>'website';
begin
  select (p.osm_tipo is not null) into v_tem_par
  from public.pontos p where p.id = p_ponto_id
  for update;
  if not found then
    return false;
  end if;

  -- Ponto sem elemento primário: este elemento passa a ser o par do ponto
  -- ("vincule o osm_id ao ponto oficial"). Senão, fica só em pontos_osm.
  v_papel := case when v_tem_par then 'secundario' else 'vinculado' end;
  if p_papel = 'primario' then
    v_papel := 'primario';
  end if;

  update public.pontos p set
    endereco               = coalesce(nullif(btrim(p.endereco), ''), v_endereco),
    osm_wheelchair         = coalesce(nullif(btrim(p.osm_wheelchair), ''), v_wheel),
    osm_toilets_wheelchair = coalesce(nullif(btrim(p.osm_toilets_wheelchair), ''), v_toil),
    osm_opening_hours      = coalesce(nullif(btrim(p.osm_opening_hours), ''), v_hours),
    osm_phone              = coalesce(nullif(btrim(p.osm_phone), ''), v_phone),
    osm_website            = coalesce(nullif(btrim(p.osm_website), ''), v_web),
    osm_tipo               = coalesce(p.osm_tipo, v_tipo),
    osm_id                 = coalesce(p.osm_id, v_osm_id),
    osm_sincronizado_em    = now()
  where p.id = p_ponto_id
    and (
      p.osm_tipo is null
      or (nullif(btrim(p.endereco), '') is null and v_endereco is not null)
      or (nullif(btrim(p.osm_wheelchair), '') is null and v_wheel is not null)
      or (nullif(btrim(p.osm_toilets_wheelchair), '') is null and v_toil is not null)
      or (nullif(btrim(p.osm_opening_hours), '') is null and v_hours is not null)
      or (nullif(btrim(p.osm_phone), '') is null and v_phone is not null)
      or (nullif(btrim(p.osm_website), '') is null and v_web is not null)
    );
  v_mudou := found;

  insert into public.pontos_osm (osm_tipo, osm_id, ponto_id, papel)
  values (v_tipo, v_osm_id, p_ponto_id, v_papel)
  on conflict (osm_tipo, osm_id) do update
    set ponto_id = excluded.ponto_id, papel = excluded.papel
    where public.pontos_osm.ponto_id is null;

  return v_mudou;
end $$;

-- Atualiza um ponto em mapeamento a partir do seu elemento primário.
-- nome/categoria/coordenadas sempre vêm do OSM; endereço e tags osm_* só
-- quando o OSM traz valor (não desfaz o que um elemento secundário preencheu).
create or replace function public._osm_atualizar_mapeamento(p_ponto_id uuid, p_el jsonb) returns boolean
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v record;
begin
  select * into v from jsonb_to_record(p_el) as x(
    nome text, categoria text, lat double precision, lng double precision, endereco text,
    wheelchair text, toilets_wheelchair text, opening_hours text, phone text, website text
  );

  if v.nome is null or v.categoria is null or v.lat is null or v.lng is null then
    return false;
  end if;

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
end $$;

-- Pontos próximos (oficiais, ou em mapeamento de origem OSM) com distância,
-- similaridade de nome e compatibilidade de categoria.
create or replace function public._osm_candidatos(
  p_geog extensions.geography, p_nome_norm text, p_categoria text, p_status text, p_raio integer
) returns table (ponto_id uuid, dist double precision, sim real, mesma_cat boolean)
language sql stable security definer
set search_path = public, extensions
as $$
  select p.id,
         extensions.st_distance(p.geog, p_geog),
         public.nome_similaridade(p.nome_normalizado, p_nome_norm),
         public.categoria_compativel(p.categoria, p_categoria)
  from public.pontos p
  where p.status = p_status
    and (p_status = 'oficial' or p.origem = 'osm')
    and extensions.st_dwithin(p.geog, p_geog, p_raio)
  order by 2;
$$;

-- Passos 6–7 do algoritmo: checagem OSM×OSM e criação.
-- p_permitir_fila = false (uso do admin em "separar"): pula o caso "fila";
-- só a mescla <= 60 m + nome similar continua valendo.
create or replace function public._osm_criar_ou_mesclar(p_cidade text, p_el jsonb, p_permitir_fila boolean)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_cfg public.mapeamento_config%rowtype;
  v_g extensions.geography;
  v_n text;
  v_best record;
  c record;
  v_rc integer;
  v_enfileirou boolean := false;
  v_id uuid;
begin
  select * into v_cfg from public.mapeamento_config where id;
  v_g := extensions.st_setsrid(
           extensions.st_makepoint((p_el->>'lng')::double precision, (p_el->>'lat')::double precision), 4326
         )::extensions.geography;
  v_n := public.normalizar_nome_local(p_el->>'nome');

  -- 6. Contra OSM em mapeamento (inclui os criados neste mesmo lote).
  select k.ponto_id, k.dist, k.sim into v_best
  from public._osm_candidatos(v_g, v_n, p_el->>'categoria', 'em_mapeamento', v_cfg.dist_revisao_m) k
  where k.dist <= v_cfg.dist_vinculo_m and k.sim >= v_cfg.similaridade_min
  order by k.sim desc, k.dist asc
  limit 1;

  if found then
    perform public._osm_vincular(v_best.ponto_id, p_el, 'secundario');
    return jsonb_build_object('acao', 'mesclado', 'ponto_id', v_best.ponto_id);
  end if;

  if p_permitir_fila then
    -- Só nome similar entre dois elementos OSM (desvio deliberado, ver cabeçalho).
    for c in
      select k.ponto_id, k.dist, k.sim, k.mesma_cat
      from public._osm_candidatos(v_g, v_n, p_el->>'categoria', 'em_mapeamento', v_cfg.dist_revisao_m) k
      where k.sim >= v_cfg.similaridade_min
    loop
      insert into public.candidatos_duplicidade (
        osm_tipo, osm_id, cidade, nome, categoria, latitude, longitude, elemento,
        ponto_existente_id, distancia_m, similaridade, mesma_categoria
      ) values (
        p_el->>'osm_tipo', (p_el->>'osm_id')::bigint, btrim(p_cidade), p_el->>'nome', p_el->>'categoria',
        (p_el->>'lat')::double precision, (p_el->>'lng')::double precision, p_el,
        c.ponto_id, round(c.dist::numeric, 1), round(c.sim::numeric, 3), c.mesma_cat
      )
      on conflict (osm_tipo, osm_id, ponto_existente_id) do update set
        cidade = excluded.cidade, nome = excluded.nome, categoria = excluded.categoria,
        latitude = excluded.latitude, longitude = excluded.longitude, elemento = excluded.elemento,
        distancia_m = excluded.distancia_m, similaridade = excluded.similaridade,
        mesma_categoria = excluded.mesma_categoria, status = 'pendente', atualizado_em = now()
      where public.candidatos_duplicidade.status in ('pendente', 'descartado');
      get diagnostics v_rc = row_count;
      if v_rc > 0 then
        v_enfileirou := true;
      end if;
    end loop;

    if v_enfileirou then
      return jsonb_build_object('acao', 'fila', 'ponto_id', null);
    end if;
  end if;

  -- 7. Sem correspondência.
  v_id := public._osm_criar(p_cidade, p_el);
  return jsonb_build_object('acao', 'criado', 'ponto_id', v_id);
end $$;

-- ============================================================
-- RPC de sincronização (service_role apenas)
-- ============================================================
create or replace function public.osm_sync_aplicar(p_cidade text, p_elementos jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_cfg public.mapeamento_config%rowtype;
  v_cidade text := btrim(coalesce(p_cidade, ''));
  e jsonb;
  v jsonb;
  v_tipo text;
  v_osm_id bigint;
  v_g extensions.geography;
  v_n text;
  v_link record;
  v_status_ponto text;
  v_best record;
  c record;
  v_d double precision;
  v_s real;
  v_mc boolean;
  v_rc integer;
  v_fila_mudou boolean;
  v_enfileirou boolean;
  v_res jsonb;
  v_rel jsonb;
  -- contadores
  n_recebidos integer := 0;
  n_invalidos integer := 0;
  n_criados integer := 0;
  n_atualizados integer := 0;
  n_inalterados integer := 0;
  n_vinculados_oficial integer := 0;
  n_fila_novos integer := 0;
  n_fila_atualizados integer := 0;
  n_fila_descartados integer := 0;
  n_mesclados_osm integer := 0;
  n_ignorados_excluidos integer := 0;
  n_ignorados_decididos integer := 0;
begin
  if char_length(v_cidade) < 1 or char_length(v_cidade) > 80 then
    raise exception using errcode = 'P0001', message = 'cidade_invalida';
  end if;
  if p_elementos is null or jsonb_typeof(p_elementos) <> 'array' then
    raise exception using errcode = 'P0001', message = 'payload_invalido';
  end if;
  if jsonb_array_length(p_elementos) > 10000 then
    raise exception using errcode = 'P0001', message = 'payload_grande_demais';
  end if;

  select * into v_cfg from public.mapeamento_config where id;
  n_recebidos := jsonb_array_length(p_elementos);

  begin
    for e in
      select x.value
      from jsonb_array_elements(p_elementos) with ordinality as x(value, idx)
      order by case when jsonb_typeof(x.value->'ordem') = 'number'
                    then (x.value->>'ordem')::numeric else null end nulls last,
               x.idx
    loop
      -- 1. Validação
      v := public._osm_validar(e);
      if v is null then
        n_invalidos := n_invalidos + 1;
        continue;
      end if;
      v_tipo := v->>'osm_tipo';
      v_osm_id := (v->>'osm_id')::bigint;

      -- 2. Já conhecido?
      select po.ponto_id, po.papel into v_link
      from public.pontos_osm po
      where po.osm_tipo = v_tipo and po.osm_id = v_osm_id;
      if found then
        if v_link.ponto_id is null then
          n_ignorados_excluidos := n_ignorados_excluidos + 1;
          continue;
        end if;
        select p.status into v_status_ponto from public.pontos p where p.id = v_link.ponto_id;
        if v_status_ponto = 'em_mapeamento' and v_link.papel = 'primario' then
          if public._osm_atualizar_mapeamento(v_link.ponto_id, v) then
            n_atualizados := n_atualizados + 1;
          else
            n_inalterados := n_inalterados + 1;
          end if;
        else
          if public._osm_vincular(v_link.ponto_id, v, 'secundario') then
            n_atualizados := n_atualizados + 1;
          else
            n_inalterados := n_inalterados + 1;
          end if;
        end if;
        continue;
      end if;

      v_g := extensions.st_setsrid(
               extensions.st_makepoint((v->>'lng')::double precision, (v->>'lat')::double precision), 4326
             )::extensions.geography;
      v_n := public.normalizar_nome_local(v->>'nome');

      -- 3. Já está na fila?
      if exists (
        select 1 from public.candidatos_duplicidade cd
        where cd.osm_tipo = v_tipo and cd.osm_id = v_osm_id and cd.status = 'pendente'
      ) then
        v_fila_mudou := false;
        for c in
          select cd.id, cd.nome, cd.categoria, cd.latitude, cd.longitude, cd.elemento,
                 cd.distancia_m, cd.similaridade, cd.mesma_categoria,
                 p.geog as p_geog, p.nome_normalizado as p_nome_norm,
                 p.categoria as p_categoria, p.status as p_status
          from public.candidatos_duplicidade cd
          join public.pontos p on p.id = cd.ponto_existente_id
          where cd.osm_tipo = v_tipo and cd.osm_id = v_osm_id and cd.status = 'pendente'
          for update of cd
        loop
          v_d := extensions.st_distance(c.p_geog, v_g);
          v_s := public.nome_similaridade(c.p_nome_norm, v_n);
          v_mc := public.categoria_compativel(c.p_categoria, v->>'categoria');

          update public.candidatos_duplicidade cd set
            nome = v->>'nome', categoria = v->>'categoria',
            latitude = (v->>'lat')::double precision, longitude = (v->>'lng')::double precision,
            elemento = v, distancia_m = round(v_d::numeric, 1),
            similaridade = round(v_s::numeric, 3), mesma_categoria = v_mc,
            atualizado_em = now()
          where cd.id = c.id
            and (cd.nome, cd.categoria, cd.latitude, cd.longitude, cd.elemento,
                 cd.distancia_m, cd.similaridade, cd.mesma_categoria)
                is distinct from
                (v->>'nome', v->>'categoria', (v->>'lat')::double precision, (v->>'lng')::double precision, v,
                 round(v_d::numeric, 1), round(v_s::numeric, 3), v_mc);
          if found then
            v_fila_mudou := true;
          end if;

          -- Deixou de atender à regra da fila? (para pontos em mapeamento, só nome)
          if v_d > v_cfg.dist_revisao_m
             or (v_s < v_cfg.similaridade_min and (c.p_status = 'em_mapeamento' or not v_mc)) then
            update public.candidatos_duplicidade cd
              set status = 'descartado', atualizado_em = now()
              where cd.id = c.id;
            n_fila_descartados := n_fila_descartados + 1;
          end if;
        end loop;

        if v_fila_mudou then
          n_fila_atualizados := n_fila_atualizados + 1;
        end if;

        if exists (
          select 1 from public.candidatos_duplicidade cd
          where cd.osm_tipo = v_tipo and cd.osm_id = v_osm_id and cd.status = 'pendente'
        ) then
          continue;
        end if;
        -- Nenhuma pendente sobrou: segue como se fosse novo (passos 4–7).
      end if;

      -- Decidido pelo admin sem vínculo em pontos_osm (não deveria acontecer).
      if exists (
        select 1 from public.candidatos_duplicidade cd
        where cd.osm_tipo = v_tipo and cd.osm_id = v_osm_id and cd.status in ('vinculado', 'separado')
      ) then
        n_ignorados_decididos := n_ignorados_decididos + 1;
        continue;
      end if;

      -- 4–5. Contra oficiais
      select k.ponto_id, k.dist, k.sim into v_best
      from public._osm_candidatos(v_g, v_n, v->>'categoria', 'oficial', v_cfg.dist_revisao_m) k
      where k.dist <= v_cfg.dist_vinculo_m and k.sim >= v_cfg.similaridade_min
      order by k.sim desc, k.dist asc
      limit 1;
      if found then
        perform public._osm_vincular(v_best.ponto_id, v, 'vinculado');
        n_vinculados_oficial := n_vinculados_oficial + 1;
        continue;
      end if;

      v_enfileirou := false;
      for c in
        select k.ponto_id, k.dist, k.sim, k.mesma_cat
        from public._osm_candidatos(v_g, v_n, v->>'categoria', 'oficial', v_cfg.dist_revisao_m) k
        where k.sim >= v_cfg.similaridade_min or k.mesma_cat
      loop
        insert into public.candidatos_duplicidade (
          osm_tipo, osm_id, cidade, nome, categoria, latitude, longitude, elemento,
          ponto_existente_id, distancia_m, similaridade, mesma_categoria
        ) values (
          v_tipo, v_osm_id, v_cidade, v->>'nome', v->>'categoria',
          (v->>'lat')::double precision, (v->>'lng')::double precision, v,
          c.ponto_id, round(c.dist::numeric, 1), round(c.sim::numeric, 3), c.mesma_cat
        )
        on conflict (osm_tipo, osm_id, ponto_existente_id) do update set
          cidade = excluded.cidade, nome = excluded.nome, categoria = excluded.categoria,
          latitude = excluded.latitude, longitude = excluded.longitude, elemento = excluded.elemento,
          distancia_m = excluded.distancia_m, similaridade = excluded.similaridade,
          mesma_categoria = excluded.mesma_categoria, status = 'pendente', atualizado_em = now()
        where public.candidatos_duplicidade.status in ('pendente', 'descartado');
        get diagnostics v_rc = row_count;
        if v_rc > 0 then
          v_enfileirou := true;
        end if;
      end loop;
      if v_enfileirou then
        n_fila_novos := n_fila_novos + 1;
        continue;
      end if;

      -- 6–7. Contra OSM em mapeamento + criação
      v_res := public._osm_criar_ou_mesclar(v_cidade, v, true);
      case v_res->>'acao'
        when 'mesclado' then n_mesclados_osm := n_mesclados_osm + 1;
        when 'fila' then n_fila_novos := n_fila_novos + 1;
        else n_criados := n_criados + 1;
      end case;
    end loop;

    v_rel := jsonb_build_object(
      'recebidos', n_recebidos,
      'invalidos', n_invalidos,
      'criados', n_criados,
      'atualizados', n_atualizados,
      'inalterados', n_inalterados,
      'vinculados_oficial', n_vinculados_oficial,
      'fila_novos', n_fila_novos,
      'fila_atualizados', n_fila_atualizados,
      'fila_descartados', n_fila_descartados,
      'mesclados_osm', n_mesclados_osm,
      'ignorados_excluidos', n_ignorados_excluidos,
      'ignorados_decididos', n_ignorados_decididos,
      'dry_run', false
    );

    if p_dry_run then
      -- Reverte a subtransação do bloco; o relatório volta mesmo assim.
      raise exception using errcode = 'P0D01', message = 'dry_run';
    end if;
  exception when sqlstate 'P0D01' then
    return v_rel || jsonb_build_object('dry_run', true);
  end;

  insert into public.osm_sync_execucoes (cidade, dry_run, relatorio)
  values (v_cidade, false, v_rel);

  -- Retenção curta dos hashes de origem (criada na migração 03).
  perform public._purgar_origem_eventos();

  return v_rel;
end $$;

-- ============================================================
-- Resolução da fila (admin)
-- ============================================================
create or replace function public.admin_resolver_candidato(p_candidato_id uuid, p_acao text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  c public.candidatos_duplicidade%rowtype;
  v_conhecido record;
  v_res jsonb;
  v_ponto uuid;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if p_acao is null or p_acao not in ('vincular', 'separar') then
    raise exception using errcode = 'P0001', message = 'acao_invalida';
  end if;

  select * into c from public.candidatos_duplicidade where id = p_candidato_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'candidato_nao_encontrado';
  end if;
  if c.status <> 'pendente' then
    raise exception using errcode = 'P0001', message = 'candidato_ja_resolvido';
  end if;

  -- Corrida com uma sincronização: elemento já ligado a um ponto.
  select po.ponto_id into v_conhecido
  from public.pontos_osm po
  where po.osm_tipo = c.osm_tipo and po.osm_id = c.osm_id and po.ponto_id is not null;
  if found then
    perform public._osm_vincular(v_conhecido.ponto_id, c.elemento, 'secundario');
    update public.candidatos_duplicidade
      set status = 'vinculado', resolvido_por = auth.uid(), resolvido_em = now(), atualizado_em = now()
      where id = c.id;
    update public.candidatos_duplicidade
      set status = 'descartado', atualizado_em = now()
      where osm_tipo = c.osm_tipo and osm_id = c.osm_id and id <> c.id and status = 'pendente';
    return jsonb_build_object('acao', 'vincular', 'ponto_id', v_conhecido.ponto_id);
  end if;

  if p_acao = 'vincular' then
    perform public._osm_vincular(c.ponto_existente_id, c.elemento, 'vinculado');
    update public.candidatos_duplicidade
      set status = 'vinculado', resolvido_por = auth.uid(), resolvido_em = now(), atualizado_em = now()
      where id = c.id;
    update public.candidatos_duplicidade
      set status = 'descartado', atualizado_em = now()
      where osm_tipo = c.osm_tipo and osm_id = c.osm_id and id <> c.id and status = 'pendente';
    return jsonb_build_object('acao', 'vincular', 'ponto_id', c.ponto_existente_id);
  end if;

  -- separar
  v_res := public._osm_criar_ou_mesclar(c.cidade, c.elemento, false);
  v_ponto := (v_res->>'ponto_id')::uuid;
  update public.candidatos_duplicidade
    set status = 'separado', resolvido_por = auth.uid(), resolvido_em = now(), atualizado_em = now()
    where osm_tipo = c.osm_tipo and osm_id = c.osm_id and status in ('pendente', 'descartado');
  return jsonb_build_object(
    'acao', 'separar',
    'ponto_id', v_ponto,
    'mesclado', (v_res->>'acao') = 'mesclado'
  );
end $$;

-- ============================================================
-- Pré-checagem de local existente ("Sugerir um local" e cadastro admin)
-- ============================================================
create or replace function public.verificar_local_existente(
  p_nome text, p_latitude double precision, p_longitude double precision
) returns table (ponto_id uuid, nome text, categoria text, status text, distancia_m integer)
language plpgsql stable security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_cfg public.mapeamento_config%rowtype;
  v_g extensions.geography;
  v_n text;
begin
  if p_nome is null or char_length(btrim(p_nome)) < 1 or char_length(btrim(p_nome)) > 120 then
    raise exception using errcode = 'P0001', message = 'invalid_nome';
  end if;
  if p_latitude is null or p_longitude is null
     or p_latitude < -90 or p_latitude > 90
     or p_longitude < -180 or p_longitude > 180 then
    raise exception using errcode = 'P0001', message = 'invalid_coords';
  end if;

  select * into v_cfg from public.mapeamento_config where id;
  v_g := extensions.st_setsrid(extensions.st_makepoint(p_longitude, p_latitude), 4326)::extensions.geography;
  v_n := public.normalizar_nome_local(p_nome);

  return query
  select p.id, p.nome, p.categoria, p.status,
         round(extensions.st_distance(p.geog, v_g))::integer
  from public.pontos p
  where p.status in ('oficial', 'em_mapeamento')
    and extensions.st_dwithin(p.geog, v_g, v_cfg.dist_revisao_m)
    and public.nome_similaridade(p.nome_normalizado, v_n) >= v_cfg.similaridade_min
  order by public.nome_similaridade(p.nome_normalizado, v_n) desc,
           extensions.st_distance(p.geog, v_g) asc
  limit 3;
end $$;

-- ============================================================
-- Mapa por bounding box com cluster por grade no servidor (D-15)
-- security invoker: pontos é público. set search_path resolve o operador
-- && de geography, que mora em extensions.
-- ============================================================
create or replace function public.pontos_comunidade_bbox(
  p_oeste double precision, p_sul double precision, p_leste double precision, p_norte double precision,
  p_zoom integer, p_categoria text default null, p_excluir_id uuid default null, p_max_itens integer default 150
) returns table (
  tipo text, chave text, ponto_id uuid, nome text, categoria text,
  latitude double precision, longitude double precision, quantidade integer,
  sul double precision, oeste double precision, norte double precision, leste double precision
)
language plpgsql stable security invoker
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_zoom integer;
  v_max integer;
  v_cat text;
  v_env extensions.geography;
  v_base integer;
  v_cell double precision;
  v_cells integer;
  v_iter integer := 0;
  v_trunc boolean := false;
  v_lim integer;
begin
  if p_oeste is null or p_sul is null or p_leste is null or p_norte is null
     or p_oeste >= p_leste or p_sul >= p_norte then
    raise exception using errcode = 'P0001', message = 'bbox_invalida';
  end if;
  if p_leste - p_oeste > 0.25 or p_norte - p_sul > 0.25 then
    raise exception using errcode = 'P0001', message = 'bbox_grande_demais';
  end if;
  if p_zoom is null or p_zoom < 15 then
    return;
  end if;

  v_zoom := least(p_zoom, 19);
  v_max := greatest(20, least(coalesce(p_max_itens, 150), 300));
  v_cat := nullif(lower(public.f_unaccent(left(btrim(coalesce(p_categoria, '')), 40))), '');
  v_env := extensions.st_makeenvelope(p_oeste, p_sul, p_leste, p_norte, 4326)::extensions.geography;

  select count(*) into v_base from (
    select 1 from public.pontos p
    where p.status = 'em_mapeamento'
      and p.geog && v_env
      and (p_excluir_id is null or p.id <> p_excluir_id)
      and (v_cat is null or lower(public.f_unaccent(p.categoria)) like '%' || v_cat || '%')
    limit 3000
  ) s;

  -- Zoom >= 18 com poucos pontos: individuais.
  if v_zoom >= 18 and v_base <= v_max then
    return query
    select 'ponto'::text, 'p:' || p.id::text, p.id, p.nome, p.categoria,
           p.latitude, p.longitude, 1, null::double precision, null::double precision,
           null::double precision, null::double precision
    from public.pontos p
    where p.status = 'em_mapeamento'
      and p.geog && v_env
      and (p_excluir_id is null or p.id <> p_excluir_id)
      and (v_cat is null or lower(public.f_unaccent(p.categoria)) like '%' || v_cat || '%')
    order by p.id
    limit v_max;
    return;
  end if;

  -- Célula ≈ 300 m no zoom 15 (64 px de tela).
  v_cell := 360.0::double precision / (256 * power(2::double precision, least(v_zoom, 18)::double precision)) * 64;

  loop
    select count(*) into v_cells from (
      select distinct floor(b.longitude / v_cell), floor(b.latitude / v_cell)
      from (
        select p.latitude, p.longitude from public.pontos p
        where p.status = 'em_mapeamento'
          and p.geog && v_env
          and (p_excluir_id is null or p.id <> p_excluir_id)
          and (v_cat is null or lower(public.f_unaccent(p.categoria)) like '%' || v_cat || '%')
        limit 3000
      ) b
    ) s;
    exit when v_cells <= v_max or v_iter >= 6;
    v_cell := v_cell * 2;
    v_iter := v_iter + 1;
  end loop;

  v_trunc := v_cells > v_max or v_base >= 3000;
  v_lim := case when v_trunc then v_max - 1 else v_max end;

  return query
  with base as (
    select p.id, p.nome, p.categoria, p.latitude, p.longitude
    from public.pontos p
    where p.status = 'em_mapeamento'
      and p.geog && v_env
      and (p_excluir_id is null or p.id <> p_excluir_id)
      and (v_cat is null or lower(public.f_unaccent(p.categoria)) like '%' || v_cat || '%')
    order by p.id
    limit 3000
  ),
  cel as (
    select floor(b.longitude / v_cell)::bigint as gx,
           floor(b.latitude / v_cell)::bigint as gy,
           count(*)::integer as n,
           (array_agg(b.id order by b.id))[1] as id1,
           (array_agg(b.nome order by b.id))[1] as nome1,
           (array_agg(b.categoria order by b.id))[1] as cat1,
           avg(b.latitude) as lat_c, avg(b.longitude) as lng_c,
           min(b.latitude) as lat_min, max(b.latitude) as lat_max,
           min(b.longitude) as lng_min, max(b.longitude) as lng_max
    from base b
    group by 1, 2
  )
  select case when c.n = 1 then 'ponto' else 'grupo' end::text,
         case when c.n = 1 then 'p:' || c.id1::text
              else 'g:' || round(v_cell * 1e7)::bigint::text || ':' || c.gx::text || ':' || c.gy::text end,
         case when c.n = 1 then c.id1 else null::uuid end,
         case when c.n = 1 then c.nome1 else null::text end,
         case when c.n = 1 then c.cat1 else null::text end,
         c.lat_c, c.lng_c, c.n,
         case when c.n = 1 then null::double precision else c.lat_min end,
         case when c.n = 1 then null::double precision else c.lng_min end,
         case when c.n = 1 then null::double precision else c.lat_max end,
         case when c.n = 1 then null::double precision else c.lng_max end
  from cel c
  order by c.n desc, c.gx, c.gy
  limit v_lim;

  if v_trunc then
    -- quantidade = itens omitidos (base menos os pontos das células devolvidas).
    return query
    select 'truncado'::text, 'truncado'::text, null::uuid, null::text, null::text,
           null::double precision, null::double precision,
           greatest(v_base - coalesce((
             select sum(x.n)::integer from (
               select count(*)::integer as n
               from (
                 select p.latitude, p.longitude from public.pontos p
                 where p.status = 'em_mapeamento'
                   and p.geog && v_env
                   and (p_excluir_id is null or p.id <> p_excluir_id)
                   and (v_cat is null or lower(public.f_unaccent(p.categoria)) like '%' || v_cat || '%')
                 order by p.id
                 limit 3000
               ) b
               group by floor(b.longitude / v_cell), floor(b.latitude / v_cell)
               order by count(*) desc, floor(b.longitude / v_cell), floor(b.latitude / v_cell)
               limit v_lim
             ) x
           ), 0), 0),
           null::double precision, null::double precision, null::double precision, null::double precision;
  end if;
end $$;

-- Observação: buscar_pontos_comunidade (assistente de voz) é criada na
-- migração 03, depois de consenso_recursos.

-- ============================================================
-- Privilégios das funções criadas aqui
-- ============================================================
-- Internas de sincronização: só chamadas por funções definer do mesmo dono.
revoke execute on function public._osm_validar(jsonb) from public, anon, authenticated;
revoke execute on function public._osm_criar(text, jsonb) from public, anon, authenticated;
revoke execute on function public._osm_vincular(uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function public._osm_atualizar_mapeamento(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public._osm_candidatos(extensions.geography, text, text, text, integer) from public, anon, authenticated;
revoke execute on function public._osm_criar_ou_mesclar(text, jsonb, boolean) from public, anon, authenticated;

-- Só serviço.
revoke execute on function public.osm_sync_aplicar(text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.osm_sync_aplicar(text, jsonb, boolean) to service_role;

-- Públicas.
grant execute on function public.verificar_local_existente(text, double precision, double precision) to anon, authenticated;
grant execute on function public.pontos_comunidade_bbox(double precision, double precision, double precision, double precision, integer, text, uuid, integer) to anon, authenticated;

-- Só authenticated (checa is_admin() dentro).
revoke execute on function public.admin_resolver_candidato(uuid, text) from public, anon;
grant execute on function public.admin_resolver_candidato(uuid, text) to authenticated;
