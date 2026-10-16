"use client";

import React, { useEffect, useState } from "react";
import { Loader2, GitMerge, RefreshCw } from "lucide-react";
import {
  fetchPendingCandidatos,
  resolveCandidato,
  type CandidatoComPonto,
} from "@/services/duplicidadesAdminService";

function errorMessage(err: unknown, fallback: string): string {
  const msg = (err as { message?: string })?.message ?? "";
  if (msg.includes("candidato_ja_resolvido")) return "Este caso já foi resolvido. A lista foi atualizada.";
  if (msg.includes("forbidden")) return "Sem permissão para esta ação.";
  if (msg.includes("candidato_nao_encontrado")) return "Caso não encontrado. A lista foi atualizada.";
  if (msg.includes("acao_invalida")) return "Ação inválida.";
  return fallback;
}

/**
 * Admin — /admin/duplicidades. Elementos do OpenStreetMap a até 150 m de um
 * ponto já cadastrado, com nome parecido ou mesma categoria. A equipe decide:
 * vincular ao ponto existente (só completa campos vazios, nunca sobrescreve
 * dado oficial) ou criar como ponto "em mapeamento" separado.
 */
export default function AdminDuplicidadesPage() {
  const [items, setItems] = useState<CandidatoComPonto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actingId, setActingId] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      setItems(await fetchPendingCandidatos());
    } catch (err) {
      setError(errorMessage(err, "Não foi possível carregar a fila."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetchPendingCandidatos()
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, "Não foi possível carregar a fila."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleResolve = async (item: CandidatoComPonto, acao: "vincular" | "separar") => {
    setActingId(item.id);
    setError("");
    try {
      await resolveCandidato(item.id, acao);
    } catch (err) {
      setError(errorMessage(err, "Não foi possível resolver este caso."));
    } finally {
      setActingId(null);
    }
    // Recarrega para tirar também os "irmãos" do mesmo elemento.
    await reload();
  };

  return (
    <main className="w-full min-h-full bg-bg-app py-8 px-4 sm:px-6 flex flex-col items-center">
      <div className="w-full max-w-2xl flex flex-col gap-6">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-black text-text-main flex items-center gap-2.5">
              <GitMerge className="w-6 h-6 text-brand" aria-hidden="true" />
              Possíveis duplicidades
            </h1>
            <button
              type="button"
              onClick={() => {
                setError("");
                void reload();
              }}
              disabled={loading}
              className="flex items-center gap-2 rounded-full bg-white border border-gray-200 px-4 py-2.5 text-sm font-bold text-text-secondary hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              Atualizar
            </button>
          </div>
          <p className="text-sm text-text-secondary font-medium mt-1.5 leading-relaxed">
            Locais do OpenStreetMap perto de um ponto já cadastrado. Vincular só completa campos vazios do ponto existente.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm font-bold text-accent-text">
            {error}
          </p>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-brand animate-spin" aria-label="Carregando" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-text-secondary font-medium">Nenhum caso pendente.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item) => {
              const existente = item.ponto;
              const nomeExistente = existente?.nome ?? "Ponto removido";
              return (
                <li key={item.id} className="bg-white rounded-3xl p-5 border border-gray-200 flex flex-col gap-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-extrabold uppercase tracking-wider text-text-secondary">No OpenStreetMap</p>
                      <p className="mt-1 text-sm font-black text-text-main">{item.nome}</p>
                      <p className="text-xs text-text-secondary font-semibold">
                        {item.categoria} · {item.osm_tipo}/{item.osm_id}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-extrabold uppercase tracking-wider text-text-secondary">Já cadastrado</p>
                      <p className="mt-1 text-sm font-black text-text-main">{nomeExistente}</p>
                      {existente && (
                        <p className="text-xs text-text-secondary font-semibold">
                          {existente.categoria} · {existente.status === "oficial" ? "Oficial" : "Em mapeamento"}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="text-sm text-text-secondary font-semibold flex flex-col gap-0.5">
                    <p>Distância: {Math.round(Number(item.distancia_m))} m</p>
                    <p>Nome parecido: {Math.round(Number(item.similaridade) * 100)}%</p>
                    <p>Mesma categoria: {item.mesma_categoria ? "sim" : "não"}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleResolve(item, "vincular")}
                      disabled={actingId !== null}
                      className="flex items-center gap-2 rounded-full bg-brand text-white px-4 py-2.5 text-sm font-bold hover:bg-brand-dark disabled:opacity-50"
                      aria-label={`Vincular ${item.nome} do OpenStreetMap ao ponto existente ${nomeExistente}`}
                    >
                      {actingId === item.id && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                      Vincular ao ponto existente
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResolve(item, "separar")}
                      disabled={actingId !== null}
                      className="rounded-full bg-gray-100 text-text-main px-4 py-2.5 text-sm font-bold hover:bg-gray-200 disabled:opacity-50"
                      aria-label={`Criar ${item.nome} como ponto separado de ${nomeExistente}`}
                    >
                      Criar como ponto separado
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
