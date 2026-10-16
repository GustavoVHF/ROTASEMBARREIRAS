/**
 * Recursos de acessibilidade que a comunidade pode relatar em pontos
 * "Em mapeamento" (decisão D-7) e helpers de exibição das tags do
 * OpenStreetMap. A mesma lista de chaves existe no banco em
 * public.relato_recursos_validos (supabase/migrations_osm_03_relatos_comunidade.sql).
 */
import type { CommunityResourceKey } from "@/types/database";

export const COMMUNITY_RESOURCES: { key: CommunityResourceKey; label: string }[] = [
  { key: "entrada", label: "Entrada sem degraus ou com rampa" },
  { key: "banheiro", label: "Banheiro adaptado" },
  { key: "braille", label: "Braille ou sinalização tátil" },
  { key: "libras", label: "Atendimento em Libras" },
  { key: "atendimento", label: "Atendimento preparado para PCD" },
];

export function communityResourceLabel(key: string): string {
  return COMMUNITY_RESOURCES.find((r) => r.key === key)?.label ?? key;
}

/** Valores de wheelchair / toilets:wheelchair no OSM. Desconhecidos são omitidos. */
export const OSM_VALUE_LABEL: Record<string, string> = {
  yes: "sim",
  limited: "parcial",
  no: "não",
  designated: "sim, adaptado",
};

export function osmValueLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return OSM_VALUE_LABEL[raw.trim().toLowerCase()] ?? null;
}

const DAY_LABEL: Record<string, string> = {
  Mo: "seg",
  Tu: "ter",
  We: "qua",
  Th: "qui",
  Fr: "sex",
  Sa: "sáb",
  Su: "dom",
  PH: "feriados",
};

/**
 * Traduz o essencial de opening_hours para pt-BR ("Mo-Fr 08:00-18:00" ->
 * "seg-sex 08:00-18:00"). Devolve o texto original se não reconhecer nada.
 */
export function formatOpeningHours(raw: string): string {
  let changed = false;
  let out = raw.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (m) => {
    changed = true;
    return DAY_LABEL[m];
  });
  out = out.replace(/\boff\b/g, () => {
    changed = true;
    return "fechado";
  });
  if (out.includes(";")) {
    changed = true;
    out = out.split(";").map((s) => s.trim()).filter(Boolean).join("; ");
  }
  return changed ? out : raw;
}

/** tel: só com dígitos e "+". */
export function phoneHref(raw: string): string {
  return `tel:${raw.replace(/[^0-9+]/g, "")}`;
}

/** Hostname para exibir no lugar da URL inteira. */
export function websiteLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
