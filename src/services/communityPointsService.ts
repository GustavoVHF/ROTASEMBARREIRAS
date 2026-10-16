/**
 * Pontos "Em mapeamento" (locais do OpenStreetMap importados pelo script
 * scripts/sync-osm.mjs). O app nunca consulta a API do OpenStreetMap: tudo
 * aqui lê o Supabase (tabela pontos e RPCs das migrações migrations_osm_0*.sql).
 */
import { createClient } from "@/lib/supabase/client";
import { queryWithSessionRecovery, rowToPoint } from "@/services/pointsService";
import type {
  CommunityLayerRow,
  CommunityVoiceRow,
  ConsensoRecursoRow,
  ExistingPlaceMatch,
  PontoRow,
} from "@/types/database";
import type { TouristPoint } from "@/types/point";
import { voiceLog } from "@/lib/voice/logger";

/** Camada comunitária do mapa: pontos/grupos na área visível (cluster no servidor). */
export async function fetchCommunityLayer(params: {
  bounds: { west: number; south: number; east: number; north: number };
  zoom: number;
  category: string | null;
  excludeId: string | null;
  maxItens: number;
  signal: AbortSignal;
}): Promise<CommunityLayerRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .rpc("pontos_comunidade_bbox", {
      p_oeste: params.bounds.west,
      p_sul: params.bounds.south,
      p_leste: params.bounds.east,
      p_norte: params.bounds.north,
      p_zoom: Math.floor(params.zoom),
      p_categoria: params.category,
      p_excluir_id: params.excludeId,
      p_max_itens: params.maxItens,
    })
    .abortSignal(params.signal);
  if (error) throw error;
  return (data as CommunityLayerRow[]) ?? [];
}

/** Um ponto em mapeamento pelo id (null se não existir ou não for em mapeamento). */
export async function fetchCommunityPoint(id: string): Promise<TouristPoint | null> {
  const supabase = createClient();
  const { data, error } = await queryWithSessionRecovery<PontoRow>(() =>
    supabase.from("pontos").select("*").eq("id", id).eq("status", "em_mapeamento").maybeSingle()
  );
  if (error) throw error;
  return data ? rowToPoint(data) : null;
}

/** Qualquer ponto pelo id (oficial ou em mapeamento) — usado por "Ver local". */
export async function fetchPontoById(id: string): Promise<TouristPoint | null> {
  const supabase = createClient();
  const { data, error } = await queryWithSessionRecovery<PontoRow>(() =>
    supabase.from("pontos").select("*").eq("id", id).maybeSingle()
  );
  if (error) throw error;
  return data ? rowToPoint(data) : null;
}

/** Consenso da comunidade por recurso. Complementar: erro vira [] ("não verificado"). */
export async function fetchConsensus(pontoId: string): Promise<ConsensoRecursoRow[]> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("consenso_recursos", { p_ponto_id: pontoId });
    if (error || !data) return [];
    return data as ConsensoRecursoRow[];
  } catch {
    return [];
  }
}

/** Pré-checagem de duplicidade (mesmo lugar, nome parecido). Lança em caso de erro. */
export async function checkExistingPlace(nome: string, lat: number, lng: number): Promise<ExistingPlaceMatch[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("verificar_local_existente", {
    p_nome: nome.trim().slice(0, 120),
    p_latitude: lat,
    p_longitude: lng,
  });
  if (error) throw error;
  return (data as ExistingPlaceMatch[]) ?? [];
}

/** Busca para o assistente de voz. Nunca lança: erro vira []. */
export async function searchCommunityPointsForVoice(params: {
  texto?: string | null;
  cidade?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  raioM?: number | null;
  limite?: number | null;
  categoria?: string | null;
}): Promise<CommunityVoiceRow[]> {
  const cut = (v: string | null | undefined, max: number) => {
    const t = (v ?? "").trim();
    return t ? t.slice(0, max) : null;
  };
  try {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("buscar_pontos_comunidade", {
      p_texto: cut(params.texto, 120),
      p_cidade: cut(params.cidade, 80),
      p_latitude: params.latitude ?? null,
      p_longitude: params.longitude ?? null,
      p_raio_m: params.raioM ?? 2000,
      p_limite: params.limite ?? 5,
      p_categoria: cut(params.categoria, 40),
    });
    if (error) throw error;
    return (data as CommunityVoiceRow[]) ?? [];
  } catch (error) {
    // Não fatal: o assistente responde só com os oficiais.
    voiceLog("community_search_failed", error);
    return [];
  }
}

/** Converte uma linha da busca comunitária em TouristPoint (para goToPoint). */
export function rowToCommunityTouristPoint(row: CommunityVoiceRow): TouristPoint {
  const osm = {
    wheelchair: row.osm_wheelchair,
    toiletsWheelchair: row.osm_toilets_wheelchair,
    openingHours: row.osm_opening_hours,
    phone: row.osm_phone,
    website: row.osm_website,
  };
  return {
    id: row.ponto_id,
    name: row.nome,
    category: row.categoria,
    city: row.cidade ?? "",
    coords: { lat: row.latitude, lng: row.longitude },
    image: "",
    gallery: [],
    imageFolder: null,
    description: "",
    history: "",
    accessibility: {
      wheelchair: false,
      audio: false,
      braille: false,
      libras: false,
      attendance: false,
      details: [],
    },
    address: row.endereco ?? "",
    qrCodeValue: null,
    audioUrl: null,
    audioDescriptionUrl: null,
    librasVideoUrl: null,
    updatedAt: null,
    status: "em_mapeamento",
    osm: Object.values(osm).some((v) => v !== null) ? osm : null,
  };
}
