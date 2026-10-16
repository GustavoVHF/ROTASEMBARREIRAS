-- ============================================================
-- Rota sem Barreiras — OSM "Em mapeamento" (3/3): relatos da comunidade
-- ADDITIVE ONLY. Idempotente. Rodar depois de 01 e 02.
--
-- - Relatos liberados para sessões anônimas do Supabase (papel authenticated,
--   com is_anonymous no JWT), sempre com user_id = auth.uid() (RLS).
-- - 1 relato por usuário por ponto a cada 7 dias (contando relatos ocultos).
-- - Limite por origem no banco: guarda só sha256(sal || ip), apagado em 2 h.
--   LGPD: o espaço IPv4 é pequeno, então o hash só protege enquanto o sal for
--   secreto. Por isso o sal fica no Supabase Vault (relatos_origem_sal), fora
--   do repositório e fora do .env.local.
-- - Consenso por recurso calculado no banco; ocultar = exclusão lógica.
-- ============================================================

-- ---------- Colunas em relatos_pontos ----------
alter table public.relatos_pontos
  add column if not exists recursos jsonb,
  add column if not exists oculto boolean not null default false,
  add column if not exists ocultado_em timestamptz,
  add column if not exists ocultado_por uuid references auth.users(id) on delete set null;
alter table public.relatos_pontos alter column user_id set default auth.uid();
create index if not exists relatos_pontos_user_ponto_idx
  on public.relatos_pontos (user_id, ponto_id, criado_em desc);

-- ---------- Recursos marcados ----------
-- null é válido. Senão: objeto com chaves de {entrada, banheiro, braille,
-- libras, atendimento}, valores "tem" | "nao_tem", no máximo 5 chaves.
create or replace function public.relato_recursos_validos(p jsonb) returns boolean
language plpgsql immutable
set search_path = public, extensions
as $$
begin
  if p is null then
    return true;
  end if;
  if jsonb_typeof(p) <> 'object' then
    return false;
  end if;
  if (select count(*) from jsonb_object_keys(p)) > 5 then
    return false;
  end if;
  return not exists (
    select 1 from jsonb_each(p) e
    where e.key not in ('entrada', 'banheiro', 'braille', 'libras', 'atendimento')
       or jsonb_typeof(e.value) <> 'string'
       or (e.value #>> '{}') not in ('tem', 'nao_tem')
  );
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'relatos_pontos_recursos_check') then
    alter table public.relatos_pontos
      add constraint relatos_pontos_recursos_check check (public.relato_recursos_validos(recursos));
  end if;
end $$;

-- ---------- Identidade, sem reescrita (RF-5.3) ----------
-- Nunca reescreve um user_id diferente: a RLS recusa (42501).
create or replace function public.ensure_relato_identity()
returns trigger
language plpgsql
security definer set search_path = public, extensions
as $$
begin
  if new.user_id is null then new.user_id := auth.uid(); end if;   -- redundante ao default
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
$$;

drop trigger if exists on_relato_insert on public.relatos_pontos;
create trigger on_relato_insert
  before insert on public.relatos_pontos
  for each row execute procedure public.ensure_relato_identity();

-- ---------- Validação de texto (RF-5.7) ----------
-- Trigger BEFORE INSERT (não CHECK): ocultar um relato antigo com link não falha.
-- A mesma regex existe em src/lib/relatoText.ts.
create or replace function public.relatos_validar_texto()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.texto := nullif(btrim(new.texto), '');
  if new.texto is not null then
    if char_length(new.texto) > 280 then
      raise exception using errcode = 'P0001', message = 'texto_muito_longo';
    end if;
    if new.texto ~* '(https?://|www\.|\m[a-z0-9-]+\.(com|net|org|br|io|me|info|biz|xyz|app|site|online|ly|gl|co|link|tk|ru)\M)' then
      raise exception using errcode = 'P0001', message = 'texto_com_link';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists relatos_validar_texto on public.relatos_pontos;
create trigger relatos_validar_texto
  before insert on public.relatos_pontos
  for each row execute procedure public.relatos_validar_texto();

-- ---------- Limite de 7 dias que conta relatos ocultos (RF-5.4) ----------
-- Dentro de uma policy, um subselect em relatos_pontos passaria pela policy
-- de SELECT (que filtra oculto = false). Por isso a checagem é definer.
create or replace function public.relato_recente_existe(p_ponto_id uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.relatos_pontos r
    where r.ponto_id = p_ponto_id and r.user_id = auth.uid() and r.criado_em > now() - interval '7 days');
$$;

-- Usado pelo cliente para distinguir o 42501 da regra de 7 dias.
create or replace function public.relato_bloqueado_ate(p_ponto_id uuid) returns timestamptz
language sql stable security definer set search_path = public, extensions as $$
  select max(r.criado_em) + interval '7 days' from public.relatos_pontos r
  where r.ponto_id = p_ponto_id and r.user_id = auth.uid() and r.criado_em > now() - interval '7 days';
$$;

-- ---------- Policies (RF-5.2, RF-5.10) ----------
-- INSERT para authenticated (inclui sessões anônimas), sempre user_id = auth.uid().
drop policy if exists "relatos_insert_rate" on public.relatos_pontos;
create policy "relatos_insert_rate" on public.relatos_pontos
  for insert to authenticated
  with check (auth.uid() is not null and user_id = auth.uid()
              and not public.relato_recente_existe(ponto_id));

drop policy if exists "relatos_select_public" on public.relatos_pontos;
create policy "relatos_select_public" on public.relatos_pontos
  for select to anon, authenticated
  using (oculto = false or public.is_admin());
-- Sem policy de INSERT para anon, nem de UPDATE/DELETE para ninguém
-- (append-only; ocultar é feito por RPC).

-- ---------- Limite por origem (RF-5.5, 5.6; D-9, D-10) ----------
create table if not exists public.relatos_origem_eventos (
  id bigint generated always as identity primary key,
  origem_hash bytea not null,
  criado_em timestamptz not null default now()
);
create index if not exists relatos_origem_hash_idx on public.relatos_origem_eventos (origem_hash, criado_em);
create index if not exists relatos_origem_criado_idx on public.relatos_origem_eventos (criado_em);
alter table public.relatos_origem_eventos enable row level security;   -- sem policies
revoke all on public.relatos_origem_eventos from anon, authenticated;

-- Retenção curta (sem pg_cron). Também chamada por osm_sync_aplicar,
-- admin_ocultar_relato e diagnostico_origem.
create or replace function public._purgar_origem_eventos() returns void
language sql security definer set search_path = public, extensions as $$
  delete from public.relatos_origem_eventos
  where criado_em < now() - make_interval(hours => (select origem_retencao_horas from public.mapeamento_config where id));
$$;

create or replace function public.relatos_limite_origem()
returns trigger
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_cfg public.mapeamento_config%rowtype;
  h jsonb;
  v_ip text;
  v_xff text;
  v_sal text;
  v_hash bytea;
  v_qtd integer;
begin
  -- 1. Sem cabeçalhos (SQL Editor / service_role sem cabeçalho): sem limite.
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    h := null;
  end;
  if h is null then
    return new;
  end if;

  select * into v_cfg from public.mapeamento_config where id;

  -- 2. IP conforme a fonte configurada.
  v_xff := nullif(btrim(coalesce(h->>'x-forwarded-for', '')), '');
  case v_cfg.origem_fonte
    when 'desligado' then
      return new;
    when 'cf-connecting-ip' then
      v_ip := nullif(btrim(coalesce(h->>'cf-connecting-ip', '')), '');
      if v_ip is null and v_xff is not null then
        v_ip := nullif(btrim(split_part(v_xff, ',', 1)), '');
      end if;
    when 'xff-primeiro' then
      v_ip := case when v_xff is null then null else nullif(btrim(split_part(v_xff, ',', 1)), '') end;
    when 'xff-ultimo' then
      v_ip := case when v_xff is null then null
                   else nullif(btrim((string_to_array(v_xff, ','))[array_length(string_to_array(v_xff, ','), 1)]), '') end;
    else
      return new;
  end case;
  if v_ip is null then
    return new;
  end if;

  -- 3. Sal no Vault; ausente => fail-open com aviso no log.
  begin
    select ds.decrypted_secret into v_sal
    from vault.decrypted_secrets ds
    where ds.name = 'relatos_origem_sal'
    limit 1;
  exception when undefined_table or invalid_schema_name or insufficient_privilege then
    v_sal := null;
  end;
  if v_sal is null or char_length(v_sal) < 16 then
    raise warning 'relatos_origem_sal ausente: limite por origem desativado';
    return new;
  end if;

  -- 4. Só o hash; o IP existe apenas nesta variável local, nunca é gravado nem logado.
  v_hash := sha256(convert_to(v_sal || '|' || v_ip, 'UTF8'));
  v_ip := null;

  -- 5. Retenção curta.
  perform public._purgar_origem_eventos();

  -- 6. Serializa a mesma origem.
  perform pg_advisory_xact_lock(hashtextextended(encode(v_hash, 'hex'), 0));

  -- 7. Limite por hora.
  select count(*) into v_qtd
  from public.relatos_origem_eventos e
  where e.origem_hash = v_hash and e.criado_em > now() - interval '1 hour';
  if v_qtd >= v_cfg.relatos_por_origem_hora then
    raise exception using errcode = 'P0001', message = 'origem_rate_limited';
  end if;

  -- 8.
  insert into public.relatos_origem_eventos (origem_hash) values (v_hash);
  return new;
end $$;

drop trigger if exists relatos_z_limite_origem on public.relatos_pontos;
create trigger relatos_z_limite_origem
  before insert on public.relatos_pontos
  for each row execute procedure public.relatos_limite_origem();

-- ---------- Diagnóstico do cabeçalho de IP (sem expor IP) ----------
-- p_ip_esperado: o IP público de quem roda o teste. Nunca gravado,
-- devolvido nem logado; só comparado.
create or replace function public.diagnostico_origem(p_ip_esperado text default null) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  h jsonb;
  v_esperado inet;
  v_sentinela inet := '203.0.113.9'::inet;
  v_cf text;
  v_xff text;
  v_itens text[] := '{}'::text[];
  v_primeiro text;
  v_ultimo text;
  v_cf_inet inet;
  v_pri_inet inet;
  v_ult_inet inet;
  v_cf_eq boolean;
  v_pri_eq boolean;
  v_ult_eq boolean;
  v_rec text;
  v_sal text;
  v_fonte text;
begin
  if p_ip_esperado is not null then
    if char_length(btrim(p_ip_esperado)) > 45 then
      raise exception using errcode = 'P0001', message = 'ip_invalido';
    end if;
    begin
      v_esperado := btrim(p_ip_esperado)::inet;
    exception when invalid_text_representation then
      raise exception using errcode = 'P0001', message = 'ip_invalido';
    end;
  end if;

  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    h := null;
  end;
  h := coalesce(h, '{}'::jsonb);

  v_cf := nullif(btrim(coalesce(h->>'cf-connecting-ip', '')), '');
  v_xff := nullif(btrim(coalesce(h->>'x-forwarded-for', '')), '');
  if v_xff is not null then
    select coalesce(array_agg(btrim(x)), '{}'::text[]) into v_itens
    from unnest(string_to_array(v_xff, ',')) x;
    v_primeiro := v_itens[1];
    v_ultimo := v_itens[array_length(v_itens, 1)];
  end if;

  begin v_cf_inet := v_cf::inet; exception when others then v_cf_inet := null; end;
  begin v_pri_inet := v_primeiro::inet; exception when others then v_pri_inet := null; end;
  begin v_ult_inet := v_ultimo::inet; exception when others then v_ult_inet := null; end;

  if v_esperado is not null then
    v_cf_eq := coalesce(v_cf_inet = v_esperado, false);
    v_pri_eq := coalesce(v_pri_inet = v_esperado, false);
    v_ult_eq := coalesce(v_ult_inet = v_esperado, false);
    v_rec := case
      when v_cf_eq and v_cf_inet is distinct from v_sentinela then 'cf-connecting-ip'
      when v_pri_eq and v_pri_inet is distinct from v_sentinela then 'xff-primeiro'
      when v_ult_eq and v_ult_inet is distinct from v_sentinela then 'xff-ultimo'
      else 'desligado'
    end;
  end if;

  -- Mesma consulta e mesmo tratamento de erro do trigger.
  begin
    select ds.decrypted_secret into v_sal
    from vault.decrypted_secrets ds
    where ds.name = 'relatos_origem_sal'
    limit 1;
  exception when undefined_table or invalid_schema_name or insufficient_privilege then
    v_sal := null;
  end;

  select origem_fonte into v_fonte from public.mapeamento_config where id;

  perform public._purgar_origem_eventos();

  return jsonb_build_object(
    'tem_cf_connecting_ip', v_cf is not null,
    'tem_x_real_ip', nullif(btrim(coalesce(h->>'x-real-ip', '')), '') is not null,
    'xff_qtd_itens', coalesce(array_length(v_itens, 1), 0),
    'cf_e_sentinela', coalesce(v_cf_inet = v_sentinela, false),
    'xff_primeiro_e_sentinela', coalesce(v_pri_inet = v_sentinela, false),
    'xff_ultimo_e_sentinela', coalesce(v_ult_inet = v_sentinela, false),
    'cf_igual_esperado', v_cf_eq,
    'xff_primeiro_igual_esperado', v_pri_eq,
    'xff_ultimo_igual_esperado', v_ult_eq,
    'fonte_atual', v_fonte,
    'fonte_recomendada', v_rec,
    'sal_configurado', v_sal is not null and char_length(v_sal) >= 16
  );
end $$;

-- ---------- Consenso por recurso (RF-5.9) ----------
-- Último relato de cada sessão por recurso, janela de 365 dias, mínimo de 3
-- sessões e vencedor com >= 70%. Recursos ausentes = "não verificado".
create or replace function public.consenso_recursos(p_ponto_id uuid)
returns table (recurso text, estado text, apoiadores integer, total integer)
language sql stable security definer
set search_path = public, extensions
as $$
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
agg as (select m.recurso, m.estado, count(*)::int n from marcas m group by 1,2),
tot as (select a.recurso, sum(a.n)::int total from agg a group by 1)
select a.recurso, a.estado, a.n, t.total
from agg a join tot t using (recurso), cfg
where t.total >= cfg.consenso_min_sessoes
  and a.n >= ceil(cfg.consenso_fracao_min * t.total);
$$;

-- ---------- Ocultar relato (RF-5.11) ----------
-- Exclusão lógica. Nunca apaga. Idempotente.
create or replace function public.admin_ocultar_relato(p_relato_id uuid) returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;

  update public.relatos_pontos
    set oculto = true, ocultado_em = now(), ocultado_por = auth.uid()
    where id = p_relato_id and oculto = false;

  if not found and not exists (select 1 from public.relatos_pontos where id = p_relato_id) then
    raise exception using errcode = 'P0001', message = 'relato_nao_encontrado';
  end if;

  perform public._purgar_origem_eventos();
end $$;

-- ---------- Busca para o assistente de voz (RF-6.1) ----------
-- Só pontos em mapeamento (os oficiais seguem o caminho existente).
create or replace function public.buscar_pontos_comunidade(
  p_texto text default null, p_cidade text default null,
  p_latitude double precision default null, p_longitude double precision default null,
  p_raio_m integer default 2000, p_limite integer default 5, p_categoria text default null
) returns table (
  ponto_id uuid, nome text, categoria text, cidade text, endereco text,
  latitude double precision, longitude double precision, distancia_m integer,
  osm_wheelchair text, osm_toilets_wheelchair text, osm_opening_hours text,
  osm_phone text, osm_website text, consenso jsonb
)
language plpgsql stable security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_texto text;
  v_cidade text;
  v_cat text;
  v_n text;
  v_g extensions.geography;
  v_raio integer;
  v_lim integer;
begin
  if (p_texto is not null and char_length(p_texto) > 120)
     or (p_cidade is not null and char_length(p_cidade) > 80)
     or (p_categoria is not null and char_length(btrim(p_categoria)) > 40) then
    raise exception using errcode = 'P0001', message = 'parametro_invalido';
  end if;

  v_texto := nullif(btrim(coalesce(p_texto, '')), '');
  v_cidade := nullif(lower(public.f_unaccent(btrim(coalesce(p_cidade, '')))), '');
  v_cat := nullif(lower(public.f_unaccent(btrim(coalesce(p_categoria, '')))), '');
  v_n := case when v_texto is null then null else public.normalizar_nome_local(v_texto) end;
  v_raio := greatest(100, least(coalesce(p_raio_m, 2000), 10000));
  v_lim := greatest(1, least(coalesce(p_limite, 5), 10));

  if p_latitude is not null and p_longitude is not null
     and p_latitude between -90 and 90 and p_longitude between -180 and 180 then
    v_g := extensions.st_setsrid(extensions.st_makepoint(p_longitude, p_latitude), 4326)::extensions.geography;
  end if;

  return query
  select p.id, p.nome, p.categoria, p.cidade, p.endereco, p.latitude, p.longitude,
         case when v_g is null then null else round(extensions.st_distance(p.geog, v_g))::integer end,
         p.osm_wheelchair, p.osm_toilets_wheelchair, p.osm_opening_hours, p.osm_phone, p.osm_website,
         coalesce((select jsonb_agg(to_jsonb(cr)) from public.consenso_recursos(p.id) cr), '[]'::jsonb)
  from public.pontos p
  where p.status = 'em_mapeamento'
    and (v_n is null or public.nome_similaridade(p.nome_normalizado, v_n) >= 0.35)
    and (v_cidade is null or lower(public.f_unaccent(p.cidade)) like '%' || v_cidade || '%')
    and (v_cat is null or lower(public.f_unaccent(p.categoria)) like '%' || v_cat || '%')
    and (v_g is null or extensions.st_dwithin(p.geog, v_g, v_raio))
  order by
    case when v_g is null then null else extensions.st_distance(p.geog, v_g) end asc nulls last,
    case when v_n is null then null else public.nome_similaridade(p.nome_normalizado, v_n) end desc nulls last,
    p.nome
  limit v_lim;
end $$;

-- ============================================================
-- Fechamento (nesta ordem)
-- ============================================================

-- (1) Privilégios das funções criadas aqui.
grant execute on function public.relato_recursos_validos(jsonb) to authenticated, service_role;

revoke execute on function public.ensure_relato_identity() from public, anon, authenticated;
revoke execute on function public.relatos_validar_texto() from public, anon, authenticated;
revoke execute on function public.relatos_limite_origem() from public, anon, authenticated;

revoke execute on function public._purgar_origem_eventos() from public, anon, authenticated;

revoke execute on function public.relato_recente_existe(uuid) from public, anon;
grant execute on function public.relato_recente_existe(uuid) to authenticated;
revoke execute on function public.relato_bloqueado_ate(uuid) from public, anon;
grant execute on function public.relato_bloqueado_ate(uuid) to authenticated;
revoke execute on function public.admin_ocultar_relato(uuid) from public, anon;
grant execute on function public.admin_ocultar_relato(uuid) to authenticated;

grant execute on function public.diagnostico_origem(text) to anon, authenticated;
grant execute on function public.consenso_recursos(uuid) to anon, authenticated;
grant execute on function public.buscar_pontos_comunidade(text, text, double precision, double precision, integer, integer, text) to anon, authenticated;

-- (2) handle_new_user: SECURITY DEFINER antiga sem revoke (função de trigger).
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- (3) suggest_local: o comentário de migrations_sugestoes.sql diz "não concedido a anon",
-- mas as default privileges do Supabase concedem EXECUTE direto a anon
-- (o revoke ... from public de lá não remove esse grant).
revoke execute on function public.suggest_local(text, text, double precision, double precision) from anon;
-- o grant ... to authenticated de migrations_sugestoes.sql continua valendo (não é tocado).

-- (4) Uma única policy de INSERT em relatos_pontos (policies se combinam por OR).
do $$ begin
  if exists (select 1 from pg_policies
             where schemaname = 'public' and tablename = 'relatos_pontos'
               and cmd in ('INSERT','ALL') and policyname <> 'relatos_insert_rate') then
    raise exception 'Há outra policy de INSERT/ALL em relatos_pontos; remova-a (ver pg_policies) e rode de novo.';
  end if;
end $$;

-- (5) Guarda P5 (último bloco): nenhuma SECURITY DEFINER de public executável
-- por anon/authenticated fora das listas permitidas. Se acusar um nome não
-- previsto, a migração é revertida: confira a função antes de mexer na lista.
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
  if v is not null then
    raise exception 'SECURITY DEFINER exposta a anon: %', v;
  end if;

  select string_agg(p.proname, ', ') into v
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and has_function_privilege('authenticated', p.oid, 'execute')
    and p.proname <> all (v_auth);
  if v is not null then
    raise exception 'SECURITY DEFINER exposta a authenticated: %', v;
  end if;
end $$;
