-- ============================================================
-- migrations_osm_04_mapa_cluster_estavel.sql
--
-- Substitui public.pontos_comunidade_bbox (criada na migração 02) para o
-- mapa mostrar pontos "Em mapeamento" de mais longe e sem piscar:
--
--  * aceita zoom >= 12 (antes só >= 15) e bbox de até 1,5° por lado
--    (antes 0,25°), porque o app agora pede uma área maior que a tela;
--  * a célula da grade depende SÓ do zoom (80 px até o zoom 14, 56 px nos
--    zooms 15–16) e cada célula tocada é agregada com TODOS os seus pontos
--    (envelope alinhado à grade), então chave, quantidade e centro de um
--    grupo não mudam conforme a borda da tela;
--  * pontos individuais a partir do zoom 17 (antes 18) quando cabem.
--
-- Mesma assinatura, mesmas colunas, mesmos formatos de chave
-- (p:<uuid>, g:<round(cell*1e7)>:<gx>:<gy>, truncado) e mesmo grant.
-- Idempotente: pode rodar de novo sem efeito colateral.
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
  v_gx0 bigint;
  v_gx1 bigint;
  v_gy0 bigint;
  v_gy1 bigint;
  v_aenv extensions.geography;
  v_abase integer;
  v_cells integer;
  v_iter integer := 0;
  v_trunc boolean := false;
  v_lim integer;
begin
  if p_oeste is null or p_sul is null or p_leste is null or p_norte is null
     or p_oeste >= p_leste or p_sul >= p_norte then
    raise exception using errcode = 'P0001', message = 'bbox_invalida';
  end if;
  if p_leste - p_oeste > 1.5 or p_norte - p_sul > 1.5 then
    raise exception using errcode = 'P0001', message = 'bbox_grande_demais';
  end if;
  if p_zoom is null or p_zoom < 12 then
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

  -- Zoom >= 17 com poucos pontos: individuais.
  if v_zoom >= 17 and v_base <= v_max then
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

  -- Célula em graus: 80 px de tela até o zoom 14, 56 px nos zooms 15–16.
  v_cell := 360.0::double precision / (256 * power(2::double precision, least(v_zoom, 18)::double precision))
            * (case when v_zoom <= 14 then 80 else 56 end);

  -- Proteção contra sobrecarga: dobra a célula (e recalcula o envelope
  -- alinhado) enquanto houver células demais. Com o volume atual não roda.
  loop
    v_gx0 := floor(p_oeste / v_cell)::bigint;
    v_gx1 := floor(p_leste / v_cell)::bigint;
    v_gy0 := floor(p_sul / v_cell)::bigint;
    v_gy1 := floor(p_norte / v_cell)::bigint;
    v_aenv := extensions.st_makeenvelope(v_gx0 * v_cell, v_gy0 * v_cell,
                                         (v_gx1 + 1) * v_cell, (v_gy1 + 1) * v_cell, 4326)::extensions.geography;

    select count(*), count(distinct (floor(b.longitude / v_cell), floor(b.latitude / v_cell)))
      into v_abase, v_cells
    from (
      select p.latitude, p.longitude from public.pontos p
      where p.status = 'em_mapeamento'
        and p.geog && v_aenv
        and floor(p.longitude / v_cell) between v_gx0 and v_gx1
        and floor(p.latitude / v_cell) between v_gy0 and v_gy1
        and (p_excluir_id is null or p.id <> p_excluir_id)
        and (v_cat is null or lower(public.f_unaccent(p.categoria)) like '%' || v_cat || '%')
      limit 3000
    ) b;
    exit when v_cells <= v_max or v_iter >= 6;
    v_cell := v_cell * 2;
    v_iter := v_iter + 1;
  end loop;

  v_trunc := v_cells > v_max or v_abase >= 3000;
  v_lim := case when v_trunc then v_max - 1 else v_max end;

  return query
  with base as (
    select p.id, p.nome, p.categoria, p.latitude, p.longitude
    from public.pontos p
    where p.status = 'em_mapeamento'
      and p.geog && v_aenv
      and floor(p.longitude / v_cell) between v_gx0 and v_gx1
      and floor(p.latitude / v_cell) between v_gy0 and v_gy1
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
    -- quantidade = itens omitidos (base alinhada menos os pontos das células devolvidas).
    return query
    select 'truncado'::text, 'truncado'::text, null::uuid, null::text, null::text,
           null::double precision, null::double precision,
           greatest(v_abase - coalesce((
             select sum(x.n)::integer from (
               select count(*)::integer as n
               from (
                 select p.latitude, p.longitude from public.pontos p
                 where p.status = 'em_mapeamento'
                   and p.geog && v_aenv
                   and floor(p.longitude / v_cell) between v_gx0 and v_gx1
                   and floor(p.latitude / v_cell) between v_gy0 and v_gy1
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

grant execute on function public.pontos_comunidade_bbox(double precision, double precision, double precision, double precision, integer, text, uuid, integer) to anon, authenticated;
