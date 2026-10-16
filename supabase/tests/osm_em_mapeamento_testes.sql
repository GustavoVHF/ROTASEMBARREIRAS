-- ============================================================
-- Rota sem Barreiras — testes de banco do OSM "Em mapeamento" + relatos
-- Rodar no SQL Editor DEPOIS das migrações 01, 02 e 03.
-- Tudo roda em uma única transação e termina em ROLLBACK: nada fica gravado.
-- Pode rodar quantas vezes for preciso.
--
-- Fixtures sintéticas no oceano (lat -10.0, lng -30.0), cidade 'QA Teste',
-- osm_id >= 9000000000. Não interferem nos dados reais.
-- Cada caso é um bloco "do $$ ... $$"; um assert falho aborta com a mensagem.
-- Ao final, a saída "NOTICE: OK ..." lista os casos que passaram.
-- ============================================================

begin;

-- ---------- Helpers (só como postgres) ----------
create function pg_temp.el(
  p_ordem int, p_tipo text, p_id bigint, p_nome text, p_cat text,
  p_lat double precision, p_lng double precision, p_endereco text default null
) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'ordem', p_ordem, 'osm_tipo', p_tipo, 'osm_id', p_id, 'nome', p_nome, 'categoria', p_cat,
    'lat', p_lat, 'lng', p_lng, 'endereco', p_endereco,
    'wheelchair', null, 'toilets_wheelchair', null, 'opening_hours', null, 'phone', null, 'website', null)
$$;

-- ---------- Fixtures ----------
-- Usuários (o trigger handle_new_user cria profiles).
insert into auth.users (instance_id, id, aud, role, email, is_anonymous, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'qa-admin@exemplo.invalid', false, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000011', 'authenticated', 'authenticated', null, true, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000012', 'authenticated', 'authenticated', null, true, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000013', 'authenticated', 'authenticated', null, true, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000014', 'authenticated', 'authenticated', null, true, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000015', 'authenticated', 'authenticated', null, true, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000016', 'authenticated', 'authenticated', 'qa-comum@exemplo.invalid', false, '{}'::jsonb, now(), now());

insert into public.profiles (id, is_admin) values ('aaaaaaaa-0000-4000-8000-000000000001', true)
on conflict (id) do update set is_admin = true;

-- Ponto oficial fixture (endereço vazio de propósito, para C2).
insert into public.pontos (id, nome, categoria, cidade, latitude, longitude, endereco, status, origem)
values ('bbbbbbbb-0000-4000-8000-000000000001', 'Praça Fixture', 'Lazer', 'QA Teste', -10.0, -30.0, null, 'oficial', 'oficial');

-- Pontos em mapeamento para H2/O1/O3 (longe dos demais).
insert into public.pontos (id, nome, categoria, cidade, latitude, longitude, status, origem)
values
  ('bbbbbbbb-0000-4000-8000-000000000002', 'QA H2 Alfa', 'Lazer', 'QA Teste', -10.10, -30.0, 'em_mapeamento', 'osm'),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'QA H2 Beta', 'Lazer', 'QA Teste', -10.11, -30.0, 'em_mapeamento', 'osm'),
  ('bbbbbbbb-0000-4000-8000-000000000004', 'QA O1 Gama', 'Lazer', 'QA Teste', -10.12, -30.0, 'em_mapeamento', 'osm'),
  ('bbbbbbbb-0000-4000-8000-000000000005', 'QA O3 Delta', 'Lazer', 'QA Teste', -10.13, -30.0, 'em_mapeamento', 'osm');

-- Payload principal (C1–C4):
--  C1: 100 m ao norte, mesma categoria, nome diferente  -> fila
--  C2: 40 m ao norte, "Praca Fixture" com endereço      -> vinculado ao oficial
--  C3: 300 m ao norte                                   -> em_mapeamento
--  C4: node + way "Museu Gêmeo" a 20 m (longe)          -> 1 ponto, 2 linhas em pontos_osm
create temp table qa_payload as
select jsonb_build_array(
  pg_temp.el(0, 'node', 9000000001, 'Quadra Zeta',    'Lazer',   -9.999096, -30.0),
  pg_temp.el(1, 'node', 9000000002, 'Praca Fixture',  'Lazer',   -9.999638, -30.0, 'Rua QA, 1'),
  pg_temp.el(2, 'node', 9000000003, 'Coreto Isolado', 'Lazer',   -9.997287, -30.0),
  pg_temp.el(3, 'node', 9000000004, 'Museu Gêmeo',    'Cultura', -10.02,    -30.0),
  pg_temp.el(4, 'way',  9000000005, 'Museu Gêmeo',    'Cultura', -10.019819, -30.0, 'Rua Gêmea, 5')
) as p;

-- ============================================================
-- C1–C4 + idempotência
-- ============================================================
do $$
declare
  r1 jsonb; r2 jsonb;
  v_pontos_antes int; v_pontos_depois int;
  v_osm_antes int; v_osm_depois int;
  v_fila_antes int; v_fila_depois int;
  v_oficial record;
  v_museu record;
begin
  r1 := public.osm_sync_aplicar('QA Teste', (select p from qa_payload));
  raise notice 'C1-C4 relatorio 1: %', r1;

  -- C1
  assert (r1->>'fila_novos')::int = 1, 'C1: fila_novos deveria ser 1';
  assert exists (select 1 from public.candidatos_duplicidade
                 where osm_id = 9000000001 and status = 'pendente'
                   and ponto_existente_id = 'bbbbbbbb-0000-4000-8000-000000000001'), 'C1: candidato pendente ausente';
  assert not exists (select 1 from public.pontos where osm_id = 9000000001), 'C1: não deveria criar ponto';

  -- C2
  select * into v_oficial from public.pontos where id = 'bbbbbbbb-0000-4000-8000-000000000001';
  assert (r1->>'vinculados_oficial')::int = 1, 'C2: vinculados_oficial deveria ser 1';
  assert v_oficial.osm_id = 9000000002 and v_oficial.osm_tipo = 'node', 'C2: osm_id não vinculado ao oficial';
  assert v_oficial.nome = 'Praça Fixture', 'C2: nome oficial foi alterado';
  assert v_oficial.endereco = 'Rua QA, 1', 'C2: endereço vazio deveria ser preenchido';
  assert v_oficial.status = 'oficial' and v_oficial.origem = 'oficial', 'C2: status/origem do oficial mudou';

  -- C3
  assert exists (select 1 from public.pontos where osm_id = 9000000003 and status = 'em_mapeamento' and origem = 'osm'),
    'C3: ponto em mapeamento não criado';

  -- C4
  select * into v_museu from public.pontos where osm_tipo = 'node' and osm_id = 9000000004;
  assert v_museu.id is not null, 'C4: node primário não virou ponto';
  assert (select count(*) from public.pontos where nome = 'Museu Gêmeo') = 1, 'C4: dois pins para o mesmo lugar';
  assert (select count(*) from public.pontos_osm where ponto_id = v_museu.id) = 2, 'C4: deveria haver 2 linhas em pontos_osm';
  assert v_museu.endereco = 'Rua Gêmea, 5', 'C4: endereço do way deveria preencher o ponto';
  assert (r1->>'criados')::int = 2 and (r1->>'mesclados_osm')::int = 1, 'C4: contagens criados/mesclados_osm';

  select count(*) into v_pontos_antes from public.pontos;
  select count(*) into v_osm_antes from public.pontos_osm;
  select count(*) into v_fila_antes from public.candidatos_duplicidade;

  -- Idempotência: mesmo payload de novo.
  r2 := public.osm_sync_aplicar('QA Teste', (select p from qa_payload));
  raise notice 'C1-C4 relatorio 2: %', r2;

  select count(*) into v_pontos_depois from public.pontos;
  select count(*) into v_osm_depois from public.pontos_osm;
  select count(*) into v_fila_depois from public.candidatos_duplicidade;
  assert v_pontos_antes = v_pontos_depois and v_osm_antes = v_osm_depois and v_fila_antes = v_fila_depois,
    'Idempotência: contagens mudaram na 2ª execução';
  assert (r2->>'criados')::int = 0 and (r2->>'fila_novos')::int = 0
     and (r2->>'atualizados')::int = 0 and (r2->>'fila_atualizados')::int = 0
     and (r2->>'fila_descartados')::int = 0,
    'Idempotência: 2ª execução deveria ter criados=0, fila_novos=0, atualizados=0, fila_atualizados=0, fila_descartados=0';
  assert (select endereco from public.pontos where id = v_museu.id) = 'Rua Gêmea, 5', 'C4: endereço não foi mantido na 2ª execução';

  -- Dry-run não grava nada.
  r2 := public.osm_sync_aplicar('QA Teste',
          jsonb_build_array(pg_temp.el(0, 'node', 9000000099, 'QA DryRun', 'Lazer', -10.3, -30.0)), true);
  assert (r2->>'dry_run')::boolean and (r2->>'criados')::int = 1, 'Dry-run: relatório incorreto';
  assert not exists (select 1 from public.pontos where osm_id = 9000000099), 'Dry-run: gravou ponto';

  raise notice 'OK C1 C2 C3 C4 idempotencia dry-run';
end $$;

-- ============================================================
-- C5: separar como admin cria ponto e não volta para a fila
-- ============================================================
do $$
declare
  v_cand uuid;
  r jsonb;
begin
  select id into v_cand from public.candidatos_duplicidade where osm_id = 9000000001 and status = 'pendente';

  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
  r := public.admin_resolver_candidato(v_cand, 'separar');
  reset role;

  assert r->>'acao' = 'separar' and (r->>'mesclado')::boolean = false, 'C5: resposta de separar incorreta';
  assert exists (select 1 from public.pontos where osm_id = 9000000001 and status = 'em_mapeamento'), 'C5: ponto não criado';

  r := public.osm_sync_aplicar('QA Teste', (select p from qa_payload));
  assert not exists (select 1 from public.candidatos_duplicidade where osm_id = 9000000001 and status = 'pendente'),
    'C5: elemento separado voltou para a fila';
  assert (r->>'criados')::int = 0 and (r->>'fila_novos')::int = 0, 'C5: rodar de novo criou algo';

  raise notice 'OK C5';
end $$;

-- ============================================================
-- C6: candidato que deixa de ser ambíguo é descartado e o elemento é criado
-- ============================================================
do $$
declare r jsonb;
begin
  r := public.osm_sync_aplicar('QA Teste',
         jsonb_build_array(pg_temp.el(0, 'node', 9000000006, 'Banca Teta', 'Lazer', -10.0, -29.999088)));
  assert (r->>'fila_novos')::int = 1, 'C6: deveria entrar na fila a 100 m';

  r := public.osm_sync_aplicar('QA Teste',
         jsonb_build_array(pg_temp.el(0, 'node', 9000000006, 'Banca Teta', 'Lazer', -10.0, -29.997264)));
  assert (r->>'fila_descartados')::int = 1 and (r->>'criados')::int = 1, 'C6: contagens descarte/criação';
  assert exists (select 1 from public.candidatos_duplicidade where osm_id = 9000000006 and status = 'descartado'),
    'C6: linha deveria virar descartado';
  assert exists (select 1 from public.pontos where osm_id = 9000000006 and status = 'em_mapeamento'),
    'C6: elemento deveria virar em_mapeamento';
  raise notice 'OK C6';
end $$;

-- ============================================================
-- C7: separar com outro OSM já criado a 15 m e nome similar -> mesclado
-- ============================================================
do $$
declare
  r jsonb;
  v_cand uuid;
  v_antes int;
begin
  r := public.osm_sync_aplicar('QA Teste',
         jsonb_build_array(pg_temp.el(0, 'node', 9000000070, 'Chafariz Kappa', 'Lazer', -10.04, -30.0)));
  assert (r->>'criados')::int = 1, 'C7: ponto base não criado';

  insert into public.candidatos_duplicidade (
    osm_tipo, osm_id, cidade, nome, categoria, latitude, longitude, elemento,
    ponto_existente_id, distancia_m, similaridade, mesma_categoria
  ) values (
    'node', 9000000071, 'QA Teste', 'Chafariz Kappa', 'Lazer', -10.039864, -30.0,
    public._osm_validar(pg_temp.el(0, 'node', 9000000071, 'Chafariz Kappa', 'Lazer', -10.039864, -30.0)),
    'bbbbbbbb-0000-4000-8000-000000000001', 120.0, 0.200, true
  ) returning id into v_cand;

  select count(*) into v_antes from public.pontos;

  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
  r := public.admin_resolver_candidato(v_cand, 'separar');
  reset role;

  assert (r->>'mesclado')::boolean, 'C7: deveria mesclar com o OSM existente';
  assert (select count(*) from public.pontos) = v_antes, 'C7: não deveria criar ponto novo';
  assert exists (select 1 from public.pontos_osm where osm_id = 9000000071 and papel = 'secundario'), 'C7: vínculo secundário ausente';
  raise notice 'OK C7';
end $$;

-- ============================================================
-- S1: verificar_local_existente
-- ============================================================
do $$
begin
  assert (select count(*) from public.verificar_local_existente('Praca Fixture', -9.999638, -30.0)) >= 1, 'S1: 40 m deveria achar';
  assert (select count(*) from public.verificar_local_existente('Praca Fixture', -9.997287, -30.0)
          where ponto_id = 'bbbbbbbb-0000-4000-8000-000000000001') = 0, 'S1: 300 m não deveria achar o oficial';
  assert (select count(*) from public.verificar_local_existente('Xyzzy Qwerty', -9.999638, -30.0)) = 0, 'S1: nome sem relação não deveria achar';
  raise notice 'OK S1';
end $$;

-- ============================================================
-- H1 + (f): 3 relatos "tem" -> consenso; ocultar 1 -> sem consenso, condição conta 2;
-- 2º relato da mesma sessão em < 7 dias é bloqueado (inclusive com o 1º oculto).
-- ============================================================
do $$
declare
  v_ponto uuid;
  v_relato uuid;
  v_n int;
  v_ok boolean;
  v_ate timestamptz;
  u uuid;
begin
  select id into v_ponto from public.pontos where osm_id = 9000000003;   -- Coreto Isolado (C3)

  foreach u in array array['aaaaaaaa-0000-4000-8000-000000000011','aaaaaaaa-0000-4000-8000-000000000012','aaaaaaaa-0000-4000-8000-000000000013']::uuid[] loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    insert into public.relatos_pontos (ponto_id, tipo, texto, recursos)
    values (v_ponto, 'ok', 'Teste QA', '{"entrada":"tem"}'::jsonb);
    reset role;
  end loop;

  assert exists (select 1 from public.consenso_recursos(v_ponto)
                 where recurso = 'entrada' and estado = 'tem' and apoiadores = 3), 'H1: consenso entrada/tem/3 ausente';
  assert (select count(*) from public.relatos_pontos where ponto_id = v_ponto
          and user_id = 'aaaaaaaa-0000-4000-8000-000000000011') = 1, 'H1: user_id deveria ser auth.uid()';

  -- (f) segundo relato em < 7 dias
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000011","role":"authenticated"}', true);
  v_ok := false;
  begin
    insert into public.relatos_pontos (ponto_id, tipo) values (v_ponto, 'ok');
  exception when insufficient_privilege then v_ok := true;
  end;
  v_ate := public.relato_bloqueado_ate(v_ponto);
  reset role;
  assert v_ok, '(f): 2º relato em < 7 dias deveria ser recusado (42501)';
  assert v_ate is not null, '(f): relato_bloqueado_ate deveria devolver data';

  -- Ocultar 1 (admin)
  select id into v_relato from public.relatos_pontos
  where ponto_id = v_ponto and user_id = 'aaaaaaaa-0000-4000-8000-000000000011';
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
  perform public.admin_ocultar_relato(v_relato);
  perform public.admin_ocultar_relato(v_relato);   -- idempotente
  reset role;

  assert (select oculto from public.relatos_pontos where id = v_relato), 'H1: relato deveria estar oculto';
  assert not exists (select 1 from public.consenso_recursos(v_ponto)), 'H1: oculto não deveria contar para o consenso';

  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  select count(*) into v_n from public.relatos_pontos
  where ponto_id = v_ponto and criado_em > now() - interval '14 days';
  reset role;
  assert v_n = 2, 'H1: leitura pública deveria contar 2 relatos (oculto fora)';

  -- Oculto continua contando para os 7 dias.
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000011","role":"authenticated"}', true);
  v_ok := false;
  begin
    insert into public.relatos_pontos (ponto_id, tipo) values (v_ponto, 'ok');
  exception when insufficient_privilege then v_ok := true;
  end;
  reset role;
  assert v_ok, '(f): relato oculto deveria continuar contando para os 7 dias';

  -- Não-admin não oculta.
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000012","role":"authenticated"}', true);
  v_ok := false;
  begin
    perform public.admin_ocultar_relato(v_relato);
  exception when insufficient_privilege then v_ok := true;
  end;
  reset role;
  assert v_ok, 'H1: não-admin não deveria ocultar';

  raise notice 'OK H1 (f)';
end $$;

-- ============================================================
-- H2: 0, 2 e 3 relatos; 2 "tem" x 1 "nao_tem"
-- ============================================================
do $$
declare
  a uuid := 'bbbbbbbb-0000-4000-8000-000000000002';
  b uuid := 'bbbbbbbb-0000-4000-8000-000000000003';
  users uuid[] := array['aaaaaaaa-0000-4000-8000-000000000011','aaaaaaaa-0000-4000-8000-000000000012','aaaaaaaa-0000-4000-8000-000000000013']::uuid[];
  i int;
begin
  assert not exists (select 1 from public.consenso_recursos(a)), 'H2: 0 relatos deveria ser vazio';

  for i in 1..2 loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', users[i], 'role', 'authenticated')::text, true);
    insert into public.relatos_pontos (ponto_id, tipo, recursos) values (a, 'ok', '{"entrada":"tem"}');
    reset role;
  end loop;
  assert not exists (select 1 from public.consenso_recursos(a)), 'H2: 2 relatos deveria ser vazio';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', users[3], 'role', 'authenticated')::text, true);
  insert into public.relatos_pontos (ponto_id, tipo, recursos) values (a, 'ok', '{"entrada":"tem"}');
  reset role;
  assert exists (select 1 from public.consenso_recursos(a)
                 where recurso = 'entrada' and estado = 'tem' and apoiadores = 3 and total = 3), 'H2: 3 relatos deveria dar entrada/tem/3/3';

  for i in 1..3 loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', users[i], 'role', 'authenticated')::text, true);
    insert into public.relatos_pontos (ponto_id, tipo, recursos)
    values (b, 'ok', case when i < 3 then '{"entrada":"tem"}'::jsonb else '{"entrada":"nao_tem"}'::jsonb end);
    reset role;
  end loop;
  assert not exists (select 1 from public.consenso_recursos(b)), 'H2: 2x1 não deveria ter consenso';

  raise notice 'OK H2';
end $$;

-- ============================================================
-- T1–T4 (texto) + P3 (recursos válidos) + (g) personificação
-- ============================================================
do $$
declare
  v_of uuid := 'bbbbbbbb-0000-4000-8000-000000000001';
  v_msg text;
  v_ok boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000014","role":"authenticated"}', true);

  v_msg := null;
  begin insert into public.relatos_pontos (ponto_id, tipo, texto) values (v_of, 'problema', repeat('a', 281));
  exception when raise_exception then v_msg := sqlerrm; end;
  assert v_msg = 'texto_muito_longo', 'T1: esperado texto_muito_longo, veio ' || coalesce(v_msg, 'nada');

  v_msg := null;
  begin insert into public.relatos_pontos (ponto_id, tipo, texto) values (v_of, 'problema', 'veja https://x.com');
  exception when raise_exception then v_msg := sqlerrm; end;
  assert v_msg = 'texto_com_link', 'T2: esperado texto_com_link, veio ' || coalesce(v_msg, 'nada');

  v_msg := null;
  begin insert into public.relatos_pontos (ponto_id, tipo, texto) values (v_of, 'problema', 'www.x.com');
  exception when raise_exception then v_msg := sqlerrm; end;
  assert v_msg = 'texto_com_link', 'T3: esperado texto_com_link, veio ' || coalesce(v_msg, 'nada');

  insert into public.relatos_pontos (ponto_id, tipo, texto) values (v_of, 'problema', '<script>alert(1)</script>');
  reset role;
  assert exists (select 1 from public.relatos_pontos where ponto_id = v_of and texto = '<script>alert(1)</script>'),
    'T4: texto deveria ser gravado literalmente';

  -- P3: authenticated comum com recursos válidos (CHECK chama relato_recursos_validos).
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000015","role":"authenticated"}', true);
  insert into public.relatos_pontos (ponto_id, tipo, recursos) values (v_of, 'ok', '{"banheiro":"nao_tem","libras":"tem"}');

  -- (g) A grava com user_id de B -> RLS recusa.
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000011","role":"authenticated"}', true);
  v_ok := false;
  begin
    insert into public.relatos_pontos (ponto_id, user_id, tipo) values (v_of, 'aaaaaaaa-0000-4000-8000-000000000012', 'ok');
  exception when insufficient_privilege then v_ok := true;
  end;
  reset role;
  assert v_ok, '(g): RLS deveria recusar user_id de outro usuário (42501)';
  assert not exists (select 1 from public.relatos_pontos where ponto_id = v_of
                     and user_id in ('aaaaaaaa-0000-4000-8000-000000000011','aaaaaaaa-0000-4000-8000-000000000012')),
    '(g): nenhuma linha deveria ser criada';

  raise notice 'OK T1 T2 T3 T4 P3 (g)';
end $$;

-- ============================================================
-- P1, P2, P4, P5 (privilégios)
-- ============================================================
do $$
declare
  v_ok boolean;
  v_msg text;
  v text;
  v_ponto uuid;
begin
  -- P1: admin insere e edita ponto (trigger invoker chama os helpers).
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
  insert into public.pontos (id, nome, categoria, cidade, latitude, longitude)
  values ('bbbbbbbb-0000-4000-8000-000000000009', 'QA P1 Ponto', 'Lazer', 'QA Teste', -10.2, -30.0);
  update public.pontos set nome = 'QA P1 Ponto Editado' where id = 'bbbbbbbb-0000-4000-8000-000000000009';
  reset role;
  assert (select nome_normalizado from public.pontos where id = 'bbbbbbbb-0000-4000-8000-000000000009') = 'qa p1 ponto editado',
    'P1: nome_normalizado não recalculado';

  -- P2: anon chama a bbox com categoria.
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform * from public.pontos_comunidade_bbox(-30.01, -10.01, -29.99, -9.99, 16, 'Lazer');

  -- P4: anon barrado nas internas, na sync e em suggest_local.
  v_ok := false;
  begin perform public.osm_sync_aplicar('QA Teste', '[]'::jsonb); exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'P4: anon não deveria executar osm_sync_aplicar';
  v_ok := false;
  begin perform public._osm_criar('QA Teste', '{}'::jsonb); exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'P4: anon não deveria executar _osm_criar';
  v_ok := false;
  begin perform public.suggest_local('QA Fixture', 'Endereço QA', -10.0, -30.0); exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'P4: anon não deveria executar suggest_local';

  -- P5 (parte 2): chamada direta a _osm_atualizar_mapeamento como anon.
  select id into v_ponto from public.pontos where id = 'bbbbbbbb-0000-4000-8000-000000000002';
  v_ok := false;
  begin perform public._osm_atualizar_mapeamento('bbbbbbbb-0000-4000-8000-000000000002', '{}'::jsonb);
  exception when insufficient_privilege then v_ok := true; end;
  assert v_ok, 'P5: anon não deveria executar _osm_atualizar_mapeamento';
  reset role;

  -- P4: authenticated chama suggest_local sem permission denied (erro de negócio aceito).
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000016","role":"authenticated"}', true);
  v_ok := true;
  begin perform public.suggest_local('QA Fixture', 'Endereço QA', -10.0, -30.0);
  exception
    when insufficient_privilege then v_ok := false;
    when others then null;
  end;
  reset role;
  assert v_ok, 'P4: authenticated deveria poder executar suggest_local';

  -- P5: nenhuma SECURITY DEFINER exposta fora das listas permitidas.
  select string_agg(p.proname, ', ') into v
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and has_function_privilege('anon', p.oid, 'execute')
    and p.proname <> all (array['is_admin','verificar_local_existente','consenso_recursos',
                                'buscar_pontos_comunidade','diagnostico_origem']);
  assert v is null, 'SECURITY DEFINER exposta a anon: ' || v;

  select string_agg(p.proname, ', ') into v
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and has_function_privilege('authenticated', p.oid, 'execute')
    and p.proname <> all (array['is_admin','verificar_local_existente','consenso_recursos',
                                'buscar_pontos_comunidade','diagnostico_origem',
                                'relato_recente_existe','relato_bloqueado_ate',
                                'admin_resolver_candidato','admin_ocultar_relato','suggest_local']);
  assert v is null, 'SECURITY DEFINER exposta a authenticated: ' || v;

  -- Lista dos grants (conferir contra a tabela do design §2).
  select string_agg(format('%s -> %s', r.routine_name, r.grantees), '; ' order by r.routine_name) into v
  from (
    select rp.routine_name, string_agg(distinct rp.grantee, ',' order by rp.grantee) as grantees
    from information_schema.routine_privileges rp
    where rp.routine_schema = 'public' and rp.privilege_type = 'EXECUTE'
      and rp.grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
      and rp.routine_name in ('f_unaccent','normalizar_nome_local','nome_similaridade','categoria_compativel',
        'relato_recursos_validos','pontos_sync_derivados','relatos_validar_texto','relatos_limite_origem',
        'ensure_relato_identity','sync_ponto_auto_trilha','handle_new_user','_osm_validar','_osm_criar',
        '_osm_vincular','_osm_atualizar_mapeamento','_osm_candidatos','_osm_criar_ou_mesclar',
        '_purgar_origem_eventos','osm_sync_aplicar','verificar_local_existente','pontos_comunidade_bbox',
        'consenso_recursos','buscar_pontos_comunidade','diagnostico_origem','relato_recente_existe',
        'relato_bloqueado_ate','admin_resolver_candidato','admin_ocultar_relato','suggest_local','is_admin')
    group by rp.routine_name
  ) r;
  raise notice 'Grants: %', v;

  raise notice 'OK P1 P2 P4 P5';
end $$;

-- ============================================================
-- O1–O3: limite por origem e diagnóstico
-- ============================================================
do $$
declare
  v_tem_sal boolean := false;
  p uuid := 'bbbbbbbb-0000-4000-8000-000000000004';
  users uuid[] := array['aaaaaaaa-0000-4000-8000-000000000011','aaaaaaaa-0000-4000-8000-000000000012',
                        'aaaaaaaa-0000-4000-8000-000000000013','aaaaaaaa-0000-4000-8000-000000000014',
                        'aaaaaaaa-0000-4000-8000-000000000015']::uuid[];
  i int;
  v_msg text;
begin
  begin
    select exists (select 1 from vault.decrypted_secrets where name = 'relatos_origem_sal'
                   and char_length(decrypted_secret) >= 16) into v_tem_sal;
  exception when others then v_tem_sal := false;
  end;

  if not v_tem_sal then
    raise notice 'SKIP O1: segredo relatos_origem_sal ausente no Vault (limite por origem em fail-open)';
    return;
  end if;

  update public.mapeamento_config set relatos_por_origem_hora = 3, origem_fonte = 'cf-connecting-ip' where id;
  perform set_config('request.headers', '{"cf-connecting-ip":"203.0.113.7"}', true);

  for i in 1..3 loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', users[i], 'role', 'authenticated')::text, true);
    insert into public.relatos_pontos (ponto_id, tipo) values (p, 'ok');
    reset role;
  end loop;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', users[4], 'role', 'authenticated')::text, true);
  v_msg := null;
  begin insert into public.relatos_pontos (ponto_id, tipo) values (p, 'ok');
  exception when raise_exception then v_msg := sqlerrm; end;
  reset role;
  assert v_msg = 'origem_rate_limited', 'O1: 4ª inserção deveria dar origem_rate_limited, veio ' || coalesce(v_msg, 'nada');

  assert (select bool_and(octet_length(origem_hash) = 32) from public.relatos_origem_eventos), 'O1: hash deveria ter 32 bytes';
  assert (select count(*) from public.relatos_origem_eventos) >= 3, 'O1: eventos não gravados';

  -- Eventos antigos somem no próximo insert.
  update public.relatos_origem_eventos set criado_em = now() - interval '3 hours';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', users[5], 'role', 'authenticated')::text, true);
  insert into public.relatos_pontos (ponto_id, tipo) values (p, 'ok');
  reset role;
  assert not exists (select 1 from public.relatos_origem_eventos where criado_em < now() - interval '2 hours'),
    'O1: eventos com mais de 2 h deveriam ser apagados';

  perform set_config('request.headers', '', true);
  raise notice 'OK O1';
end $$;

do $$
declare r jsonb;
begin
  perform set_config('request.headers', '{"cf-connecting-ip":"198.51.100.20","x-forwarded-for":"198.51.100.20, 10.0.0.1"}', true);
  r := public.diagnostico_origem('198.51.100.20');
  assert r->>'fonte_recomendada' = 'cf-connecting-ip', 'O2: esperado cf-connecting-ip, veio ' || coalesce(r->>'fonte_recomendada', 'null');
  assert position('198.51.100.20' in r::text) = 0, 'O2: IP não pode aparecer no retorno';

  perform set_config('request.headers', '{"x-forwarded-for":"198.51.100.20, 10.0.0.1"}', true);
  r := public.diagnostico_origem('198.51.100.20');
  assert r->>'fonte_recomendada' = 'xff-primeiro', 'O2: esperado xff-primeiro, veio ' || coalesce(r->>'fonte_recomendada', 'null');

  perform set_config('request.headers', '{"cf-connecting-ip":"203.0.113.9","x-forwarded-for":"203.0.113.9, 10.0.0.1"}', true);
  r := public.diagnostico_origem('198.51.100.20');
  assert r->>'fonte_recomendada' = 'desligado', 'O2: esperado desligado, veio ' || coalesce(r->>'fonte_recomendada', 'null');

  r := public.diagnostico_origem(null);
  assert r->'fonte_recomendada' = 'null'::jsonb, 'O2: sem IP esperado, fonte_recomendada deveria ser null';

  perform set_config('request.headers', '', true);
  raise notice 'OK O2';
end $$;

do $$
declare
  p uuid := 'bbbbbbbb-0000-4000-8000-000000000005';
  users uuid[] := array['aaaaaaaa-0000-4000-8000-000000000011','aaaaaaaa-0000-4000-8000-000000000012',
                        'aaaaaaaa-0000-4000-8000-000000000013','aaaaaaaa-0000-4000-8000-000000000014']::uuid[];
  i int;
begin
  update public.mapeamento_config set relatos_por_origem_hora = 3, origem_fonte = 'desligado' where id;
  perform set_config('request.headers', '{"cf-connecting-ip":"203.0.113.8"}', true);
  for i in 1..4 loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', users[i], 'role', 'authenticated')::text, true);
    insert into public.relatos_pontos (ponto_id, tipo) values (p, 'ok');
    reset role;
  end loop;
  assert (select count(*) from public.relatos_pontos where ponto_id = p) = 4, 'O3: com desligado as 4 inserções deveriam passar';
  perform set_config('request.headers', '', true);
  raise notice 'OK O3';
end $$;

-- ============================================================
-- Guarda de policy extra de INSERT em relatos_pontos (mesma lógica da migração 03)
-- ============================================================
do $$
declare v_ok boolean := false;
begin
  begin
    execute 'create policy qa_policy_extra on public.relatos_pontos for insert to authenticated with check (true)';
    if exists (select 1 from pg_policies
               where schemaname = 'public' and tablename = 'relatos_pontos'
                 and cmd in ('INSERT','ALL') and policyname <> 'relatos_insert_rate') then
      raise exception 'Há outra policy de INSERT/ALL em relatos_pontos; remova-a (ver pg_policies) e rode de novo.';
    end if;
  exception when raise_exception then
    v_ok := true;
  end;
  assert v_ok, 'Guarda de policy: deveria acusar a policy extra';
  assert not exists (select 1 from pg_policies where tablename = 'relatos_pontos' and policyname = 'qa_policy_extra'),
    'Guarda de policy: a policy extra deveria ter sido revertida';
  raise notice 'OK guarda de policy';
end $$;

do $$ begin raise notice 'TODOS OS CASOS PASSARAM (O1 pode ter sido SKIP, ver acima).'; end $$;

rollback;
