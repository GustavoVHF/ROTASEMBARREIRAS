/**
 * App-facing domain type (camelCase), decoupled from Supabase row shape.
 * Mapping choice: descricao_curta -> description (preview/search),
 * descricao_longa -> history (detail-screen body text). Keeps existing
 * component field names (BottomSheet.description, PointDetails.history)
 * untouched — no component rewrite needed for this rename.
 */
import type { AccessibilityDetail } from "@/types/database";

export interface TouristPoint {
  id: string;
  name: string;
  category: string;
  /** Cidade cadastrada no ponto (public.pontos.cidade). Usado pelo
   * assistente de voz para filtrar/agrupar por cidade sem precisar de
   * outra consulta. */
  city: string;
  coords: { lat: number; lng: number };
  image: string;
  gallery: string[];
  /** Storage folder slug (bucket pontos-imagens) used to load the FULL
   * photo gallery in the point detail screen — distinct from `gallery`
   * above, which only holds the manually-curated URLs in
   * galeria_imagens. Null if the point has no folder configured. */
  imageFolder: string | null;
  description: string;
  history: string;
  accessibility: {
    /** Summary flags — plain booleans (chip: orange when true, dull gray
     * when false). */
    wheelchair: boolean;
    audio: boolean;
    braille: boolean;
    libras: boolean;
    /** Atendimento preparado para PCD (equipe treinada / prioritário). */
    attendance: boolean;
    /** Bullet list under the accessibility card — each item carries its
     * own 3-state confirmation (tem / nao_tem / nao_verificado). */
    details: AccessibilityDetail[];
  };
  address: string;
  qrCodeValue: string | null;
  audioUrl: string | null;
  audioDescriptionUrl: string | null;
  librasVideoUrl: string | null;
  /** ISO timestamp of when the cadastro row was last updated (public.pontos
   * atualizado_em). Shown as a small "updated on" caption under the
   * accessibility cards. */
  updatedAt: string | null;
  /** Real-time community condition. Present only when computed (post
   * aggregation of relatos_pontos from the last 14 days). `active` means
   * problem reports outnumber ok reports — the discrete indicator is shown
   * only in that case. */
  condition?: {
    active: boolean;
    problemCount: number;
    okCount: number;
  };
}
