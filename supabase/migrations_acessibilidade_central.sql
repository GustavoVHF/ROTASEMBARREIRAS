-- ============================================================
-- Rota sem Barreiras — Central de Acessibilidade
-- (recursos visuais e de leitura)
-- ADDITIVE ONLY. Não derruba/reseta nada de migrations.sql.
-- Seguro rodar mais de uma vez (add column if not exists + guards).
-- Rodar no Supabase SQL Editor, uma vez.
--
-- O QUE FAZ: adiciona 5 colunas em public.accessibility_preferences,
-- que é a linha 1:1 por usuário já usada por alto contraste, escala de
-- fonte, leitura em voz alta e reduzir movimento. Nenhuma tabela nova —
-- as preferências continuam viajando com o usuário entre páginas e
-- sessões pelo mesmo caminho (AuthContext.updatePreferences).
--
--   color_saturation      normal | high | low | grayscale
--   text_spacing          tight | normal | wide | wider
--   line_height           normal | relaxed | loose
--   hide_images_enabled   boolean
--   dyslexia_mode_enabled boolean
--
-- Todas com default = comportamento atual, então nenhuma linha antiga
-- muda de aparência ao rodar isto.
--
-- RLS: nada a fazer. As policies de accessibility_preferences são por
-- linha (user_id = auth.uid()), não por coluna.
-- ============================================================

alter table public.accessibility_preferences
  add column if not exists color_saturation text not null default 'normal',
  add column if not exists text_spacing text not null default 'normal',
  add column if not exists line_height text not null default 'normal',
  add column if not exists hide_images_enabled boolean not null default false,
  add column if not exists dyslexia_mode_enabled boolean not null default false;

-- ---------- Constraints de domínio ----------
-- Blindagem contra valor inválido chegando do cliente. Cada bloco só cria
-- a constraint se ela ainda não existir, então re-rodar é inofensivo.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'accessibility_color_saturation_check') then
    alter table public.accessibility_preferences
      add constraint accessibility_color_saturation_check
      check (color_saturation in ('normal', 'high', 'low', 'grayscale'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'accessibility_text_spacing_check') then
    alter table public.accessibility_preferences
      add constraint accessibility_text_spacing_check
      check (text_spacing in ('tight', 'normal', 'wide', 'wider'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'accessibility_line_height_check') then
    alter table public.accessibility_preferences
      add constraint accessibility_line_height_check
      check (line_height in ('normal', 'relaxed', 'loose'));
  end if;
end $$;

comment on column public.accessibility_preferences.color_saturation is
  'Saturação das cores da interface. Ignorada enquanto high_contrast_enabled = true (os dois recursos disputam a mesma paleta).';
comment on column public.accessibility_preferences.text_spacing is
  'Espaçamento entre letras/palavras dos conteúdos textuais.';
comment on column public.accessibility_preferences.line_height is
  'Altura da linha dos conteúdos textuais.';
comment on column public.accessibility_preferences.hide_images_enabled is
  'Oculta imagens da interface (tiles/marcadores do mapa são preservados).';
comment on column public.accessibility_preferences.dyslexia_mode_enabled is
  'Modo de leitura amigável para dislexia: tipografia Lexend, sem itálico/caixa alta, espaçamento e altura de linha maiores.';

-- ---------- Conferir ----------
-- select user_id, high_contrast_enabled, font_scale, color_saturation,
--        text_spacing, line_height, hide_images_enabled, dyslexia_mode_enabled
-- from public.accessibility_preferences;
