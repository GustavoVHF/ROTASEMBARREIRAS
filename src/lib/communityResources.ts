/**
 * Recursos de acessibilidade que a comunidade pode relatar em pontos
 * "Em mapeamento" (decisão D-7) e helpers de exibição das tags do
 * OpenStreetMap. A mesma lista de chaves existe no banco em
 * public.relato_recursos_validos (supabase/migrations_osm_03_relatos_comunidade.sql).
 */
import type { CommunityResourceKey, ConsensoRecursoRow, RelatoRecursos } from "@/types/database";

/** `label` = texto completo; `short` = rótulo do bloco no formulário de relato. */
export const COMMUNITY_RESOURCES: { key: CommunityResourceKey; label: string; short: string }[] = [
  { key: "entrada", label: "Entrada sem degraus ou com rampa", short: "Entrada sem degraus" },
  { key: "banheiro", label: "Banheiro adaptado", short: "Banheiro adaptado" },
  { key: "braille", label: "Braille ou sinalização tátil", short: "Braille" },
  { key: "libras", label: "Atendimento em Libras", short: "Libras" },
  { key: "atendimento", label: "Atendimento preparado para PCD", short: "Atendimento PCD" },
];

export function communityResourceLabel(key: string): string {
  return COMMUNITY_RESOURCES.find((r) => r.key === key)?.label ?? key;
}

/**
 * Bloco do formulário: ligado = "tem"; desligado = recurso omitido (não
 * enviado). Um "nao_tem" antigo vira "tem" ao tocar. Devolve objeto novo.
 */
export function toggleRecurso(value: RelatoRecursos, key: CommunityResourceKey): RelatoRecursos {
  const next: RelatoRecursos = { ...value };
  if (next[key] === "tem") delete next[key];
  else next[key] = "tem";
  return next;
}

/** "Tem: A, B · Não tem: C" (rótulos completos); null quando vazio. */
export function recursosResumo(recursos: RelatoRecursos | null | undefined): string | null {
  if (!recursos) return null;
  const tem: string[] = [];
  const naoTem: string[] = [];
  for (const r of COMMUNITY_RESOURCES) {
    if (recursos[r.key] === "tem") tem.push(r.label);
    else if (recursos[r.key] === "nao_tem") naoTem.push(r.label);
  }
  const parts: string[] = [];
  if (tem.length) parts.push(`Tem: ${tem.join(", ")}`);
  if (naoTem.length) parts.push(`Não tem: ${naoTem.join(", ")}`);
  return parts.length ? parts.join(" · ") : null;
}

/** "Relatado pela comunidade: Banheiro adaptado (3 pessoas) · …"; null quando vazio. */
export function consensoResumo(rows: ConsensoRecursoRow[] | null | undefined): string | null {
  if (!rows || rows.length === 0) return null;
  const parts = rows.map((row) => {
    const pessoas = `${row.apoiadores} ${row.apoiadores === 1 ? "pessoa" : "pessoas"}`;
    const label = communityResourceLabel(row.recurso);
    return row.estado === "nao_tem" ? `${label}: não tem (${pessoas})` : `${label} (${pessoas})`;
  });
  return `Relatado pela comunidade: ${parts.join(" · ")}`;
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
