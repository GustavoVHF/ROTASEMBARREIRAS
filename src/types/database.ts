/** Mirrors Supabase schema. Keep in sync w/ migrations.sql */

/** Three-state confirmation for an individual accessibility DETAIL item
 * (public.pontos.acessibilidade_detalhes[].estado) — NOT for the 4
 * top-level summary flags below, which stay plain booleans.
 * "nao_verificado" is the default and is distinct from an explicit "no" —
 * it means nobody has confirmed either way yet. See
 * supabase/migrations_acessibilidade_estados.sql. */
export type AccessibilityState = "tem" | "nao_tem" | "nao_verificado";

/** One item in public.pontos.acessibilidade_detalhes (jsonb array). */
export interface AccessibilityDetail {
  texto: string;
  estado: AccessibilityState;
}

/** Row shape of public.pontos, as returned by PostgREST. */
export interface PontoRow {
  id: string;
  nome: string;
  categoria: string;
  latitude: number;
  longitude: number;
  endereco: string | null;
  descricao_curta: string | null;
  descricao_longa: string | null;
  imagem_capa: string | null;
  galeria_imagens: string[];
  /** Storage folder slug under bucket pontos-imagens (e.g. "ibituruna").
   * Used by the in-app photo gallery to list all images for this point.
   * Null on rows created before this column existed — falls back to
   * qr_code_value in rowToPoint(). */
  pasta_imagens: string | null;
  /** Summary flags — plain booleans, chip shown orange (true) or dull gray
   * (false). No 3rd state at this level (see acessibilidade_detalhes for
   * the 3-state rating). */
  acessibilidade_rampa: boolean;
  acessibilidade_audio: boolean;
  acessibilidade_braille: boolean;
  acessibilidade_libras: boolean;
  /** Equipe preparada para receber pessoas com deficiência (atendimento
   * prioritário, funcionário treinado). Added by
   * supabase/migrations_acessibilidade_atendimento.sql — default false, so
   * rows created before it simply read as "não tem". */
  acessibilidade_atendimento: boolean;
  acessibilidade_detalhes: AccessibilityDetail[];
  audio_url: string | null;
  audiodescricao_url: string | null;
  video_libras_url: string | null;
  qr_code_value: string | null;
  cidade: string;
  xp_value: number;
  criado_em: string;
  atualizado_em: string;
}

export interface UserSearchRow {
  id: string;
  user_id: string;
  point_id: string;
  searched_at: string;
}

export interface TrilhaRow {
  id: string;
  titulo: string;
  descricao: string | null;
  imagem_capa: string | null;
  selo_titulo: string | null;
  cidade: string;
  criado_em: string;
}

export interface TrilhaPontoRow {
  trilha_id: string;
  ponto_id: string;
  ordem: number;
}

/** Confirmed QR scan — source of truth for trail progress + XP. Distinct
 * from user_searches (which also logs plain map/search clicks, not just
 * physical QR confirmations). unique(user_id, ponto_id) means this row's
 * mere existence = "first confirmed scan", so XP is never double-counted. */
export interface UserScanRow {
  id: string;
  user_id: string;
  ponto_id: string;
  scanned_at: string;
}

export interface UserTrailBadgeRow {
  id: string;
  user_id: string;
  trilha_id: string;
  earned_at: string;
}

export interface UserFavoriteRow {
  id: string;
  user_id: string;
  point_id: string;
  created_at: string;
}

export interface AccessibilityPreferencesRow {
  user_id: string;
  audio_enabled: boolean; // reused for "Leitura em voz alta" toggle
  libras_enabled: boolean; // reused for VLibras widget toggle
  high_contrast_enabled: boolean;
  font_scale: "normal" | "lg" | "xl";
  reduce_motion_enabled?: boolean;
  updated_at: string;
}

export interface Profile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
  /** Grants access to /admin/*. See supabase/migrations_admin.sql. Default
   * false — set manually per-account (Table Editor or the SQL snippet at
   * the bottom of that migration), never settable from the client. */
  is_admin: boolean;
}

/** Row shape of public.sugestoes_locais (admin triage queue for the
 * "Sugerir um local" feature). Never read/written by regular users —
 * SELECT/UPDATE/DELETE are admin-only RLS policies; INSERT only via the
 * suggest_local RPC. See supabase/migrations_sugestoes.sql +
 * migrations_admin.sql. */
export interface SugestaoLocalRow {
  id: string;
  nome: string;
  endereco: string | null;
  latitude: number;
  longitude: number;
  apoios: number;
  user_id: string | null;
  status: "pendente" | "aprovado" | "rejeitado";
  criado_em: string;
}

/** Community condition report for a point. Append-only; "active" condition is
 * computed at query time: problem count > ok count within the last 14 days. */
export interface RelatoRow {
  id: string;
  ponto_id: string;
  user_id: string | null; // null for anonymous guests
  guest_id: string | null; // localStorage guest id when anonymous
  tipo: "ok" | "problema";
  texto: string | null;
  criado_em: string;
}

/** Relato joined with the reporter's public profile (name + avatar). */
export interface RelatoWithProfile extends RelatoRow {
  reporter_name: string; // profile.full_name, or "Visitante" when anonymous
  reporter_avatar: string | null; // profile.avatar_url, or null
}
