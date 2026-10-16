import { createClient } from "@/lib/supabase/client";
import type { PointStatus, RelatoRecursos } from "@/types/database";

/**
 * Moderação de relatos (/admin/relatos). A leitura inclui relatos ocultos
 * porque a policy relatos_select_public libera tudo para is_admin(). Ocultar
 * é exclusão lógica pela RPC admin_ocultar_relato (nunca apaga).
 */
export interface AdminRelatoRow {
  id: string;
  ponto_id: string;
  tipo: "ok" | "problema";
  texto: string | null;
  recursos: RelatoRecursos | null;
  criado_em: string;
  oculto: boolean;
  ocultado_em: string | null;
  pontos: { nome: string; status: PointStatus; cidade: string } | null;
}

/** Relatos mais recentes primeiro; `before` = cursor (criado_em do último item). */
export async function fetchRecentRelatos(params: { before?: string; limit?: number } = {}): Promise<AdminRelatoRow[]> {
  const { before, limit = 30 } = params;
  const supabase = createClient();
  let query = supabase
    .from("relatos_pontos")
    .select("id, ponto_id, tipo, texto, recursos, criado_em, oculto, ocultado_em, pontos(nome, status, cidade)")
    .order("criado_em", { ascending: false })
    .limit(limit);
  if (before) query = query.lt("criado_em", before);
  const { data, error } = await query;
  if (error) throw error;
  return (data as unknown as AdminRelatoRow[]) ?? [];
}

/** Oculta um relato (deixa de aparecer no app e de contar para condição e consenso). */
export async function hideRelato(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("admin_ocultar_relato", { p_relato_id: id });
  if (error) throw error;
}
