-- ============================================================
-- Rota sem Barreiras — Upload de imagens pelo painel admin
-- (bucket `pontos-imagens`)
-- ADDITIVE ONLY. Safe to re-run (policies dropped-then-recreated by name).
-- Run in Supabase SQL Editor, once, AFTER:
--   1. migrations_admin.sql   (creates public.is_admin())
--   2. o bucket `pontos-imagens` existir (Storage → New bucket, public: on)
--
-- WHY: migrations_storage_pontos_imagens.sql deliberately created NO insert
-- policy — photos were uploaded by hand via the Dashboard. The admin panel
-- (/admin/pontos) now uploads images straight from the form, so admins need
-- INSERT/UPDATE/DELETE on storage.objects for this one bucket. Everyone else
-- keeps read-only access (pontos_imagens_select_public, unchanged).
--
-- NOTE ON "criar o bucket automaticamente": creating a *bucket* requires the
-- service_role key, which must never reach the browser. The app instead uses
-- ONE fixed public bucket (`pontos-imagens`) and creates a FOLDER per point
-- automatically, derived from the point name (slugifyPontoFolder in
-- src/services/pointsService.ts). Storage folders are implicit in the object
-- path, so the first upload creates it — no manual step, no extra key.
-- ============================================================

-- Admins podem enviar novas imagens para o bucket pontos-imagens.
drop policy if exists "pontos_imagens_insert_admin" on storage.objects;
create policy "pontos_imagens_insert_admin" on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'pontos-imagens' and public.is_admin());

-- Admins podem sobrescrever (upsert) imagens existentes.
drop policy if exists "pontos_imagens_update_admin" on storage.objects;
create policy "pontos_imagens_update_admin" on storage.objects
  for update
  to authenticated
  using (bucket_id = 'pontos-imagens' and public.is_admin())
  with check (bucket_id = 'pontos-imagens' and public.is_admin());

-- Admins podem remover imagens (botão "remover" na galeria do painel).
drop policy if exists "pontos_imagens_delete_admin" on storage.objects;
create policy "pontos_imagens_delete_admin" on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'pontos-imagens' and public.is_admin());

-- Leitura pública continua vindo de migrations_storage_pontos_imagens.sql
-- ("pontos_imagens_select_public"). Nada aqui altera esse comportamento.
