import { createClient } from "@/lib/supabase/client";
import type { CandidatoDuplicidadeRow, PointStatus } from "@/types/database";

/**
 * Fila de revisão de duplicidade (/admin/duplicidades): elementos do
 * OpenStreetMap a até 150 m de um ponto existente com nome parecido ou mesma
 * categoria. Leitura pela policy candidatos_select_admin; resolução só pela
 * RPC admin_resolver_candidato (checa is_admin() no banco).
 */
export interface CandidatoComPonto extends CandidatoDuplicidadeRow {
  ponto: { id: string; nome: string; categoria: string; status: PointStatus; endereco: string | null } | null;
}

export async function fetchPendingCandidatos(): Promise<CandidatoComPonto[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("candidatos_duplicidade")
    .select("*, ponto:pontos!candidatos_duplicidade_ponto_existente_id_fkey(id, nome, categoria, status, endereco)")
    .eq("status", "pendente")
    .order("distancia_m");
  if (error) throw error;
  return (data as unknown as CandidatoComPonto[]) ?? [];
}

/** "vincular" ao ponto existente ou "separar" (criar como ponto em mapeamento). */
export async function resolveCandidato(
  id: string,
  acao: "vincular" | "separar"
): Promise<{ acao: string; ponto_id: string | null; mesclado?: boolean }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_resolver_candidato", { p_candidato_id: id, p_acao: acao });
  if (error) throw error;
  return data as { acao: string; ponto_id: string | null; mesclado?: boolean };
}
