/**
 * Acesso aos pontos turísticos NO SERVIDOR, para as páginas públicas
 * indexáveis (/pontos e /pontos/[slug]), sitemap e llms.txt.
 *
 * POR QUE UM CLIENTE PRÓPRIO, E NÃO src/lib/supabase/server.ts: aquele usa
 * cookies() para manter a sessão do usuário, o que torna a rota dinâmica e
 * impede pré-renderização. Aqui a leitura é pública (policy RLS
 * `pontos_select_public`, ver supabase/migrations.sql, concede SELECT para o
 * papel `anon`), então basta a chave anônima, sem cookie nenhum — e as páginas
 * podem ser estáticas com ISR.
 *
 * REGRA DE CONTEÚDO: nada aqui afirma que um recurso de acessibilidade existe.
 * Os campos do cadastro são expostos com o estado explícito (declarado /
 * declarado como ausente / não informado) para que o HTML e o JSON-LD digam a
 * mesma coisa, sem inventar validação que a UAI ainda não fez.
 */
import { createClient } from "@supabase/supabase-js";
import type { PontoRow } from "@/types/database";

export interface PublicPonto {
  id: string;
  slug: string;
  nome: string;
  categoria: string;
  cidade: string;
  endereco: string | null;
  latitude: number;
  longitude: number;
  descricaoCurta: string | null;
  descricaoLonga: string | null;
  imagemCapa: string | null;
  galeria: string[];
  qrCodeValue: string | null;
  atualizadoEm: string | null;
  /** Recursos principais, com o estado do cadastro (nunca "validado"). */
  recursos: Array<{ label: string; declared: boolean }>;
  /** Itens detalhados do cadastro, com os 3 estados originais. */
  detalhes: Array<{ texto: string; estado: "tem" | "nao_tem" | "nao_verificado" }>;
}

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Mesma normalização usada no painel admin para a pasta de imagens. */
function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

/**
 * Slug da URL pública. Ordem de preferência:
 *   1. qr_code_value sem o prefixo "rota-" (é o identificador físico já
 *      impresso nos QR Codes, então a URL fica estável)
 *   2. pasta_imagens
 *   3. slug do nome
 * Colisões recebem sufixo com o início do id — determinístico entre builds.
 */
function buildSlug(row: PontoRow, taken: Set<string>): string {
  const candidates = [
    row.qr_code_value?.replace(/^rota-/, "") ?? "",
    row.pasta_imagens ?? "",
    row.nome,
  ];
  let base = "";
  for (const candidate of candidates) {
    base = slugify(candidate || "");
    if (base) break;
  }
  if (!base) base = `ponto-${row.id.slice(0, 8)}`;
  let slug = base;
  if (taken.has(slug)) slug = `${base}-${row.id.slice(0, 6)}`;
  taken.add(slug);
  return slug;
}

function rowToPublic(row: PontoRow, taken: Set<string>): PublicPonto {
  return {
    id: row.id,
    slug: buildSlug(row, taken),
    nome: row.nome,
    categoria: row.categoria,
    cidade: row.cidade ?? "",
    endereco: row.endereco,
    latitude: row.latitude,
    longitude: row.longitude,
    descricaoCurta: row.descricao_curta,
    descricaoLonga: row.descricao_longa,
    imagemCapa: row.imagem_capa,
    galeria: row.galeria_imagens ?? [],
    qrCodeValue: row.qr_code_value,
    atualizadoEm: row.atualizado_em ?? row.criado_em ?? null,
    recursos: [
      { label: "Rampa ou acesso sem escadas", declared: row.acessibilidade_rampa },
      { label: "Áudio guia", declared: row.acessibilidade_audio },
      { label: "Braille", declared: row.acessibilidade_braille },
      { label: "Libras", declared: row.acessibilidade_libras },
      { label: "Atendimento preparado para PCD", declared: row.acessibilidade_atendimento ?? false },
    ],
    detalhes: (row.acessibilidade_detalhes ?? []).filter((d) => d?.texto),
  };
}

/** Todos os pontos, ordem alfabética (estável para sitemap e listagem). */
export async function fetchPublicPontos(): Promise<PublicPonto[]> {
  const supabase = serverClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("pontos")
    .select("*")
    .order("nome", { ascending: true });
  // Falha de rede/env não pode derrubar o build inteiro: a página cai para
  // "nenhum ponto publicado" e o deploy segue.
  if (error || !data) return [];
  const taken = new Set<string>();
  return (data as PontoRow[]).map((row) => rowToPublic(row, taken));
}

export async function fetchPublicPontoBySlug(slug: string): Promise<PublicPonto | null> {
  const all = await fetchPublicPontos();
  return all.find((p) => p.slug === slug) ?? null;
}

/** Texto curto e factual usado em <meta description> e na listagem. */
export function pontoSummary(ponto: PublicPonto): string {
  if (ponto.descricaoCurta?.trim()) return ponto.descricaoCurta.trim();
  const local = [ponto.cidade, "MG"].filter(Boolean).join(" - ");
  return `${ponto.nome} é um ponto turístico de ${ponto.categoria.toLowerCase()} em ${local}, com informações de acessibilidade e como chegar no Rota sem Barreiras.`;
}

/** Rótulo dos 3 estados dos itens detalhados, igual ao que o website mostra. */
export const ESTADO_LABEL: Record<PublicPonto["detalhes"][number]["estado"], string> = {
  tem: "Declarado no cadastro",
  nao_tem: "Declarado como ausente",
  nao_verificado: "Não informado",
};
