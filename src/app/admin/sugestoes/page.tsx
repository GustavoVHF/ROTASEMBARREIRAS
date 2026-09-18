"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Check, X, MapPin, ListChecks, RefreshCw, ThumbsUp } from "lucide-react";
import { approveSugestao, fetchPendingSugestoes, rejectSugestao } from "@/services/sugestoesAdminService";
import type { SugestaoLocalRow } from "@/types/database";

/**
 * Admin panel — /admin/sugestoes. Lists pending rows from
 * public.sugestoes_locais (queue fed by the "Sugerir um local" feature's
 * suggest_local RPC) and lets an admin approve or reject each one.
 * Approving does not auto-create a `pontos` row — cadastro do ponto em si
 * continua manual em /admin/pontos, usando os dados aqui como referência.
 */
export default function AdminSugestoesPage() {
  const [items, setItems] = useState<SugestaoLocalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actingId, setActingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchPendingSugestoes();
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar as sugestões.");
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch without the setLoading(true) prelude of load() — `loading`
  // already starts true, so nothing is set synchronously inside the effect.
  useEffect(() => {
    let cancelled = false;
    fetchPendingSugestoes()
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Não foi possível carregar as sugestões.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleApprove = async (id: string) => {
    setActingId(id);
    try {
      await approveSugestao(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível aprovar a sugestão.");
    } finally {
      setActingId(null);
    }
  };

  const handleReject = async (id: string) => {
    setActingId(id);
    try {
      await rejectSugestao(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível rejeitar a sugestão.");
    } finally {
      setActingId(null);
    }
  };

  return (
    <main className="w-full min-h-full bg-bg-app py-8 px-4 sm:px-6 flex flex-col items-center">
      <div className="w-full max-w-2xl flex flex-col gap-6">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-black text-text-main flex items-center gap-2.5">
              <ListChecks className="w-6 h-6 text-brand" />
              Fila de sugestões
            </h1>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="flex items-center gap-2 rounded-full bg-white border border-gray-200 px-4 py-2.5 text-sm font-bold text-text-secondary hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </button>
          </div>
          <p className="text-sm text-text-secondary font-medium mt-1.5 leading-relaxed">
            Locais sugeridos por usuários via o app. Aprovar remove da fila — o cadastro definitivo do ponto continua em &quot;Pontos&quot;.
          </p>
        </div>

        {error && <p className="text-sm font-bold text-brand">{error}</p>}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-brand animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-text-secondary font-medium">Nenhuma sugestão pendente.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <li
                key={item.id}
                className="bg-white rounded-3xl p-5 border border-gray-100 shadow-md flex items-start justify-between gap-4"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-text-main">{item.nome}</p>
                  {item.endereco && (
                    <p className="mt-1 text-xs text-text-secondary font-semibold flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                      {item.endereco}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-text-secondary font-semibold">
                    lat {item.latitude.toFixed(6)}, lng {item.longitude.toFixed(6)}
                  </p>
                  <p className="mt-1.5 text-xs font-bold text-brand flex items-center gap-1">
                    <ThumbsUp className="w-3.5 h-3.5" />
                    {item.apoios} {item.apoios === 1 ? "apoio" : "apoios"}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => handleApprove(item.id)}
                    disabled={actingId === item.id}
                    className="p-2.5 rounded-full bg-brand text-white hover:bg-brand-dark disabled:opacity-50 transition-colors"
                    aria-label={`Aprovar ${item.nome}`}
                  >
                    {actingId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReject(item.id)}
                    disabled={actingId === item.id}
                    className="p-2.5 rounded-full bg-gray-100 text-text-secondary hover:bg-gray-200 disabled:opacity-50 transition-colors"
                    aria-label={`Rejeitar ${item.nome}`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
