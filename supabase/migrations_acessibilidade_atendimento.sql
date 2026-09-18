-- ============================================================
-- Rota sem Barreiras — 5º recurso de acessibilidade: ATENDIMENTO
-- ADDITIVE ONLY. Não derruba/reseta nada de migrations.sql.
-- Seguro rodar mais de uma vez (add column if not exists).
-- Rodar no Supabase SQL Editor, uma vez.
--
-- O QUE FAZ:
--   Adiciona public.pontos.acessibilidade_atendimento (boolean, default
--   false) ao lado dos 4 flags que já existiam (rampa, audio, braille,
--   libras). Representa "equipe preparada para receber pessoas com
--   deficiência": atendimento prioritário, funcionário treinado,
--   acompanhamento até o local, etc.
--
-- POR QUE default false e NOT NULL:
--   Mesma convenção dos outros 4 flags — o app trata o chip como
--   "tem / não tem", sem 3º estado. O estado "não informado" existe
--   apenas nos itens de acessibilidade_detalhes (jsonb), que continuam
--   com tem / nao_tem / nao_verificado (migrations_acessibilidade_estados.sql).
--   Assim nenhuma linha antiga quebra: todas passam a valer false até
--   alguém marcar no painel /admin/pontos.
--
-- RLS: nada a fazer. As policies de pontos são por linha/ação
--   (pontos_select_public, pontos_*_admin), não por coluna — a coluna
--   nova já entra coberta.
-- ============================================================

alter table public.pontos
  add column if not exists acessibilidade_atendimento boolean not null default false;

comment on column public.pontos.acessibilidade_atendimento is
  'Equipe preparada para receber pessoas com deficiência (atendimento prioritário, funcionário treinado). Flag resumo, sem 3º estado — igual aos outros acessibilidade_*.';

-- ---------- Conferir ----------
-- select nome, acessibilidade_rampa, acessibilidade_audio, acessibilidade_braille,
--        acessibilidade_libras, acessibilidade_atendimento
-- from public.pontos
-- order by nome;

-- ---------- Backfill opcional ----------
-- Se alguns pontos já citam atendimento na lista de bullets
-- (acessibilidade_detalhes), dá para ligar o flag de uma vez. Revise
-- antes de rodar — é um UPDATE em massa:
--
--   update public.pontos p
--   set acessibilidade_atendimento = true
--   where exists (
--     select 1
--     from jsonb_array_elements(coalesce(p.acessibilidade_detalhes, '[]'::jsonb)) as item
--     where item->>'estado' = 'tem'
--       and item->>'texto' ilike '%atendimento%'
--   );
