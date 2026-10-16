-- ============================================================
-- Rota sem Barreiras — verificação da sincronização OSM sobre dados REAIS
-- Rodar no SQL Editor, bloco a bloco (selecionar o trecho e executar).
-- Os blocos estão comentados de propósito: nada roda por engano.
-- O snapshot fica no schema "qa" (não exposto pelo PostgREST).
-- ============================================================


-- ============================================================
-- RODAR ANTES da 1ª sincronização  (testes (a) e (b))
-- ============================================================
-- create schema if not exists qa;
-- drop table if exists qa.oficiais_antes;
-- create table qa.oficiais_antes as select * from public.pontos where status = 'oficial';
-- select count(*) as oficiais_antes from qa.oficiais_antes;            -- esperado: 22
-- select
--   (select count(*) from public.pontos) as pontos,
--   (select count(*) from public.pontos where origem = 'osm') as pontos_osm_origem,
--   (select count(*) from public.pontos_osm) as pontos_osm,
--   (select count(*) from public.candidatos_duplicidade) as candidatos;


-- ============================================================
-- RODAR DEPOIS de cada sincronização  (teste (a))
-- ============================================================
-- Contagens (comparar entre a 1ª e a 2ª execução: devem ser iguais).
-- select
--   (select count(*) from public.pontos) as pontos,
--   (select count(*) from public.pontos where origem = 'osm') as pontos_osm_origem,
--   (select count(*) from public.pontos where status = 'em_mapeamento') as em_mapeamento,
--   (select count(*) from public.pontos_osm) as pontos_osm,
--   (select count(*) from public.candidatos_duplicidade) as candidatos,
--   (select count(*) from public.candidatos_duplicidade where status = 'pendente') as pendentes;

-- Duplicatas (as três devem voltar vazias).
-- select osm_tipo, osm_id, count(*) from public.pontos
-- where osm_id is not null group by 1, 2 having count(*) > 1;
-- select osm_tipo, osm_id, count(*) from public.pontos_osm group by 1, 2 having count(*) > 1;
-- select osm_tipo, osm_id, ponto_existente_id, count(*) from public.candidatos_duplicidade
-- group by 1, 2, 3 having count(*) > 1;

-- Últimas execuções registradas.
-- select id, cidade, executado_em, relatorio from public.osm_sync_execucoes order by id desc limit 5;


-- ============================================================
-- (b) 22 oficiais intactos
-- ============================================================
-- Mesmos ids e mesma contagem.
-- select count(*) as oficiais_agora from public.pontos p
-- where p.status = 'oficial' and p.id in (select id from qa.oficiais_antes);   -- esperado: 22
-- select id from qa.oficiais_antes except select id from public.pontos where status = 'oficial';  -- vazio

-- Diferenças coluna a coluna: se o valor antes não era nulo/vazio, tem que ser igual depois.
-- (Ignora atualizado_em e as colunas novas osm_*, geog, nome_normalizado, status, origem.)
-- select a.id, c.coluna, c.antes, c.depois
-- from qa.oficiais_antes a
-- join public.pontos p on p.id = a.id
-- cross join lateral (
--   select k.key as coluna, k.value as antes, to_jsonb(p) -> k.key as depois
--   from jsonb_each(to_jsonb(a)) k
--   where k.key not in ('atualizado_em','osm_tipo','osm_id','osm_wheelchair','osm_toilets_wheelchair',
--                       'osm_opening_hours','osm_phone','osm_website','osm_sincronizado_em',
--                       'geog','nome_normalizado','status','origem')
--     and k.value <> 'null'::jsonb and k.value <> '""'::jsonb
--     and k.value <> '[]'::jsonb and k.value <> '{}'::jsonb
--     and (to_jsonb(p) -> k.key) is distinct from k.value
-- ) c;                                                                    -- esperado: 0 linhas

-- Proximidade: nenhum em_mapeamento a <= 60 m de um oficial com nome similar.
-- select o.nome as oficial, m.nome as em_mapeamento,
--        round(extensions.st_distance(o.geog, m.geog)) as dist_m,
--        public.nome_similaridade(o.nome_normalizado, m.nome_normalizado) as sim
-- from public.pontos o
-- join public.pontos m on m.status = 'em_mapeamento'
--   and extensions.st_dwithin(o.geog, m.geog, (select dist_vinculo_m from public.mapeamento_config where id))
-- where o.status = 'oficial'
--   and public.nome_similaridade(o.nome_normalizado, m.nome_normalizado) >= (select similaridade_min from public.mapeamento_config where id);
--                                                                      -- esperado: 0 linhas

-- Nenhum em_mapeamento a <= 150 m com nome similar ou mesma categoria, exceto os "separado".
-- select o.nome as oficial, m.nome as em_mapeamento, m.categoria,
--        round(extensions.st_distance(o.geog, m.geog)) as dist_m,
--        public.nome_similaridade(o.nome_normalizado, m.nome_normalizado) as sim
-- from public.pontos o
-- join public.pontos m on m.status = 'em_mapeamento'
--   and extensions.st_dwithin(o.geog, m.geog, (select dist_revisao_m from public.mapeamento_config where id))
-- where o.status = 'oficial'
--   and (public.nome_similaridade(o.nome_normalizado, m.nome_normalizado) >= (select similaridade_min from public.mapeamento_config where id)
--        or public.categoria_compativel(o.categoria, m.categoria))
--   and not exists (
--     select 1 from public.candidatos_duplicidade cd
--     where cd.status = 'separado' and cd.osm_tipo = m.osm_tipo and cd.osm_id = m.osm_id
--   );                                                                 -- esperado: 0 linhas


-- ============================================================
-- (c) Invariante da fila (dados reais): toda linha pendente é ambígua de verdade
-- ============================================================
-- select cd.* from public.candidatos_duplicidade cd, public.mapeamento_config cfg
-- where cfg.id and cd.status = 'pendente'
--   and not (cd.distancia_m <= cfg.dist_revisao_m
--            and (cd.similaridade >= cfg.similaridade_min or cd.mesma_categoria));   -- esperado: 0 linhas

-- Fila atual para revisão no /admin/duplicidades.
-- select cd.id, cd.nome as osm, p.nome as existente, cd.distancia_m, cd.similaridade, cd.mesma_categoria, cd.status
-- from public.candidatos_duplicidade cd join public.pontos p on p.id = cd.ponto_existente_id
-- order by cd.status, cd.distancia_m;


-- ============================================================
-- Calibração do limiar de similaridade (design §11) — depois da 1ª execução real
-- ============================================================
-- Pares oficial x em_mapeamento a <= 150 m com nome "meio parecido".
-- select o.nome as oficial, m.nome as em_mapeamento,
--        round(extensions.st_distance(o.geog, m.geog)) as dist_m,
--        round(public.nome_similaridade(o.nome_normalizado, m.nome_normalizado)::numeric, 3) as sim
-- from public.pontos o
-- join public.pontos m on m.status = 'em_mapeamento' and extensions.st_dwithin(o.geog, m.geog, 150)
-- where o.status = 'oficial'
--   and public.nome_similaridade(o.nome_normalizado, m.nome_normalizado) between 0.35 and 0.7
-- order by sim desc;
-- Linhas da fila com a similaridade calculada.
-- select nome, distancia_m, similaridade, mesma_categoria, status from public.candidatos_duplicidade order by similaridade desc;
-- Ajuste (se houver falso negativo claro):
-- update public.mapeamento_config set similaridade_min = 0.5;


-- ============================================================
-- Promoção (CA-14) — antes e depois de promover no /admin/pontos
-- ============================================================
-- Trocar <ID> pelo id do ponto em mapeamento escolhido.
-- select id, status, origem, osm_tipo, osm_id, qr_code_value from public.pontos where id = '<ID>';
-- select count(*) as total_pontos from public.pontos;
-- select count(*) as relatos_do_ponto from public.relatos_pontos where ponto_id = '<ID>';
-- Depois de promover, além das três acima:
-- select * from public.trilha_pontos where ponto_id = '<ID>';           -- 1 linha (trilha automática)
-- select qr_code_value, count(*) from public.pontos where qr_code_value is not null group by 1 having count(*) > 1;  -- vazio


-- ============================================================
-- Consumidores (CA-15)
-- ============================================================
-- select count(*) from public.pontos where status = 'em_mapeamento' and qr_code_value is not null;  -- esperado: 0
-- select count(*) from public.pontos where status = 'oficial';                                       -- = snapshot


-- ============================================================
-- Ids para o teste de relatos (npm run test:relatos -- --oficial <id> --mapeamento <id>)
-- ============================================================
-- select id, nome from public.pontos where status = 'oficial' order by nome limit 5;
-- select id, nome from public.pontos where status = 'em_mapeamento' order by nome limit 5;


-- ============================================================
-- LIMPEZA PÓS-TESTE (destrutivo; só com os ids impressos por npm run test:relatos)
-- ============================================================
-- Trocar <A> e <B> pelos valores de TEST_USER_IDS.
-- delete from public.relatos_pontos where user_id in ('<A>'::uuid, '<B>'::uuid);
-- delete from auth.users where id in ('<A>'::uuid, '<B>'::uuid) and is_anonymous;
-- opcional: eventos de origem do teste (só hashes; somem sozinhos em 2 h)
-- delete from public.relatos_origem_eventos where criado_em > now() - interval '2 hours';
-- Conferência (ambos 0):
-- select count(*) from public.relatos_pontos where user_id in ('<A>'::uuid, '<B>'::uuid);
-- select count(*) from auth.users where id in ('<A>'::uuid, '<B>'::uuid);
-- Relatos feitos à mão na janela anônima: localizar e apagar só os próprios, pelo id.
-- select id, user_id, ponto_id, criado_em from public.relatos_pontos order by criado_em desc limit 10;


-- ============================================================
-- Fim: remover o snapshot
-- ============================================================
-- drop schema qa cascade;
